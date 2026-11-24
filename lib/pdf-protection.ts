import { maxBytes } from "./tools";
import { runDocumentJob } from "./document-job";

export const protectionLimit = maxBytes;
export type ProtectionFormat = "pdf" | "zip";
export type ProtectionJob = { file: Blob; format: ProtectionFormat; password: string; sourcePassword: string };

export function validNewPassword(password: string) {
  const size = new TextEncoder().encode(password).byteLength;
  return size <= 40 && !!password.trim() && !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(password);
}

export function nameForDownload(value: string, fallback: string, extension: string) {
  const clean = value.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-").trim().replace(/[. ]+$/, "");
  const stem = clean.replace(new RegExp(`\\.${extension}$`, "i"), "").slice(0, 160);
  return stem ? `${stem}.${extension}` : fallback;
}

export function protectPdf(file: Blob, format: ProtectionFormat, password: string, sourcePassword: string, signal: AbortSignal) {
  return runDocumentJob<ProtectionJob, Blob>(
    () => new Worker(new URL("./pdf-protection.worker.ts", import.meta.url), { type: "module" }),
    { file, format, password, sourcePassword }, signal, 60_000,
  );
}
