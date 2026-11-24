import { clip, degrees, endPath, PDFDocument, PDFName, popGraphicsState, pushGraphicsState, rectangle, rgb, StandardFonts } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import { smartPageLimit, smartPdfLimit } from "./smart-commands";
import { smartOperations } from "./smart-plan";
import type { SmartJob, SmartOperation, SmartRect } from "./smart-plan";

class SmartEditError extends Error {}

function coordinates(page: PDFPage) {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  let left = Math.max(media.x, crop.x);
  let bottom = Math.max(media.y, crop.y);
  let right = Math.min(media.x + media.width, crop.x + crop.width);
  let top = Math.min(media.y + media.height, crop.y + crop.height);
  if (right <= left || top <= bottom) {
    ({ x: left, y: bottom } = media);
    right = left + media.width;
    top = bottom + media.height;
  }
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  const swap = angle === 90 || angle === 270;
  const width = swap ? top - bottom : right - left;
  const height = swap ? right - left : top - bottom;
  if (![0, 90, 180, 270].includes(angle) || width <= 0 || height <= 0) throw new SmartEditError("The page dimensions or rotation are unsupported.");

  function point(x: number, y: number) {
    switch (angle) {
      case 90: return { x: left + y, y: bottom + x };
      case 180: return { x: right - x, y: bottom + y };
      case 270: return { x: right - y, y: top - x };
      default: return { x: left + x, y: top - y };
    }
  }
  return { width, height, point, rotate: degrees(angle) };
}

function textWidth(font: PDFFont, text: string, size: number) {
  try { return font.widthOfTextAtSize(text, size); }
  catch { throw new SmartEditError("The text includes characters outside the Smart Editor font. Use manual Edit PDF to choose a different font."); }
}

function addText(page: PDFPage, font: PDFFont, text: string, position: { edge: string; align: string }, anchor?: { x: number; y: number }) {
  const { width, height, point, rotate } = coordinates(page);
  const size = Math.min(13, height * .12);
  const textLength = textWidth(font, text, size);
  const x = anchor ? anchor.x * width : position.align === "left" ? width * .06 : position.align === "right" ? width * .94 - textLength : (width - textLength) / 2;
  const y = anchor ? anchor.y * height + size : position.edge === "top" ? height * .06 + size : position.edge === "bottom" ? height * .94 : height / 2 + size / 2;
  if (x < 0 || x + textLength > width || y > height * .98) throw new SmartEditError("The text is too long or there is not enough room at this position.");
  page.drawText(text, { ...point(x, y), rotate, font, size, color: rgb(0, 0, 0) });
}

async function drawPhoto(pdf: PDFDocument, page: PDFPage, image: string | undefined, box: SmartRect) {
  if (!image || image.length > 32 * 1024 * 1024 || !/^data:image\/(jpeg|png);base64,/.test(image)) throw new SmartEditError("Choose a supported JPEG or PNG photo.");
  const photo = image.startsWith("data:image/jpeg;") ? await pdf.embedJpg(image) : await pdf.embedPng(image);
  const { point, width, height, rotate } = coordinates(page);
  const x = width * box.x;
  const y = height * box.y;
  const w = width * box.width;
  const h = height * box.height;
  const a = point(x, y);
  const b = point(x + w, y + h);
  const scale = Math.max(w / photo.width, h / photo.height);
  const photoWidth = photo.width * scale;
  const photoHeight = photo.height * scale;
  page.pushOperators(pushGraphicsState(), rectangle(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y)), clip(), endPath());
  page.drawImage(photo, { ...point(x + (w - photoWidth) / 2, y + (h + photoHeight) / 2), rotate, width: photoWidth, height: photoHeight });
  page.pushOperators(popGraphicsState());
}

async function prepare({ source, operations: input, image }: SmartJob) {
  if (!(source instanceof File) || !source.size || source.size > smartPdfLimit) throw new SmartEditError("Choose a non-empty PDF of 25 MiB or less.");
  const operation = smartOperations.safeParse(input);
  if (!operation.success) throw new SmartEditError("This instruction produced an invalid editing operation.");
  const edits = operation.data;
  const pdf = await PDFDocument.load(await source.arrayBuffer(), { updateMetadata: false, throwOnInvalidObject: true }).catch(() => {
    throw new SmartEditError("This PDF could not be edited. Open a readable, unlocked copy and try again.");
  });
  const pages = pdf.getPages();
  if (!pages.length || pages.length > smartPageLimit) throw new SmartEditError("Smart PDF Editor supports up to 150 pages.");
  if (edits.some((edit) => "page" in edit && edit.page >= pages.length)) throw new SmartEditError("Choose a page in this document.");
  const removed = new Set(edits.flatMap((edit) => edit.kind === "remove_page" ? [edit.page] : []));
  if (removed.size >= pages.length) throw new SmartEditError("A PDF needs at least one page.");
  if (edits.some((edit) => "page" in edit && edit.kind !== "remove_page" && removed.has(edit.page))) {
    throw new SmartEditError("This plan edits and deletes the same page. Revise the instruction and remove the conflict.");
  }
  const reorder = edits.filter((edit) => edit.kind === "reorder_pages");
  const numbering = edits.filter((edit) => edit.kind === "add_page_numbers");
  if (reorder.length > 1 || numbering.length > 1) throw new SmartEditError("Give one page order and one numbering instruction per review.");

  async function applyContent(edit: SmartOperation) {
    switch (edit.kind) {
    case "rotate_page": {
      const page = pages[edit.page];
      page.setRotation(degrees(((page.getRotation().angle + edit.angle) % 360 + 360) % 360));
      break;
    }
    case "add_text": {
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      addText(pages[edit.page], font, edit.text, edit.position, edit.anchor);
      break;
    }
    case "cover_text": {
      const font = await pdf.embedFont(edit.serif ?
        (edit.bold ? StandardFonts.TimesRomanBold : StandardFonts.TimesRoman) :
        (edit.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica));
      const page = pages[edit.page];
      const { point, rotate, width, height } = coordinates(page);
      const x = edit.baseline.x * width;
      const y = edit.baseline.y * height;
      if (x + textWidth(font, edit.text, edit.size) > width * (edit.right ?? 1) || y - edit.size * .8 < 0 || y + edit.size * .2 > height) {
        throw new SmartEditError("The replacement does not fit in the available space. Try shorter text or use manual Edit PDF for precise placement.");
      }
      const { cover } = edit;
      page.drawRectangle({ ...point(cover.x * width, (cover.y + cover.height) * height), width: cover.width * width, height: cover.height * height,
        rotate, color: rgb(1, 1, 1) });
      const [r, g, b] = edit.color.slice(1).match(/../g)!.map((value) => Number.parseInt(value, 16) / 255);
      page.drawText(edit.text, { ...point(x, y), rotate, font, size: edit.size, color: rgb(r, g, b) });
      break;
    }
    case "set_field": {
      if (pdf.catalog.getAcroForm()?.dict.has(PDFName.of("XFA"))) {
        throw new SmartEditError("This form uses XFA. Upload a standard AcroForm or an accessible flattened copy.");
      }
      const form = pdf.getForm();
      const field = form.getTextField(edit.field);
      if (field.isReadOnly() || field.isRichFormatted() || (field.getText() ?? "") !== edit.before) {
        throw new SmartEditError("This field is read-only, rich-text, or its value has changed. Review the source form.");
      }
      if (edit.text.length > (field.getMaxLength() ?? Infinity)) throw new SmartEditError("The new text exceeds this field’s character limit.");
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      textWidth(font, edit.text, 12);
      field.setText(edit.text);
      field.updateAppearances(font);
      break;
    }
    case "insert_image":
      await drawPhoto(pdf, pages[edit.page], image, edit.box);
      break;
    case "remove_page":
    case "reorder_pages":
    case "add_page_numbers":
      break;
    }
  }
  // Page references in a review refer to the original order. Number the final order last.
  for (const edit of edits) if (edit.kind !== "rotate_page") await applyContent(edit);
  for (const edit of edits) if (edit.kind === "rotate_page") await applyContent(edit);
  if (reorder[0]) {
    const { order } = reorder[0];
    if (order.length !== pages.length || new Set(order).size !== pages.length || order.some((index) => index >= pages.length)) {
      throw new SmartEditError("List each page exactly once.");
    }
    for (let index = pages.length - 1; index >= 0; index--) pdf.removePage(index);
    for (const index of order) if (!removed.has(index)) pdf.addPage(pages[index]);
  } else {
    for (let index = pages.length - 1; index >= 0; index--) if (removed.has(index)) pdf.removePage(index);
  }
  if (numbering[0]) {
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const position = numbering[0].position;
    pdf.getPages().forEach((page, index) => addText(page, font, String(index + 1), position));
  }
  const bytes = await pdf.save({ updateFieldAppearances: false });
  if (bytes.byteLength > smartPdfLimit) throw new SmartEditError("The result exceeds the 25 MiB Smart Editor limit.");
  return new File([new Uint8Array(bytes)], source.name, { type: "application/pdf" });
}

self.onmessage = ({ data }: MessageEvent<SmartJob>) => {
  void prepare(data).then((result) => self.postMessage({ result })).catch((error: unknown) => {
    self.postMessage({ error: error instanceof SmartEditError ? error.message : "This document could not be edited. Try a smaller PDF or a simpler instruction." });
  });
};
