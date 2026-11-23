"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Download, Eye, EyeOff, LoaderCircle, LockKeyhole, X } from "lucide-react";
import { nameForDownload, protectPdf, protectionLimit, validNewPassword } from "../lib/pdf-protection";
import type { ProtectionFormat } from "../lib/pdf-protection";

export function PasswordField({ label, value, setValue, current = false }: {
  label: string; value: string; setValue: (value: string) => void; current?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return <div className="field password-field">
    <label htmlFor={id}>{label}</label>
    <div><input id={id} type={visible ? "text" : "password"} autoComplete={current ? "current-password" : "new-password"}
      autoCapitalize="none" spellCheck={false} maxLength={current ? 127 : 40} value={value} onChange={(event) => setValue(event.currentTarget.value)} />
      <button type="button" className="icon-button" aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} onClick={() => setVisible(!visible)}>
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button></div>
  </div>;
}

type ProtectFormProps = { file: Blob; format: ProtectionFormat; name: string; sourcePassword?: string; onCancel?: () => void };

export function ProtectForm({ file, format, name, sourcePassword = "", onCancel }: ProtectFormProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const active = useRef<AbortController | null>(null);
  const tooLarge = file.size > protectionLimit;
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => { if (url) return () => URL.revokeObjectURL(url); }, [url]);

  async function submit() {
    if (active.current || tooLarge) return;
    setError("");
    if (!validNewPassword(password)) { setError("Enter a non-empty password of up to 40 UTF-8 bytes."); return; }
    if (password !== confirm) { setError("The passwords do not match."); return; }
    const job = new AbortController();
    active.current = job;
    setBusy(true);
    try {
      const protectedFile = await protectPdf(file, format, password, sourcePassword, job.signal);
      if (job.signal.aborted) return;
      setUrl(URL.createObjectURL(protectedFile));
      setPassword("");
      setConfirm("");
    } catch (caught) {
      if (!job.signal.aborted) setError(caught instanceof Error ? caught.message : "The local engine could not protect this document.");
    } finally {
      active.current = null;
      if (!job.signal.aborted) setBusy(false);
    }
  }

  return <form className="protect-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    {format === "zip" && <p>Each PDF in the ZIP will require the same password. The ZIP itself can still be opened without a password.</p>}
    <p>{url ? "Password protection is ready. Opening the protected PDF requires the password you chose." : "The local engine applies AES-256 encryption. Choose a unique passphrase of at least 12 characters. PDF passwords can use up to 40 UTF-8 bytes."}</p>
    {tooLarge && <p className="workspace-error" role="alert">Password protection supports files up to 80 MiB.</p>}
    {!url && <fieldset disabled={busy || tooLarge}>
      <PasswordField label="Password" value={password} setValue={setPassword} />
      <PasswordField label="Confirm password" value={confirm} setValue={setConfirm} />
    </fieldset>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
    {url && <p className="sr-only" role="status">Encryption complete.</p>}
    <div className="protection-actions">
      {onCancel && <button type="button" className="button secondary" onClick={onCancel}>{url ? "Done" : "Cancel"}</button>}
      {url ? <a className="button primary" href={url} download={nameForDownload(name, `protected.${format}`, format)}><Download size={17} /> Download protected {format.toUpperCase()}</a>
        : <button type="submit" className="button primary" disabled={busy || tooLarge}>
          {busy ? <><LoaderCircle size={17} className="spinner" /> Protecting…</> : <><LockKeyhole size={17} /> Protect {format === "zip" ? "PDFs" : "PDF"}</>}
        </button>}
    </div>
  </form>;
}

export function ProtectDialog({ onCancel, ...props }: ProtectFormProps & { onCancel: () => void }) {
  const modal = useRef<HTMLDialogElement>(null);
  const title = useId();
  useLayoutEffect(() => { modal.current?.showModal(); }, []);

  return <dialog ref={modal} className="document-dialog protection-dialog" aria-labelledby={title}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onCancel(); }}>
    <header className="preview-header">
      <h2 id={title}>Protect with password</h2>
      <button type="button" className="icon-button" aria-label="Close password protection" onClick={onCancel}><X size={19} /></button>
    </header>
    <ProtectForm {...props} onCancel={onCancel} />
  </dialog>;
}
