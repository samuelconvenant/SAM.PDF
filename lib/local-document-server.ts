import { join } from "node:path";

export function isLocalDocumentRequest(request: Request) {
  const host = request.headers.get("host") ?? "";
  const origin = request.headers.get("origin");
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host) &&
    request.headers.get("sec-fetch-site") !== "cross-site" &&
    (!origin || origin === `http://${host}` || origin === `https://${host}`);
}

export function localPython(root: string) {
  return process.env.SAMPDF_PYTHON || join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
}

export async function readDocumentRequest(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      parts.push(chunk.value);
    }
    return Buffer.concat(parts, size);
  } finally {
    reader.releaseLock();
  }
}
