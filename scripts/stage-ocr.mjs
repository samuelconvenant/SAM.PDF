import { copyFile, mkdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const output = new URL("public/smart-ocr/", root);
await mkdir(output, { recursive: true });

const files = {
  "worker.min.js": "tesseract.js/dist/worker.min.js",
  "tesseract-core-lstm.wasm.js": "tesseract.js-core/tesseract-core-lstm.wasm.js",
  "tesseract-core-lstm.wasm": "tesseract.js-core/tesseract-core-lstm.wasm",
  "eng.traineddata.gz": "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  "tesseract-license.md": "tesseract.js/LICENSE.md",
  "core-license.txt": "tesseract.js-core/LICENSE",
  "pdfium-wrapper-license.txt": "@embedpdf/pdfium/LICENSE",
  "pdfium-notices.txt": "@embedpdf/pdfium/LICENSE.pdfium",
};
await Promise.all(Object.entries(files).map(([name, source]) =>
  copyFile(new URL(`node_modules/${source}`, root), new URL(name, output))));
