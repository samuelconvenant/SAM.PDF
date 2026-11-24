import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { raster } from "./smart-layout";
import type { TextCandidate } from "./smart-layout";

export async function recognizePage(page: PDFPageProxy, signal: AbortSignal): Promise<TextCandidate[][]> {
  const { createWorker } = await import("tesseract.js");
  const assets = new URL("/smart-ocr/", location.origin).href;
  let disposed = false;
  const startup = createWorker("eng", 1, {
    workerPath: assets + "worker.min.js",
    corePath: assets + "tesseract-core-lstm.wasm.js",
    langPath: assets,
    workerBlobURL: false,
    cacheMethod: "none",
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    void startup.then((worker) => worker.terminate()).catch(() => {});
  };
  let rejectAbort: (reason?: unknown) => void;
  const abort = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const cancel = () => { dispose(); rejectAbort(signal.reason); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    const worker = await Promise.race([startup, abort]);
    const image = await raster(page, signal, 1700);
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")!.putImageData(image, 0, 0);
    const result = await Promise.race([worker.recognize(canvas, {}, { blocks: true, text: false }), abort]);
    canvas.width = canvas.height = 0;
    const { width, height } = image;
    const view = page.getViewport({ scale: 1 / page.userUnit });
    return (result.data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.map((line) => line.words.flatMap((word) => {
        const { x0, y0, x1, y1 } = word.bbox;
        if (!word.text.trim() || x1 <= x0 || y1 <= y0) return [];
        return [{
          text: word.text.trim(), size: Math.max(6, Math.min(96, (y1 - y0) / height * view.height * 1.3)),
          bold: false, rect: { x: x0 / width, y: y0 / height, width: (x1 - x0) / width, height: (y1 - y0) / height },
          baseline: { x: x0 / width, y: y1 / height },
        }];
      }))));
  } finally {
    signal.removeEventListener("abort", cancel);
    dispose();
  }
}
