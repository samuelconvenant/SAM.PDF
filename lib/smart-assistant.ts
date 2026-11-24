import type { PDFDocumentProxy } from "pdfjs-dist";
import { candidates, documentPages, scanPage } from "./smart-document";
import type { Target } from "./smart-document";
import { planInstruction } from "./smart-layout";
import { operationLabel, smartOperation } from "./smart-plan";
import type { SmartOperation } from "./smart-plan";
import { fieldCategory, understand } from "./smart-understanding";
import type { Meaning } from "./smart-understanding";

export type Change = {
  operation: SmartOperation;
  label: string;
  note?: string;
  target?: Target;
};
export type Revision = { base: File; changes: Change[]; image?: string };
export type Clarification = { step: number; label: string; options: Target[] };
export type Decisions = Record<number, string>;
export type AssistantResult = { kind: "plan"; revision: Revision } | { kind: "clarify"; question: Clarification };

function describe(operation: SmartOperation, note?: string, target?: Target): Change {
  const check = smartOperation.safeParse(operation);
  if (!check.success) throw new Error("A requested value, position or size is outside the supported range.");
  return { operation: check.data, label: target ? target.label : operationLabel(check.data), note, target };
}

function changedText(target: Target, meaning: Extract<Meaning, { kind: "value" | "style" }>, previous?: Change): Change {
  if (target.kind === "field") {
    if (meaning.kind !== "value") throw new Error("Enter a new value for this fillable field. Smart Editor supports changing its value.");
    return describe({ kind: "set_field", page: target.page, field: target.field, before: target.value, text: meaning.value },
      target.pages.length > 1 ? "This form field shares one value across its listed pages." : undefined, target);
  }
  const { line } = target;
  const existing = previous?.operation.kind === "cover_text" ? previous.operation : undefined;
  const style = meaning.kind === "style" ? meaning.style : { replacement: meaning.value };
  const sizeBefore = existing?.size ?? line.size;
  const size = style.size === 0 ? Math.min(96, sizeBefore * 1.2) : style.size === -1 ? Math.max(6, sizeBefore / 1.2) : style.size ?? sizeBefore;
  const warning = "Visual cover. The original text remains searchable or recoverable.";
  const note = target.origin === "ocr" ? `OCR is approximate. Check the recognized text and placement. ${warning}` :
    target.origin === "inferred" ? `The field was inferred from the surrounding text. ${warning}` : warning;
  return describe({ kind: "cover_text", page: target.page, text: style.replacement ?? existing?.text ?? target.value,
    cover: line.rect, baseline: existing?.baseline ?? line.baseline, size, right: target.right,
    bold: style.bold ?? existing?.bold ?? line.bold, color: style.color ?? existing?.color ?? "#000000", serif: line.serif }, note, target);
}

function move(change: Change, meaning: Extract<Meaning, { kind: "move_photo" | "move_text" }>) {
  const { operation } = change;
  if (meaning.kind === "move_photo" && operation.kind === "insert_image") {
    const { box } = operation;
    const x = meaning.position.endsWith("right") ? .94 - box.width : meaning.position.endsWith("left") ? .06 : (1 - box.width) / 2;
    const y = meaning.position.startsWith("top") ? .06 : .94 - box.height;
    return describe({ ...operation, box: { ...box, x, y } }, "The uploaded image will move to the new frame.");
  }
  if (meaning.kind === "move_text" && operation.kind === "cover_text") {
    const { direction } = meaning;
    const x = operation.baseline.x + (direction === "right" ? .022 : direction === "left" ? -.022 : 0);
    const y = operation.baseline.y + (direction === "down" ? .022 : direction === "up" ? -.022 : 0);
    return describe({ ...operation, baseline: { x, y } }, `Move the replacement slightly ${direction}. ${change.note ?? ""}`.trim(), change.target);
  }
  throw new Error("Which editable item should move? You can move a recently added Smart Editor photo or replacement text in the current session.");
}

function contextRequest(meaning: Meaning) {
  if (meaning.kind === "move_photo" || meaning.kind === "move_text") return true;
  return (meaning.kind === "style" || meaning.kind === "value") && /^(?:it|that|this|that text|the same field)$/i.test(meaning.label);
}

export function isFollowUp(prompt: string) {
  return /^(?:please\s+)?(?:also[,\s]+)?(?:(?:make|change|set|move|shift)\s+(?:it|that|this)\b|(?:increase|reduce|raise|enlarge)\s+its\b|(?:move|shift)\s+(?:the |my |this )?(?:picture|photo|image|(?:main )?heading|title)\b)/i.test(prompt.trim());
}

export async function prepareInstruction({
  pdf, prompt, active, current, prior, followUp = false, image, decisions, signal, status,
}: {
  pdf: PDFDocumentProxy; prompt: string; active: number; current: File; prior?: Revision; followUp?: boolean;
  image?: string; decisions: Decisions; signal: AbortSignal; status: (message: string) => void;
}): Promise<AssistantResult> {
  const today = new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(new Date());
  const meanings = understand(prompt, active, pdf.numPages, today);
  const useContext = !!prior && (followUp || meanings.some(contextRequest));
  const base = useContext ? prior.base : current;
  const changes = useContext ? [...prior.changes] : [];
  let focus = changes.length === 1 ? 0 : -1;
  if (useContext && changes.length > 1) {
    const editable = changes.map((change, index) => change.target || change.operation.kind === "insert_image" ? index : -1).filter((index) => index >= 0);
    if (editable.length === 1) focus = editable[0];
  }
  const touched = new Set<string>();
  let outputPhoto = useContext ? prior.image : image;
  for (const [step, meaning] of meanings.entries()) {
    signal.throwIfAborted();
    if (meaning.kind === "command") {
      if (base !== current && useContext) throw new Error("Apply this follow-up first, then request page or photo operations separately.");
      const { operation, note } = await planInstruction(pdf, meaning.command, !!image, signal);
      changes.push(describe(operation, note));
      focus = operation.kind === "insert_image" ? changes.length - 1 : -1;
      if (operation.kind === "insert_image") outputPhoto = image;
      continue;
    }
    if (meaning.kind === "move_photo" || meaning.kind === "move_text") {
      let index = focus;
      if (meaning.kind === "move_photo") {
        const positions = changes.map((change, index) => change.operation.kind === "insert_image" ? index : -1).filter((index) => index >= 0);
        if (positions.length === 1) index = positions[0];
      }
      const previous = changes[index];
      if (!previous) throw new Error("Which item should move? Select or add replacement text or an uploaded photo first.");
      changes[index] = move(previous, meaning);
      focus = index;
      continue;
    }
    if (contextRequest(meaning) || (useContext && focus >= 0 && changes[focus].target?.category === "heading" && fieldCategory(meaning.label) === "heading")) {
      const previous = changes[focus];
      if (!previous?.target) throw new Error("Which change should this apply to? Name the field or heading in the instruction.");
      changes[focus] = changedText(previous.target, meaning, previous);
      continue;
    }
    if (base !== current) throw new Error("Apply this follow-up first, then name other fields in a separate instruction.");
    status("Finding matching fields…");
    const pages = await documentPages(pdf, signal, meaning.page);
    const exact = meaning.kind === "value" ? meaning.exact : undefined;
    let matches = candidates(pages, meaning.label, exact);
    const scanned = pages.filter((page) => !page.selectable && !page.fields.length);
    if (!matches.length && scanned.length) {
      const toRead = scanned.length <= 2 ? scanned : scanned.filter((page) => page.page === active);
      if (!toRead.length) throw new Error("There are several image-only pages. Open the intended page or name it so Smart Editor can read it with OCR.");
      status("Reading the scanned page with English OCR…");
      const recognized = [];
      for (const { page } of toRead) recognized.push(await scanPage(pdf, page, signal));
      matches = candidates(recognized, meaning.label, exact);
      if (!matches.length) throw new Error(`OCR could not identify ${meaning.label}. Check the scan or identify a clearer page.`);
    }
    if (!matches.length) throw new Error(`I couldn't locate ${meaning.label}. What label or visible text identifies it?`);
    const choice = decisions[step];
    const ambiguous = matches.length > 1 || matches[0].kind === "text" && matches[0].origin === "ocr";
    if (ambiguous && !choice) {
      if (matches.length > 24) throw new Error("There are more than 24 matching fields. Name a page or give a more specific field label.");
      return { kind: "clarify", question: { step, options: matches, label: meaning.label } };
    }
    let target = choice ? matches.find(({ id }) => id === choice) : matches[0];
    if (!target) throw new Error("That match is no longer available. Review the instruction again.");
    if (target.kind === "field") {
      const widgets = (await pdf.getFieldObjects())?.[target.field] as { page?: number }[] | undefined;
      const pages = widgets?.flatMap(({ page }) => typeof page === "number" && page >= 0 && page < pdf.numPages ? [page] : []) ?? [];
      target = { ...target, pages: [...new Set([...target.pages, ...pages])].sort((a, b) => a - b) };
    }
    const id = target.id;
    const same = changes.findIndex((change) => change.target?.id === id);
    if (same >= 0) {
      if (!touched.has(target.id) || meaning.kind === "style") changes[same] = changedText(target, meaning, changes[same]);
      else throw new Error(`The request gives more than one new value for ${target.label}. Use one value per field.`);
      focus = same;
    } else {
      changes.push(changedText(target, meaning));
      focus = changes.length - 1;
    }
    if (meaning.kind === "value") touched.add(target.id);
  }
  return { kind: "plan", revision: { changes, base, image: outputPhoto } };
}
