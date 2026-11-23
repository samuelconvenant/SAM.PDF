import { maxBytes } from "./tools";

export const protectionLimit = maxBytes;
export const protectionHeaderLimit = 1024;
export const protectionMime = "application/octet-stream";
export type ProtectionFormat = "pdf" | "zip";

export function validNewPassword(password: string) {
  const size = new TextEncoder().encode(password).byteLength;
  return size <= 40 && !!password.trim() && !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(password);
}

export function nameForDownload(value: string, fallback: string, extension: string) {
  const clean = value.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-").trim().replace(/[. ]+$/, "");
  const stem = clean.replace(new RegExp(`\\.${extension}$`, "i"), "").slice(0, 160);
  return stem ? `${stem}.${extension}` : fallback;
}

export async function protectPdf(file: Blob, format: ProtectionFormat, password: string, sourcePassword: string, signal: AbortSignal) {
  const header = new TextEncoder().encode(JSON.stringify({ format, password, sourcePassword }));
  const prefix = new Uint8Array(4);
  new DataView(prefix.buffer).setUint32(0, header.byteLength);
  const response = await fetch("/api/protect", {
    method: "POST", headers: { "Content-Type": protectionMime }, signal,
    body: new Blob([prefix, header, file], { type: protectionMime }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(typeof data?.message === "string" ? data.message : "The local protection engine could not finish. Try again.");
  }
  return response.blob();
}
