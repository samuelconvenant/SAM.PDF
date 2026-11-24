import { PDFDocument, degrees, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } from "pdf-lib";
import type { PDFFont, PDFPage, StandardFonts } from "pdf-lib";
import { zipSync } from "fflate";
import { maxBytes, maxFiles } from "./tools";
import type { Job, JobResult } from "./pdf-protocol";
import type { Overlay } from "./editor-types";
import { overlayFont, photoLayout, textBoxLines } from "./overlay-layout";
import { assertFontCoverage, fontBytes, loadFontMetrics } from "./document-fonts";
import { standardPostScript } from "./draft-fonts";

function pdfColor(value: string) {
  const hex = Number.parseInt(value.slice(1), 16);
  return rgb((hex >> 16) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

const overlayFonts = new WeakMap<PDFDocument, Map<string, Promise<PDFFont>>>();

function embedOverlayFont(pdf: PDFDocument, overlay: Overlay) {
  const { family, face } = overlayFont(overlay);
  const key = `${family.pdf}:${face}`;
  let cache = overlayFonts.get(pdf);
  if (!cache) { cache = new Map(); overlayFonts.set(pdf, cache); }
  let pending = cache.get(key);
  if (!pending) {
    const asset = family.asset;
    pending = asset ? Promise.all([import("@pdf-lib/fontkit"), fontBytes(asset, face)]).then(([{ default: fontkit }, bytes]) => {
      pdf.registerFontkit(fontkit);
      return pdf.embedFont(bytes, { subset: true });
    }) : pdf.embedFont(standardPostScript(family, face) as StandardFonts);
    cache.set(key, pending);
  }
  return pending;
}

async function drawOverlay(pdf: PDFDocument, page: PDFPage, overlay: Overlay) {
  const box = page.getCropBox();
  const x = (value: number) => box.x + value * box.width;
  const y = (value: number) => box.y + (1 - value) * box.height;
  const color = pdfColor(overlay.color);
  const width = overlay.width * box.width;
  const height = overlay.height * box.height;
  const left = x(overlay.x);
  const top = y(overlay.y);
  if (overlay.kind === "text") {
    const { family, face } = overlayFont(overlay);
    const [font, metrics] = await Promise.all([embedOverlayFont(pdf, overlay), loadFontMetrics(family, face)]);
    assertFontCoverage(family, metrics, overlay.text);
    if (overlay.cover) page.drawRectangle({ x: left, y: top - height, width, height, color: rgb(1, 1, 1) });
    page.pushOperators(pushGraphicsState(), rectangle(left, top - height, width, height), clip(), endPath());
    for (const line of textBoxLines(overlay, width, height, metrics)) {
      if (!line.text) continue;
      const x = left + line.x;
      const y = top - line.y;
      if (overlay.highlight) page.drawRectangle({ x, y: y + line.ascent - line.height, width: line.width, height: line.height, color: pdfColor(overlay.highlight) });
      page.drawText(line.text, { x, y, font, size: overlay.size, color });
      if (overlay.underline) page.drawLine({ start: { x, y: y - overlay.size * .12 }, end: { x: x + line.width, y: y - overlay.size * .12 }, thickness: overlay.size * .05, color });
    }
    page.pushOperators(popGraphicsState());
  } else if (overlay.kind === "image" && overlay.photo) {
    const image = overlay.photo.data.startsWith("data:image/jpeg;") ? await pdf.embedJpg(overlay.photo.data) : await pdf.embedPng(overlay.photo.data);
    const fit = photoLayout(overlay, width, height);
    page.pushOperators(pushGraphicsState(), rectangle(left, top - height, width, height), clip(), endPath());
    page.drawImage(image, { x: left + fit.x, y: top - fit.y - fit.height, width: fit.width, height: fit.height });
    page.pushOperators(popGraphicsState());
  } else if (overlay.kind === "ink") {
    for (let index = 1; index < overlay.points.length; index++) {
      const start = overlay.points[index - 1];
      const end = overlay.points[index];
      page.drawLine({ start: { x: x(start.x + overlay.x), y: y(start.y + overlay.y) }, end: { x: x(end.x + overlay.x), y: y(end.y + overlay.y) }, color, thickness: 2 });
    }
  } else {
    page.drawRectangle({
      x: x(overlay.x), y: y(overlay.y + overlay.height), width: overlay.width * box.width, height: overlay.height * box.height,
      ...(overlay.kind === "highlight" ? { color, opacity: .32 } : { borderColor: color, borderWidth: 2, color, opacity: 0 }),
    });
  }
}

async function openPdf(file: File) {
  let pdf: PDFDocument;
  let pageCount: number;
  try {
    pdf = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
    pageCount = pdf.getPageCount();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Input document to `PDFDocument.load` is encrypted.")) {
      throw new Error(`“${file.name}” is password-protected or encrypted. Choose an unencrypted copy.`);
    }
    throw new Error(`“${file.name}” could not be read as a PDF. Check the file and try again.`);
  }
  if (!pageCount) throw new Error(`“${file.name}” has no pages.`);
  return pdf;
}

async function checkSignature(file: File, image: boolean) {
  const header = new Uint8Array(await file.slice(0, image ? 8 : 1024).arrayBuffer());
  const isPng = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => header[index] === value);
  const isJpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
  if (image ? !isPng && !isJpeg : !new TextDecoder().decode(header).includes("%PDF-")) {
    throw new Error(`“${file.name}” is not a valid ${image ? "JPEG or PNG image" : "PDF"}.`);
  }
  return isPng;
}

function parseRanges(value: string, pageCount: number) {
  const entries = value.split(",");
  if (entries.length > 100) throw new Error("Enter up to 100 comma-separated ranges.");
  const ranges = entries.map((entry) => {
    const parts = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(entry.trim());
    if (!parts) throw new Error("Enter page numbers or ranges such as 1-3, 5.");
    const start = Number(parts[1]);
    const end = Number(parts[2] ?? start);
    if (start < 1 || end < start || end > pageCount) {
      throw new Error(`Enter increasing ranges between 1 and ${pageCount}.`);
    }
    return { start, end };
  });
  if (ranges.reduce((total, { start, end }) => total + end - start + 1, 0) > 1000) {
    throw new Error("Select up to 1,000 output pages per split.");
  }
  return ranges;
}

function result(bytes: Uint8Array, name: string, mime = "application/pdf"): JobResult {
  return { type: "processed", data: new Uint8Array(bytes).buffer, name, mime };
}

async function run(job: Job): Promise<JobResult> {
  if (!job.files.length || job.files.length > maxFiles || job.files.some((file) => file.size === 0) ||
      job.files.reduce((size, file) => size + file.size, 0) > maxBytes) {
    throw new Error("Choose up to 30 non-empty files with a combined size of 80 MiB or less.");
  }

  if (job.type === "inspect") {
    let pages: import("./pdf-protocol").PageEdit[] = [];
    const counts: number[] = [];
    for (const file of job.files) {
      await checkSignature(file, job.image);
      if (!job.image) {
        const pdf = await openPdf(file);
        counts.push(pdf.getPageCount());
        if (job.files.length === 1) pages = pdf.getPages().map((page, index) => {
          const { width, height } = page.getCropBox();
          return { index, rotation: page.getRotation().angle, width, height };
        });
      }
    }
    return { type: "inspected", pages, counts };
  }

  const [first] = job.files;
  if (job.operation === "split") {
    const source = await openPdf(first);
    const ranges = parseRanges(job.ranges, source.getPageCount());
    const entries: Record<string, Uint8Array> = {};
    for (const [index, { start, end }] of ranges.entries()) {
      const output = await PDFDocument.create();
      const pages = await output.copyPages(source, Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i));
      for (const page of pages) output.addPage(page);
      const name = `part-${index + 1}-pages-${start}-${end}.pdf`;
      const bytes = await output.save();
      if (ranges.length === 1) return result(bytes, name);
      entries[name] = bytes;
    }
    return result(zipSync(entries, { level: 0 }), "sampdf-split.zip", "application/zip");
  }

  if (job.operation === "edit") {
    const edits = job.edits;
    if (!edits?.length) throw new Error("Keep at least one page.");
    const source = await openPdf(first);
    const original = source.getPages();
    for (const edit of edits) {
      const page = original[edit.index];
      if (page.getRotation().angle !== edit.rotation) page.setRotation(degrees(edit.rotation));
      for (const overlay of edit.overlays) await drawOverlay(source, page, overlay);
    }
    const kept = new Set(edits.map(({ index }) => index));
    for (let index = original.length - 1; index >= 0; index--) {
      if (!kept.has(index)) source.removePage(index);
    }
    return result(await source.save({ updateFieldAppearances: false }), "sampdf-edit.pdf");
  }

  const output = await PDFDocument.create();
  if (job.operation === "merge") {
    if (job.files.length < 2) throw new Error("Choose at least two PDFs to merge.");
    for (const file of job.files) {
      const source = await openPdf(file);
      const pages = await output.copyPages(source, source.getPageIndices());
      for (const page of pages) output.addPage(page);
    }
  } else if (job.operation === "organize") {
    const selected = job.pages;
    if (!selected.length) throw new Error("Keep at least one page.");
    const source = await openPdf(first);
    const pages = await output.copyPages(source, selected.map(({ index }) => index));
    pages.forEach((page, index) => {
      page.setRotation(degrees(selected[index].rotation));
      output.addPage(page);
    });
  } else {
    for (const file of job.files) {
      const isPng = await checkSignature(file, true);
      const bytes = await file.arrayBuffer();
      try {
        const image = isPng ? await output.embedPng(bytes) : await output.embedJpg(bytes);
        const [width, height] = job.fit === "a4" ? [595.28, 841.89] : [image.width, image.height];
        const size = image.scaleToFit(width, height);
        const page = output.addPage([width, height]);
        page.drawImage(image, { ...size, x: (width - size.width) / 2, y: (height - size.height) / 2 });
      } catch {
        throw new Error(`“${file.name}” could not be opened as an image.`);
      }
    }
  }
  return result(await output.save(), `sampdf-${job.operation}.pdf`);
}

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<Job>) => void) | null;
  postMessage: (value: JobResult, transfer?: ArrayBuffer[]) => void;
};

worker.onmessage = async ({ data }) => {
  try {
    const value = await run(data);
    worker.postMessage(value, value.type === "processed" ? [value.data] : []);
  } catch (error) {
    worker.postMessage({ type: "error", message: error instanceof Error ? error.message : "The file could not be processed." });
  }
};
