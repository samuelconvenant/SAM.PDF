"use client";

import dynamic from "next/dynamic";
import { ChevronLeft, ChevronRight, FileText, ImagePlus, Minus, Plus, Sparkles, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { runDocumentJob } from "../lib/document-job";
import { readDocumentImage } from "../lib/document-image";
import { smartExamples, smartPageLimit, smartPdfLimit, smartPromptLimit } from "../lib/smart-commands";
import type { SmartJob, SmartOperation } from "../lib/smart-plan";
import type { PreviewOutput } from "./document-preview";
import { PagePreviews, PdfCanvas, usePdf } from "./page-preview";

const DocumentPreview = dynamic(() => import("./document-preview"), { ssr: false });
const pdfType = "application/pdf";
type Review = { file: File; operation: SmartOperation; label: string; note?: string };
type Photo = { name: string; data: string };

export function SmartWorkspace() {
  const input = useRef<HTMLInputElement>(null);
  const revision = useRef(0);
  const [source, setSource] = useState<{ file: File; id: number } | null>(null);
  const [error, setError] = useState("");
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const id = ++revision.current;
    const file = files[0];
    setError("");
    if (files.length !== 1 || !file.size || file.size > smartPdfLimit) { setError("Choose one non-empty PDF of 25 MiB or less."); return; }
    try {
      const header = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
      if (!header.includes("%PDF-")) throw new Error();
      if (id === revision.current) setSource({ file, id });
    } catch {
      if (id === revision.current) setError("Choose a valid PDF.");
    }
  }
  return <div className="workspace" aria-label="Smart PDF Editor workspace">
    <input type="file" accept=".pdf,application/pdf" aria-label="Upload PDF to Smart Editor" ref={input} hidden
      onChange={(event) => { void upload(event.currentTarget.files); event.currentTarget.value = ""; }} />
    {source ? <SmartSession key={source.id} source={source.file} onReplace={() => input.current?.click()} />
      : <div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files); }}>
        <span className="upload-icon"><Sparkles size={27} aria-hidden="true" /></span>
        <h2>Choose a PDF</h2>
        <p>Describe one change in English, then review it on the actual document. Up to 25 MiB and 150 pages.</p>
        <button className="button primary" type="button" onClick={() => input.current?.click()}><Upload size={18} aria-hidden="true" /> Choose file</button>
      </div>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
  </div>;
}

function SmartSession({ source, onReplace }: { source: File; onReplace: () => void }) {
  const [current, setCurrent] = useState(source);
  const [isEdited, setEdited] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [showProposal, setShowProposal] = useState(true);
  const [output, setOutput] = useState<PreviewOutput | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [renderedFile, setRenderedFile] = useState<Blob>();
  const [photoDirty, setPhotoDirty] = useState(false);
  const job = useRef<AbortController | null>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const previewFile = review && showProposal ? review.file : current;
  const ready = renderedFile === previewFile && !locked;
  const onLocked = useCallback(() => setLocked(true), []);

  useEffect(() => () => job.current?.abort(), []);
  useEffect(() => { if (output) return () => URL.revokeObjectURL(output.url); }, [output]);

  async function generate(prepare: (signal: AbortSignal) => Promise<{ operation: SmartOperation; note?: string }>) {
    if (job.current) return;
    const controller = new AbortController();
    job.current = controller;
    setBusy("Preparing preview…");
    setError("");
    const time = window.setTimeout(() => controller.abort(new Error("Layout analysis timed out. Try a simpler page.")), 20_000);
    try {
      const { operation, note } = await prepare(controller.signal);
      window.clearTimeout(time);
      controller.signal.throwIfAborted();
      const [{ operationLabel }, file] = await Promise.all([
        import("../lib/smart-plan"),
        runDocumentJob<SmartJob, File>(() => new Worker(new URL("../lib/smart-pdf.worker.ts", import.meta.url), { type: "module" }),
          { source: current, operation, image: operation.kind === "insert_image" ? photo?.data : undefined }, controller.signal, 35_000),
      ]);
      controller.signal.throwIfAborted();
      setReview({ file, operation, note, label: operationLabel(operation) });
      setShowProposal(true);
      setPhotoDirty(false);
      const target = "page" in operation ? operation.page : 0;
      setIndex(operation.kind === "remove_page" ? Math.max(0, target - 1) : target);
    } catch (caught) {
      if (job.current !== controller) return;
      const reason = controller.signal.aborted ? controller.signal.reason : caught;
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "This instruction could not be prepared.");
    } finally {
      window.clearTimeout(time);
      if (job.current === controller) { job.current = null; setBusy(""); }
    }
  }

  async function uploadPhoto(file?: File) {
    if (!file) return;
    setPhotoBusy(true);
    setError("");
    try { setPhoto({ name: file.name, data: (await readDocumentImage(file, true)).data }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The photo could not be opened."); }
    finally { setPhotoBusy(false); }
  }

  async function adjustPhoto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (review?.operation.kind !== "insert_image") return;
    const fields = new FormData(event.currentTarget);
    const distance = (name: string) => Number(fields.get(name)) / 100;
    const box = { x: distance("x"), y: distance("y"), width: distance("width"), height: distance("height") };
    if (box.x + box.width > 1.000001 || box.y + box.height > 1.000001) {
      setError("Keep the whole photo frame inside the page. Position and size must add up to 100% or less.");
      return;
    }
    const operation = { ...review.operation, box };
    await generate(async () => ({ operation, note: "The photo fills the adjusted frame. Review the crop before applying." }));
  }

  function revise(focus: boolean) {
    setReview(null);
    setPhotoDirty(false);
    setError("");
    if (focus) requestAnimationFrame(() => promptInput.current?.focus());
  }

  function apply() {
    if (!review || !showProposal || !ready || photoDirty || busy) return;
    setCurrent(review.file);
    setEdited(true);
    setReview(null);
    setOutput(null);
    setPrompt("");
    setError("");
  }

  function download() {
    if (!output) setOutput({ file: current, url: URL.createObjectURL(current), mime: pdfType, name: source.name.replace(/\.pdf$/i, "") + "-edited.pdf" });
    setPreviewOpen(true);
  }

  return <div className="work-panel smart-workspace">
    <div className="work-heading"><h2>{source.name}</h2><button type="button" className="button secondary compact" onClick={onReplace}>Replace PDF</button></div>
    <PagePreviews file={previewFile} full onLocked={onLocked}>
      <div className="smart-grid">
        <section className="smart-view" aria-label="Smart Editor document">
          {review && <div className="smart-compare" role="group" aria-label="Compare changes">
            <button type="button" className="button secondary compact" aria-pressed={!showProposal} onClick={() => setShowProposal(false)}>Original</button>
            <button type="button" className="button secondary compact" aria-pressed={showProposal} onClick={() => setShowProposal(true)}>Proposed</button>
          </div>}
          <SmartViewer index={index} setIndex={setIndex} zoom={zoom} setZoom={setZoom} onRendered={setRenderedFile} locked={locked} />
        </section>
        <section className="smart-instructions" aria-labelledby="smart-instructions">
          <h3 id="smart-instructions">Your instruction</h3>
          <p>Use one English instruction at a time. If you omit a page, text and photos go on the visible page.</p>
          <InstructionForm prompt={prompt} setPrompt={setPrompt} promptInput={promptInput}
            disabled={!ready || !!review || !!busy || photoBusy} index={index}
            onSubmit={(pdf, index) => void generate(async (signal) => {
              const { planInstruction } = await import("../lib/smart-layout");
              return planInstruction(pdf, prompt, index, !!photo, signal);
            })} />
          <input type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" aria-label="Upload JPEG or PNG photo" ref={photoInput} hidden
            onChange={(event) => { void uploadPhoto(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
          <div className="smart-photo">
            <button type="button" className="button secondary compact" disabled={!!review || !!busy || photoBusy} onClick={() => photoInput.current?.click()}>
              <ImagePlus size={16} aria-hidden="true" /> {photo ? "Replace photo" : "Upload photo"}
            </button>
            {photo && <span>{photo.name}</span>}
            {photo && !review && <button type="button" className="button secondary compact" disabled={!!busy || photoBusy} onClick={() => setPhoto(null)}>Remove photo</button>}
          </div>
          {!review && <details className="smart-examples">
            <summary>Example instructions</summary>
            <ul>{smartExamples.map((example) => <li key={example}><button type="button" disabled={!!busy} onClick={() => { setPrompt(example); promptInput.current?.focus(); }}>{example}</button></li>)}</ul>
          </details>}
          {review && <section className="smart-review" aria-labelledby="smart-proposal">
            <h3 id="smart-proposal">Proposed change</h3>
            <p>{review.label}</p>
            {review.note && <p>{review.note}</p>}
            {review.operation.kind === "insert_image" && <form key={JSON.stringify(review.operation.box)} className="smart-photo-adjust" onSubmit={(event) => void adjustPhoto(event)} onChange={() => setPhotoDirty(true)}>
              <fieldset disabled={!!busy}><legend>Photo frame (% of page)</legend>
                {Object.entries(review.operation.box).map(([name, value]) => <label className="field" key={name}>{({ x: "Left", y: "Top", width: "Width", height: "Height" })[name]}
                  <input type="number" name={name} min={name === "x" || name === "y" ? 0 : 1} max={100} step=".1" required defaultValue={Math.round(value * 1000) / 10} />
                </label>)}
              </fieldset>
              <button type="submit" className="button secondary compact" disabled={!photoDirty || !!busy}>Update photo preview</button>
            </form>}
            <div className="smart-actions">
              <button type="button" className="button primary" disabled={!showProposal || !ready || photoDirty || !!busy} onClick={apply}>Apply changes</button>
              <button type="button" className="button secondary" disabled={!!busy} onClick={() => revise(true)}>Revise</button>
              <button type="button" className="button secondary" disabled={!!busy} onClick={() => { revise(false); setPrompt(""); }}>Cancel proposal</button>
            </div>
          </section>}
          {(busy || photoBusy) && <p role="status">{busy || "Preparing photo…"}</p>}
          {error && <p className="workspace-error" role="alert">{error}</p>}
          {isEdited && !review && <div className="smart-actions">
            <p role="status">Changes applied.</p><button type="button" className="button primary" disabled={!!busy} onClick={download}><FileText size={16} aria-hidden="true" /> Preview &amp; download</button>
          </div>}
        </section>
      </div>
    </PagePreviews>
    {output && <DocumentPreview output={output} open={previewOpen} onClose={() => setPreviewOpen(false)} />}
  </div>;
}

function SmartViewer({ index, setIndex, zoom, setZoom, onRendered, locked }: {
  index: number; setIndex: (index: number) => void; zoom: number; setZoom: (zoom: number) => void; onRendered: (file: Blob) => void; locked: boolean;
}) {
  const pdf = usePdf();
  if (locked) return <p className="workspace-error" role="alert">This PDF is locked. Open an accessible copy with its current password before editing.</p>;
  if (!pdf) return <p className="pdf-loading" role="status">Opening document…</p>;
  if (pdf.numPages > smartPageLimit) return <p className="workspace-error" role="alert">This PDF exceeds the 150-page Smart Editor limit.</p>;
  const page = Math.min(index, pdf.numPages - 1);
  return <>
    <div className="preview-tools">
      <button type="button" className="icon-button" aria-label="Previous page" disabled={!page} onClick={() => setIndex(page - 1)}><ChevronLeft size={18} /></button>
      <span className="page-indicator" aria-live="polite">Page {page + 1} of {pdf.numPages}</span>
      <button type="button" className="icon-button" aria-label="Next page" disabled={page + 1 >= pdf.numPages} onClick={() => setIndex(page + 1)}><ChevronRight size={18} /></button>
      <button type="button" className="icon-button" aria-label="Zoom out" disabled={zoom <= .5} onClick={() => setZoom(zoom - .25)}><Minus size={18} /></button>
      <span className="page-indicator">{Math.round(zoom * 100)}%</span>
      <button type="button" className="icon-button" aria-label="Zoom in" disabled={zoom >= 2.5} onClick={() => setZoom(zoom + .25)}><Plus size={18} /></button>
    </div>
    <PdfCanvas index={page} zoom={zoom} onRendered={onRendered} />
  </>;
}

function InstructionForm({ prompt, setPrompt, promptInput, disabled, index, onSubmit }: {
  prompt: string; setPrompt: (value: string) => void; promptInput: React.RefObject<HTMLTextAreaElement | null>; disabled: boolean; index: number;
  onSubmit: (pdf: NonNullable<ReturnType<typeof usePdf>>, index: number) => void;
}) {
  const pdf = usePdf();
  return <form className="smart-prompt" onSubmit={(event) => {
    event.preventDefault();
    if (pdf && !disabled) onSubmit(pdf, Math.min(index, pdf.numPages - 1));
  }}>
    <label className="field">Describe the change
      <textarea ref={promptInput} value={prompt} onChange={(event) => setPrompt(event.currentTarget.value)} readOnly={disabled}
        maxLength={smartPromptLimit} rows={3} placeholder='Add "Confidential" at the top right of page one' />
    </label>
    <button type="submit" className="button primary" disabled={disabled || !prompt.trim()}>
      <Sparkles size={17} aria-hidden="true" /> Review instruction
    </button>
  </form>;
}
