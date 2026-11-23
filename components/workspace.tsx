"use client";

import { ArrowDown, ArrowUp, Eye, FileText, Grid2X2, GripVertical, List, LoaderCircle, Plus, RotateCw, Upload, X } from "lucide-react";
import { LazyMotion, domMax, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { DragEvent } from "react";
import type { ImageFit, Job, JobResult, PageEdit } from "../lib/pdf-protocol";
import { maxBytes, maxFiles, type LocalTool } from "../lib/tools";
import { PagePreviews, PageThumbnail } from "./page-preview";
import type { PreviewOutput } from "./document-preview";
import type { EditorPage } from "../lib/editor-types";

const DocumentPreview = dynamic(() => import("./document-preview"), { ssr: false, loading: () => <p role="status">Loading preview…</p> });
const PdfEditor = dynamic(() => import("./pdf-editor"), { ssr: false, loading: () => <p role="status">Opening editor…</p> });
type FileEntry = { id: number; file: File; pageCount?: number };
type RunningJob = { worker: Worker; cancel: () => void };

function moved<T>(items: T[], from: number, to: number) {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function fileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Workspace({ tool }: { tool: LocalTool }) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [pages, setPages] = useState<PageEdit[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [ranges, setRanges] = useState("");
  const [fit, setFit] = useState<ImageFit>("fit");
  const [busy, setBusy] = useState<"reading" | "processing" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [output, setOutput] = useState<PreviewOutput | null>(null);
  const [stale, setStale] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [inputPreview, setInputPreview] = useState<FileEntry | null>(null);
  const [grid, setGrid] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLButtonElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const active = useRef<RunningJob | null>(null);
  const generation = useRef(0);
  const sequence = useRef(0);
  const draggingFile = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => () => { generation.current++; active.current?.cancel(); }, []);
  useEffect(() => {
    if (!output) return;
    return () => URL.revokeObjectURL(output.url);
  }, [output]);

  function run(job: Job) {
    return new Promise<Exclude<JobResult, { type: "error" }>>((resolve, reject) => {
      const worker = new Worker(new URL("../lib/pdf.worker.ts", import.meta.url), { type: "module" });
      const finish = () => {
        worker.terminate();
        if (active.current?.worker === worker) active.current = null;
      };
      active.current = { worker, cancel: () => { finish(); reject(new Error("Canceled")); } };
      worker.onmessage = ({ data }: MessageEvent<JobResult>) => {
        finish();
        if (data.type === "error") reject(new Error(data.message));
        else resolve(data);
      };
      worker.onerror = () => { finish(); reject(new Error("The browser could not process this file. Try again with a smaller file.")); };
      worker.onmessageerror = () => { finish(); reject(new Error("The workspace could not read the processing result. Try again.")); };
      try {
        worker.postMessage(job);
      } catch (caught) {
        finish();
        reject(caught);
      }
    });
  }

  const clearFeedback = useCallback(() => {
    setError("");
    setNotice("");
    setStale(true);
  }, []);

  async function add(incoming: File[]) {
    if (busy || active.current || !incoming.length) return;
    clearFeedback();
    if (!tool.multiple && incoming.length !== 1) {
      setError("Choose one PDF at a time.");
      return;
    }
    const next = tool.multiple ? [...files.map(({ file }) => file), ...incoming] : incoming;
    if (next.length > maxFiles || next.reduce((size, file) => size + file.size, 0) > maxBytes) {
      setError("Choose up to 30 files with a combined size of 80 MiB or less.");
      return;
    }
    const job = ++generation.current;
    setBusy("reading");
    try {
      const result = await run({ type: "inspect", files: incoming, image: tool.id === "images-to-pdf" });
      if (generation.current !== job || result.type !== "inspected") return;
      const entries = incoming.map((file, index) => ({ id: ++sequence.current, file, pageCount: result.counts[index] }));
      setOutput(null);
      setPreviewOpen(false);
      setFiles(tool.multiple ? [...files, ...entries] : entries);
      if (!tool.multiple) {
        setPages(result.pages);
        setPageCount(result.pages.length);
        setRanges("");
      }
      setNotice(`${incoming.length} ${incoming.length === 1 ? "file" : "files"} added.`);
    } catch (caught) {
      if (generation.current === job) setError(caught instanceof Error ? caught.message : "Could not open the file.");
    } finally {
      if (generation.current === job) setBusy(null);
    }
  }

  function reset() {
    generation.current++;
    active.current?.cancel();
    setBusy(null);
    setFiles([]);
    setPages([]);
    setPageCount(0);
    setRanges("");
    setFit("fit");
    clearFeedback();
    setOutput(null);
    setPreviewOpen(false);
    setNotice("Workspace cleared.");
    requestAnimationFrame(() => picker.current?.focus());
  }

  function reorderFile(from: number, to: number) {
    if (busy || from < 0 || to < 0 || to >= files.length || from === to) return;
    clearFeedback();
    setFiles(moved(files, from, to));
    setNotice(`${files[from].file.name} moved to position ${to + 1}.`);
  }

  function reorderPage(from: number, to: number) {
    if (busy || from === to || to < 0 || to >= pages.length) return;
    clearFeedback();
    setPages(moved(pages, from, to));
    setNotice(`Page ${pages[from].index + 1} moved to position ${to + 1}.`);
  }

  async function processFiles(edits?: EditorPage[]) {
    if (busy || active.current) return;
    if (output && !stale) {
      setPreviewOpen(true);
      return;
    }
    clearFeedback();
    const job = ++generation.current;
    setBusy("processing");
    try {
      const result = await run({ type: "process", operation: tool.id, files: files.map(({ file }) => file), ranges, pages, fit, edits });
      if (generation.current !== job || result.type !== "processed") return;
      const file = new Blob([result.data], { type: result.mime });
      setOutput({ name: result.name, file, mime: result.mime, url: URL.createObjectURL(file) });
      setStale(false);
      setPreviewOpen(true);
      setNotice("Your document is ready to preview.");
    } catch (caught) {
      if (generation.current === job) setError(caught instanceof Error ? caught.message : "Could not process the file.");
    } finally {
      if (generation.current === job) setBusy(null);
    }
  }

  function dropFiles(event: DragEvent) {
    event.preventDefault();
    setDragOver(false);
    void add(Array.from(event.dataTransfer.files));
  }

  const canProcess = files.length >= (tool.id === "merge" ? 2 : 1);
  const merging = tool.id === "merge";

  return (
    <LazyMotion features={domMax} strict>
      <div className="workspace" aria-label={`${tool.name} workspace`}>
        <input ref={input} type="file" tabIndex={-1} hidden accept={tool.accept} multiple={tool.multiple} onChange={(event) => {
          const selection = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void add(selection);
        }} />
        {files.length === 0 ? (
          <div className="drop-zone" data-dragging={dragOver} onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={dropFiles}>
            <span className="upload-icon"><Upload size={28} strokeWidth={1.7} aria-hidden="true" /></span>
            <h2>{tool.multiple ? "Start with your files" : "Start with your file"}</h2>
            <p>{tool.input}</p>
            <button ref={picker} type="button" className="button primary" disabled={!!busy} onClick={() => input.current?.click()}><Plus size={19} aria-hidden="true" /> {tool.multiple ? "Choose files" : "Choose file"}</button>
            <small className="drop-hint">or drag and drop here</small>
          </div>
        ) : tool.id === "edit" ? (
          <PdfEditor key={files[0].id} file={files[0].file} pages={pages} busy={!!busy} onChange={clearFeedback} onPreview={processFiles} onReset={reset} />
        ) : (
          <div className="work-panel">
            <div className={`work-grid${merging ? " merge-work-grid" : ""}`}>
              <section className="file-section" aria-labelledby="files-heading">
                <div className="work-heading"><h2 id="files-heading">{tool.id === "organize" ? "Your pages" : merging ? "Merge order" : "Your files"}</h2>
                  <div className="merge-controls">
                    {merging && <div role="group" aria-label="Gallery view" className="merge-view">
                      <button type="button" className="icon-button" aria-label="Grid view" aria-pressed={grid} onClick={() => setGrid(true)}><Grid2X2 size={17} /></button>
                      <button type="button" className="icon-button" aria-label="List view" aria-pressed={!grid} onClick={() => setGrid(false)}><List size={18} /></button>
                    </div>}
                    <button type="button" className={`button secondary compact${merging ? " merge-add-desktop" : ""}`} disabled={!!busy} onClick={() => input.current?.click()}><Plus size={16} aria-hidden="true" /> {merging ? "Add PDFs" : tool.multiple ? "Add files" : "Replace file"}</button>
                  </div>
                </div>
                {tool.id === "organize" ? (
                  <PagePreviews key={files[0].id} file={files[0].file}>
                    <p className="file-caption">{files[0].file.name} · {pages.length} of {pageCount} pages</p>
                    <ol className="page-grid">
                      {pages.map((page, index) => {
                        const number = page.index + 1;
                        return <m.li layout={!reducedMotion && pages.length <= 30} transition={{ duration: 0.19 }} key={page.index}>
                          <PageThumbnail index={page.index} rotation={page.rotation} />
                          <div className="page-label">Page {number}</div>
                          <div className="row-actions">
                            <button type="button" className="icon-button" aria-label={`Move page ${number} earlier`} disabled={!!busy || index === 0} onClick={() => reorderPage(index, index - 1)}><ArrowUp size={16} aria-hidden="true" /></button>
                            <button type="button" className="icon-button" aria-label={`Move page ${number} later`} disabled={!!busy || index === pages.length - 1} onClick={() => reorderPage(index, index + 1)}><ArrowDown size={16} aria-hidden="true" /></button>
                            <button type="button" className="icon-button" aria-label={`Rotate page ${number}`} disabled={!!busy} onClick={() => {
                              const rotation = (page.rotation + 90) % 360;
                              clearFeedback();
                              setPages(pages.map((item) => item.index === page.index ? { ...item, rotation } : item));
                              setNotice(`Page ${number} rotated to ${rotation} degrees.`);
                            }}><RotateCw size={16} aria-hidden="true" /></button>
                            <button type="button" className="icon-button" aria-label={`Remove page ${number}`} disabled={!!busy || pages.length === 1} onClick={() => {
                              clearFeedback();
                              setPages(pages.filter((item) => item.index !== page.index));
                              setNotice(`Page ${number} removed.`);
                            }}><X size={16} aria-hidden="true" /></button>
                          </div>
                        </m.li>;
                      })}
                    </ol>
                  </PagePreviews>
                ) : (
                  <ol className={`file-list${merging ? " merge-gallery" : ""}`} data-view={merging ? (grid ? "grid" : "list") : undefined} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={(event) => { if (event.dataTransfer.types.includes("Files")) dropFiles(event); }}>
                    {files.map(({ id, file, pageCount }, index) => (
                      <m.li layout={!reducedMotion} transition={{ duration: 0.19 }} key={id} draggable={tool.multiple && !busy}
                        onDragStartCapture={(event) => {
                          if (!tool.multiple || busy) return;
                          draggingFile.current = id;
                          event.dataTransfer.setData("text/plain", String(id));
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEndCapture={() => { draggingFile.current = null; }}
                        onDragOver={(event) => { if (draggingFile.current !== null) event.preventDefault(); }}
                        onDrop={(event) => {
                          if (draggingFile.current === null) return;
                          event.preventDefault();
                          reorderFile(files.findIndex((entry) => entry.id === draggingFile.current), index);
                          draggingFile.current = null;
                        }}>
                        {merging && <button className="merge-cover" type="button" aria-label={`Preview ${file.name}`} onClick={() => setInputPreview({ id, file, pageCount })}>
                          <PagePreviews file={file} defer><PageThumbnail index={0} /></PagePreviews>
                          <span className="merge-cover-open"><Eye size={16} aria-hidden="true" /> Preview</span>
                        </button>}
                        <span className="file-icon">{tool.multiple ? <GripVertical size={19} aria-hidden="true" /> : <FileText size={19} aria-hidden="true" />}</span>
                        {merging && <span className="merge-order" aria-label={`Merge position ${index + 1}`}>{index + 1}</span>}
                        <div className="file-name"><strong title={file.name}>{file.name}</strong><small>{fileSize(file.size)}{pageCount ? ` · ${pageCount} ${pageCount === 1 ? "page" : "pages"}` : ""}</small></div>
                        <div className="row-actions">
                          {tool.multiple && <>
                            <button type="button" className="icon-button" aria-label={`Move ${file.name} earlier`} disabled={!!busy || index === 0} onClick={() => reorderFile(index, index - 1)}><ArrowUp size={16} aria-hidden="true" /></button>
                            <button type="button" className="icon-button" aria-label={`Move ${file.name} later`} disabled={!!busy || index === files.length - 1} onClick={() => reorderFile(index, index + 1)}><ArrowDown size={16} aria-hidden="true" /></button>
                          </>}
                          <button type="button" className="icon-button" aria-label={`Remove ${file.name}`} disabled={!!busy} onClick={() => {
                            if (files.length === 1) reset();
                            else {
                              clearFeedback();
                              setFiles(files.filter((entry) => entry.id !== id));
                              setNotice(`${file.name} removed.`);
                            }
                          }}><X size={16} aria-hidden="true" /></button>
                        </div>
                      </m.li>
                    ))}
                  </ol>
                )}
              </section>
              <form className="work-settings" onSubmit={(event) => { event.preventDefault(); void processFiles(); }}>
                <h2>Output settings</h2>
                {tool.id === "split" && <div className="field">
                  <label htmlFor="ranges">Page ranges</label>
                  <input id="ranges" value={ranges} maxLength={800} required placeholder="e.g. 1-3, 5" aria-describedby="ranges-hint" disabled={!!busy} onChange={(event) => { clearFeedback(); setRanges(event.target.value); }} />
                  <small id="ranges-hint">{pageCount} {pageCount === 1 ? "page" : "pages"} available. Separate ranges with commas. Multiple outputs download as a ZIP.</small>
                </div>}
                {tool.id === "images-to-pdf" && <div className="field">
                  <label htmlFor="image-fit">Page size</label>
                  <select id="image-fit" value={fit} disabled={!!busy} onChange={(event) => { clearFeedback(); setFit(event.target.value as ImageFit); }}>
                    <option value="fit">Fit each image</option><option value="a4">A4 portrait</option>
                  </select>
                </div>}
                {tool.id === "merge" && <p>Files appear in the output in the order shown. {files.length === 1 && "Add one more PDF to continue."}</p>}
                {tool.id === "organize" && <p>Save the pages in the order shown, with your rotation changes.</p>}
                {merging && <button type="button" className="button secondary merge-add-mobile" disabled={!!busy} onClick={() => input.current?.click()}><Plus size={17} aria-hidden="true" /> Add PDFs</button>}
                <button type="submit" className="button primary" disabled={!!busy || !canProcess}>{busy === "processing" ? "Processing…" : tool.action}</button>
              </form>
            </div>
            <button type="button" className="text-button" onClick={reset}>Clear workspace</button>
          </div>
        )}
        {busy && <div className="workspace-status">
          <span><LoaderCircle size={18} className="spinner" aria-hidden="true" /> {busy === "reading" ? "Checking files…" : "Processing on this device…"}</span>
          <button type="button" className="text-button" onClick={() => {
            generation.current++;
            active.current?.cancel();
            setBusy(null);
            setNotice("Processing canceled.");
          }}>Cancel</button>
        </div>}
        {error && <p className="workspace-error" role="alert">{error}</p>}
        <p className="sr-only" role="status" aria-atomic="true">{busy ? (busy === "reading" ? "Checking files." : "Processing files.") : notice}</p>
        {inputPreview && <DocumentPreview key={inputPreview.id} source={inputPreview.file} open onClose={() => setInputPreview(null)} />}
        {output && <>
          <div className="result-panel">
            <div><h2>{stale ? "Previous export" : "Your file is ready"}</h2><p>{output.name}</p></div>
            <button ref={previewButton} className="button primary" type="button" disabled={!!busy} onClick={() => setPreviewOpen(true)}>Open preview</button>
          </div>
          <DocumentPreview output={output} open={previewOpen} onClose={() => {
            setPreviewOpen(false);
            requestAnimationFrame(() => previewButton.current?.focus({ preventScroll: true }));
          }} />
        </>}
      </div>
    </LazyMotion>
  );
}
