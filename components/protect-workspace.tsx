"use client";

import { FileLock2, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { nameForDownload, protectionLimit } from "../lib/pdf-protection";
import { PagePreviews, PdfCanvas, usePdf } from "./page-preview";
import { PasswordField, ProtectForm } from "./protect-form";

function SourcePage({ locked, onRendered }: { locked: boolean; onRendered: () => void }) {
  const pdf = usePdf();
  if (!pdf) return locked ? null : <p role="status">Opening preview…</p>;
  return <>
    <p className="file-caption">{pdf.numPages} {pdf.numPages === 1 ? "page" : "pages"} · First page</p>
    <PdfCanvas index={0} zoom={1} onRendered={onRendered} />
  </>;
}

function ProtectionDetails({ file }: { file: File }) {
  const [current, setCurrent] = useState("");
  const [previewPassword, setPreviewPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "required" | "wrong">("idle");
  const [name, setName] = useState(file.name.replace(/\.pdf$/i, "") + "-protected.pdf");
  const onLocked = useCallback(() => setStatus(previewPassword ? "wrong" : "required"), [previewPassword]);
  const onRendered = useCallback(() => setStatus("idle"), []);
  return <div className="protect-details work-grid">
    <section aria-label="Source PDF preview">
      <p className="file-caption">{file.size.toLocaleString()} bytes</p>
      <PagePreviews file={file} full password={previewPassword} onLocked={onLocked}><SourcePage locked={status !== "idle"} onRendered={onRendered} /></PagePreviews>
    </section>
    <section aria-label="PDF password settings">
      <label className="field">Filename<input type="text" value={name} maxLength={170} onChange={(event) => setName(event.currentTarget.value)} /></label>
      <details className="unlock-source" open={status !== "idle" || undefined}>
        <summary>Current PDF password, if required</summary>
        {status !== "idle" && <p role="status">{status === "wrong" ? "The current PDF password is incorrect." : "Enter the current password to preview and protect this PDF. Some files require the owner password to change protection."}</p>}
        <PasswordField label="Current PDF password" value={current} setValue={setCurrent} current />
        <button type="button" className="button secondary compact" disabled={!current} onClick={() => setPreviewPassword(current)}>Unlock preview</button>
      </details>
      <ProtectForm file={file} format="pdf" name={nameForDownload(name, "protected.pdf", "pdf")} sourcePassword={current} />
    </section>
  </div>;
}

export function ProtectWorkspace() {
  const input = useRef<HTMLInputElement>(null);
  const [choice, setChoice] = useState<{ id: number; file: File } | null>(null);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  async function choose(list: FileList | null) {
    if (!list?.length) return;
    const id = ++sequence.current;
    const source = list[0];
    setError("");
    if (list.length !== 1 || !source.size || source.size > protectionLimit) { setError("Choose one non-empty PDF of 80 MiB or less."); return; }
    try {
      const header = new TextDecoder().decode(await source.slice(0, 1024).arrayBuffer());
      if (!header.includes("%PDF-")) throw new Error("Choose a valid PDF.");
      if (sequence.current === id) setChoice({ id, file: source });
    } catch {
      if (sequence.current === id) setError("Choose a valid PDF.");
    }
  }
  return <div className="workspace" aria-label="Protect PDF workspace">
    <input ref={input} type="file" accept=".pdf,application/pdf" aria-label="Upload PDF to protect" hidden onChange={(event) => {
      void choose(event.currentTarget.files); event.currentTarget.value = "";
    }} />
    {!choice ? <div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void choose(event.dataTransfer.files); }}>
      <span className="upload-icon"><FileLock2 size={27} aria-hidden="true" /></span><h2>Choose a PDF</h2>
      <p>Every reader will need the password to open the protected file.</p>
      <button type="button" className="button primary" onClick={() => input.current?.click()}><Upload size={18} /> Choose file</button>
    </div> : <div className="work-panel">
      <div className="work-heading"><h2>{choice.file.name}</h2><button type="button" className="button secondary compact" onClick={() => input.current?.click()}>Replace PDF</button></div>
      <ProtectionDetails key={choice.id} file={choice.file} />
    </div>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
  </div>;
}
