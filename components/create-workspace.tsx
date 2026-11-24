"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, Node, useEditor, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import { NodeSelection } from "@tiptap/pm/state";
import { Bold, Italic, Underline, List, ListOrdered, Undo2, Redo2, FilePlus, ImagePlus, Table2, Save, FolderOpen, Settings2 } from "lucide-react";
import { readDocumentImage } from "../lib/document-image";
import type { PreviewOutput } from "./document-preview";
import { draftImage } from "../lib/draft-image-geometry";
import { defaultDraftFont, findDraftFont } from "../lib/draft-fonts";
import { ensureBrowserFont } from "../lib/document-fonts";
import { PaperImage } from "./draft-image";
import { draftTableExtensions } from "./draft-table";
import { tableFormatting } from "../lib/draft-table-format";
import { ColorControl, FontControl, FontSizeControl } from "./draft-format-controls";
import { DraftImageControls, DraftTableControls } from "./draft-object-controls";
import { addDraftPage, alignDraft, capitalizePreference, DraftWriting, readDraftFile, saveDraftFile } from "./draft-writing";

const Preview = dynamic(() => import("./document-preview"), { ssr: false });
const PaperBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  parseHTML: () => [{ tag: "div[data-paper-break]" }],
  renderHTML: () => ["div", { "data-paper-break": "", contenteditable: "false", role: "separator", "aria-label": "Page break" }, "Page break"],
});
const extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, blockquote: false, codeBlock: false, code: false, horizontalRule: false, link: false }),
  TextStyleKit.configure({ lineHeight: false }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  ...draftTableExtensions,
  PaperImage, PaperBreak,
];
const retainScroll = { scrollIntoView: false };

function toolbarState(editor: Editor | null) {
  if (!editor) return null;
  const style = editor.getAttributes("textStyle");
  const heading = editor.getAttributes("heading").level as number | undefined;
  const paragraphAttrs = editor.getAttributes(heading ? "heading" : "paragraph");
  const image = editor.isActive("image") ? editor.getAttributes("image") : null;
  const inTable = editor.isActive("table");
  const cell = editor.isActive("tableHeader") ? editor.getAttributes("tableHeader") : editor.getAttributes("tableCell");
  return {
    bold: editor.isActive("bold"), italic: editor.isActive("italic"), underline: editor.isActive("underline"),
    bullets: editor.isActive("bulletList"), numbers: editor.isActive("orderedList"),
    table: inTable ? { ...tableFormatting(editor.getAttributes("table")), background: cell.background ?? "#ffffff",
      cellAlign: cell.cellAlign ?? "left", vertical: cell.vertical ?? "top", merge: editor.can().mergeCells(), split: editor.can().splitCell() } : null,
    undo: editor.can().undo(), redo: editor.can().redo(),
    font: findDraftFont(style.fontFamily).name,
    size: (style.fontSize ?? "") as string,
    color: (style.color ?? "#222222") as string,
    highlight: (style.backgroundColor ?? "") as string,
    heading: String(heading ?? 0), alignment: (paragraphAttrs.textAlign ?? "left") as string,
    image: image ? draftImage(image) : null,
  };
}

export function CreateWorkspace() {
  const [autoCapitalize, setAutoCapitalize] = useState(true);
  const capitalizationEnabled = useRef(true);
  const [draftMessage, setDraftMessage] = useState("");
  const draftFile = useRef<HTMLInputElement>(null);
  const writing = useMemo(() => DraftWriting.configure({
    capitalizationEnabled: () => capitalizationEnabled.current,
    save: (editor) => { saveDraftFile(editor); setDraftMessage("Draft downloaded."); },
  }), []);
  const editor = useEditor({
    extensions: [...extensions, writing],
    content: "<p></p>",
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: "create-document", role: "textbox", "aria-label": "Document page", "aria-multiline": "true" },
    },
  });
  const state = useEditorState({ editor, selector: ({ editor }) => toolbarState(editor) }) ?? toolbarState(editor);
  const [output, setOutput] = useState<PreviewOutput | null>(null);
  const outputDocument = useRef<object | null>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const imageInput = useRef<HTMLInputElement>(null);
  const replacing = useRef(false);
  const preview = useRef<HTMLButtonElement>(null);
  const job = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { void ensureBrowserFont(defaultDraftFont).catch(() => {}); }, []);
  useEffect(() => {
    try { if (localStorage.getItem(capitalizePreference) === "off") { capitalizationEnabled.current = false; setAutoCapitalize(false); } } catch {}
  }, []);
  useEffect(() => { if (output) return () => URL.revokeObjectURL(output.url); }, [output]);

  async function openDraft(file: File) {
    if (!editor || job.current) return;
    const current = editor.state.doc;
    job.current = true;
    setStatus("Opening draft…");
    setError("");
    setDraftMessage("");
    try {
      const draft = await readDraftFile(file, editor);
      await Promise.all(draft.fonts.map((name) => ensureBrowserFont(findDraftFont(name))));
      if (!mounted.current || editor.isDestroyed) return;
      if (editor.state.doc !== current) throw new Error("The current document changed during loading. Open the draft again to replace it.");
      if (!editor.isEmpty && !window.confirm("Replace this document with the saved draft?")) return;
      editor.commands.setContent(draft.document, { errorOnInvalidContent: true });
      editor.commands.focus(undefined, retainScroll);
      setDraftMessage("Saved draft opened.");
    } catch (caught) {
      if (mounted.current) setError(caught instanceof SyntaxError ? "Choose a draft saved by samPDF." : caught instanceof Error ? caught.message : "The draft could not be opened.");
    } finally {
      job.current = false;
      if (mounted.current) setStatus("");
    }
  }

  async function insertPicture(file: File, replace: boolean) {
    if (!editor || job.current) return;
    job.current = true;
    setError("");
    setStatus("Preparing image…");
    const selection = editor.state.selection.from;
    const original = editor.state.selection instanceof NodeSelection ? editor.state.selection.node : null;
    try {
      const image = await readDocumentImage(file);
      if (!mounted.current || editor.isDestroyed) return;
      if (replace) {
        if (original?.type.name !== "image" || editor.state.doc.nodeAt(selection) !== original) {
          setError("Select the image again before replacing it.");
          return;
        }
        editor.view.dispatch(editor.state.tr.setNodeMarkup(selection, undefined, {
          ...original.attrs, src: image.data, alt: file.name, sourceWidth: image.width, sourceHeight: image.height, crop: [0, 0, 0, 0],
        }));
        return;
      }
      const width = Math.min(350, image.width, 720 * image.width / image.height);
      editor.chain().focus().setTextSelection(Math.min(selection, editor.state.doc.content.size - 1)).insertContent({
        type: "image", attrs: { src: image.data, alt: file.name, sourceWidth: image.width, sourceHeight: image.height,
          width: Math.round(width), height: Math.round(width * image.height / image.width), position: "center" },
      }).run();
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : "The image could not be inserted.");
    } finally {
      job.current = false;
      if (mounted.current) setStatus("");
    }
  }

  async function renderPdf() {
    if (!editor || job.current) return;
    job.current = true;
    setStatus("Building your PDF…");
    setError("");
    const snapshot = editor.state.doc;
    const document = editor.getJSON();
    try {
      const { generateCreatedPdf } = await import("../lib/create-pdf");
      const file = await generateCreatedPdf(document);
      if (!mounted.current) return;
      if (editor.state.doc !== snapshot) {
        setError("The draft changed while the PDF was building. Preview again for the latest version.");
        return;
      }
      outputDocument.current = snapshot;
      setOutput({ file, url: URL.createObjectURL(file), name: "sampdf-document.pdf", mime: "application/pdf" });
      setOpen(true);
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : "Your PDF could not be generated.");
    } finally {
      job.current = false;
      if (mounted.current) {
        setStatus("");
      }
    }
  }

  return <section className="create-workspace editor" aria-label="Create PDF workspace">
    <header className="editor-top">
      <div><h2>New document</h2><p>A4 portrait</p></div>
      <div className="preview-actions create-actions">
        <span className="create-progress" role="status">{status}</span>
        <button ref={preview} type="button" className="button primary" disabled={!editor || !!status} onClick={() => output && editor?.state.doc === outputDocument.current ? setOpen(true) : void renderPdf()}>Preview PDF</button>
      </div>
    </header>
    {editor && state && <>
      <div className="preview-tools create-toolbar" role="group" aria-label="Document formatting">
        <button type="button" className="icon-button" aria-label="Undo" title="Undo (Ctrl/⌘+Z)" disabled={!state.undo || !!status} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={18} /></button>
        <button type="button" className="icon-button" aria-label="Redo" title="Redo (Ctrl/⌘+Y or Ctrl/⌘+Shift+Z)" disabled={!state.redo || !!status} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={18} /></button>
        <label><span className="sr-only">Paragraph style</span><select value={state.heading} disabled={!!status} onChange={(event) => {
          const level = Number(event.currentTarget.value);
          if (level === 1 || level === 2 || level === 3) editor.chain().focus().setHeading({ level }).run();
          else editor.chain().focus().setParagraph().run();
        }}><option value="0">Paragraph</option>{[1, 2, 3].map((level) => <option key={level} value={level}>Heading {level}</option>)}</select></label>
        <FontControl value={state.font} disabled={!!status} apply={(font) => editor.chain().focus(undefined, retainScroll).setFontFamily(font.css).run()} />
        <FontSizeControl value={state.size} disabled={!!status} apply={(size) => {
          const chain = editor.chain().focus(undefined, retainScroll);
          if (size) chain.setFontSize(size).run();
          else chain.unsetFontSize().run();
        }} />
        <button type="button" className="icon-button" aria-label="Bold" title="Bold (Ctrl/⌘+B)" disabled={!!status} aria-pressed={state.bold} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={17} /></button>
        <button type="button" className="icon-button" aria-label="Italic" title="Italic (Ctrl/⌘+I)" disabled={!!status} aria-pressed={state.italic} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={17} /></button>
        <button type="button" className="icon-button" aria-label="Underline" title="Underline (Ctrl/⌘+U)" disabled={!!status} aria-pressed={state.underline} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={17} /></button>
        <ColorControl value={state.color} disabled={!!status} apply={(color) => {
          const chain = editor.chain().focus(undefined, retainScroll);
          if (color) chain.setColor(color).run();
          else chain.unsetColor().run();
        }} />
        <ColorControl highlight value={state.highlight} disabled={!!status} apply={(color) => {
          const chain = editor.chain().focus(undefined, retainScroll);
          if (color) chain.setBackgroundColor(color).run();
          else chain.unsetBackgroundColor().run();
        }} />
        <label><span className="sr-only">Text alignment</span><select title="Ctrl/⌘+L for left, E for centre, R for right, J to justify" disabled={!!status} value={state.alignment} onChange={(event) => {
          alignDraft(editor, event.currentTarget.value);
          editor.commands.focus(undefined, retainScroll);
        }}>
          <option value="left">Align left</option><option value="center">Centre</option><option value="right">Align right</option><option value="justify">Justify</option>
        </select></label>
        <button type="button" className="icon-button" aria-label="Bullet list" title="Bullet list (Ctrl/⌘+Shift+8)" disabled={!!status} aria-pressed={state.bullets} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={18} /></button>
        <button type="button" className="icon-button" aria-label="Numbered list" title="Numbered list (Ctrl/⌘+Shift+7)" disabled={!!status} aria-pressed={state.numbers} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={18} /></button>
      </div>
      <div className="preview-tools create-toolbar" role="group" aria-label="Insert content">
        <button className="button secondary compact" type="button" disabled={!!status} onClick={() => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()}><Table2 size={16} aria-hidden="true" /> Insert table</button>
        <input type="file" ref={imageInput} accept="image/jpeg,image/png,image/webp,image/gif,image/bmp" aria-label="Import document image" hidden onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void insertPicture(file, replacing.current);
          replacing.current = false;
        }} />
        <button className="button secondary compact" type="button" disabled={!!status} onClick={() => { replacing.current = false; imageInput.current?.click(); }}><ImagePlus size={16} aria-hidden="true" /> Insert image</button>
        <button className="button secondary compact" type="button" title="Add page (Ctrl/⌘+Enter)" disabled={!!status || !!state.table} onClick={() => { addDraftPage(editor); editor.commands.focus(); }}><FilePlus size={16} aria-hidden="true" /> Add page</button>
        <button className="button secondary compact" type="button" title="Save draft (Ctrl/⌘+S)" onClick={() => writing.options.save(editor)}><Save size={16} aria-hidden="true" /> Save draft</button>
        <button className="button secondary compact" type="button" disabled={!!status} onClick={() => draftFile.current?.click()}><FolderOpen size={16} aria-hidden="true" /> Open draft</button>
        <input type="file" hidden ref={draftFile} aria-label="Upload saved samPDF draft" accept=".json,application/json" onChange={(event) => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void openDraft(file);
        }} />
        <details className="create-menu" onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
        }}>
          <summary aria-label="Writing settings"><Settings2 size={15} aria-hidden="true" /> Writing settings</summary>
          <div className="create-popover"><label className="editor-toggle"><input type="checkbox" checked={autoCapitalize} onChange={(event) => {
            const enabled = event.currentTarget.checked;
            capitalizationEnabled.current = enabled;
            setAutoCapitalize(enabled);
            try { localStorage.setItem(capitalizePreference, enabled ? "on" : "off"); } catch {}
          }} /> Auto-capitalize sentences</label></div>
        </details>
        <span className="sr-only" role="status">{draftMessage}</span>
      </div>
      <div className="create-context">
        {state.table && !state.image && <DraftTableControls editor={editor} state={state.table} disabled={!!status} />}
        {state.image && <DraftImageControls editor={editor} image={state.image} disabled={!!status} replace={() => { replacing.current = true; imageInput.current?.click(); }} />}
        {!state.table && !state.image && <p className="draft-control-hint">Select an image or table to adjust it.</p>}
      </div>
    </>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
    <div className="create-paper">{editor ? <EditorContent editor={editor} /> : <div className="create-document" aria-hidden="true" />}</div>
    <p className="editor-note">Text flows onto additional A4 pages in the generated PDF. Use Preview PDF to check the final page breaks.</p>
    {output && <Preview output={output} open={open} onClose={() => { setOpen(false); requestAnimationFrame(() => preview.current?.focus({ preventScroll: true })); }} />}
  </section>;
}
