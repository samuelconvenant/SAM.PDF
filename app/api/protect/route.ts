import { execFile } from "node:child_process";
import { join } from "node:path";
import { isLocalDocumentRequest, localPython, readDocumentRequest } from "../../../lib/local-document-server";
import { protectionHeaderLimit, protectionLimit, protectionMime, validNewPassword } from "../../../lib/pdf-protection";

export const runtime = "nodejs";
const outputLimit = 100 * 1024 * 1024;
let busy = false;

const errors: Record<string, string> = {
  PASSWORD_REQUIRED: "Enter the current PDF password to protect this file.",
  WRONG_PASSWORD: "The current PDF password is incorrect.",
  RESTRICTED: "This PDF requires its owner password to change its protection.",
  INVALID_PDF: "A valid PDF is required. Check the file and try again.",
  INVALID_ZIP: "The split archive could not be read as a collection of PDFs.",
  LIMIT: "These files exceed the protection limit. Try with a smaller document or fewer split ranges.",
};

function reply(status: number, message: string) {
  return Response.json({ message }, { status, headers: { "Cache-Control": "no-store" } });
}

function runProtection(input: Buffer, signal: AbortSignal) {
  return new Promise<Buffer>((resolve, reject) => {
    const root = process.cwd();
    const job = execFile(localPython(root), [join(root, "scripts", "protect_pdf.py")], {
      encoding: "buffer", timeout: 75_000, maxBuffer: outputLimit, windowsHide: true, signal,
    }, (error, bytes, stderr) => {
      const code = stderr.toString().trim();
      if (!error) resolve(bytes);
      else if (error.code === "ENOENT" || code === "DEPENDENCIES") reject(new Error("DEPENDENCIES"));
      else if (error.killed) reject(new Error("TIMEOUT"));
      else reject(new Error(Object.hasOwn(errors, code) ? code : "FAILED"));
    });
    job.stdin?.on("error", () => {});
    job.stdin?.end(input);
  });
}

export async function POST(request: Request) {
  if (!isLocalDocumentRequest(request)) return reply(403, "Use the local samPDF server to protect documents.");
  if (request.headers.get("content-type") !== protectionMime) return reply(415, "Choose a PDF to protect.");
  if (busy) return reply(429, "Another document is being protected. Try again in a moment.");
  busy = true;
  let input: Buffer | null = null;
  try {
    input = await readDocumentRequest(request, protectionLimit + protectionHeaderLimit + 4);
    if (!input) return reply(413, "Password protection supports documents up to 80 MiB.");
    if (input.length < 6) return reply(400, "Choose a PDF to protect.");
    const length = input.readUInt32BE(0);
    if (!length || length > protectionHeaderLimit || length + 4 >= input.length) return reply(400, "The protection request is invalid.");
    const documentSize = input.length - length - 4;
    if (documentSize > protectionLimit) return reply(413, "Password protection supports documents up to 80 MiB.");
    let meta;
    try { meta = JSON.parse(input.subarray(4, length + 4).toString("utf8")); } catch { return reply(400, "The protection request is invalid."); }
    if (!meta || (meta.format !== "pdf" && meta.format !== "zip") || typeof meta.sourcePassword !== "string" ||
      Buffer.byteLength(meta.sourcePassword) > 127 || typeof meta.password !== "string" || !validNewPassword(meta.password)) {
      return reply(400, "Enter a non-empty new password of up to 40 UTF-8 bytes and a valid current password if required.");
    }
    const bytes = await runProtection(input, request.signal);
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": meta.format === "zip" ? "application/zip" : "application/pdf", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "FAILED";
    if (code === "DEPENDENCIES") return reply(503, "Install the local Python document dependencies to use password protection.");
    if (code === "TIMEOUT") return reply(504, "Password protection timed out. Try again with a smaller document.");
    return reply(422, Object.hasOwn(errors, code) ? errors[code] : "The local engine could not protect this document.");
  } finally {
    input?.fill(0);
    busy = false;
  }
}
