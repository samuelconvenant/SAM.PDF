import type { PDFDocumentProxy } from "pdfjs-dist";
import { candidates, documentPages, scanPage } from "./smart-document";
import type { Target } from "./smart-document";
import { photoFrames, planInstruction } from "./smart-layout";
import { operationLabel, smartOperation } from "./smart-plan";
import type { SmartOperation } from "./smart-plan";
import { fieldCategory, understand } from "./smart-understanding";
import type { Meaning } from "./smart-understanding";

export type Change = {
  operation: SmartOperation;
  label: string;
  note?: string;
  target?: Target;
  previousValue?: string;
};
export type Revision = { base: File; changes: Change[]; image?: string; reviewSteps: number[]; recent: number[]; discussed: number[]; prompt: string };
export type Clarification = { step: number; label: string; options: Pick<Target, "id" | "label" | "value" | "page">[] };
export type Decisions = Record<number, string>;
export type AssistantResult = { kind: "plan"; revision: Revision } | { kind: "clarify"; question: Clarification };

function describe(operation: SmartOperation, note?: string, target?: Target): Change {
  const check = smartOperation.safeParse(operation);
  if (!check.success) throw new Error("A requested value, position or size is outside the supported range.");
  return { operation: check.data, label: target ? target.label : operationLabel(check.data), note, target };
}

function changedText(target: Target, meaning: Extract<Meaning, { kind: "value" | "style" }>, previous?: Change): Change {
  if (meaning.kind === "value" && !meaning.value) {
    throw new Error(`I found ${target.label} on page ${target.page + 1}. What new value should I use? Add it to your instruction.`);
  }
  const previousValue = previous && "text" in previous.operation ? previous.operation.text : target.value;
  if (target.kind === "field") {
    if (meaning.kind !== "value") throw new Error("Enter a new value for this fillable field. Smart Editor supports changing its value.");
    return { ...describe({ kind: "set_field", page: target.page, field: target.field, before: target.value, text: meaning.value! },
      target.pages.length > 1 ? "This form field shares one value across its listed pages." : undefined, target), previousValue };
  }
  const { line } = target;
  const priorEdit = previous?.operation;
  const existing = priorEdit?.kind === "cover_text" || priorEdit?.kind === "replace_text" ? priorEdit : undefined;
  const restore = meaning.kind === "style" && meaning.original;
  const style = meaning.kind === "style" ? meaning.style : { replacement: meaning.value };
  const sizeBefore = restore === "formatting" ? line.size : existing?.size ?? line.size;
  const size = style.size === 0 ? Math.min(96, sizeBefore * 1.2) : style.size === -1 ? Math.max(6, sizeBefore / 1.2) : style.size ?? sizeBefore;
  const fields = { page: target.page, text: style.replacement ?? existing?.text ?? target.value,
    cover: line.rect, baseline: existing?.baseline ?? line.baseline, size, right: target.right };
  const result = target.origin === "ocr" ?
    describe({ kind: "cover_text", ...fields, bold: style.bold ?? existing?.bold ?? line.bold,
      color: style.color ?? existing?.color ?? "#000000", serif: line.serif },
    "OCR is approximate. This visual cover leaves the original image recoverable.", target) :
    describe({ kind: "replace_text", ...fields, before: target.value, originalSize: line.size, originalBaseline: line.baseline,
      bold: restore ? undefined : style.bold ?? existing?.bold, color: restore === "formatting" ? undefined : style.color ?? existing?.color,
      alignment: target.alignment ?? "left" },
    target.origin === "inferred" ? "The field was inferred from the surrounding text." : undefined, target);
  return { ...result, previousValue };
}

function move(change: Change, meaning: Extract<Meaning, { kind: "move_photo" | "move_text" }>) {
  const { operation } = change;
  if (meaning.kind === "move_photo" && operation.kind === "insert_image") {
    const { box } = operation;
    const x = meaning.position.endsWith("right") ? .94 - box.width : meaning.position.endsWith("left") ? .06 : (1 - box.width) / 2;
    const y = meaning.position.startsWith("top") ? .06 : .94 - box.height;
    return describe({ ...operation, box: { ...box, x, y } }, "The uploaded image will move to the new frame.");
  }
  if (meaning.kind === "move_text" && operation.kind === "insert_image") {
    const { box } = operation;
    const x = box.x + (meaning.direction === "right" ? .022 : meaning.direction === "left" ? -.022 : 0);
    const y = box.y + (meaning.direction === "down" ? .022 : meaning.direction === "up" ? -.022 : 0);
    return describe({ ...operation, box: { ...box, x, y } }, `Move the uploaded photo slightly ${meaning.direction}.`);
  }
  if (meaning.kind === "move_text" && (operation.kind === "cover_text" || operation.kind === "replace_text")) {
    const { direction } = meaning;
    const x = operation.baseline.x + (direction === "right" ? .022 : direction === "left" ? -.022 : 0);
    const y = operation.baseline.y + (direction === "down" ? .022 : direction === "up" ? -.022 : 0);
    return { ...describe({ ...operation, baseline: { x, y } }, `Move the replacement slightly ${direction}.`, change.target), previousValue: operation.text };
  }
  throw new Error("Which editable item should move? You can move a recently added Smart Editor photo or replacement text in the current session.");
}

function pronoun(meaning: Meaning) {
  return (meaning.kind === "style" || meaning.kind === "value") && /^(?:it|that|this|that text|the same field)$/i.test(meaning.label);
}

function contextRequest(meaning: Meaning) {
  if (meaning.kind === "move_photo" || meaning.kind === "move_text") return true;
  return pronoun(meaning) || meaning.kind === "value" && !!meaning.relative;
}

function simple(operation: SmartOperation) {
  return ["replace_text", "cover_text", "set_field", "insert_image"].includes(operation.kind);
}

function closeTarget(a: Target | undefined, b: Target) {
  if (!a || a.kind !== b.kind || a.page !== b.page) return false;
  if (a.id === b.id) return true;
  return a.kind === "text" && b.kind === "text" && a.category === b.category &&
    Math.abs(a.line.baseline.x - b.line.baseline.x) < .008 && Math.abs(a.line.baseline.y - b.line.baseline.y) < .006;
}

export async function prepareInstruction({
  pdf, prompt, active, current, prior, followUp = false, image, decisions, signal, status,
}: {
  pdf: PDFDocumentProxy; prompt: string; active: number; current: File; prior?: Revision; followUp?: boolean;
  image?: string; decisions: Decisions; signal: AbortSignal; status: (message: string) => void;
}): Promise<AssistantResult> {
  const today = new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(new Date());
  const meanings = understand(prompt, active, pdf.numPages, today);
  const canExtend = !!prior && prior.changes.every(({ operation }) => simple(operation)) &&
    meanings.every((meaning) => meaning.kind !== "command" || meaning.command.kind === "photo");
  const useContext = !!prior && (followUp || meanings.some(contextRequest) || canExtend && prior.changes.length + meanings.length <= 16);
  const base = useContext ? prior.base : current;
  const changes = useContext ? [...prior.changes] : [];
  let focus = useContext && prior.recent.length === 1 ? prior.recent[0] : -1;
  const discussed = useContext ? [...prior.discussed] : [];
  const reviewSteps = new Set(followUp && useContext ? prior.reviewSteps : []);
  const recent = new Set<number>();
  function record(index: number) {
    reviewSteps.add(index);
    recent.add(index);
    const previous = discussed.indexOf(index);
    if (previous >= 0) discussed.splice(previous, 1);
    discussed.push(index);
    focus = index;
  }
  const touched = new Set<string>();
  let outputPhoto = useContext ? prior.image : image;
  for (const [step, meaning] of meanings.entries()) {
    signal.throwIfAborted();
    if (meaning.kind === "command") {
      if (base !== current && !canExtend) throw new Error("Apply this follow-up first, then request page operations separately.");
      let proposal: { operation: SmartOperation; note?: string } | undefined;
      if (meaning.command.kind === "photo" && !meaning.command.position && image) {
        const page = meaning.command.page;
        const boxes = await photoFrames(pdf, page, meaning.command.top ?? false, signal);
        if (boxes.length) {
          const options = boxes.map((box, index) => ({ id: String(index), page, label: "Photo frame",
            value: `${Math.round(box.x * 100)}% from left, ${Math.round(box.y * 100)}% from top` }));
          if (boxes.length > 1 && decisions[step] === undefined) return { kind: "clarify", question: { step, label: "the photo", options } };
          const box = boxes[Number(decisions[step] ?? 0)];
          if (!box) throw new Error("This frame is no longer available. Review the instruction again.");
          proposal = { operation: { kind: "insert_image", page, box },
            note: boxes.length > 1 ? "Review the crop in the selected frame." : "An empty frame was detected. Confirm that it is the intended photo placeholder." };
        }
      }
      const { operation, note } = proposal ?? await planInstruction(pdf, meaning.command, !!image, signal);
      if (operation.kind === "insert_image" && outputPhoto && image !== outputPhoto && changes.some((change) => change.operation.kind === "insert_image")) {
        throw new Error("This edit history refers to a different uploaded photo. Finish the current plan before substituting the photo.");
      }
      changes.push(describe(operation, note));
      if (operation.kind === "insert_image") record(changes.length - 1);
      else reviewSteps.add(changes.length - 1);
      if (operation.kind === "insert_image") outputPhoto = image;
      continue;
    }
    if (meaning.kind === "move_photo" || meaning.kind === "move_text") {
      if (meaning.kind === "move_text" && meaning.both) {
        const pair = discussed.filter((index) => ["replace_text", "cover_text"].includes(changes[index]?.operation.kind)).slice(-2);
        if (pair.length !== 2) throw new Error("Which two text items should move? Identify both fields before moving them together.");
        pair.forEach((index) => { changes[index] = move(changes[index], meaning); record(index); });
        continue;
      }
      let index = focus;
      if (meaning.kind === "move_photo" || meaning.photo) {
        const positions = changes.map((change, index) => change.operation.kind === "insert_image" ? index : -1).filter((index) => index >= 0);
        if (positions.length === 1) index = positions[0];
      }
      const previous = changes[index];
      if (!previous) throw new Error("Which item should move? Select or add replacement text or an uploaded photo first.");
      changes[index] = move(previous, meaning);
      record(index);
      continue;
    }
    if (pronoun(meaning) || (meaning.kind === "style" && useContext && focus >= 0 && changes[focus].target?.category === "heading" && fieldCategory(meaning.label) === "heading")) {
      const previous = changes[focus];
      if (!previous?.target) throw new Error("Which change should this apply to? Name the field or heading in the instruction.");
      changes[focus] = changedText(previous.target, meaning, previous);
      record(focus);
      continue;
    }
    if (base !== current && !canExtend) throw new Error("Apply this follow-up first, then name other fields in a separate instruction.");
    status("Finding matching fields…");
    const anchor = meaning.kind === "value" && meaning.relative ? changes[focus]?.target : undefined;
    if (meaning.kind === "value" && meaning.relative && anchor?.kind !== "text") {
      throw new Error("Which text should I look below? Identify the reference field or give the page and target label.");
    }
    const pages = await documentPages(pdf, signal, meaning.page ?? anchor?.page);
    const exact = meaning.kind === "value" ? meaning.exact : undefined;
    let matches = candidates(pages, meaning.label, exact);
    if (anchor?.kind === "text") {
      const { baseline } = anchor.line;
      matches = matches.filter((item) => item.kind === "text" && item.line.baseline.y > baseline.y &&
        item.line.baseline.y - baseline.y < .16 && Math.abs(item.line.baseline.x - baseline.x) < .14);
    }
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
    const all = meaning.kind === "value" && meaning.all && matches.every((item) => item.kind !== "text" || item.origin !== "ocr");
    const ambiguous = !all && (matches.length > 1 || matches[0].kind === "text" && matches[0].origin === "ocr");
    if (ambiguous && !choice) {
      if (matches.length > 24) throw new Error("There are more than 24 matching fields. Name a page or give a more specific field label.");
      return { kind: "clarify", question: { step, options: matches, label: meaning.label } };
    }
    const selected = all ? matches : [choice ? matches.find(({ id }) => id === choice) : matches[0]];
    for (let target of selected) {
      if (!target) throw new Error("That match is no longer available. Review the instruction again.");
    if (target.kind === "field") {
      const widgets = (await pdf.getFieldObjects())?.[target.field] as { page?: number }[] | undefined;
      const pages = widgets?.flatMap(({ page }) => typeof page === "number" && page >= 0 && page < pdf.numPages ? [page] : []) ?? [];
      target = { ...target, pages: [...new Set([...target.pages, ...pages])].sort((a, b) => a - b) };
    }
    const selectedTarget = target;
    const same = changes.findIndex((change) => closeTarget(change.target, selectedTarget));
    if (same >= 0) {
      if (!touched.has(target.id) || meaning.kind === "style") changes[same] = changedText(changes[same].target!, meaning, changes[same]);
      else throw new Error(`The request gives more than one new value for ${target.label}. Use one value per field.`);
      record(same);
    } else {
      changes.push(changedText(target, meaning));
      record(changes.length - 1);
    }
    if (meaning.kind === "value") touched.add(target.id);
    }
  }
  if (changes.length > 16) throw new Error("This plan affects more than 16 targets. Split the request or name a specific page.");
  return { kind: "plan", revision: { changes, base, image: outputPhoto, reviewSteps: [...reviewSteps], recent: [...recent], discussed, prompt } };
}
