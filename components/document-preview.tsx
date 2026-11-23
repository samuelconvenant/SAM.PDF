"use client";
import { memo, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, LockKeyhole, Maximize, Minus, Plus, X } from "lucide-react";
import { PagePreviews, PageThumbnail, PdfCanvas, usePdf } from "./page-preview";
import { docxMime } from "../lib/conversion";
import { nameForDownload } from "../lib/pdf-protection";
import type { PDFDocumentProxy } from "pdfjs-dist";

const ProtectDialog = dynamic(() => import("./protect-form").then((module) => module.ProtectDialog), { ssr: false });

export type PreviewOutput = { url: string; name: string; file: Blob; mime: string };
type Part = { name: string; file: Blob };

type PageSize = { width: number; height: number };

const ScrollPage = memo(function ScrollPage({ index, zoom, height }: { index: number; zoom: number; height: number }) {
  const block = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = block.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root: element.parentElement, rootMargin: "300px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <section ref={block} data-scroll-page={index} aria-label={`Page ${index + 1}`}
    style={{ height }}>
    <p className="scroll-page-number">Page {index + 1}</p>
    {visible && <PdfCanvas index={index} zoom={zoom} continuous />}
  </section>;
});

const Pages = memo(function Pages({ onRendered, allowScroll }: { onRendered?: (file: Blob) => void; allowScroll?: boolean }) {
  const pdf = usePdf();
  const [selectedPage, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [scroll, setScroll] = useState(false);
  const [measures, setMeasures] = useState<{ pdf: PDFDocumentProxy; pages: PageSize[] } | null>(null);
  const [failedScroll, setFailedScroll] = useState(false);
  const [stageWidth, setStageWidth] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const startAt = useRef(0);
  const layout = measures?.pdf === pdf ? measures?.pages : undefined;
  const continuous = scroll && !!layout;
  useEffect(() => {
    if (!scroll || !pdf || layout) return;
    let canceled = false;
    async function measure() {
      if (!pdf) return;
      const pages: PageSize[] = [];
      for (let start = 1; start <= pdf.numPages && !canceled; start += 12) {
        const batch = await Promise.all(Array.from({ length: Math.min(12, pdf.numPages - start + 1) }, (_, offset) => pdf.getPage(start + offset)));
        for (const page of batch) {
          const { width, height } = page.getViewport({ scale: 1 });
          pages.push({ width, height });
        }
      }
      if (!canceled) setMeasures({ pdf, pages });
    }
    void measure().catch(() => { if (!canceled) { setFailedScroll(true); setScroll(false); } });
    return () => { canceled = true; };
  }, [scroll, pdf, layout]);
  useEffect(() => {
    const stage = grid.current?.lastElementChild;
    if (!stage) return;
    const observer = new ResizeObserver(() => setStageWidth(stage.clientWidth));
    observer.observe(stage);
    return () => observer.disconnect();
  }, [continuous, pdf]);
  useLayoutEffect(() => {
    const element = strip.current;
    if (element && startAt.current) element.scrollTop = (element.children[startAt.current] as HTMLElement | undefined)?.offsetTop ?? 0;
  }, [continuous, zoom, stageWidth]);
  if (!pdf) return <p className="pdf-loading" role="status">Opening document…</p>;
  const page = Math.min(selectedPage, pdf.numPages - 1);
  function navigate(index: number) {
    if (strip.current) strip.current.scrollTop = (strip.current.children[index] as HTMLElement).offsetTop;
    startAt.current = index;
    setPage(index);
  }
  return <>
    <div className="preview-tools" aria-label="Preview controls">
      <button className="icon-button" type="button" aria-label="Previous page" disabled={!page} onClick={() => navigate(page - 1)}><ChevronLeft size={18} /></button>
      <label className="page-indicator"><span className="sr-only">Page number</span><input type="number" min={1} max={pdf.numPages} value={page + 1} onChange={(event) => {
        const value = event.currentTarget.valueAsNumber;
        if (Number.isInteger(value) && value >= 1 && value <= pdf.numPages) navigate(value - 1);
      }} /> / {pdf.numPages}</label>
      <button className="icon-button" type="button" aria-label="Next page" disabled={page + 1 === pdf.numPages} onClick={() => navigate(page + 1)}><ChevronRight size={18} /></button>
      <button className="icon-button" type="button" aria-label="Zoom out" disabled={zoom <= .5} onClick={() => setZoom(zoom - .25)}><Minus size={18} /></button>
      <span className="page-indicator" aria-live="polite">{Math.round(zoom * 100)}%</span>
      <button className="icon-button" type="button" aria-label="Zoom in" disabled={zoom >= 2.5} onClick={() => setZoom(zoom + .25)}><Plus size={18} /></button>
      {allowScroll && <button type="button" className="button compact secondary" aria-pressed={scroll} onClick={() => {
        startAt.current = page; setFailedScroll(false); setScroll(!scroll);
      }}>{continuous ? "Single page" : scroll ? "Cancel page layout" : "Scroll pages"}</button>}
      {scroll && !layout && <span className="page-indicator" role="status">Preparing page layout…</span>}
      {failedScroll && <span className="page-indicator" role="status">Continuous view is unavailable for this PDF.</span>}
    </div>
    <div className="preview-grid" ref={grid}>
      <ol className="preview-thumbnails" aria-label="Page thumbnails">
        {Array.from({ length: pdf.numPages }, (_, index) => <li key={index}><button type="button" aria-label={`Go to page ${index + 1}`} aria-current={page === index ? "page" : undefined} onClick={() => navigate(index)}><PageThumbnail index={index} /><span>{index + 1}</span></button></li>)}
      </ol>
      {continuous ? <div ref={strip} className="pdf-scroll-pages" role="region" aria-label="Scroll through PDF pages" tabIndex={0} onScroll={(event) => {
        const root = event.currentTarget;
        const line = root.scrollTop + Math.min(root.clientHeight / 3, 140);
        let low = 0, high = root.children.length - 1;
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          if ((root.children[mid] as HTMLElement).offsetTop <= line) low = mid;
          else high = mid - 1;
        }
        startAt.current = low;
        setPage(low);
      }}>
        {layout.map(({ width, height }, index) => <ScrollPage key={index} index={index} zoom={zoom}
          height={Math.ceil(Math.min(Math.max(1, stageWidth - 36) / width, 1.3) * zoom * height) + 46} />)}
      </div> : <PdfCanvas index={page} zoom={zoom} onRendered={onRendered} />}
    </div>
  </>;
});

type DialogContent = { output: PreviewOutput; source?: never } | { source: File; output?: never };

export default function DocumentPreview({ output, source, open, onClose }: DialogContent & { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const protectButton = useRef<HTMLButtonElement>(null);
  const [protecting, setProtecting] = useState(false);
  const [filename, setFilename] = useState<{ file: Blob; value: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const bundle = output?.mime === "application/zip";
  const word = output?.mime === docxMime;
  const [archive, setArchive] = useState<{ source: Blob; parts: Part[] } | null>(null);
  const [renderedFile, setRenderedFile] = useState<Blob | null>(null);
  const [failedFile, setFailedFile] = useState<Blob | null>(null);
  const [part, setPart] = useState(0);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => {
    if (!bundle || !output) return;
    let canceled = false;
    void Promise.all([import("fflate"), output.file.arrayBuffer()]).then(([{ unzipSync }, bytes]) => {
      if (canceled) return;
      const files = Object.entries(unzipSync(new Uint8Array(bytes))).map(([name, data]) => ({
        name, file: new Blob([new Uint8Array(data)], { type: "application/pdf" }),
      }));
      setArchive({ source: output.file, parts: files });
    }).catch(() => { if (!canceled) setFailedFile(output.file); });
    return () => { canceled = true; };
  }, [bundle, output?.file]);

  const parts = archive?.parts;
  const selectedPart = Math.min(part, Math.max(0, (parts?.length ?? 0) - 1));
  const file = bundle ? parts?.[selectedPart]?.file : source ?? output?.file;
  const ready = renderedFile === file && (!bundle || archive?.source === output?.file);
  const fileType = bundle ? "ZIP" : word ? "DOCX" : "PDF";
  const filenameInput = filename?.file === output?.file ? filename?.value ?? "" : output?.name ?? "";
  const downloadName = output ? nameForDownload(filenameInput, output.name, fileType.toLowerCase()) : "";
  function close() { setProtecting(false); onClose(); }
  return <dialog ref={dialog} className="document-dialog" data-expanded={expanded} aria-labelledby={title} onCancel={(event) => { event.preventDefault(); close(); }}>
    <header className="preview-header">
      <div><h2 id={title}>{source ? "Uploaded PDF preview" : "Document preview"}</h2><p>{source?.name ?? output?.name}</p></div>
      <div className="preview-actions">
        <button type="button" className="icon-button" aria-label={expanded ? "Restore preview size" : "Expand preview"} onClick={() => setExpanded(!expanded)}><Maximize size={18} /></button>
        <button type="button" className="icon-button" aria-label="Close preview" onClick={close}><X size={20} /></button>
      </div>
    </header>
    {bundle && parts && <label className="part-select">PDF in archive <select value={selectedPart} onChange={(event) => setPart(Number(event.currentTarget.value))}>{parts.map(({ name }, index) => <option key={name} value={index}>{name}</option>)}</select></label>}
    {word && <p className="part-select">LibreOffice preview of the generated DOCX. Microsoft Word may render it differently.</p>}
    <div className="preview-body">
      {bundle && failedFile === output?.file ? <p role="alert">The PDFs in this archive could not be opened for preview.</p> : file ? <PagePreviews file={file} full><Pages onRendered={setRenderedFile} allowScroll={!!source} /></PagePreviews> : <p role="status" className="pdf-loading">Opening archive…</p>}
    </div>
    <footer className="preview-footer">
      <button type="button" className="button secondary" onClick={close}><ArrowLeft size={17} /> Back to workspace</button>
      {output && <div className="preview-downloads">
        <label className="field preview-name">Filename<input value={filenameInput} maxLength={170} onChange={(event) => setFilename({ file: output.file, value: event.currentTarget.value })} /></label>
        {!word && <button type="button" ref={protectButton} className="button secondary" disabled={!ready} onClick={() => setProtecting(true)}>
          <LockKeyhole size={16} /> {bundle ? "Protect each PDF" : "Protect with Password"}
        </button>}
        {ready ? <a className="button primary" href={output.url} download={downloadName}><Download size={18} /> Download {fileType}</a>
          : <button type="button" className="button primary" disabled><Download size={18} /> Download {fileType}</button>}
      </div>}
    </footer>
    {output && open && protecting && !word && <ProtectDialog file={output.file} format={bundle ? "zip" : "pdf"} name={downloadName} onCancel={() => {
      setProtecting(false);
      requestAnimationFrame(() => protectButton.current?.focus({ preventScroll: true }));
    }} />}
  </dialog>;
}
