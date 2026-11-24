import type { JSONContent } from "@tiptap/react";
import { defaultDraftFont, faceFor, findDraftFont } from "./draft-fonts";
import type { DraftFont } from "./draft-fonts";
import { assertFontCoverage, fontBytes, loadFontMetrics } from "./document-fonts";
import { draftImage, fitDraftImage, turnedSize } from "./draft-image-geometry";
import { tableFormatting } from "./draft-table-format";

type Block = Record<string, unknown>;
type ImageAsset = { data: string; width: number; height: number };
type Assets = Map<JSONContent, ImageAsset>;
const width = 595.28 - 96;
const pt = .75;

function alignment(value: unknown) {
  return value === "right" || value === "center" || value === "justify" ? value : "left";
}

function textRun(node: JSONContent, inheritedSize: number): Block {
  if (node.type === "hardBreak") return { text: "\n" };
  const marks = new Map((node.marks ?? []).map((mark) => [mark.type, mark.attrs]));
  const style = marks.get("textStyle");
  const font = findDraftFont(style?.fontFamily).pdf;
  const text = node.text ?? "";
  const requestedSize = typeof style?.fontSize === "string" ? Number.parseFloat(style.fontSize) : inheritedSize;
  const color = typeof style?.color === "string" ? style.color : undefined;
  return {
    text, font, color, fontSize: Number.isFinite(requestedSize) ? Math.min(72, Math.max(6, requestedSize)) : inheritedSize,
    background: typeof style?.backgroundColor === "string" ? style.backgroundColor : undefined,
    bold: marks.has("bold"), italics: marks.has("italic"),
    decoration: marks.has("underline") ? "underline" : marks.has("strike") ? "lineThrough" : undefined,
  };
}

function collectFonts(node: JSONContent, used: Map<string, DraftFont>, check: Promise<void>[], heading = false) {
  if (node.text) {
    const style = node.marks?.find(({ type }) => type === "textStyle");
    const font = findDraftFont(style?.attrs?.fontFamily);
    const face = faceFor(font, heading || node.marks?.some(({ type }) => type === "bold"), node.marks?.some(({ type }) => type === "italic"));
    used.set(font.pdf, font);
    const text = node.text;
    check.push(loadFontMetrics(font, face).then((metrics) => assertFontCoverage(font, metrics, text)));
  }
  for (const child of node.content ?? []) collectFonts(child, used, check, node.type === "heading");
}

async function prepareFonts(document: JSONContent) {
  const used = new Map([[defaultDraftFont.pdf, defaultDraftFont]]);
  const check: Promise<void>[] = [];
  collectFonts(document, used, check);
  const files: Record<string, string> = {};
  const definitions: Record<string, Record<string, string>> = {};
  const variants = [["normal", false, false], ["bold", true, false], ["italics", false, true], ["bolditalics", true, true]] as const;
  await Promise.all([...check, ...[...used.values()].map(async (font) => {
    if (!font.asset) return;
    const asset = font.asset;
    definitions[asset] = Object.fromEntries(await Promise.all(variants.map(async ([name, bold, italic]) => {
      const face = faceFor(font, bold, italic);
      const file = `${asset}-${face}.ttf`;
      if (!files[file]) {
        const data = new Uint8Array(await fontBytes(asset, face));
        let binary = "";
        for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
        files[file] = btoa(binary);
      }
      return [name, file];
    })));
  })]);
  return { files, definitions };
}

function buildTable(node: JSONContent, available: number, images: Assets): Block | null {
  const rows = node.content ?? [];
  if (!rows.length) return null;
  const columns = Math.max(...rows.map((row) => (row.content ?? []).reduce((total, cell) => total + (Number(cell.attrs?.colspan) || 1), 0)));
  if (!columns) return null;
  const grid = rows.map(() => Array<Block | null>(columns).fill(null));
  const knownWidths = Array<number>(columns).fill(0);
  const { widthPercent, padding, borderWidth, borderColor } = tableFormatting(node.attrs);
  const pad = padding * pt;
  const stroke = borderWidth * pt;
  const tableWidth = available * widthPercent / 100;
  rows.forEach((row, rowIndex) => {
    let column = 0;
    for (const cell of row.content ?? []) {
      while (column < columns && grid[rowIndex][column] !== null) column++;
      if (column >= columns) break;
      const colSpan = Math.min(columns - column, Number(cell.attrs?.colspan) || 1);
      const rowSpan = Math.min(rows.length - rowIndex, Number(cell.attrs?.rowspan) || 1);
      const contents = blocks(cell.content ?? [], images, Math.max(14, tableWidth / columns * colSpan - pad * 2));
      for (const [i, block] of contents.entries()) {
        const source = cell.content?.[i];
        if (block.text && !source?.attrs?.textAlign) block.alignment = alignment(cell.attrs?.cellAlign);
      }
      grid[rowIndex][column] = {
        stack: contents.length ? contents : [{ text: " " }], colSpan, rowSpan,
        fillColor: cell.attrs?.background || (cell.type === "tableHeader" ? "#f0ece3" : undefined),
        verticalAlignment: cell.attrs?.vertical,
      };
      for (let index = 0; index < colSpan; index++) {
        if (Array.isArray(cell.attrs?.colwidth) && !knownWidths[column + index]) {
          knownWidths[column + index] = (Number(cell.attrs.colwidth[index]) || 0) * pt;
        }
      }
      for (let y = rowIndex; y < rowIndex + rowSpan; y++) {
        for (let x = column; x < column + colSpan; x++) {
          if (y !== rowIndex || x !== column) grid[y][x] = {};
        }
      }
      column += colSpan;
    }
  });
  const inner = Math.max(columns, tableWidth - columns * pad * 2 - (columns + 1) * stroke);
  const fixed = knownWidths.reduce((sum, value) => sum + value, 0);
  const elastic = knownWidths.filter((value) => !value).length;
  const adjusted = knownWidths.map((value) => value || Math.max(12, (inner - fixed) / Math.max(1, elastic)));
  const total = adjusted.reduce((sum, value) => sum + value, 0);
  const widths = adjusted.map((value) => value * inner / total);
  return {
    table: { widths, heights: rows.map((row) => (Number(row.attrs?.rowHeight) || 0) * pt),
      body: grid.map((row) => row.map((cell) => cell ?? { text: "" })) },
    layout: {
      hLineWidth: () => stroke, vLineWidth: () => stroke, hLineColor: () => borderColor, vLineColor: () => borderColor,
      paddingLeft: () => pad, paddingRight: () => pad, paddingTop: () => pad, paddingBottom: () => pad,
    },
    margin: [0, 2, 0, 9],
  };
}

function blocks(nodes: JSONContent[], images: Assets, available = width): Block[] {
  const result: Block[] = [];
  for (const node of nodes) {
    let block: Block | null = null;
    if (node.type === "paragraph" || node.type === "heading") {
      const heading = node.type === "heading";
      const size = heading ? ([0, 28, 21, 16][Number(node.attrs?.level)] || 14) : 12;
      const runs = (node.content ?? []).map((run) => {
        const item = textRun(run, size);
        if (heading) item.bold = true;
        return item;
      });
      block = { text: runs.length ? runs : " ", alignment: alignment(node.attrs?.textAlign), margin: [0, heading ? 5 : 0, 0, 7] };
    } else if (node.type === "bulletList" || node.type === "orderedList") {
      block = { [node.type === "bulletList" ? "ul" : "ol"]: (node.content ?? []).map((item) => ({
        stack: blocks(item.content ?? [], images, available - 14),
      })), ...(node.type === "orderedList" ? { start: node.attrs?.start ?? 1 } : {}), margin: [0, 0, 0, 7] };
    } else if (node.type === "table") {
      block = buildTable(node, available, images);
    } else if (node.type === "image") {
      const asset = images.get(node);
      if (asset) {
        const scale = Math.min(pt, available / asset.width, 720 / asset.height);
        block = { image: asset.data, width: asset.width * scale, height: asset.height * scale,
          alignment: alignment(node.attrs?.position), margin: [0, 3, 0, 9] };
      }
    }
    if (block) result.push(block);
  }
  return result;
}

async function prepareImages(nodes: JSONContent[], assets: Assets) {
  for (const node of nodes) {
    if (node.type !== "image") {
      if (node.content) await prepareImages(node.content, assets);
      continue;
    }
    const image = draftImage(node.attrs);
    if (!/^data:image\/(png|jpeg);base64,/.test(image.src)) continue;
    const originalRatio = Math.abs(image.width * image.sourceHeight / image.sourceWidth - image.height) < .2;
    if (!image.angle && originalRatio && image.crop.every((margin) => !margin)) {
      assets.set(node, { data: image.src, width: image.width, height: image.height });
      continue;
    }
    const bitmap = new Image();
    bitmap.src = image.src;
    await bitmap.decode();
    const size = turnedSize(image);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(size.width * 2);
    canvas.height = Math.ceil(size.height * 2);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image formatting is unavailable in this browser.");
    context.scale(canvas.width / size.width, canvas.height / size.height);
    context.translate(size.width / 2, size.height / 2);
    context.rotate(image.angle * Math.PI / 180);
    context.translate(-image.width / 2, -image.height / 2);
    context.beginPath();
    context.rect(0, 0, image.width, image.height);
    context.clip();
    const fit = fitDraftImage(image);
    context.drawImage(bitmap, fit.x, fit.y, fit.width, fit.height);
    assets.set(node, { data: canvas.toDataURL("image/png"), ...size });
  }
}

function paginateSections(nodes: JSONContent[], assets: Assets) {
  const sections: JSONContent[][] = [[]];
  for (const node of nodes) {
    if (node.type === "pageBreak") sections.push([]);
    else sections.at(-1)!.push(node);
  }
  return sections.flatMap((section, index) => {
    const floats = section.filter((node) => node.type === "image" && node.attrs?.layout === "floating" && assets.has(node))
      .sort((left, right) => Number(left.attrs?.layer) - Number(right.attrs?.layer));
    const flow = blocks(section.filter((node) => !floats.includes(node)), assets);
    if (!floats.length) {
      if (!flow.length) flow.push({ text: " " });
      if (index) flow[0].pageBreak = "before";
      return flow;
    }
    const placed = floats.map((node) => {
      const image = draftImage(node.attrs);
      const asset = assets.get(node)!;
      return { image: asset.data, width: asset.width * pt, height: asset.height * pt,
        absolutePosition: { x: 48 + image.x * pt, y: 48 + image.y * pt } };
    });
    return [...(index ? [{ text: " ", fontSize: 1, pageBreak: "before" }] : []), ...placed, ...flow];
  });
}

export async function generateCreatedPdf(document: JSONContent) {
  const images: Assets = new Map();
  const [{ default: pdfmake }, { default: times }, { default: courier }, { default: helvetica }, fonts] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/standard-fonts/Times"), import("pdfmake/build/standard-fonts/Courier"),
    import("pdfmake/build/standard-fonts/Helvetica"), prepareFonts(document), prepareImages(document.content ?? [], images),
  ]);
  pdfmake.addVirtualFileSystem(fonts.files);
  pdfmake.addFonts(fonts.definitions);
  pdfmake.addFontContainer(times);
  pdfmake.addFontContainer(courier);
  pdfmake.addFontContainer(helvetica);
  const content = paginateSections(document.content ?? [], images);
  return pdfmake.createPdf({
    content: content.length ? content : [{ text: " " }], pageSize: "A4", pageMargins: [48, 48, 48, 48],
    defaultStyle: { font: defaultDraftFont.pdf, fontSize: 12, color: "#222222", lineHeight: 1.15 },
    info: { title: "samPDF document", creator: "samPDF" },
  }).getBlob();
}
