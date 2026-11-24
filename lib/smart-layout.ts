import type { PDFDocumentProxy, PDFPageProxy, TextItem, TextStyle } from "pdfjs-dist/types/src/display/api";
import type { Instruction } from "./smart-commands";
import { smartOperation } from "./smart-plan";
import type { SmartOperation, SmartRect } from "./smart-plan";

export type TextCandidate = { text: string; rect: SmartRect; baseline: { x: number; y: number }; size: number; bold: boolean; serif?: boolean };
type Proposal = { operation: SmartOperation; note?: string };

function bounds(points: number[][]): SmartRect {
  const x = Math.min(...points.map((point) => point[0]));
  const y = Math.min(...points.map((point) => point[1]));
  return { x, y, width: Math.max(...points.map((point) => point[0])) - x, height: Math.max(...points.map((point) => point[1])) - y };
}

export function textCandidate(page: PDFPageProxy, item: TextItem, style?: TextStyle): TextCandidate | null {
  const viewport = page.getViewport({ scale: 1 });
  const [a, b, c, d, x, y] = item.transform;
  const size = Math.hypot(c, d);
  if (!size || !item.width || item.dir !== "ltr" || !item.str.trim()) return null;
  const end = viewport.convertToViewportPoint(x + a * item.width / Math.hypot(a, b), y + b * item.width / Math.hypot(a, b));
  const start = viewport.convertToViewportPoint(x, y);
  if (Math.abs(end[1] - start[1]) > 1 || end[0] <= start[0]) return null;
  const rise = (style?.ascent || .95) * 1.12;
  const drop = Math.min(style?.descent ?? -.25, -.22);
  const visual = bounds([
    [start[0] - 1, start[1]], [end[0] + 1, end[1]],
    viewport.convertToViewportPoint(x + c * rise, y + d * rise),
    viewport.convertToViewportPoint(x + c * drop, y + d * drop),
  ]);
  if (visual.x < 0 || visual.y < 0 || visual.x + visual.width > viewport.width || visual.y + visual.height > viewport.height) return null;
  return {
    text: item.str.trim(), size, bold: /bold/i.test(item.fontName + (style?.fontFamily ?? "")), serif: style?.fontFamily === "serif",
    rect: { x: visual.x / viewport.width, y: visual.y / viewport.height, width: visual.width / viewport.width, height: visual.height / viewport.height },
    baseline: { x: start[0] / viewport.width, y: start[1] / viewport.height },
  };
}

function overlaps(a: SmartRect, b: SmartRect) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export async function pageText(page: PDFPageProxy, signal: AbortSignal) {
  const reader = page.streamTextContent().getReader();
  const items: TextItem[] = [];
  const styles: Record<string, TextStyle> = Object.create(null);
  let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      Object.assign(styles, value.styles);
      for (const item of value.items) {
        if (!("str" in item)) continue;
        items.push(item);
        length += item.str.length;
        if (items.length > 5000 || length > 100_000) throw new Error("This page is too dense to locate a text line reliably.");
      }
    }
    return { items, styles };
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

async function locateText(page: PDFPageProxy, signal: AbortSignal, exact?: string) {
  const content = await pageText(page, signal);
  const lines = content.items.flatMap((item) => {
    const candidate = textCandidate(page, item, content.styles[item.fontName]);
    return candidate ? [candidate] : [];
  });
  const choices = exact ? lines.filter((line) => line.text === exact) :
    lines.filter((line) => line.rect.y < .33 && line.size >= 14).sort((a, b) => b.size - a.size);
  const selected = choices[0];
  if (!selected || (choices[1] && (exact || selected.size < choices[1].size * 1.12)) ||
    lines.some((line) => line !== selected && overlaps(selected.rect, line.rect))) {
    throw new Error(exact
      ? "That text could not be located as a single unique line. Check the page and use the complete visible line exactly as written."
      : 'The heading is ambiguous or has no selectable text. Give the exact line and page, for example “Replace "Current title" with "New title" on page one”. Scans require OCR.');
  }
  return selected;
}

export async function raster(page: PDFPageProxy, signal: AbortSignal, longest = 720) {
  const size = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: longest / Math.max(size.width, size.height) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser could not inspect the page layout.");
  signal.throwIfAborted();
  const task = page.render({ canvas, viewport, background: "#ffffff" });
  const cancel = () => task.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await task.promise;
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    signal.removeEventListener("abort", cancel);
    canvas.width = canvas.height = 0;
  }
}

function findSlot({ data, width, height }: ImageData) {
  const edges: { x: number; end: number; y: number }[] = [];
  const ink = (x: number, y: number) => Math.min(data[(y * width + x) * 4], data[(y * width + x) * 4 + 1], data[(y * width + x) * 4 + 2]) < 165;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (!ink(x, y)) continue;
      const left = x;
      while (x < width - 1 && ink(x, y)) x++;
      if (x - left >= 32 && x - left < width * .55) edges.push({ x: left, end: x - 1, y });
      if (edges.length > 320) return null;
    }
  }
  const boxes: SmartRect[] = [];
  for (const [index, top] of edges.entries()) {
    for (let j = index + 1; j < edges.length; j++) {
      const bottom = edges[j];
      const h = bottom.y - top.y;
      const w = top.end - top.x;
      if (h > height * .55) break;
      if (h < 34 || w / h < .48 || w / h > 1.35 || Math.abs(top.x - bottom.x) > 2 || Math.abs(top.end - bottom.end) > 2) continue;
      let sides = 0;
      for (let y = top.y + 2; y < bottom.y - 1; y++) {
        if ((ink(top.x - 1, y) || ink(top.x, y) || ink(top.x + 1, y)) &&
            (ink(top.end - 1, y) || ink(top.end, y) || ink(top.end + 1, y))) sides++;
      }
      if (sides < (h - 3) * .88) continue;
      let marks = 0;
      let tested = 0;
      for (let y = top.y + 4; y < bottom.y - 3; y += 2) {
        for (let x = top.x + 4; x < top.end - 3; x += 2) { tested++; if (ink(x, y)) marks++; }
      }
      if (marks > tested * .025) continue;
      const box = { x: (top.x + 2) / width, y: (top.y + 2) / height, width: (w - 4) / width, height: (h - 4) / height };
      if (boxes.some((other) => Math.abs(box.x - other.x) <= 4 / width && Math.abs(box.y - other.y) <= 4 / height &&
        Math.abs(box.width - other.width) <= 6 / width && Math.abs(box.height - other.height) <= 6 / height)) continue;
      boxes.push(box);
      if (boxes.length > 1) return null;
    }
  }
  return boxes[0];
}

export async function planInstruction(pdf: PDFDocumentProxy, command: Instruction, hasPhoto: boolean, signal: AbortSignal): Promise<Proposal> {
  const plan = (operation: SmartOperation, note?: string) => {
    const validated = smartOperation.safeParse(operation);
    if (!validated.success) throw new Error("The requested text size, length or position is outside the supported range.");
    return { operation: validated.data, note };
  };
  switch (command.kind) {
    case "rotate": return plan({ kind: "rotate_page", page: command.page, angle: command.angle });
    case "reorder": return plan({ kind: "reorder_pages", order: command.order });
    case "number": return plan({ kind: "add_page_numbers", position: command.position });
    case "remove_blank":
    case "remove": {
      if (pdf.numPages < 2) throw new Error("A PDF needs at least one page.");
      if (command.kind === "remove_blank") {
        const page = await pdf.getPage(command.page + 1);
        const content = await pageText(page, signal);
        const { data } = await raster(page, signal);
        if (content.items.some((item) => item.str.trim()) ||
          data.some((channel, index) => index % 4 !== 3 && channel < 250)) {
          throw new Error(`Page ${command.page + 1} does not appear blank. Name a different page or explicitly request its deletion.`);
        }
      }
      return plan({ kind: "remove_page", page: command.page });
    }
    case "add": {
      const anchor = command.belowHeading ? await locateText(await pdf.getPage(command.page + 1), signal) : null;
      const point = anchor ? { x: anchor.baseline.x, y: anchor.rect.y + anchor.rect.height + .027 } : undefined;
      return plan({ kind: "add_text", page: command.page, text: command.text, position: command.position, anchor: point });
    }
    case "heading": {
      const line = await locateText(await pdf.getPage(command.page + 1), signal, command.exact);
      const size = command.style.size === 0 ? line.size * 1.2 : command.style.size ?? line.size;
      return plan({ kind: "cover_text", page: command.page, text: command.style.replacement ?? line.text,
        cover: line.rect, baseline: line.baseline, size, bold: command.style.bold ?? line.bold, color: command.style.color ?? "#000000" },
      `A white cover will obscure “${line.text}”. The original text remains searchable and recoverable. Review the placement before applying.`);
    }
    case "photo": {
      if (!hasPhoto) throw new Error("Upload a JPEG or PNG photo first.");
      const page = await pdf.getPage(command.page + 1);
      let box: SmartRect | null | undefined;
      if (command.position) {
        const { width: w, height: h } = page.getViewport({ scale: 1 });
        const width = Math.min(.26, h / w * .28);
        const height = width * w / h * (45 / 35);
        const { align, edge } = command.position;
        box = {
          x: align === "left" ? .06 : align === "right" ? .94 - width : (1 - width) / 2,
          y: edge === "top" ? .06 : edge === "bottom" ? .94 - height : (1 - height) / 2, width, height,
        };
      } else box = findSlot(await raster(page, signal));
      if (!box) throw new Error('I could not identify a single empty photo box. Specify a position such as “Insert the photo at the top right on page one” and adjust its coordinates in the review.');
      return plan({ kind: "insert_image", page: command.page, box },
        command.position ? "Review the position and adjust the crop frame before applying." : "An empty frame was detected. Confirm that it is the intended photo placeholder.");
    }
  }
}
