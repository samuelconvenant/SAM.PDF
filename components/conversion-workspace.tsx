"use client";

import dynamic from "next/dynamic";
import { FileText, LoaderCircle, ShieldCheck, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { conversionMaxBytes, docxMime } from "../lib/conversion";
import type { ConversionKind } from "../lib/conversion";
import type { PreviewOutput } from "./document-preview";

const Preview = dynamic(() => import("./document-preview"), { ssr: false });
const pdfMime = "application/pdf";
const extension = (file: File) => file.name.split(".").at(-1)?.toLowerCase();

export function ConversionWorkspace({ kind }: { kind: ConversionKind }) {
  const toWord = kind === "pdf-to-word";
  const expected = toWord ? "pdf" : "docx";
  const label = toWord ? "PDF" : "DOCX";
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<XMLHttpRequest | null>(null);
  const reopen = useRef<HTMLButtonElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("");
  const [output, setOutput] = useState<PreviewOutput | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  useEffect(() => { if (output) return () => URL.revokeObjectURL(output.url); }, [output]);

  function choose(files: FileList | null) {
    if (!files?.length || phase) return;
    setError("");
    setOutput(null);
    setOpen(false);
    setFile(null);
    const candidate = files[0];
    if (files.length !== 1 || extension(candidate) !== expected) {
      setError(`Choose one .${expected} file.`);
    } else if (!candidate.size || candidate.size > conversionMaxBytes) {
      setError("Choose a non-empty file of 25 MiB or less.");
    } else {
      setFile(candidate);
    }
  }

  function convert() {
    if (!file || request.current) return;
    if (output) { setOpen(true); return; }
    setError("");
    setPhase("Sending to the local engine…");
    const xhr = new XMLHttpRequest();
    request.current = xhr;
    xhr.open("POST", `/api/convert/${kind}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.responseType = "arraybuffer";
    xhr.timeout = 135_000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.loaded < event.total) {
        setPhase(`Sending to the local engine… ${Math.floor(event.loaded * 100 / event.total)}%`);
      }
    };
    xhr.upload.onload = () => setPhase("Converting locally and preparing the preview…");
    xhr.onerror = xhr.ontimeout = () => {
      request.current = null;
      setPhase("");
      setError("The local conversion server did not respond. Check that samPDF is running and try again.");
    };
    xhr.onload = async () => {
      try {
        const data = new Uint8Array(xhr.response);
        if (xhr.status !== 200) {
          const result = JSON.parse(new TextDecoder().decode(data));
          throw new Error(result.message);
        }
        let preview = data;
        let download = data;
        if (toWord) {
          const { unzipSync } = await import("fflate");
          const parts = unzipSync(data);
          preview = new Uint8Array(parts["preview.pdf"]);
          download = new Uint8Array(parts["result.docx"]);
          if (!preview.length || !download.length) throw new Error("The engine returned an incomplete document.");
        }
        if (request.current !== xhr) return;
        const mime = toWord ? docxMime : pdfMime;
        const name = file.name.replace(/\.[^.]+$/, "") + (toWord ? ".docx" : ".pdf");
        setOutput({ name, mime, url: URL.createObjectURL(new Blob([download], { type: mime })), file: new Blob([preview], { type: pdfMime }) });
        setOpen(true);
      } catch (caught) {
        if (request.current === xhr) setError(caught instanceof Error && !(caught instanceof SyntaxError) ? caught.message : "The conversion engine returned an unexpected response.");
      } finally {
        if (request.current === xhr) {
          request.current = null;
          setPhase("");
        }
      }
    };
    xhr.send(file);
  }

  return <>
    <div className="drop-zone conversion-picker" data-dragging={dragging}
      onDragOver={(event) => { event.preventDefault(); if (!phase) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files); }}>
      <input ref={input} hidden type="file" accept={toWord ? ".pdf,application/pdf" : `.docx,${docxMime}`}
        onChange={(event) => { choose(event.currentTarget.files); event.currentTarget.value = ""; }} />
      <span className="upload-icon">{file ? <FileText size={25} /> : <Upload size={25} />}</span>
      <h2>{file ? file.name : `Choose a ${label} document`}</h2>
      <p>{file ? `${file.size.toLocaleString()} bytes` : "Drag a file here or choose one from your device. Maximum 25 MiB."}</p>
      <div className="conversion-actions">
        <button type="button" className={`button ${file ? "secondary" : "primary"}`} disabled={!!phase} onClick={() => input.current?.click()}>{file ? "Replace file" : "Choose file"}</button>
        {file && <button type="button" className="button primary" disabled={!!phase} onClick={convert}>Convert to {toWord ? "Word" : "PDF"}</button>}
      </div>
    </div>
    {phase && <p className="workspace-status" role="status"><span><LoaderCircle size={17} className="spinner" aria-hidden="true" />{phase}</span></p>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
    {output && <div className="result-panel"><div><h2>Conversion complete</h2><p>{output.name}</p></div><button ref={reopen} type="button" className="button primary" onClick={() => setOpen(true)}>Open preview</button></div>}
    {output && <Preview output={output} open={open} onClose={() => { setOpen(false); requestAnimationFrame(() => reopen.current?.focus({ preventScroll: true })); }} />}
    <p className="tool-privacy"><ShieldCheck size={17} aria-hidden="true" /> This tool sends the file to the samPDF server on this computer for temporary conversion.</p>
    <p className="conversion-limit">{toWord
      ? "Editing is supported in the generated DOCX. PDF reading order, tables, and formatting may change. Scanned pages need OCR to become editable."
      : "LibreOffice renders the final PDF. Missing fonts and Word-specific features can affect the layout."}</p>
  </>;
}
