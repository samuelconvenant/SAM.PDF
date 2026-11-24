import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import AxeBuilder from "@axe-core/playwright";
import { unzipSync } from "fflate";
import { decodePDFRawStream, PDFDocument, PDFName } from "pdf-lib";
import { chromium } from "playwright";

const origin = process.env.SAMPDF_TEST_ORIGIN ?? "http://127.0.0.1:4417";
const edge = process.env.SAMPDF_BROWSER ?? (process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : undefined);
const server = process.env.SAMPDF_TEST_ORIGIN ? null : spawn(process.execPath, [
  resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "4417",
], { stdio: "inherit", windowsHide: true });
const artifacts = resolve("test-results");
const python = process.env.SAMPDF_PYTHON ?? resolve(".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const errors = [];
const outgoing = [];
const validationResponses = [];

async function generatedPdf(name, widths, encrypted = false) {
  const doc = await PDFDocument.create();
  for (const width of widths) {
    const page = doc.addPage([width, 500]);
    page.drawText(`Synthetic page ${width}`, { x: 26, y: 450, size: 13 });
  }
  if (encrypted) doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: PDFName.of("Standard") }));
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

async function fileResult(page, label) {
  const dialog = page.getByRole("dialog", { name: "Document preview" });
  try {
    await dialog.locator(".pdf-sheet:not([hidden]) canvas").waitFor();
  } catch (error) {
    console.error("Preview alerts", await page.getByRole("alert").allTextContents());
    throw error;
  }
  const canvas = await dialog.locator(".pdf-sheet canvas").elementHandle();
  if (label === "Download PDF") await dialog.getByRole("button", { name: "Protect with Password", exact: true }).waitFor();
  if (label === "Download ZIP") await dialog.getByRole("button", { name: "Protect each PDF", exact: true }).waitFor();
  const download = page.waitForEvent("download");
  await dialog.getByRole("link", { name: label }).click();
  const result = await download;
  assert.equal(await result.failure(), null);
  assert.equal(await dialog.isVisible(), true);
  assert.equal(await canvas.evaluate((element) => element.isConnected && !element.parentElement.hidden), true);
  await dialog.getByRole("button", { name: "Back to workspace" }).click();
  return readFile(await result.path());
}

async function visit(page, path, status = 200) {
  const response = await page.goto(origin + path);
  assert.equal(response?.status(), status);
  await page.locator("main h1").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, path);
}

async function audit(page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((item) => ["serious", "critical"].includes(item.impact));
  assert.deepEqual(serious.map((item) => [item.id, item.nodes.map((node) => node.target)]), []);
}

async function ready() {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server && server.exitCode !== null) throw new Error(`Server exited with ${server.exitCode}`);
    try { if ((await fetch(origin)).ok) return; } catch {}
    await delay(400);
  }
  throw new Error("The production server did not start.");
}

let browser;
try {
  await ready();
  await mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({ executablePath: edge, headless: true });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  desktop.on("request", (request) => {
    const localConversion = request.method() === "POST" && ["/api/convert/pdf-to-word", "/api/convert/word-to-pdf"].some((path) => request.url() === origin + path);
    if (/^https?:/.test(request.url()) && !localConversion && (!request.url().startsWith(origin + "/") || request.method() !== "GET")) {
      outgoing.push(`${request.method()} ${request.url()}`);
    }
  });
  const page = await desktop.newPage();
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (response.status() === 422 && path.startsWith("/api/convert/")) validationResponses.push(path);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    const expectedValidation = message.text().includes("422 (Unprocessable Entity)") && message.location().url.startsWith(origin + "/api/convert/");
    if (message.type() === "error" && !message.text().includes("404 (Not Found)") && !expectedValidation) errors.push(message.text());
  });

  await visit(page, "/");
  assert.match(await page.title(), /^samPDF/);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Skip to content");
  await page.screenshot({ path: resolve(artifacts, "home-keyboard-focus.png") });
  await page.evaluate(() => document.activeElement.blur());
  await page.screenshot({ path: resolve(artifacts, "home-desktop.png"), fullPage: true });
  await audit(page);
  assert.match(await page.locator(".site-header").evaluate((node) => getComputedStyle(node).backdropFilter), /blur/);
  const heroAction = page.getByRole("link", { name: "Explore PDF tools" });
  await heroAction.hover({ position: { x: 28, y: 17 } });
  assert.notEqual(await heroAction.evaluate((node) => node.style.getPropertyValue("--mx")), "");
  const firstTool = page.locator(".tool-card").first();
  await firstTool.hover();
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".tool-card")).transform.includes("-4"));
  assert.equal(await page.locator(".cursor-glow").getAttribute("data-active"), "true");
  await page.mouse.move(0, 0);
  await page.getByRole("button", { name: "Convert", exact: true }).click();
  assert.equal(await page.locator(".tool-card").count(), 3);
  await page.getByRole("searchbox").fill("PDF to Word");
  assert.equal(await page.locator(".tool-card").count(), 1);
  await page.locator(".tool-card").click();
  await page.getByRole("heading", { name: "Choose a PDF document" }).waitFor();
  await visit(page, "/");
  await page.getByRole("searchbox").fill("no matches");
  await page.getByText("No tools match your search.").waitFor();
  await page.getByRole("button", { name: "Show all tools" }).click();
  assert.equal(await page.locator(".tool-card").count(), 9);

  const showcase = page.getByRole("region", { name: "Interactive PDF tools" });
  const stage = showcase.locator(".document-stage");
  await stage.scrollIntoViewIfNeeded();
  const bounds = await stage.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .78, bounds.y + bounds.height * .45);
  await page.waitForFunction(() => parseFloat(document.querySelector(".document-group").style.getPropertyValue("--tilt-y")) > 2);
  const mergeCard = showcase.getByRole("button", { name: "Merge PDF" });
  const cardBounds = await mergeCard.boundingBox();
  await page.mouse.move(cardBounds.x + cardBounds.width * .23, cardBounds.y + cardBounds.height * .5);
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".document-card--merge")).getPropertyValue("--lift").trim() === "94px");
  await page.mouse.move(bounds.x + bounds.width * .08, bounds.y + bounds.height * .45);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .62, bounds.y + bounds.height * .61, { steps: 10 });
  await page.waitForFunction(() => parseFloat(document.querySelector(".document-group").style.getPropertyValue("--tilt-y")) > 17);
  await page.mouse.up();
  await page.waitForFunction(() => Math.abs(parseFloat(document.querySelector(".document-group").style.getPropertyValue("--tilt-y"))) < .2);
  await mergeCard.press("Enter");
  assert.equal(await mergeCard.getAttribute("aria-pressed"), "true");
  assert.equal(await showcase.getByRole("link", { name: "Open Merge PDF" }).getAttribute("href"), "/tools/merge");
  await showcase.getByRole("button", { name: "Edit PDF" }).press("Enter");
  assert.equal(await showcase.getByRole("link", { name: "Open Edit PDF" }).getAttribute("href"), "/tools/edit");
  await showcase.getByRole("button", { name: "Convert PDF" }).press("Enter");
  assert.equal(await showcase.getByRole("link", { name: "PDF to Word" }).getAttribute("href"), "/tools/pdf-to-word");
  await showcase.getByRole("link", { name: "Word to PDF" }).click();
  await page.getByRole("heading", { name: "Choose a DOCX document" }).waitFor();
  await audit(page);
  const fixtures = JSON.parse(execFileSync(python, [resolve("tests/conversion-fixtures.py")], { encoding: "utf8" }));
  const previousJobs = new Set(await readdir(tmpdir()));
  const conversionInput = page.locator('input[type="file"]');
  const wordButton = page.getByRole("button", { name: "Convert to PDF" });
  const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  await conversionInput.setInputFiles({ name: "bad.docx", mimeType: docxMime, buffer: Buffer.from("bad") });
  await wordButton.click();
  await page.getByRole("alert").filter({ hasText: "valid DOCX" }).waitFor();
  await conversionInput.setInputFiles({ name: "sample.docx", mimeType: docxMime, buffer: Buffer.from(fixtures.docx, "base64") });
  const wordResponse = page.waitForResponse((response) => response.url().endsWith("/api/convert/word-to-pdf"), { timeout: 125_000 });
  await wordButton.click();
  const renderedWord = await wordResponse;
  assert.ok(renderedWord.ok(), renderedWord.ok() ? "" : await renderedWord.text());
  {
    const dialog = page.getByRole("dialog", { name: "Document preview" });
    await dialog.locator(".pdf-sheet:not([hidden]) canvas").waitFor({ timeout: 65_000 });
    await dialog.getByRole("button", { name: "Next page" }).click();
    assert.equal(await dialog.getByLabel("Page number").inputValue(), "2");
    await dialog.getByRole("button", { name: "Zoom in" }).click();
    await audit(page);
  }
  const convertedPdf = await fileResult(page, "Download PDF");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  {
    const dialog = page.getByRole("dialog", { name: "Document preview" });
    assert.equal(await dialog.getByLabel("Page number").inputValue(), "2");
    await dialog.getByText("125%", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Close preview" }).click();
  }
  assert.equal((await PDFDocument.load(convertedPdf)).getPageCount(), 2);
  const pdfPath = resolve(artifacts, "word-to-pdf-sample.pdf");
  await writeFile(pdfPath, convertedPdf);
  execFileSync(python, ["-c", "import pymupdf,sys; d=pymupdf.open(sys.argv[1]); assert 'Editable paragraph' in d[0].get_text(); assert 'Copper' in d[0].get_text(); assert d[0].get_images(); assert 'Second page' in d[1].get_text()", pdfPath]);

  await visit(page, "/tools/pdf-to-word");
  const pdfButton = page.getByRole("button", { name: "Convert to Word" });
  await conversionInput.setInputFiles({ name: "invalid.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a PDF") });
  await pdfButton.click();
  await page.getByRole("alert").filter({ hasText: "valid PDF" }).waitFor();
  await conversionInput.setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(fixtures.scan, "base64") });
  await pdfButton.click();
  await page.getByRole("alert").filter({ hasText: "Run OCR" }).waitFor();
  await conversionInput.setInputFiles({ name: "sample.pdf", mimeType: "application/pdf", buffer: convertedPdf });
  const pdfResponse = page.waitForResponse((response) => response.url().endsWith("/api/convert/pdf-to-word"), { timeout: 125_000 });
  await pdfButton.click();
  const renderedPdf = await pdfResponse;
  assert.ok(renderedPdf.ok(), renderedPdf.ok() ? "" : await renderedPdf.text());
  {
    const dialog = page.getByRole("dialog", { name: "Document preview" });
    await dialog.getByText("LibreOffice preview of the generated DOCX", { exact: false }).waitFor({ timeout: 125_000 });
    await dialog.locator(".pdf-sheet:not([hidden]) canvas").waitFor({ timeout: 45_000 });
  }
  const wordBytes = await fileResult(page, "Download DOCX");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  {
    const dialog = page.getByRole("dialog", { name: "Document preview" });
    await dialog.locator(".pdf-sheet:not([hidden]) canvas").waitFor();
    await dialog.getByRole("button", { name: "Close preview" }).click();
  }
  const wordPath = resolve(artifacts, "pdf-to-word-sample.docx");
  await writeFile(wordPath, wordBytes);
  const convertedWord = unzipSync(wordBytes);
  const wordXml = Buffer.from(convertedWord["word/document.xml"]).toString();
  assert.match(wordXml, /<w:t[^>]*>Editable paragraph with real document text\.<\/w:t>/);
  assert.match(wordXml, /<w:tbl>/);
  assert.ok(Object.keys(convertedWord).some((name) => name.startsWith("word/media/")));
  execFileSync(python, ["-c", "from docx import Document; import sys; d=Document(sys.argv[1]); assert any('Editable paragraph' in p.text for p in d.paragraphs); assert any('Copper' in c.text for t in d.tables for r in t.rows for c in r.cells); assert d.inline_shapes", wordPath]);
  assert.deepEqual((await readdir(tmpdir())).filter((name) => name.startsWith("sampdf-convert-") && !previousJobs.has(name)), []);
  await visit(page, "/");

  const a = await generatedPdf("alpha.pdf", [200, 210, 220]);
  const b = await generatedPdf("beta.pdf", [300]);
  const locked = await generatedPdf("encrypted.pdf", [400], true);
  const chooser = page.locator('input[type="file"]');

  await page.getByRole("link", { name: "Merge PDF", exact: false }).last().click();
  await page.waitForURL("**/tools/merge");
  await page.getByRole("button", { name: "Choose files" }).waitFor();
  await page.screenshot({ path: resolve(artifacts, "merge-desktop.png"), fullPage: true });
  await audit(page);
  await chooser.setInputFiles({ name: "bad.pdf", mimeType: "application/pdf", buffer: Buffer.from("corrupt") });
  await page.getByRole("alert").filter({ hasText: "not a valid PDF" }).waitFor();
  await chooser.setInputFiles({ name: "truncated.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\ntruncated") });
  await page.getByRole("alert").filter({ hasText: "could not be read" }).waitFor();
  await chooser.setInputFiles(locked);
  await page.getByRole("alert").filter({ hasText: "encrypted" }).waitFor();
  await chooser.setInputFiles([a, b]);
  await page.getByRole("button", { name: "Move beta.pdf earlier" }).press("Enter");
  assert.match(await page.locator(".file-list li").first().textContent(), /beta.pdf.*1 page/);
  await page.getByRole("button", { name: "Merge PDFs" }).click();
  const preview = page.getByRole("dialog", { name: "Document preview" });
  await preview.locator(".pdf-sheet:not([hidden]) canvas").waitFor();
  await preview.getByRole("button", { name: "Next page" }).click();
  assert.equal(await preview.getByLabel("Page number").inputValue(), "2");
  await preview.getByRole("button", { name: "Zoom in" }).click();
  await preview.getByText("125%").waitFor();
  await preview.getByRole("button", { name: "Expand preview" }).click();
  assert.equal(await preview.getAttribute("data-expanded"), "true");
  await preview.getByRole("button", { name: "Restore preview size" }).click();
  await preview.getByRole("button", { name: "Go to page 4" }).click();
  await preview.locator(".pdf-sheet:not([hidden]) canvas").waitFor();
  await page.screenshot({ path: resolve(artifacts, "merge-preview-desktop.png") });
  await audit(page);
  let doc = await PDFDocument.load(await fileResult(page, "Download PDF"));
  assert.deepEqual(doc.getPages().map((item) => item.getWidth()), [300, 200, 210, 220]);
  await page.getByRole("button", { name: "Merge PDFs" }).click();
  await page.getByRole("link", { name: "Download PDF" }).waitFor();
  await page.keyboard.press("Escape");
  await preview.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Clear workspace" }).click();
  await page.getByRole("button", { name: "Choose files" }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Download PDF" }).count(), 0);
  const dropped = await page.evaluateHandle(({ a, b }) => {
    const transfer = new DataTransfer();
    for (const file of [a, b]) transfer.items.add(new File([Uint8Array.from(file.bytes)], file.name, { type: "application/pdf" }));
    return transfer;
  }, { a: { name: a.name, bytes: Array.from(a.buffer) }, b: { name: b.name, bytes: Array.from(b.buffer) } });
  await page.locator(".drop-zone").dispatchEvent("drop", { dataTransfer: dropped });
  await dropped.dispose();
  await page.getByText("beta.pdf", { exact: true }).waitFor();
  await page.locator(".file-list li").last().dragTo(page.locator(".file-list li").first());
  assert.equal(await page.locator(".file-list strong").first().textContent(), "beta.pdf");
  await page.evaluate(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (job) {
      if (job.type === "process") setTimeout(() => send.call(this, job), 1000);
      else send.call(this, job);
    };
    window.restoresamPDFWorker = () => { Worker.prototype.postMessage = send; };
  });
  await page.getByRole("button", { name: "Merge PDFs" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Processing canceled." }).waitFor({ state: "attached" });
  await page.evaluate(() => window.restoresamPDFWorker());
  assert.equal(await page.getByRole("link", { name: "Download PDF" }).count(), 0);
  await page.getByRole("button", { name: "Merge PDFs" }).click();
  doc = await PDFDocument.load(await fileResult(page, "Download PDF"));
  assert.equal(doc.getPage(0).getWidth(), 300);

  await visit(page, "/tools/split");
  await page.screenshot({ path: resolve(artifacts, "split-desktop.png"), fullPage: true });
  await audit(page);
  await chooser.setInputFiles(a);
  const ranges = page.getByLabel("Page ranges");
  await ranges.fill("8-10");
  await page.getByRole("button", { name: "Split PDF", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "between 1 and 3" }).waitFor();
  await ranges.fill("2-3");
  await page.getByRole("button", { name: "Split PDF", exact: true }).click();
  doc = await PDFDocument.load(await fileResult(page, "Download PDF"));
  assert.deepEqual(doc.getPages().map((item) => item.getWidth()), [210, 220]);
  await ranges.fill("1-2, 3");
  await page.getByRole("button", { name: "Split PDF", exact: true }).click();
  await preview.getByLabel("PDF in archive").selectOption("1");
  await preview.locator(".pdf-sheet:not([hidden]) canvas").waitFor();
  const archive = unzipSync(await fileResult(page, "Download ZIP"));
  assert.deepEqual(Object.keys(archive).sort(), ["part-1-pages-1-2.pdf", "part-2-pages-3-3.pdf"]);
  assert.equal((await PDFDocument.load(archive["part-1-pages-1-2.pdf"])).getPageCount(), 2);
  assert.equal((await PDFDocument.load(archive["part-2-pages-3-3.pdf"])).getPage(0).getWidth(), 220);

  await visit(page, "/tools/organize");
  await chooser.setInputFiles(a);
  await page.locator(".thumbnail canvas:not([hidden])").first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Move page 3 earlier" }).click();
  await page.getByRole("button", { name: "Rotate page 3" }).click();
  await page.getByRole("button", { name: "Remove page 1" }).click();
  await page.waitForFunction(() => [...document.querySelectorAll(".page-grid li")].every((element) => getComputedStyle(element).transform === "none"));
  await page.screenshot({ path: resolve(artifacts, "organize-desktop.png"), fullPage: true, animations: "disabled" });
  await audit(page);
  await page.getByRole("button", { name: "Save PDF" }).click();
  doc = await PDFDocument.load(await fileResult(page, "Download PDF"));
  assert.deepEqual(doc.getPages().map((item) => [item.getWidth(), item.getRotation().angle]), [[220, 90], [210, 0]]);

  await visit(page, "/tools/images-to-pdf");
  await page.screenshot({ path: resolve(artifacts, "images-desktop.png"), fullPage: true });
  await audit(page);
  const images = await page.evaluate(() => [
    { name: "green.png", width: 70, height: 120, type: "image/png", color: "green" },
    { name: "orange.jpg", width: 105, height: 90, type: "image/jpeg", color: "orange" },
  ].map(({ name, width, height, type, color }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
    return { name, mimeType: type, data: canvas.toDataURL(type).split(",")[1] };
  }));
  await chooser.setInputFiles(images.map(({ name, mimeType, data }) => ({ name, mimeType, buffer: Buffer.from(data, "base64") })));
  await page.getByRole("button", { name: "Move orange.jpg earlier" }).click();
  await page.getByRole("button", { name: "Create PDF" }).click();
  doc = await PDFDocument.load(await fileResult(page, "Download PDF"));
  assert.deepEqual(doc.getPages().map((item) => item.getSize()), [{ width: 105, height: 90 }, { width: 70, height: 120 }]);
  await page.getByLabel("Page size").selectOption("a4");
  await page.getByRole("button", { name: "Create PDF" }).click();
  doc = await PDFDocument.load(await fileResult(page, "Download PDF"));
  assert.deepEqual(doc.getPages().map((item) => item.getSize()), [{ width: 595.28, height: 841.89 }, { width: 595.28, height: 841.89 }]);

  await visit(page, "/tools/create");
  const draft = page.getByRole("textbox", { name: "Document page" });
  await draft.waitFor();
  assert.equal((await draft.textContent()).trim(), "");
  await draft.click();
  await page.getByLabel("Paragraph style").selectOption("1");
  await page.keyboard.insertText("Field notes");
  await page.keyboard.press("Enter");
  await page.locator('summary[aria-label^="Font picker,"]').click();
  await page.getByLabel("Search fonts").fill("Times");
  await page.getByLabel("Font family").selectOption("Times New Roman");
  await page.getByLabel("Font size").fill("18");
  await page.getByLabel("Font size").press("Enter");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await page.getByRole("button", { name: "Italic", exact: true }).click();
  await page.getByRole("button", { name: "Underline", exact: true }).click();
  await page.locator('summary[aria-label="Text colour options"]').click();
  await page.getByLabel("Text colour HEX").fill("#315477");
  await page.getByLabel("Text colour HEX").press("Enter");
  await page.getByLabel("Text alignment").selectOption("center");
  await page.waitForFunction(() => document.activeElement?.classList.contains("create-document"));
  await page.keyboard.insertText("Formatted field report");
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Insert table" }).click();
  const cell = draft.locator("th p, td p").first();
  await cell.click();
  await page.keyboard.insertText("Specimen table");
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  assert.equal(await draft.locator("tr").count(), 3);
  assert.equal(await draft.locator("tr").first().locator("th, td").count(), 3);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await draft.locator(":scope > p").last().click();
  await page.getByLabel("Import document image").setInputFiles({ name: images[0].name, mimeType: images[0].mimeType, buffer: Buffer.from(images[0].data, "base64") });
  const insertedImage = draft.locator("img");
  await insertedImage.waitFor();
  await insertedImage.click();
  await page.getByLabel("Image width").fill("85");
  await page.getByLabel("Image width").press("Enter");
  await page.getByLabel("Image position").selectOption("right");
  await page.waitForFunction(() => document.activeElement?.classList.contains("create-document"));
  await page.keyboard.press("Control+End");
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  await page.keyboard.insertText("Explicit page begins here");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Bullet list" }).click();
  await page.keyboard.insertText("Bullet annotation");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Numbered list" }).click();
  await page.keyboard.insertText("Numbered annotation");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText(Array.from({ length: 100 }, (_, index) => `Flow section ${index + 1} contains real selectable text.`).join(" "));
  await page.screenshot({ path: resolve(artifacts, "create-desktop.png"), fullPage: true });
  await audit(page);
  await page.getByRole("button", { name: "Preview PDF", exact: true }).click();
  const created = await fileResult(page, "Download PDF");
  const createdPath = resolve(artifacts, "created-a4-sample.pdf");
  await writeFile(createdPath, created);
  execFileSync(python, ["-c", "import pymupdf,sys; d=pymupdf.open(sys.argv[1]); assert len(d)>=3; assert all(abs(p.rect.width-595.28)<.02 and abs(p.rect.height-841.89)<.02 for p in d); first=d[0].get_text(); assert 'Field notes' in first and 'Formatted field report' in first and 'Specimen table' in first; span=next(s for b in d[0].get_text('dict')['blocks'] for l in b.get('lines',[]) for s in l['spans'] if 'Formatted field report' in s['text']); assert abs(span['size']-18)<.01 and span['color']==0x315477 and 'Times-BoldItalic' in span['font']; pic=d[0].get_image_info()[0]['bbox']; assert abs(pic[2]-pic[0]-63.75)<.1 and abs(pic[2]-(595.28-48))<.1; assert 'Explicit page begins here' in d[1].get_text(); assert 'Flow section 100' in ' '.join(d[-1].get_text().split())", createdPath]);

  await visit(page, "/tools/edit");
  await chooser.setInputFiles(a);
  await page.locator(".editor .pdf-sheet:not([hidden]) canvas").waitFor();
  await page.getByRole("button", { name: "Add text box" }).click();
  await page.getByRole("button", { name: "Type on page" }).click();
  await page.getByRole("textbox", { name: "Type in text box" }).fill("Reviewed");
  await page.getByRole("textbox", { name: "Type in text box" }).press("Escape");
  await page.locator('summary[aria-label^="Font picker,"]').click();
  await page.getByLabel("Search fonts").fill("Times");
  await page.getByLabel("Font family", { exact: true }).selectOption("Times New Roman");
  await page.getByLabel("Font size").fill("24");
  await page.getByLabel("Font size").press("Enter");
  await page.getByLabel("Color", { exact: true }).fill("#005588");
  await page.getByLabel("Left %").fill("25");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByLabel("Selected annotation").selectOption("1");
  assert.equal(await page.getByLabel("Left %").inputValue(), "25");
  for (const tool of ["Rectangle", "Highlight", "Draw"]) {
    await page.getByRole("button", { name: tool, exact: true }).click();
    const bounds = await page.locator(".editor-overlay").boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .2, bounds.y + bounds.height * .25);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * .65, bounds.y + bounds.height * .38, { steps: 6 });
    await page.mouse.up();
  }
  assert.equal(await page.locator(".editor-mark").count(), 4);
  await page.getByRole("button", { name: "Rotate selected page" }).click();
  await page.getByRole("button", { name: "Select page 2", exact: true }).click();
  await page.getByRole("button", { name: "Delete selected page" }).click();
  await page.getByRole("button", { name: "Select page 1", exact: true }).click();
  await page.locator(".editor .pdf-sheet:not([hidden]) canvas").waitFor();
  await page.screenshot({ path: resolve(artifacts, "editor-desktop.png"), fullPage: true });
  await audit(page);
  await page.getByRole("button", { name: "Preview edited PDF" }).click();
  doc = await PDFDocument.load(await fileResult(page, "Download PDF"));
  assert.deepEqual(doc.getPages().map((item) => [item.getWidth(), item.getRotation().angle]), [[200, 90], [220, 0]]);
  const contents = doc.getPage(0).node.Contents();
  assert.ok(contents.size() > 1, "export includes a new content stream");
  const operators = Buffer.from(decodePDFRawStream(contents.lookup(contents.size() - 1)).decode()).toString();
  assert.match(operators, new RegExp(Buffer.from("Reviewed").toString("hex"), "i"));
  assert.match(operators, /24 Tf/);

  const formPdf = await PDFDocument.create();
  const formPage = formPdf.addPage([595.28, 841.89]);
  formPage.drawText("Original application form", { x: 50, y: 760, size: 18 });
  formPage.drawRectangle({ x: 595.28 * .62, y: 841.89 * .75 - 45 * 72 / 25.4, width: 35 * 72 / 25.4, height: 45 * 72 / 25.4, borderWidth: 1 });
  const originalField = formPdf.getForm().createTextField("original-field");
  originalField.setText("Retained value");
  originalField.addToPage(formPage, { x: 50, y: 704, width: 180, height: 25 });
  const formInput = { name: "application-form.pdf", mimeType: "application/pdf", buffer: Buffer.from(await formPdf.save()) };
  const passport = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 175;
    canvas.height = 225;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#77b6e2";
    ctx.fillRect(0, 0, 175, 225);
    ctx.fillStyle = "#433d50";
    ctx.beginPath();ctx.ellipse(88, 221, 57, 69, 0, 0, Math.PI * 2);ctx.fill();
    ctx.fillStyle = "#a36f4d";
    ctx.beginPath();ctx.ellipse(88, 93, 39, 49, 0, 0, Math.PI * 2);ctx.fill();
    return canvas.toDataURL("image/jpeg", .94).split(",")[1];
  });
  await visit(page, "/tools/edit");
  assert.equal(await page.locator(".editor-grid").count(), 0);
  await chooser.setInputFiles(formInput);
  const sheet = page.locator(".editor .pdf-sheet:not([hidden]) canvas");
  await sheet.waitFor();
  await page.getByRole("button", { name: "Add text box" }).click();
  await page.getByLabel("Overlay text").fill("Added reference");
  const box = page.locator(".editor-box-content").first();
  await box.scrollIntoViewIfNeeded();
  const textBoxBounds = await box.boundingBox();
  await page.mouse.move(textBoxBounds.x + 10, textBoxBounds.y + 10);
  await page.mouse.down();
  await page.mouse.move(textBoxBounds.x + 35, textBoxBounds.y + 23, { steps: 6 });
  await page.mouse.up();
  assert.ok(Number(await page.getByLabel("Left %").inputValue()) > 15);
  await page.getByLabel("Left %").fill("11.25");
  await page.getByLabel("Top %").fill("15");
  await page.getByLabel("Width mm").fill("70");

  const photoTransfer = await page.evaluateHandle((encoded) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(encoded), (item) => item.charCodeAt(0))], "passport.jpg", { type: "image/jpeg" }));
    return transfer;
  }, passport);
  const overlay = page.locator(".editor-overlay");
  const photoBounds = await overlay.boundingBox();
  await overlay.dispatchEvent("dragover", { dataTransfer: photoTransfer, clientX: photoBounds.x + photoBounds.width * .58, clientY: photoBounds.y + photoBounds.height * .22 });
  await overlay.dispatchEvent("drop", { dataTransfer: photoTransfer, clientX: photoBounds.x + photoBounds.width * .58, clientY: photoBounds.y + photoBounds.height * .22 });
  await photoTransfer.dispose();
  await page.getByLabel("Photo size").selectOption("35x45");
  const handle = page.locator('.editor-resize-handle[data-gesture="se"]');
  await handle.scrollIntoViewIfNeeded();
  const resize = await handle.boundingBox();
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
  await page.mouse.down();
  await page.mouse.move(resize.x + resize.width / 2 + 19, resize.y + resize.height / 2 + 12, { steps: 5 });
  await page.mouse.up();
  assert.ok(Number(await page.getByLabel("Width mm").inputValue()) > 35);
  await page.getByLabel("Photo size").selectOption("35x45");
  await page.getByLabel("Left %", { exact: true }).fill("62");
  await page.getByLabel("Top %", { exact: true }).fill("25");
  await page.getByText("Crop image", { exact: true }).click();
  await page.getByLabel("Crop left %").fill("10");
  assert.equal(await page.getByLabel("Width mm").inputValue(), "35");
  assert.equal(await page.getByLabel("Height mm").inputValue(), "45");
  await page.getByRole("button", { name: "Preview edited PDF" }).click();
  const edited = await fileResult(page, "Download PDF");
  const editedPath = resolve(artifacts, "edited-photo-form.pdf");
  await writeFile(editedPath, edited);
  assert.equal((await PDFDocument.load(edited)).getForm().getTextField("original-field").getText(), "Retained value");
  execFileSync(python, ["-c", "import pymupdf,sys; d=pymupdf.open(sys.argv[1]); p=d[0]; assert 'Original application form' in p.get_text(); hit=p.search_for('Added reference')[0]; assert abs(hit.x0-(595.28*.1125+2))<.1; assert p.get_images(); pix=p.get_pixmap(); x,y=int(595.28*.62),int(841.89*.25); color=pix.pixel(x+4,y+4); assert color[2]>color[0]+45; assert min(pix.pixel(x-4,y+4))>240; assert min(pix.pixel(x+104,y+4))>240", editedPath]);

  await visit(page, "/help");
  await page.screenshot({ path: resolve(artifacts, "help-desktop.png"), fullPage: true });
  await audit(page);
  await visit(page, "/unknown", 404);
  await page.screenshot({ path: resolve(artifacts, "404-desktop.png"), fullPage: true });
  await audit(page);

  for (const [width, height, reducedMotion] of [[320, 740, "reduce"], [390, 844, "no-preference"], [768, 1024, "reduce"], [844, 390, "reduce"]]) {
    const mobile = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, reducedMotion, acceptDownloads: true });
    const phone = await mobile.newPage();
    if (width === 390) {
      const cdp = await mobile.newCDPSession(phone);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 100, downloadThroughput: 200000, uploadThroughput: 90000 });
      await phone.addInitScript(() => {
        window.sampdfVitals = { lcp: 0, cls: 0 };
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.sampdfVitals.lcp = entry.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.sampdfVitals.cls += entry.value;
        }).observe({ type: "layout-shift", buffered: true });
      });
    }
    await visit(phone, "/");
    if (width === 768) await phone.screenshot({ path: resolve(artifacts, "home-tablet.png"), fullPage: true });
    if (width === 320) {
      await phone.screenshot({ path: resolve(artifacts, "home-mobile-reduced.png"), fullPage: true });
      assert.equal(await phone.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), "auto");
      assert.equal(await phone.locator(".cursor-glow").evaluate((node) => getComputedStyle(node).display), "none");
      assert.equal(await phone.locator(".document-group").evaluate((node) => getComputedStyle(node).animationName), "none");
    }
    if (width === 390) {
      await phone.screenshot({ path: resolve(artifacts, "home-mobile.png"), fullPage: true });
      console.log("Throttled mobile homepage", await phone.evaluate(() => window.sampdfVitals));
      await audit(phone);
      const mobileStack = phone.getByRole("region", { name: "Interactive PDF tools" });
      const convertCard = mobileStack.getByRole("button", { name: "Convert PDF" });
      await convertCard.scrollIntoViewIfNeeded();
      const box = await convertCard.boundingBox();
      await phone.touchscreen.tap(box.x + box.width * .78, box.y + box.height * .52);
      assert.equal(await convertCard.getAttribute("aria-pressed"), "true");
      await mobileStack.getByRole("link", { name: "PDF to Word" }).waitFor();
      const touch = await mobile.newCDPSession(phone);
      const mobileStage = await mobileStack.locator(".document-stage").boundingBox();
      const start = { x: mobileStage.x + mobileStage.width * .08, y: mobileStage.y + mobileStage.height * .47 };
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + 70, y: start.y + 3 }] });
      await phone.waitForFunction(() => parseFloat(document.querySelector(".document-group").style.getPropertyValue("--tilt-y")) > 5);
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await phone.waitForFunction(() => Math.abs(parseFloat(document.querySelector(".document-group").style.getPropertyValue("--tilt-y"))) < .2);
      assert.equal(await convertCard.getAttribute("aria-pressed"), "true");
      await touch.detach();
    }
    if (width < 670) {
      const menu = phone.getByRole("button", { name: "Menu" });
      await menu.tap();
      assert.equal(await menu.getAttribute("aria-expanded"), "true");
      await phone.keyboard.press("Escape");
      assert.equal(await menu.getAttribute("aria-expanded"), "false");
      assert.equal(await menu.evaluate((element) => element === document.activeElement), true);
    }
    for (const path of ["/tools/merge", "/tools/split", "/tools/organize", "/tools/images-to-pdf", "/tools/create", "/tools/edit", "/tools/pdf-to-word", "/tools/word-to-pdf", "/tools/protect", "/help"]) {
      await visit(phone, path);
      if (width === 390) await phone.screenshot({ path: resolve(artifacts, `${path.split("/").at(-1)}-mobile.png`), fullPage: true });
    }
    if (width === 390) {
      await visit(phone, "/tools/merge");
      await phone.locator('input[type="file"]').setInputFiles([a, b]);
      await phone.getByRole("button", { name: "Move beta.pdf earlier" }).tap();
      await phone.getByRole("button", { name: "Merge PDFs" }).tap();
      doc = await PDFDocument.load(await fileResult(phone, "Download PDF"));
      assert.equal(doc.getPage(0).getWidth(), 300);
      await audit(phone);

      await visit(phone, "/tools/split");
      await phone.locator('input[type="file"]').setInputFiles(a);
      await phone.getByLabel("Page ranges").fill("3");
      await phone.getByRole("button", { name: "Split PDF", exact: true }).tap();
      doc = await PDFDocument.load(await fileResult(phone, "Download PDF"));
      assert.equal(doc.getPage(0).getWidth(), 220);

      await visit(phone, "/tools/organize");
      await phone.locator('input[type="file"]').setInputFiles(b);
      await phone.locator(".thumbnail canvas:not([hidden])").first().waitFor({ state: "visible" });
      await phone.getByRole("button", { name: "Rotate page 1" }).tap();
      await phone.getByRole("button", { name: "Save PDF" }).tap();
      doc = await PDFDocument.load(await fileResult(phone, "Download PDF"));
      assert.equal(doc.getPage(0).getRotation().angle, 90);

      await visit(phone, "/tools/images-to-pdf");
      await phone.locator('input[type="file"]').setInputFiles(images.map(({ name, mimeType, data }) => ({ name, mimeType, buffer: Buffer.from(data, "base64") })));
      await phone.getByRole("button", { name: "Create PDF" }).tap();
      doc = await PDFDocument.load(await fileResult(phone, "Download PDF"));
      assert.equal(doc.getPageCount(), 2);

      await visit(phone, "/tools/edit");
      await phone.locator('input[type="file"]').setInputFiles(b);
      await phone.locator(".editor .pdf-sheet:not([hidden]) canvas").waitFor();
      await phone.getByRole("button", { name: "Add text", exact: true }).tap();
      await phone.getByLabel("Overlay text").fill("Mobile review");
      await phone.getByLabel("Import JPEG or PNG photo").setInputFiles({ name: "portrait.jpg", mimeType: "image/jpeg", buffer: Buffer.from(passport, "base64") });
      await phone.getByRole("button", { name: "Resize", exact: true }).tap();
      await phone.getByLabel("Photo size").selectOption("35x45");
      await phone.screenshot({ path: resolve(artifacts, "editor-active-mobile.png"), fullPage: true });
      await phone.getByRole("button", { name: "Download", exact: true }).tap();
      doc = await PDFDocument.load(await fileResult(phone, "Download PDF"));
      assert.equal(doc.getPageCount(), 1);

      await visit(phone, "/tools/create");
      const phoneDraft = phone.getByRole("textbox", { name: "Document page" });
      await phoneDraft.tap();
      await phone.keyboard.insertText("Mobile A4 document");
      await phone.keyboard.press("Shift+Home");
      await phone.locator('summary[aria-label^="Font picker,"]').tap();
      await phone.getByLabel("Search fonts").fill("Verdana");
      await phone.getByLabel("Font family").selectOption("Verdana");
      await phone.waitForFunction(() => document.activeElement?.classList.contains("create-document"));
      await phone.keyboard.press("End");
      await phone.keyboard.press("Enter");
      await phone.getByLabel("Import document image").setInputFiles({ name: images[0].name, mimeType: images[0].mimeType, buffer: Buffer.from(images[0].data, "base64") });
      await phoneDraft.locator(".draft-image-frame").tap();
      await phone.getByLabel("Image layout").selectOption("floating");
      assert.equal(await phoneDraft.locator('.draft-image-anchor[data-layout="floating"] .draft-image-handle:visible').count(), 8);
      assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await audit(phone);
      await phone.getByRole("button", { name: "Preview PDF", exact: true }).tap();
      doc = await PDFDocument.load(await fileResult(phone, "Download PDF"));
      assert.equal(doc.getPageCount(), 1);
    }
    await visit(phone, "/unknown", 404);
    if (width === 390) await phone.screenshot({ path: resolve(artifacts, "404-mobile.png"), fullPage: true });
    await mobile.close();
  }

  assert.deepEqual(outgoing, []);
  assert.deepEqual(validationResponses, ["/api/convert/word-to-pdf", "/api/convert/pdf-to-word", "/api/convert/pdf-to-word"]);
  assert.deepEqual(errors, []);
  console.log("Passed eight document workflows, including A4 authoring and photo placement, output validation, accessibility, navigation, and responsive checks.");
} finally {
  await browser?.close();
  server?.kill();
}
