import { init } from "@embedpdf/pdfium";
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import type { coordinates } from "./smart-page-geometry";
import type { SmartOperation, SmartOutcome } from "./smart-plan";

type Geometry = ReturnType<typeof coordinates>;
type Edit = Extract<SmartOperation, { kind: "replace_text" }>;
type Box = { left: number; top: number; right: number; bottom: number };
type Memory = WrappedPdfiumModule["pdfium"] & { HEAPU8: Uint8Array; HEAPU32: Uint32Array; HEAPF32: Float32Array };
const asset = new URL("@embedpdf/pdfium/pdfium.wasm", import.meta.url).href;

export class NativeTextError extends Error {}

function area(a: Box, b: Box) {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}

function context(api: WrappedPdfiumModule) {
  const wasm = api.pdfium as Memory;
  const { malloc, free } = wasm.wasmExports;
  const scratch = malloc(48);
  const textBuffer = malloc(8192);
  const float = (offset: number) => wasm.HEAPF32[scratch / 4 + offset];
  function bounds(object: number, geometry: Geometry): Box | undefined {
    if (!api.FPDFPageObj_GetBounds(object, scratch, scratch + 4, scratch + 8, scratch + 12)) return;
    const a = geometry.visual(float(0), float(1));
    const b = geometry.visual(float(2), float(3));
    return { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
  }
  function readText(object: number, textPage: number) {
    const size = api.FPDFTextObj_GetText(object, textPage, 0, 0);
    if (!size || size > 8192 || !api.FPDFTextObj_GetText(object, textPage, textBuffer, size)) return "";
    return wasm.UTF16ToString(textBuffer);
  }
  function setText(object: number, text: string) {
    wasm.stringToUTF16(text, textBuffer, 8192);
    return api.FPDFText_SetText(object, textBuffer);
  }
  function name(font: number) {
    const size = api.FPDFFont_GetBaseFontName(font, textBuffer, 8192);
    return size && size <= 8192 ? wasm.UTF8ToString(textBuffer).replace(/^[A-Z]{6}\+/, "") : "Unknown";
  }
  function matrix(object: number) {
    if (!api.FPDFPageObj_GetMatrix(object, scratch)) throw new NativeTextError("This text transform could not be recovered.");
    return Array.from({ length: 6 }, (_, index) => float(index));
  }
  function setMatrix(object: number, values: number[]) {
    wasm.HEAPF32.set(values, scratch / 4);
    if (!api.FPDFPageObj_SetMatrix(object, scratch)) throw new NativeTextError("The text position could not be preserved.");
  }
  function color(object: number) {
    if (!api.FPDFPageObj_GetFillColor(object, scratch, scratch + 4, scratch + 8, scratch + 12)) {
      throw new NativeTextError("The original text color could not be recovered.");
    }
    return [...wasm.HEAPU32.subarray(scratch / 4, scratch / 4 + 4)];
  }
  function fontSize(object: number) {
    if (!api.FPDFTextObj_GetFontSize(object, scratch)) throw new NativeTextError("This run has no recoverable font size.");
    return float(0);
  }
  function dispose() { free(textBuffer); free(scratch); }
  return { bounds, readText, setText, name, matrix, setMatrix, color, fontSize, dispose };
}

function textMatches(value: string, old: string) {
  if (value.trim() === old) return { prefix: "", suffix: "" };
  const index = value.indexOf(old);
  if (index < 0 || value.indexOf(old, index + old.length) >= 0) return;
  const prefix = value.slice(0, index);
  // Only rewrite a value suffix if the same object starts with a field label.
  if (!/^\s*[\p{L}][\p{L}\p{N} ._()/&'-]{0,52}[:=]\s*$/u.test(prefix) || value.slice(index + old.length).trim()) return;
  return { prefix, suffix: value.slice(index + old.length) };
}

function applyRun(api: WrappedPdfiumModule, memory: ReturnType<typeof context>, doc: number, page: number, edit: Edit, geometry: Geometry) {
  const count = api.FPDFPage_CountObjects(page);
  if (count > 12_000) throw new NativeTextError("This page has too many drawing objects to edit safely in a browser.");
  const wanted = { left: edit.cover.x * geometry.width, right: (edit.cover.x + edit.cover.width) * geometry.width,
    top: edit.cover.y * geometry.height, bottom: (edit.cover.y + edit.cover.height) * geometry.height };
  const options: { object: number; index: number; box: Box; prefix: string; suffix: string }[] = [];
  const obstacles: { object: number; box: Box }[] = [];
  const tp = api.FPDFText_LoadPage(page);
  if (!tp) throw new NativeTextError("This page has no readable text layer.");
  try {
    for (let index = 0; index < count; index++) {
      const object = api.FPDFPage_GetObject(page, index);
      if (!object) continue;
      const kind = api.FPDFPageObj_GetType(object);
      if (![1, 2, 3, 5].includes(kind)) continue;
      let box = memory.bounds(object, geometry);
      if (!box) continue;
      if (kind === 2 && (box.right - box.left < .5 || box.bottom - box.top < .5)) {
        box = { left: box.left - .5, right: box.right + .5, top: box.top - .5, bottom: box.bottom + .5 };
      }
      obstacles.push({ object, box });
      if (kind !== 1 || !area(wanted, box) || api.FPDFTextObj_GetTextRenderMode(object) !== 0) continue;
      const parts = textMatches(memory.readText(object, tp), edit.before);
      if (parts) options.push({ object, index, box, ...parts });
    }
  } finally {
    api.FPDFText_ClosePage(tp);
  }
  if (options.length !== 1) {
    throw new NativeTextError("This value does not map to one editable text run. Use manual Edit PDF for a reviewed visual cover, or provide an editable copy of the source document.");
  }
  const { object: old, index, box: original, prefix, suffix } = options[0];
  const originalFont = api.FPDFTextObj_GetFont(old);
  if (!originalFont) throw new NativeTextError("The font of this text run could not be recovered.");
  const fontName = memory.name(originalFont);
  const flags = api.FPDFFont_GetFlags(originalFont);
  const bold = api.FPDFFont_GetWeight(originalFont) >= 600 || /bold|black|heavy|semibold/i.test(fontName);
  const italic = Boolean(flags & 64) || /italic|oblique/i.test(fontName);
  const wantsBold = edit.bold ?? bold;
  const requestedSize = edit.size / edit.originalSize;
  const [a, b, c, d, e, f] = memory.matrix(old);
  const before = geometry.point(edit.originalBaseline.x * geometry.width, edit.originalBaseline.y * geometry.height);
  const after = geometry.point(edit.baseline.x * geometry.width, edit.baseline.y * geometry.height);
  const displacement = { x: after.x - before.x, y: after.y - before.y };
  if (prefix && (wantsBold !== bold || requestedSize !== 1 || edit.color || displacement.x || displacement.y)) {
    throw new NativeTextError("The label and its value share one text run. The value can be replaced, but changing only its formatting or position would also move or style the label.");
  }
  const rgba = memory.color(old);
  if (edit.color) for (let n = 0; n < 3; n++) rgba[n] = Number.parseInt(edit.color.slice(1 + n * 2, 3 + n * 2), 16);
  const full = prefix + edit.text + suffix;
  let object = old;
  let substitute: string | undefined;
  let loadedFont = 0;
  let inserted = false;

  function verifies() {
    const textPage = api.FPDFText_LoadPage(page);
    if (!textPage) return false;
    try { return memory.readText(object, textPage).trim() === full.trim(); }
    finally { api.FPDFText_ClosePage(textPage); }
  }

  try {
    if (wantsBold !== bold || !memory.setText(old, full) || !verifies()) {
      if (prefix) throw new NativeTextError("The original run cannot encode this replacement without changing the label font. Try compatible characters or use manual Edit PDF.");
      const serif = Boolean(flags & 2) || /times|serif|garamond|georgia|cambria|baskerville/i.test(fontName);
      const mono = Boolean(flags & 1) || /courier|mono/i.test(fontName);
      substitute = mono ? (wantsBold ? "Courier-Bold" : "Courier") + (italic ? (wantsBold ? "Oblique" : "-Oblique") : "") :
        serif ? "Times-" + (wantsBold ? "Bold" : "") + (italic ? "Italic" : wantsBold ? "" : "Roman") :
          "Helvetica" + (wantsBold ? "-Bold" : "") + (italic ? (wantsBold ? "Oblique" : "-Oblique") : "");
      loadedFont = api.FPDFText_LoadStandardFont(doc, substitute);
      const baseSize = memory.fontSize(old);
      object = loadedFont ? api.FPDFPageObj_CreateTextObj(doc, loadedFont, baseSize) : 0;
      if (!object || !memory.setText(object, full)) throw new NativeTextError("The replacement characters could not be encoded in a compatible PDF font.");
      if (!api.FPDFPage_InsertObjectAtIndex(page, object, index)) throw new NativeTextError("The replacement text could not be inserted.");
      inserted = true;
      if (!verifies()) throw new NativeTextError("The replacement characters could not be verified in the PDF font.");
    }
    if (edit.color || substitute) {
      if (!api.FPDFPageObj_SetFillColor(object, rgba[0], rgba[1], rgba[2], rgba[3])) throw new NativeTextError("The replacement color could not be applied.");
    }
    const left = original.left;
    const right = original.right;
    function position(scale: number) {
      const values = [a * scale, b * scale, c * scale, d * scale, e + displacement.x, f + displacement.y];
      memory.setMatrix(object, values);
      const candidate = memory.bounds(object, geometry);
      if (!candidate) throw new NativeTextError("The resulting text bounds could not be measured.");
      let shift = 0;
      const origin = geometry.visual(e, f);
      const intended = geometry.visual(e + displacement.x, f + displacement.y);
      if (!prefix && edit.alignment === "center") shift = (left + right - candidate.left - candidate.right) / 2 + intended.x - origin.x;
      if (!prefix && edit.alignment === "right") shift = right - candidate.right + intended.x - origin.x;
      if (shift) {
        const adjust = geometry.point(intended.x + shift, intended.y);
        values[4] = adjust.x;
        values[5] = adjust.y;
        memory.setMatrix(object, values);
      }
      return memory.bounds(object, geometry)!;
    }
    function fits(candidate: Box) {
      const limit = Math.min(geometry.width, (edit.right ?? 1) * geometry.width) + .35;
      return candidate.left >= -.35 && candidate.right <= limit && candidate.top >= -.35 && candidate.bottom <= geometry.height + .35 &&
        obstacles.every(({ object, box }) => object === old || area(candidate, box) <= Math.max(1, area(original, box) + 1) ||
          (box.left <= Math.min(original.left, candidate.left) && box.right >= Math.max(original.right, candidate.right) &&
           box.top <= Math.min(original.top, candidate.top) && box.bottom >= Math.max(original.bottom, candidate.bottom)));
    }
    let scale = requestedSize;
    if (!fits(position(scale))) {
      if (prefix) throw new NativeTextError("The replacement is too long for this field. Try shorter text or position it in manual Edit PDF.");
      // Keep the reduction small and disclose the actual size in the review.
      const minimum = Math.max(6 / edit.originalSize, requestedSize * .85);
      while (scale > minimum && !fits(position(scale))) scale = Math.max(minimum, scale - .025 * requestedSize);
      if (!fits(position(scale))) throw new NativeTextError("The replacement would overlap nearby content. Try shorter text or explicitly request a smaller size.");
    }
    if (inserted) {
      if (!api.FPDFPage_RemoveObject(page, old)) throw new NativeTextError("The previous text run could not be removed.");
      api.FPDFPageObj_Destroy(old);
    }
    const hex = "#" + rgba.slice(0, 3).map((value) => value.toString(16).padStart(2, "0")).join("");
    const size = Math.round(edit.originalSize * scale * 10) / 10;
    const formatting = [substitute ?? fontName, `${size} pt`, wantsBold && "bold", italic && "italic", hex, `${edit.alignment} aligned`].filter(Boolean).join(" · ");
    return { formatting, substitution: substitute ? `Original typeface: ${fontName}. The preview uses ${substitute}.` : undefined };
  } finally {
    if (object && object !== old && !inserted) api.FPDFPageObj_Destroy(object);
    if (loadedFont) api.FPDFFont_Close(loadedFont);
  }
}

export async function replaceRuns(bytes: ArrayBuffer, edits: { edit: Edit; step: number; geometry: Geometry }[], limit: number) {
  const response = await fetch(asset);
  if (!response.ok) throw new NativeTextError("The font-preserving PDF engine could not be loaded. Retry the instruction.");
  const api = await init({ wasmBinary: await response.arrayBuffer() });
  api.FPDF_InitLibrary();
  const wasm = api.pdfium as Memory;
  const { malloc, free } = wasm.wasmExports;
  const pointer = malloc(bytes.byteLength);
  wasm.HEAPU8.set(new Uint8Array(bytes), pointer);
  const doc = api.FPDF_LoadMemDocument(pointer, bytes.byteLength, "");
  const memory = context(api);
  const outcomes: SmartOutcome[] = [];
  try {
    if (!doc) throw new NativeTextError("This PDF could not be opened for native text replacement.");
    const pages = new Map<number, number>();
    try {
      for (const { edit, step, geometry } of edits) {
        let page = pages.get(edit.page);
        if (!page) { page = api.FPDF_LoadPage(doc, edit.page); if (page) pages.set(edit.page, page); }
        if (!page) throw new NativeTextError(`Page ${edit.page + 1} could not be opened.`);
        try { outcomes.push({ step, ...applyRun(api, memory, doc, page, edit, geometry) }); }
        catch (error) {
          if (error instanceof NativeTextError) throw new NativeTextError(`Change ${step + 1} on page ${edit.page + 1}: ${error.message}`);
          throw error;
        }
      }
      for (const page of pages.values()) if (!api.FPDFPage_GenerateContent(page)) throw new NativeTextError("The edited content stream could not be saved.");
    } finally {
      for (const page of pages.values()) api.FPDF_ClosePage(page);
    }
    const writer = api.PDFiumExt_OpenFileWriter();
    try {
      if (!writer || !api.PDFiumExt_SaveAsCopy(doc, writer)) throw new NativeTextError("The edited PDF could not be written.");
      const size = api.PDFiumExt_GetFileWriterSize(writer);
      if (!size || size > limit) throw new NativeTextError("The edited PDF exceeds the Smart Editor file limit.");
      const save = malloc(size);
      try {
        api.PDFiumExt_GetFileWriterData(writer, save, size);
        return { bytes: wasm.HEAPU8.slice(save, save + size), outcomes };
      } finally { free(save); }
    } finally { if (writer) api.PDFiumExt_CloseFileWriter(writer); }
  } finally {
    memory.dispose();
    if (doc) api.FPDF_CloseDocument(doc);
    free(pointer);
    api.FPDF_DestroyLibrary();
  }
}
