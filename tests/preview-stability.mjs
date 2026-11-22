import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright";

const browser = await chromium.launch({
  executablePath: process.env.SAMPDF_BROWSER ?? (process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : undefined),
});
const origin = process.env.SAMPDF_TEST_ORIGIN ?? "http://127.0.0.1:3000";
const baseline = process.argv.includes("--baseline");
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    let renderer = 0;
    window.previewCommits = 0;
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, renderers: new Map(),
      inject(rendererInfo) { this.renderers.set(++renderer, rendererInfo); return renderer; },
      onCommitFiberRoot() { window.previewCommits++; }, onCommitFiberUnmount() {},
    };
  });
  await page.goto(origin + "/tools/edit");
  const specimen = await PDFDocument.create();
  for (const index of [1, 2, 3]) specimen.addPage([595, 842]).drawText(`Render continuity test, page ${index}`, { x: 48, y: 775 });
  const fixture = { name: "render-continuity.pdf", mimeType: "application/pdf", buffer: Buffer.from(await specimen.save()) };
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose file", exact: true }).click();
  await (await picker).setFiles(fixture);
  const visibleEditorPage = page.locator(".editor .pdf-sheet:not([hidden]) canvas");
  await visibleEditorPage.waitFor();
  const measure = async (selector) => page.evaluate((parent) => {
    const root = document.querySelector(parent);
    const canvas = root.querySelector(".pdf-sheet canvas");
    const sheet = canvas.parentElement;
    window.oldPreview = { canvas, root };
    window.previewSample = { placeholders: 0, hiddenTransitions: 0, widthChanges: 0 };
    const counters = window.previewSample;
    window.previewObserver?.disconnect();
    window.previewObserver = new MutationObserver((records) => {
      for (const mutation of records) {
        if (mutation.target === sheet && mutation.attributeName === "hidden") counters.hiddenTransitions++;
        if (mutation.target === canvas && mutation.attributeName === "width") counters.widthChanges++;
        for (const node of mutation.addedNodes) {
          if (node.textContent?.trim() === "Rendering page…") counters.placeholders++;
        }
      }
    });
    window.previewObserver.observe(root, { subtree: true, attributes: true, attributeFilter: ["hidden", "width"], childList: true });
    window.startCommits = window.previewCommits;
  }, selector);
  const collect = () => page.evaluate(() => ({
    ...window.previewSample,
    reactCommits: window.previewCommits - window.startCommits,
    sameCanvas: window.oldPreview.root.querySelector(".pdf-sheet canvas") === window.oldPreview.canvas,
  }));
  await measure(".editor-grid");
  for (const action of ["Zoom in editor", "Zoom in editor", "Next editor page", "Zoom out editor", "Previous editor page"]) {
    await page.getByRole("button", { name: action, exact: true }).click();
    await visibleEditorPage.waitFor();
  }
  await page.locator('.editor .pdf-sheet canvas[aria-label="Rendered PDF page 1"]').waitFor();
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Add image", exact: true }).waitFor();
  const editorResult = await collect();
  const photoBytes = await page.evaluate(() => {
    const image = document.createElement("canvas");
    image.width = 64;
    image.height = 84;
    const paint = image.getContext("2d");
    paint.fillStyle = "#236881";
    paint.fillRect(0, 0, 64, 84);
    return image.toDataURL().split(",")[1];
  });
  await page.getByLabel("Import JPEG or PNG photo").setInputFiles({ name: "portrait.png", mimeType: "image/png", buffer: Buffer.from(photoBytes, "base64") });
  const photo = page.locator(".editor-mark").first();
  await photo.scrollIntoViewIfNeeded();
  const left = page.getByLabel("Left %", { exact: true });
  const initialLeft = Number(await left.inputValue());
  await measure(".editor-grid");
  const bounds = await photo.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height * .4);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .4 + 42, bounds.y + bounds.height * .4 + 16, { steps: 10 });
  await page.mouse.up();
  assert.ok(Number(await left.inputValue()) > initialLeft);
  const dragResult = await collect();
  await page.getByRole("button", { name: "Preview edited PDF", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Document preview" });
  await dialog.locator(".pdf-sheet:not([hidden]) canvas").waitFor();
  await measure(".document-dialog");
  await dialog.getByRole("button", { name: "Zoom in", exact: true }).click();
  await dialog.getByRole("button", { name: "Next page", exact: true }).click();
  await dialog.locator('.pdf-sheet:not([hidden]) canvas[aria-label="Rendered PDF page 2"]').waitFor();
  const scrollPosition = await dialog.getByRole("region", { name: "Scrollable PDF page" }).evaluate((element) => {
    element.scrollTop = 240;
    return element.scrollTop;
  });
  assert.ok(scrollPosition > 0);
  const down = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Download PDF" }).click();
  assert.equal(await (await down).failure(), null);
  assert.equal(await dialog.isVisible(), true);
  const previewResult = await collect();
  await dialog.getByRole("button", { name: "Close preview" }).click();
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  await dialog.locator(".pdf-sheet:not([hidden]) canvas").waitFor();
  const reopen = await page.evaluate(() => {
    const dialog = document.querySelector(".document-dialog[open]");
    return { sameCanvas: dialog.querySelector(".pdf-sheet canvas") === window.oldPreview.canvas,
      page: dialog.querySelector('input[type="number"]').value,
      zoom: dialog.querySelector(".page-indicator[aria-live]").textContent,
      scroll: dialog.querySelector(".pdf-stage").scrollTop };
  });
  console.log(JSON.stringify({ editorResult, dragResult, previewResult, reopen }, null, 2));
  assert.deepEqual(errors, []);
  if (!baseline) {
    for (const result of [editorResult, dragResult, previewResult]) {
      assert.equal(result.hiddenTransitions, 0);
      assert.equal(result.placeholders, 0);
      assert.equal(result.sameCanvas, true);
    }
    assert.equal(dragResult.widthChanges, 0);
    assert.deepEqual(reopen, { sameCanvas: true, page: "2", zoom: "125%", scroll: scrollPosition });
  }
} finally {
  await browser.close();
}
