import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { pageText, textCandidate } from "./smart-layout";
import type { TextCandidate } from "./smart-layout";
import { editDistance, fieldCategory, looksLikeDate, looksLikePerson, normalized } from "./smart-understanding";
import type { FieldCategory } from "./smart-understanding";

type Match = { id: string; label: string; value: string; page: number; category?: FieldCategory };
export type Target = Match & (
  | { kind: "field"; field: string; pages: number[] }
  | { kind: "text"; line: TextCandidate; right?: number; alignment?: "left" | "center" | "right"; origin: "selectable" | "inferred" | "ocr" }
);
type Row = { spans: TextCandidate[]; line: TextCandidate };
type Block = { role: "heading" | "paragraph" | "columns"; rows: Row[] };
type PageIndex = { page: number; rows: Row[]; blocks: Block[]; fields: Target[]; selectable: boolean };

const indexes = new WeakMap<PDFDocumentProxy, Map<number, PageIndex>>();
const scans = new WeakMap<PDFDocumentProxy, Map<number, PageIndex>>();
const idPattern = /^(?=.{5,32}$)(?=.*\d)(?=.*[A-Z])(?:[A-Z\d]+[\/-]?)+$/i;

function joined(spans: TextCandidate[], text = spans.map((span) => span.text).join(" ")): TextCandidate {
  const first = spans[0];
  const left = Math.min(...spans.map(({ rect }) => rect.x));
  const top = Math.min(...spans.map(({ rect }) => rect.y));
  const right = Math.max(...spans.map(({ rect }) => rect.x + rect.width));
  const bottom = Math.max(...spans.map(({ rect }) => rect.y + rect.height));
  return { ...first, text, rect: { x: left, y: top, width: right - left, height: bottom - top } };
}

function makeRows(spans: TextCandidate[]) {
  const lines: TextCandidate[][] = [];
  for (const span of spans.sort((a, b) => a.baseline.y - b.baseline.y || a.baseline.x - b.baseline.x)) {
    const last = lines.at(-1);
    const anchor = last?.[0];
    if (anchor && Math.abs(anchor.baseline.y - span.baseline.y) < Math.min(anchor.rect.height, span.rect.height) * .26) last.push(span);
    else lines.push([span]);
  }
  return lines.map((row): Row => {
    row.sort((a, b) => a.baseline.x - b.baseline.x);
    return { spans: row, line: joined(row) };
  });
}

function layoutBlocks(rows: Row[]) {
  const sizes = rows.map(({ line }) => line.size).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] ?? 0;
  const blocks: Block[] = [];
  for (const row of rows) {
    const { line, spans } = row;
    const columns = spans.slice(1).filter((span, index) => span.rect.x - spans[index].rect.x - spans[index].rect.width > .045).length;
    const role = columns >= 2 ? "columns" : line.size >= Math.max(14, body * 1.15) || line.rect.y < .2 && line.size >= 14 ?
      "heading" : "paragraph";
    const prior = blocks.at(-1);
    const previous = prior?.rows.at(-1)?.line;
    if (role === "paragraph" && prior?.role === role && previous && Math.abs(previous.size - line.size) <= 1 &&
      Math.abs(previous.rect.x - line.rect.x) <= .028 && line.rect.y - previous.rect.y <= previous.rect.height * 1.55) {
      prior.rows.push(row);
    } else blocks.push({ role, rows: [row] });
  }
  return blocks;
}

function textTarget(page: number, label: string, line: TextCandidate, origin: "selectable" | "inferred" | "ocr", right?: number): Target {
  return { kind: "text", id: `${page}:${line.baseline.x.toFixed(5)}:${line.baseline.y.toFixed(5)}`, page, label,
    value: line.text, category: fieldCategory(label), line, origin, right,
    alignment: label === "Heading" && Math.abs(line.rect.x + line.rect.width / 2 - .5) < .012 ? "center" : undefined };
}

function matchAlignment(targets: Target[]) {
  return targets.map((target): Target => {
    if (target.kind !== "text" || target.right !== undefined) return target;
    const rect = target.line.rect;
    const neighbors = targets.flatMap((other) => other !== target && other.kind === "text" &&
      Math.abs(rect.y - other.line.rect.y) < .13 && Math.abs(rect.x - other.line.rect.x) > .015 ? [other.line.rect] : []);
    const right = neighbors.filter((other) => Math.abs(other.x + other.width - rect.x - rect.width) < .008).length;
    const centered = neighbors.filter((other) => Math.abs(other.x + other.width / 2 - rect.x - rect.width / 2) < .008).length;
    const alignment = right >= 2 && right > centered ? "right" : centered >= 2 && centered > right ? "center" : target.alignment;
    return { ...target, alignment };
  });
}

function valuePart(span: TextCandidate, prefix: string, value: string) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  context.font = `${span.bold ? "bold " : ""}100px ${span.serif ? "Times New Roman" : "Arial"}`;
  const whole = context.measureText(span.text).width;
  const ratio = context.measureText(prefix).width / whole;
  const shift = Math.min(.96, ratio) * span.rect.width;
  return { ...span, text: value, baseline: { ...span.baseline, x: span.baseline.x + shift },
    rect: { ...span.rect, x: span.baseline.x + shift, width: span.rect.x + span.rect.width - span.baseline.x - shift } };
}

function findFields(rows: Row[], page: number, source: "selectable" | "ocr") {
  const result: Target[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    for (let index = 0; index < row.spans.length; index++) {
      const span = row.spans[index];
      const inline = span.text.match(/^([\p{L}][\p{L}\p{N} ._()/&'-]{0,52})\s*[:=]\s*(.*)$/u);
      let label = (inline?.[1] ?? span.text).trim();
      if (inline && source === "ocr") {
        for (let previous = index - 1, prefix = ""; previous >= Math.max(0, index - 3); previous--) {
          const part = row.spans[previous];
          if (part.text.includes(":") || row.spans[previous + 1].rect.x - part.rect.x - part.rect.width > .03) break;
          prefix = `${part.text} ${prefix}`;
          const joinedLabel = prefix + inline[1].trim();
          if (fieldCategory(joinedLabel)) label = joinedLabel;
        }
      }
      const category = fieldCategory(label);
      if ((!inline && !category) || category === "heading") continue;
      if (inline?.[2]) {
        let value = valuePart(span, span.text.slice(0, span.text.length - inline[2].length), inline[2]);
        let next = index + 1;
        while (next < row.spans.length && !/[:=]$|^[\p{L} .]{2,40}:/u.test(row.spans[next].text) &&
          !fieldCategory(row.spans[next].text) && row.spans[next].rect.x - value.rect.x - value.rect.width < .028) {
          value = joined([value, row.spans[next++]]);
        }
        result.push(textTarget(page, label, value, source, row.spans[next]?.rect.x));
        index = next - 1;
        continue;
      }
      const next = row.spans[index + 1];
      const below = rows[rowIndex + 1];
      if (next && next.rect.x - span.rect.x - span.rect.width < .3 && !next.text.includes(":") && !fieldCategory(next.text)) {
        const parts = [next];
        let end = index + 2;
        while (end < row.spans.length && !row.spans[end].text.includes(":") && !fieldCategory(row.spans[end].text) &&
          row.spans[end].rect.x - parts.at(-1)!.rect.x - parts.at(-1)!.rect.width < .028) parts.push(row.spans[end++]);
        const value = joined(parts);
        result.push(textTarget(page, label, value, source, row.spans[end]?.rect.x));
        index = end - 1;
      } else if (category && below && below.line.rect.y - span.rect.y < span.rect.height * 3 &&
        Math.abs(below.line.rect.x - span.rect.x) < .045 && below.line.text.length <= 120 &&
        !below.line.text.includes(":") && !fieldCategory(below.line.text) &&
        (row.spans.length === 1 || inline)) {
        result.push(textTarget(page, label, below.line, source));
      }
    }
  }
  // Visible, unlabelled identity blocks often put the person's name just above their student ID.
  for (const [index, row] of rows.entries()) {
    const line = row.line;
    if (line.rect.y > .38 || !idPattern.test(line.text) || !/\d{2}/.test(line.text)) continue;
    const previous = rows[index - 1]?.line;
    const next = rows[index + 1]?.line;
    if (!previous || line.rect.y - previous.rect.y > previous.rect.height * 3.5 ||
      Math.abs(line.rect.x - previous.rect.x) > .1 || !looksLikePerson(previous.text)) continue;
    if (!result.some((entry) => entry.value === previous.text)) result.push(textTarget(page, "Student name", previous, source === "ocr" ? "ocr" : "inferred"));
    if (!result.some((entry) => entry.value === line.text)) result.push(textTarget(page, "Student number", line, source === "ocr" ? "ocr" : "inferred"));
    if (next && next.rect.y - line.rect.y < line.rect.height * 3 && Math.abs(next.rect.x - line.rect.x) < .1 &&
      next.text.length <= 55 && /^[\p{Lu}][\p{Lu} &/-]+$/u.test(next.text) && !result.some((entry) => entry.value === next.text)) {
      result.push(textTarget(page, "Department", next, source === "ocr" ? "ocr" : "inferred"));
    }
  }
  for (const row of rows) if (row.line.text.length < 32 && looksLikeDate(row.line.text) && !result.some((entry) => entry.value === row.line.text)) {
    result.push(textTarget(page, "Date", row.line, source === "ocr" ? "ocr" : "inferred"));
  }
  return matchAlignment(result);
}

async function acroFields(page: PDFPageProxy, index: number) {
  const annotations = await page.getAnnotations({ intent: "display" }) as {
    fieldType?: string; fieldName?: string; fieldValue?: string; alternativeText?: string; readOnly?: boolean; richText?: unknown;
  }[];
  return annotations.flatMap((data): Target[] => {
    if (data.fieldType !== "Tx" || data.readOnly || !data.fieldName || data.fieldName.length > 240) return [];
    const label = (data.alternativeText || data.fieldName.split(".").at(-1) || data.fieldName).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
    return [{ kind: "field", id: "field:" + data.fieldName, label, category: fieldCategory(label),
      value: typeof data.fieldValue === "string" ? data.fieldValue : "", page: index, field: data.fieldName, pages: [index] }];
  });
}

export async function documentPages(pdf: PDFDocumentProxy, signal: AbortSignal, only?: number) {
  const cache = indexes.get(pdf) ?? new Map<number, PageIndex>();
  indexes.set(pdf, cache);
  const pages: PageIndex[] = [];
  let characters = 0;
  for (let index = only ?? 0; index < (only === undefined ? pdf.numPages : only + 1); index++) {
    signal.throwIfAborted();
    let ready = cache.get(index);
    if (!ready) {
      const page = await pdf.getPage(index + 1);
      const [content, widgets] = await Promise.all([pageText(page, signal), acroFields(page, index)]);
      const rows = makeRows(content.items.flatMap((item) => {
        const line = textCandidate(page, item, content.styles[item.fontName]);
        return line ? [line] : [];
      }));
      ready = { page: index, rows, blocks: layoutBlocks(rows), selectable: content.items.some((item) => item.str.trim()), fields: [...widgets, ...findFields(rows, index, "selectable")] };
      cache.set(index, ready);
    }
    pages.push(ready);
    characters += ready.rows.reduce((sum, row) => sum + row.line.text.length, 0);
    if (characters > 400_000) throw new Error("This document is large. Name the page containing the field to narrow the search.");
  }
  return pages;
}

export async function scanPage(pdf: PDFDocumentProxy, page: number, signal: AbortSignal) {
  const cache = scans.get(pdf) ?? new Map<number, PageIndex>();
  scans.set(pdf, cache);
  const existing = cache.get(page);
  if (existing) return existing;
  const { recognizePage } = await import("./smart-ocr");
  const rows = (await recognizePage(await pdf.getPage(page + 1), signal)).filter((spans) => spans.length)
    .map((spans) => ({ spans, line: joined(spans) }));
  const result = { page, rows, blocks: layoutBlocks(rows), selectable: false, fields: findFields(rows, page, "ocr") };
  cache.set(page, result);
  return result;
}

export function candidates(pages: PageIndex[], label: string, exact?: string) {
  const category = fieldCategory(label);
  const clean = normalized(label);
  if (exact || category === "heading") {
    const choices: Target[] = [];
    for (const page of pages) {
      const subtitle = clean === "subtitle" || clean === "subheading";
      let rows = exact ? page.rows.filter(({ line }) => line.text.trim() === exact.trim()) :
        page.blocks.filter(({ role }) => role === "heading").flatMap(({ rows }) => rows)
          .filter(({ line }) => (subtitle || line.rect.y < .33) && line.text.length <= 130);
      const largest = Math.max(0, ...rows.map(({ line }) => line.size));
      if (subtitle && !exact) rows = rows.filter(({ line }) => line.size < largest / 1.12);
      for (const { line } of rows) if (exact || subtitle || line.size >= largest / 1.12) {
        choices.push(textTarget(page.page, exact ? "Text" : "Heading", line, page.selectable ? "selectable" : "ocr"));
      }
    }
    return choices;
  }
  const results: Target[] = [];
  for (const target of pages.flatMap(({ fields }) => fields)) {
    const other = normalized(target.label);
    if (clean !== other && (!category || target.category !== category) &&
      (clean.length < 6 || Math.abs(clean.length - other.length) > 1 || editDistance(clean, other) !== 1)) continue;
    const prior = results.find((entry) => entry.id === target.id);
    if (prior?.kind === "field" && target.kind === "field") {
      const index = results.indexOf(prior);
      if (!prior.pages.includes(target.page)) results[index] = { ...prior, pages: [...prior.pages, target.page] };
    } else if (!prior) results.push(target);
  }
  // A painted caption often repeats the value of the writable widget. Keep distinct visible values.
  return results.filter((target) => target.kind === "field" || !results.some((other) =>
    other.kind === "field" && other.pages.includes(target.page) && other.value === target.value && other.category === target.category));
}
