import createQpdf from "@soulehshaikh99/qpdf-wasm";
import type { QpdfInstance } from "@soulehshaikh99/qpdf-wasm";
import { unzipSync, zipSync } from "fflate";
import { maxBytes } from "./tools";
import type { ProtectionJob } from "./pdf-protection";

const wasmUrl = new URL("@soulehshaikh99/qpdf-wasm/dist/qpdf.wasm", import.meta.url).href;
const inputPath = "/source.pdf";
const outputPath = "/protected.pdf";
const maxParts = 150;
const outputLimit = 100 * 1024 * 1024;
class ProtectionError extends Error {}
type Terminal = QpdfInstance["FS"] & {
  init: (stdin: null, stdout: (byte: number | null) => void, stderr: (byte: number | null) => void) => void;
};

async function encrypt({ file, format, password, sourcePassword }: ProtectionJob) {
  if (!(file instanceof Blob) || !file.size || file.size > maxBytes || !["pdf", "zip"].includes(format)) {
    throw new ProtectionError("Choose a supported document of 80 MiB or less.");
  }
  const encoder = new TextEncoder();
  if (encoder.encode(password).length > 40 || !password.trim() || /[\x00-\x1f\x7f\ud800-\udfff]/u.test(password)) {
    throw new ProtectionError("Enter a non-empty password of up to 40 UTF-8 bytes.");
  }
  if (encoder.encode(sourcePassword).length > 127 || sourcePassword.includes("\0")) {
    throw new ProtectionError("The current PDF password is invalid.");
  }

  let stdout = "";
  let stderr = "";
  const options = {
    locateFile: () => wasmUrl,
    preRun: [(module: QpdfInstance) => {
      // Redirect the virtual terminal before Emscripten initializes it. Its default terminal logs to the console.
      (module.FS as Terminal).init(null,
        (byte) => { if (byte !== null && stdout.length < 4096) stdout += String.fromCharCode(byte); },
        (byte) => { if (byte !== null && stderr.length < 4096) stderr += String.fromCharCode(byte); });
    }],
  };
  const qpdf = await createQpdf(options);

  function protect(bytes: Uint8Array) {
    if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes("%PDF-")) throw new ProtectionError("Choose a valid PDF.");
    qpdf.FS.writeFile(inputPath, bytes);
    try {
      stdout = "";
      stderr = "";
      const inputPassword = `--password=${sourcePassword}`;
      const check = qpdf.callMain([inputPassword, "--json=2", "--json-key=encrypt", inputPath]);
      if (stderr.includes("invalid password")) throw new ProtectionError("Enter the correct current PDF password to change protection.");
      if (check !== 0) throw new ProtectionError("This PDF is damaged or uses unsupported protection.");
      const { encrypt: info } = JSON.parse(stdout);
      if (info.encrypted && !info.ownerpasswordmatched && !Object.values(info.capabilities).every(Boolean)) {
        throw new ProtectionError("Enter the owner password to change protection on this restricted PDF.");
      }
      const owner = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const result = qpdf.callMain([inputPath, inputPassword, "--encrypt", `--user-password=${password}`, `--owner-password=${owner}`,
        "--bits=256", "--", outputPath]);
      if (result !== 0) throw new ProtectionError("This PDF could not be protected. Check that it opens correctly and try again.");
      return new Uint8Array(qpdf.FS.readFile(outputPath));
    } finally {
      stdout = "";
      stderr = "";
      qpdf.FS.unlink(inputPath);
      try { qpdf.FS.unlink(outputPath); } catch { /* Output may not have been created. */ }
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (format === "pdf") {
    const result = protect(bytes);
    if (result.length > outputLimit) throw new ProtectionError("The protected PDF exceeds 100 MiB.");
    return new Blob([result], { type: "application/pdf" });
  }
  let count = 0;
  let total = 0;
  const parts = unzipSync(bytes, { filter(entry) {
    // Split PDF produces stored entries. Reject compressed archives and unsafe names before allocating.
    total += entry.originalSize;
    if (++count > maxParts || total > maxBytes || entry.compression !== 0 || entry.size !== entry.originalSize ||
      !/^[a-zA-Z0-9._-]+\.pdf$/i.test(entry.name)) throw new ProtectionError("This split archive contains unsupported entries or exceeds the protection limits.");
    return true;
  } });
  const encrypted: Record<string, Uint8Array> = Object.create(null);
  let encryptedSize = 0;
  if (!count) throw new ProtectionError("The split archive contains no PDFs.");
  for (const [name, part] of Object.entries(parts)) {
    const result = protect(part);
    encryptedSize += result.length;
    if (encryptedSize > outputLimit) throw new ProtectionError("The protected documents exceed 100 MiB.");
    encrypted[name] = result;
    delete parts[name];
  }
  return new Blob([new Uint8Array(zipSync(encrypted, { level: 0 }))], { type: "application/zip" });
}

self.onmessage = ({ data }: MessageEvent<ProtectionJob>) => {
  void encrypt(data).then((result) => self.postMessage({ result })).catch((error: unknown) => {
    self.postMessage({ error: error instanceof ProtectionError ? error.message : "Protection failed in this browser. Try a smaller or simpler PDF." });
  });
};
