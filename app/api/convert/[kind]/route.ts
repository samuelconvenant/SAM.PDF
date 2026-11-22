import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { zipSync } from "fflate";
import { conversionMaxBytes } from "../../../../lib/conversion";

export const runtime = "nodejs";
const execute = promisify(execFile);
const outputLimit = 100 * 1024 * 1024;
let active = false;

const errors: Record<string, [number, string]> = {
  OCR_REQUIRED: [422, "No editable text was found. Run OCR on the scanned PDF before converting it."],
  ENCRYPTED_PDF: [422, "Open the PDF with its password and save an unencrypted copy before converting."],
  INVALID_PDF: [422, "This file could not be opened as a valid PDF."],
  INVALID_DOCX: [422, "This file could not be opened as a valid DOCX document."],
  UNSUPPORTED_DOCX: [422, "Remove macros, embedded objects, or external document resources and try again."],
  DOCX_LIMIT: [422, "This DOCX exceeds the supported document expansion limits."],
  PDF_LIMIT: [422, "PDF to Word supports up to 100 pages per job."],
  OFFICE_MISSING: [503, "LibreOffice is unavailable. Install it or configure SAMPDF_SOFFICE, then retry."],
  PYTHON_DEPS: [503, "Install the conversion Python dependencies and restart samPDF."],
  OFFICE_FAILED: [422, "LibreOffice could not render this document. Try a simpler DOCX or PDF."],
  OUTPUT_LIMIT: [422, "The generated files exceed the output limit."],
  TIMEOUT: [504, "The conversion timed out. Try a shorter or less complex document."],
};

function error(status: number, message: string) {
  return Response.json({ message }, { status, headers: { "Cache-Control": "no-store" } });
}

async function inputBytes(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > conversionMaxBytes) {
        await reader.cancel();
        return null;
      }
      parts.push(chunk.value);
    }
    return Buffer.concat(parts, size);
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const toWord = kind === "pdf-to-word";
  if (!toWord && kind !== "word-to-pdf") return error(404, "Unknown conversion.");
  const host = request.headers.get("host") ?? "";
  const origin = request.headers.get("origin");
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host) ||
      request.headers.get("sec-fetch-site") === "cross-site" ||
      (origin && origin !== `http://${host}` && origin !== `https://${host}`)) {
    return error(403, "Use the local samPDF server for document conversion.");
  }
  if (request.headers.get("content-type") !== "application/octet-stream") return error(415, "Choose a document to upload.");
  const contentLength = Number(request.headers.get("content-length"));
  if (contentLength > conversionMaxBytes) return error(413, "Choose a file of 25 MiB or less.");
  if (active) return error(429, "Another conversion is running. Try again in a moment.");

  active = true;
  let directory: string | undefined;
  try {
    const input = await inputBytes(request);
    if (!input) return error(413, "Choose a file of 25 MiB or less.");
    if (!input.length) return error(400, "Choose a non-empty document.");
    directory = await mkdtemp(join(tmpdir(), "sampdf-convert-"));
    await writeFile(join(directory, toWord ? "source.pdf" : "source.docx"), input, { mode: 0o600 });
    const root = process.cwd();
    const python = process.env.SAMPDF_PYTHON || join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    try {
      await execute(python, [join(root, "scripts", "convert_document.py"), kind, directory], {
        cwd: directory, windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024,
        env: { ...process.env, PYTHONUTF8: "1" },
      });
    } catch (caught) {
      const failure = caught as { stderr?: string; code?: string; killed?: boolean };
      if (failure.code === "ENOENT") return error(503, "Set up the local Python environment or configure SAMPDF_PYTHON.");
      if (failure.killed) return error(...errors.TIMEOUT);
      const key = failure.stderr?.trim().split(/\r?\n/).at(-1) ?? "";
      const [status, message] = Object.hasOwn(errors, key) ? errors[key] : [422, "This document could not be converted. Try a simpler, valid file."] as const;
      return error(status, message);
    }

    const pdfPath = join(directory, "preview.pdf");
    const docxPath = join(directory, "result.docx");
    const previewSize = (await stat(pdfPath)).size;
    const outputSize = toWord ? (await stat(docxPath)).size : 0;
    if (previewSize + outputSize > outputLimit) return error(...errors.OUTPUT_LIMIT);
    const preview = await readFile(pdfPath);
    const body = toWord ? zipSync({ "preview.pdf": preview, "result.docx": await readFile(docxPath) }, { level: 0 }) : preview;
    return new Response(new Uint8Array(body), { headers: {
      "Content-Type": toWord ? "application/zip" : "application/pdf",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return error(500, "Local conversion failed. Check the backend setup and try again.");
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 160 });
    } finally {
      active = false;
    }
  }
}
