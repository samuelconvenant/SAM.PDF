import { Extension } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import type { EditorView } from "@tiptap/pm/view";
import { findDraftFont } from "../lib/draft-fonts";
import { maxBytes } from "../lib/tools";

export const capitalizePreference = "sampdf-capitalize-sentences";

type PendingLetter = { position: number; end: number; original: string; changed: string };
const capitalization = new PluginKey<PendingLetter | null>("draftCapitalization");
const abbreviation = /(?:\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|no|fig|approx|e\.g|i\.e)|(?:\b\p{L}\.)*\b\p{L})\.$/iu;
const address = /@|^(?:https?|ftp|file|mailto|tel|sms|data):|^[a-z][a-z0-9+.-]*:\/|^www\.|[\p{L}\p{N}-]\.[\p{L}\p{N}-]/iu;

function separateClipboardEdit(view: EditorView) {
  if (view.editable) view.dispatch(closeHistory(view.state.tr));
  return false;
}

function beginsSentence(prefix: string) {
  if (/^[\s“‘"'«([{]*$/u.test(prefix)) return true;
  if (!/\s[\s“‘"'«([{]*$/u.test(prefix)) return false;
  const before = prefix.replace(/[\s“‘"'«([{]*$/u, "").replace(/[”’"'»\])}]+$/u, "");
  if (/[!?]$/u.test(before)) return true;
  return before.endsWith(".") && !abbreviation.test(before);
}

function capitalizeTyping(before: string, input: string, from: number) {
  const combined = before + input;
  let text = input;
  let pending: PendingLetter | null = null;
  for (const token of combined.matchAll(/[^\s]+/gu)) {
    const index = token.index;
    if (index < before.length) continue;
    const word = token[0];
    const initial = /^[“‘"'«([{]*(\p{L})/u.exec(word);
    if (!initial || address.test(word) || !beginsSentence(combined.slice(0, index))) continue;
    const original = initial[1];
    const changed = original.toUpperCase();
    if (changed === original || changed.length !== original.length) continue;
    const offset = index + initial[0].length - original.length - before.length;
    text = text.slice(0, offset) + changed + text.slice(offset + original.length);
    if (index + word.length === combined.length) pending = { position: from + offset, end: from + text.length, original, changed };
  }
  return { text, pending };
}

export function addDraftPage(editor: Editor) {
  if (editor.isActive("table")) return false;
  return editor.commands.insertContent([{ type: "pageBreak" }, { type: "paragraph" }]);
}

export function alignDraft(editor: Editor, alignment: string) {
  const marks = editor.state.storedMarks;
  return editor.chain().setTextAlign(alignment).command(({ tr }) => {
    if (marks) tr.setStoredMarks(marks);
    return true;
  }).run();
}

export function saveDraftFile(editor: Editor) {
  const contents = JSON.stringify({ version: 1, type: "sampdf-draft", document: editor.getJSON() });
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "sampdf-draft.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function readDraftFile(file: File, editor: Editor) {
  if (!file.size || file.size > maxBytes) throw new Error("Choose a samPDF draft up to 80 MiB.");
  const data = JSON.parse(await file.text());
  if (data?.version !== 1 || data.type !== "sampdf-draft" || data.document?.type !== "doc") throw new Error("Choose a draft saved by samPDF.");
  const draft = editor.schema.nodeFromJSON(data.document);
  draft.check();
  const fonts = new Set<string>();
  draft.descendants((node) => {
    if (node.type.name === "image" && (typeof node.attrs.src !== "string" || !/^data:image\/(png|jpeg);base64,[a-zA-Z0-9+/=]+$/.test(node.attrs.src))) {
      throw new Error("The draft contains an unsupported image.");
    }
    for (const mark of node.marks) {
      if (mark.type.name !== "textStyle") continue;
      const family = mark.attrs.fontFamily;
      if (family) {
        if (typeof family !== "string" || /[;{}]|url\s*\(/i.test(family)) throw new Error("The draft contains an unsupported font declaration.");
        fonts.add(findDraftFont(family).name);
      }
      for (const key of ["color", "backgroundColor", "fontSize"]) {
        const value = mark.attrs[key];
        if (value && (typeof value !== "string" || /[;{}]|url\s*\(/i.test(value))) throw new Error("The draft contains unsupported text formatting.");
      }
    }
  });
  return { document: draft.toJSON() as JSONContent, fonts: [...fonts] };
}

export const DraftWriting = Extension.create<{
  capitalizationEnabled: () => boolean;
  save: (editor: Editor) => void;
}>({
  name: "draftWriting",
  priority: 110,
  addOptions() { return { capitalizationEnabled: () => true, save: saveDraftFile }; },
  addKeyboardShortcuts() {
    const editor = this.editor;
    return {
      "Mod-b": () => editor.commands.toggleBold(),
      "Mod-i": () => editor.commands.toggleItalic(),
      "Mod-u": () => editor.commands.toggleUnderline(),
      "Mod-e": () => alignDraft(editor, "center"),
      "Mod-l": () => alignDraft(editor, "left"),
      "Mod-r": () => alignDraft(editor, "right"),
      "Mod-j": () => alignDraft(editor, "justify"),
      "Mod-z": () => editor.commands.undo(),
      "Mod-y": () => editor.commands.redo(),
      "Mod-Shift-z": () => editor.commands.redo(),
      "Mod-a": () => editor.commands.selectAll(),
      "Mod-s": () => { this.options.save(editor); return true; },
      "Mod-Enter": () => addDraftPage(editor),
      "Mod-Shift-7": () => editor.commands.toggleOrderedList(),
      "Mod-Shift-8": () => editor.commands.toggleBulletList(),
    };
  },
  addProseMirrorPlugins() {
    const enabled = this.options.capitalizationEnabled;
    return [new Plugin<PendingLetter | null>({
      key: capitalization,
      state: {
        init: () => null,
        apply(transaction, current) {
          const next = transaction.getMeta(capitalization) as PendingLetter | null | undefined;
          if (next !== undefined) return next;
          return transaction.docChanged || transaction.selectionSet ? null : current;
        },
      },
      props: {
        handleDOMEvents: { cut: separateClipboardEdit, paste: separateClipboardEdit },
        handleTextInput(view, from, to, input) {
          if (!enabled() || view.composing || !input || /[\r\n]/.test(input)) return false;
          const { state } = view;
          const resolved = state.doc.resolve(from);
          if (!resolved.parent.isTextblock) return false;
          const before = resolved.parent.textBetween(0, resolved.parentOffset, " ", " ");
          const previous = capitalization.getState(state);
          const continued = previous && previous.end === from && from === to ? previous : null;
          const result = capitalizeTyping(before, input, from);
          const originalToken = continued ? (before.slice(continued.position - resolved.start()) + input).split(/\s/u, 1)[0] : "";
          const restore = continued && address.test(originalToken);
          const next = result.pending ?? (continued && !restore && !/\s/u.test(input) ? { ...continued, end: from + result.text.length } : null);
          if (result.text === input && !restore && !next) return false;
          const tr = state.tr;
          if (restore) {
            const existing = state.doc.nodeAt(continued.position);
            tr.replaceWith(continued.position, continued.position + continued.changed.length, state.schema.text(continued.original, existing?.marks));
          }
          view.dispatch(tr.insertText(result.text, from, to).setMeta(capitalization, next).scrollIntoView());
          return true;
        },
      },
    })];
  },
});
