"use client";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Maximize, Minus, Plus, X } from "lucide-react";
import { PagePreviews, PageThumbnail, PdfCanvas, usePdf } from "./page-preview";
import { docxMime } from "../lib/conversion";

export type PreviewOutput = { url: string; name: string; file: Blob; mime: string };
type Part = { name: string; file: Blob };

const Pages = memo(function Pages({ onRendered }: { onRendered: (file: Blob) => void }) {
  const pdf = usePdf();
  const [selectedPage, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  if (!pdf) return <p className="pdf-loading" role="status">Opening document…</p>;
  const page = Math.min(selectedPage, pdf.numPages - 1);
  return <>
    <div className="preview-tools" aria-label="Preview controls">
      <button className="icon-button" type="button" aria-label="Previous page" disabled={!page} onClick={() => setPage(page - 1)}><ChevronLeft size={18} /></button>
      <label className="page-indicator"><span className="sr-only">Page number</span><input type="number" min={1} max={pdf.numPages} value={page + 1} onChange={(event) => {
        const value = event.currentTarget.valueAsNumber;
        if (Number.isInteger(value) && value >= 1 && value <= pdf.numPages) setPage(value - 1);
      }} /> / {pdf.numPages}</label>
      <button className="icon-button" type="button" aria-label="Next page" disabled={page + 1 === pdf.numPages} onClick={() => setPage(page + 1)}><ChevronRight size={18} /></button>
      <button className="icon-button" type="button" aria-label="Zoom out" disabled={zoom <= .5} onClick={() => setZoom(zoom - .25)}><Minus size={18} /></button>
      <span className="page-indicator" aria-live="polite">{Math.round(zoom * 100)}%</span>
      <button className="icon-button" type="button" aria-label="Zoom in" disabled={zoom >= 2.5} onClick={() => setZoom(zoom + .25)}><Plus size={18} /></button>
    </div>
    <div className="preview-grid">
      <ol className="preview-thumbnails" aria-label="Page thumbnails">
        {Array.from({ length: pdf.numPages }, (_, index) => <li key={index}><button type="button" aria-label={`Go to page ${index + 1}`} aria-current={page === index ? "page" : undefined} onClick={() => setPage(index)}><PageThumbnail index={index} /><span>{index + 1}</span></button></li>)}
      </ol>
      <PdfCanvas index={page} zoom={zoom} onRendered={onRendered} />
    </div>
  </>;
});

export default function DocumentPreview({ output, open, onClose }: { output: PreviewOutput; open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [expanded, setExpanded] = useState(false);
  const bundle = output.mime === "application/zip";
  const word = output.mime === docxMime;
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
    if (!bundle) return;
    let canceled = false;
    void Promise.all([import("fflate"), output.file.arrayBuffer()]).then(([{ unzipSync }, bytes]) => {
      if (canceled) return;
      const files = Object.entries(unzipSync(new Uint8Array(bytes))).map(([name, data]) => ({
        name, file: new Blob([new Uint8Array(data)], { type: "application/pdf" }),
      }));
      setArchive({ source: output.file, parts: files });
    }).catch(() => { if (!canceled) setFailedFile(output.file); });
    return () => { canceled = true; };
  }, [bundle, output.file]);

  const parts = archive?.parts;
  const selectedPart = Math.min(part, Math.max(0, (parts?.length ?? 0) - 1));
  const file = bundle ? parts?.[selectedPart]?.file : output.file;
  const ready = renderedFile === file && (!bundle || archive?.source === output.file);
  const fileType = bundle ? "ZIP" : word ? "DOCX" : "PDF";
  return <dialog ref={dialog} className="document-dialog" data-expanded={expanded} aria-labelledby="preview-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="preview-header">
      <div><h2 id="preview-title">Document preview</h2><p>{output.name}</p></div>
      <div className="preview-actions">
        <button type="button" className="icon-button" aria-label={expanded ? "Restore preview size" : "Expand preview"} onClick={() => setExpanded(!expanded)}><Maximize size={18} /></button>
        <button type="button" className="icon-button" aria-label="Close preview" onClick={onClose}><X size={20} /></button>
      </div>
    </header>
    {bundle && parts && <label className="part-select">PDF in archive <select value={selectedPart} onChange={(event) => setPart(Number(event.currentTarget.value))}>{parts.map(({ name }, index) => <option key={name} value={index}>{name}</option>)}</select></label>}
    {word && <p className="part-select">LibreOffice preview of the generated DOCX. Microsoft Word may render it differently.</p>}
    <div className="preview-body">
      {bundle && failedFile === output.file ? <p role="alert">The PDFs in this archive could not be opened for preview.</p> : file ? <PagePreviews file={file} full><Pages onRendered={setRenderedFile} /></PagePreviews> : <p role="status" className="pdf-loading">Opening archive…</p>}
    </div>
    <footer className="preview-footer">
      <button type="button" className="button secondary" onClick={onClose}><ArrowLeft size={17} /> Back to workspace</button>
      {ready ? <a className="button primary" href={output.url} download={output.name}><Download size={18} /> Download {fileType}</a>
        : <button type="button" className="button primary" disabled><Download size={18} /> Download {fileType}</button>}
    </footer>
  </dialog>;
}
