import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { unzipSync } from "fflate";
import { decodePDFRawStream, degrees, PDFDocument } from "pdf-lib";
import { chromium } from "playwright";

const origin = process.env.SAMPDF_TEST_ORIGIN ?? "http://127.0.0.1:3000";
const python = process.env.SAMPDF_PYTHON ?? resolve(".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const executablePath = process.env.SAMPDF_BROWSER ?? (process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : undefined);
const browser = await chromium.launch({ executablePath });
const artifacts = resolve("test-results");
const firstPassword = "sampdf-sandstone-59";
const newPassword = "sampdf-stonework-78";
const pdfType = "application/pdf";
const errors = [];

function button(page, name) { return page.getByRole("button", { name, exact: true }); }
function preview(page) { return page.getByRole("dialog", { name: "Document preview", exact: true }); }
async function download(page, scope, name) {
  const link = scope.getByRole("link", { name, exact: true });
  await link.waitFor().catch(async (error) => {
    throw new Error(`Download '${name}' was unavailable. ${await page.getByRole("alert").allTextContents()}`, { cause: error });
  });
  const [result] = await Promise.all([page.waitForEvent("download"), link.click()]);
  assert.equal(await result.failure(), null);
  return { name: result.suggestedFilename(), bytes: await readFile(await result.path()) };
}
async function audit(page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(violations.filter(({ impact }) => impact === "serious" || impact === "critical").map(({ id, nodes }) => [id, nodes.map(({ target }) => target)]), []);
}
async function specimen(name, widths, picture, rotation = 0) {
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(picture);
  for (const [index, width] of widths.entries()) {
    const page = doc.addPage([width, 1050]);
    page.setRotation(degrees(rotation));
    page.drawText(`${name} page ${index + 1}`, { x: 30, y: 1002, size: 12 });
    page.drawImage(image, { x: 30, y: 955, width: 36, height: 26 });
  }
  return { name, mimeType: pdfType, buffer: Buffer.from(await doc.save()) };
}
async function compareEncrypted(original, protectedBytes, label, password) {
  const sourcePath = resolve(artifacts, `${label}-source.pdf`);
  const protectedPath = resolve(artifacts, `${label}-protected.pdf`);
  await writeFile(sourcePath, original);
  await writeFile(protectedPath, protectedBytes);
  execFileSync(python, ["-c", `import sys, pymupdf
source = pymupdf.open(sys.argv[1])
secured = pymupdf.open(sys.argv[2])
assert secured.needs_pass and not secured.authenticate('a deliberate wrong passphrase')
assert secured.authenticate(sys.argv[3]) == 2
assert '256-bit AES' in secured.metadata['encryption']
assert len(source) == len(secured)
for before, after in zip(source, secured):
    assert before.rect == after.rect and before.get_text() == after.get_text()
    assert len(before.get_images()) == len(after.get_images())
    assert before.get_pixmap().samples == after.get_pixmap().samples
`, sourcePath, protectedPath, password]);
}
async function protect(page, root, password, name, bundle = false) {
  await root.getByLabel("Password", { exact: true }).fill(password);
  await root.getByLabel("Confirm password", { exact: true }).fill("mismatched-secret-1");
  const action = button(root, bundle ? "Protect PDFs" : "Protect PDF");
  await action.click();
  await root.getByRole("alert").filter({ hasText: "passwords do not match" }).waitFor();
  await root.getByLabel("Confirm password", { exact: true }).fill(password);
  await action.click();
  const output = await download(page, root, bundle ? "Download protected ZIP" : "Download protected PDF");
  assert.equal(output.name, name);
  return output.bytes;
}
async function selectedBox(page) {
  return page.locator('.editor-mark[data-selected="true"] .editor-box-content').evaluate((element) =>
    ["x", "y", "width", "height"].map((key) => Number(element.getAttribute(key))));
}
async function locationOf(handle) {
  return handle.evaluate((element) => { const matrix = element.getScreenCTM(); return { x: matrix.e, y: matrix.f }; });
}
async function dragMouse(page, handle, dx, dy) {
  await handle.scrollIntoViewIfNeeded();
  const { x, y } = await locationOf(handle);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

try {
  await mkdir(artifacts, { recursive: true });
  const desktopContext = await browser.newContext({ viewport: { width: 1400, height: 920 }, acceptDownloads: true });
  const desktop = await desktopContext.newPage();
  desktop.on("pageerror", (error) => errors.push(error.message));
  await desktop.goto(`${origin}/tools/merge`);
  const image = await desktop.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 24;
    const paint = canvas.getContext("2d");
    paint.fillStyle = "#c18d2c";
    paint.fillRect(0, 0, 32, 24);
    return canvas.toDataURL().split(",")[1];
  });
  const png = Buffer.from(image, "base64");
  const first = await specimen("crochet.pdf", [560, 570], png);
  const second = await specimen("linen.pdf", [580], png);
  const third = await specimen("satin.pdf", [590, 600], png);
  const upload = desktop.locator('input[type="file"]');
  await upload.setInputFiles([first, second]);
  await desktop.locator(".merge-gallery .thumbnail canvas:not([hidden])").nth(1).waitFor();
  await desktop.screenshot({ path: resolve(artifacts, "merge-gallery-desktop.png"), fullPage: true });
  const firstCard = desktop.locator(".merge-gallery li").filter({ hasText: first.name });
  assert.match(await firstCard.innerText(), /2 pages/);
  const originalCanvas = await firstCard.locator("canvas").elementHandle();
  for (const file of [first, second]) {
    await button(desktop, `Preview ${file.name}`).click();
    const source = desktop.getByRole("dialog", { name: "Uploaded PDF preview" });
    await source.locator('.pdf-sheet canvas[aria-label="Rendered PDF page 1"]').waitFor();
    assert.match(await source.innerText(), new RegExp(file.name));
    if (file === first) {
      await button(source, "Next page").click();
      await source.locator('.pdf-sheet canvas[aria-label="Rendered PDF page 2"]').waitFor();
      await button(source, "Zoom in").click();
      await source.getByText("125%", { exact: true }).waitFor();
      await button(source, "Expand preview").click();
      await button(source, "Scroll pages").click();
      const scroll = source.getByRole("region", { name: "Scroll through PDF pages" });
      await scroll.locator('.pdf-sheet canvas[aria-label="Rendered PDF page 2"]').waitFor();
      await scroll.evaluate((element) => { element.scrollTop = 0; });
      await scroll.locator('.pdf-sheet canvas[aria-label="Rendered PDF page 1"]').waitFor();
    }
    await button(source, "Close preview").click();
  }
  await button(desktop, "Remove linen.pdf").click();
  await upload.setInputFiles(third);
  await desktop.locator(".merge-gallery .thumbnail canvas:not([hidden])").nth(1).waitFor();
  await button(desktop, "Preview satin.pdf").click();
  await desktop.getByRole("dialog", { name: "Uploaded PDF preview" }).locator(".pdf-sheet:not([hidden]) canvas").waitFor();
  await button(desktop, "Close preview").click();
  await button(desktop, "List view").click();
  await button(desktop, "Move satin.pdf earlier").click();
  assert.equal(await firstCard.locator("canvas").evaluate((element, original) => element === original, originalCanvas), true);
  assert.match(await desktop.locator(".merge-gallery li").first().innerText(), /satin.pdf/);
  await button(desktop, "Grid view").click();
  await audit(desktop);
  await button(desktop, "Merge PDFs").click();
  const result = preview(desktop);
  await result.locator(".pdf-sheet:not([hidden]) canvas").waitFor();
  await result.getByLabel("Filename").fill("Client portfolio");
  const exported = await download(desktop, result, "Download PDF");
  assert.equal(exported.name, "Client portfolio.pdf");
  assert.deepEqual((await PDFDocument.load(exported.bytes)).getPages().map((page) => page.getWidth()), [590, 600, 560, 570]);
  const resultCanvas = await result.locator(".pdf-sheet canvas").elementHandle();
  await button(result, "Protect with Password").click();
  let passwordDialog = desktop.getByRole("dialog", { name: "Protect with password" });
  await passwordDialog.getByLabel("Password", { exact: true }).fill("cancelled-test-45");
  await desktop.keyboard.press("Escape");
  await passwordDialog.waitFor({ state: "hidden" });
  assert.equal(await result.isVisible(), true);
  await button(result, "Protect with Password").click();
  await passwordDialog.getByLabel("Password", { exact: true }).waitFor();
  assert.equal(await passwordDialog.getByLabel("Password", { exact: true }).inputValue(), "");
  await button(passwordDialog, "Show password").click();
  assert.equal(await passwordDialog.getByLabel("Password", { exact: true }).getAttribute("type"), "text");
  await button(passwordDialog, "Hide password").click();
  const encryptedMerge = await protect(desktop, passwordDialog, firstPassword, "Client portfolio.pdf");
  await compareEncrypted(exported.bytes, encryptedMerge, "merge-encryption", firstPassword);
  await button(passwordDialog, "Done").click();
  assert.equal(await result.locator(".pdf-sheet canvas").evaluate((element, original) => element === original, resultCanvas), true);
  await audit(desktop);

  await desktop.goto(`${origin}/tools/protect`);
  await desktop.getByLabel("Upload PDF to protect").setInputFiles(first);
  await desktop.locator(".pdf-sheet:not([hidden]) canvas").waitFor();
  const protectedStandalone = await protect(desktop, desktop, firstPassword, "crochet-protected.pdf");
  await compareEncrypted(first.buffer, protectedStandalone, "standalone-encryption", firstPassword);
  await desktop.getByLabel("Upload PDF to protect").setInputFiles({ name: "locked.pdf", mimeType: pdfType, buffer: protectedStandalone });
  const currentPassword = desktop.getByLabel("Current PDF password", { exact: true });
  await currentPassword.waitFor();
  await currentPassword.fill("incorrect-input-password");
  await button(desktop, "Unlock preview").click();
  await desktop.getByText("The current PDF password is incorrect.").waitFor();
  assert.equal(await desktop.locator(".pdf-sheet:not([hidden]) canvas").count(), 0);
  await currentPassword.fill(firstPassword);
  await button(desktop, "Unlock preview").click();
  await desktop.locator(".pdf-sheet:not([hidden]) canvas").waitFor();
  const reprotected = await protect(desktop, desktop, newPassword, "locked-protected.pdf");
  await compareEncrypted(first.buffer, reprotected, "password-change", newPassword);
  await audit(desktop);

  await desktop.goto(`${origin}/tools/split`);
  await upload.setInputFiles(first);
  await desktop.getByLabel("Page ranges").fill("1, 2");
  await button(desktop, "Split PDF").click();
  const split = preview(desktop);
  const archive = unzipSync((await download(desktop, split, "Download ZIP")).bytes);
  await button(split, "Protect each PDF").click();
  passwordDialog = desktop.getByRole("dialog", { name: "Protect with password" });
  await passwordDialog.getByText("The ZIP itself can still be opened without a password.", { exact: false }).waitFor();
  const encryptedArchive = unzipSync(await protect(desktop, passwordDialog, firstPassword, "sampdf-split.zip", true));
  assert.deepEqual(Object.keys(encryptedArchive), Object.keys(archive));
  for (const [part, bytes] of Object.entries(encryptedArchive)) await compareEncrypted(archive[part], bytes, part, firstPassword);

  await desktop.goto(`${origin}/tools/edit`);
  await desktop.locator('input[type="file"]').first().setInputFiles(third);
  await desktop.locator(".editor .pdf-sheet:not([hidden]) canvas").waitFor();
  await button(desktop, "Zoom in editor").click();
  await desktop.locator(".editor .pdf-stage").press("Tab");
  await button(desktop, "Add text box").click();
  const edge = (name) => desktop.locator(`.editor-mark[data-selected="true"] [data-gesture="${name}"]`);
  assert.equal(await desktop.locator(".editor-resize-handle").count(), 8);
  let box = await selectedBox(desktop);
  await dragMouse(desktop, edge("e"), -55, 0);
  let resized = await selectedBox(desktop);
  assert.ok(resized[2] < box[2] && Math.abs(resized[3] - box[3]) < .0001);
  box = resized;
  await dragMouse(desktop, edge("s"), 0, 29);
  resized = await selectedBox(desktop);
  assert.ok(resized[3] > box[3] && Math.abs(resized[2] - box[2]) < .0001);
  await dragMouse(desktop, edge("nw"), 12, 10);
  box = await selectedBox(desktop);
  assert.ok(box[0] > resized[0] && box[1] > resized[1] && box[2] < resized[2] && box[3] < resized[3]);
  await dragMouse(desktop, edge("move"), 36, 16);
  resized = await selectedBox(desktop);
  assert.ok(resized[0] > box[0] && resized[1] > box[1]);
  await desktop.locator(".editor .pdf-stage").press("ArrowRight");
  box = await selectedBox(desktop);
  assert.ok(Math.abs(box[0] - resized[0] - 1) < .001);
  const text = "Long text continues to wrap in the resized box, and the chosen font size holds steady across every line.";
  await button(desktop, "Type on page").click();
  await desktop.getByRole("textbox", { name: "Type in text box" }).fill(text);
  await desktop.getByRole("textbox", { name: "Type in text box" }).press("Escape");
  assert.equal(await desktop.getByLabel("Font size", { exact: true }).inputValue(), "20");
  assert.ok(await desktop.locator(".editor-mark tspan").count() >= 2);
  const [x, y, width, height] = await selectedBox(desktop);
  await button(desktop, "Preview edited PDF").click();
  const edited = await download(desktop, preview(desktop), "Download PDF");
  const document = await PDFDocument.load(edited.bytes);
  const contents = document.getPage(0).node.Contents();
  const body = Buffer.from(decodePDFRawStream(contents.lookup(contents.size() - 1)).decode()).toString();
  const clip = /([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re\s+W/.exec(body);
  assert.ok(clip, body);
  assert.ok([x, 1050 - y - height, width, height].every((value, index) => Math.abs(value - Number(clip[index + 1])) < .0001), body);
  assert.match(body, /20 Tf/);
  await button(preview(desktop), "Close preview").click();
  await button(desktop, "Rotate selected page").click();
  await desktop.locator('.editor-overlay[viewBox="0 0 1050 590"]').waitFor();
  const beforeRotateMove = await selectedBox(desktop);
  await dragMouse(desktop, edge("move"), 19, 15);
  const rotated = await selectedBox(desktop);
  assert.ok(rotated[0] > beforeRotateMove[0] && rotated[1] < beforeRotateMove[1]);
  await button(desktop, "Preview edited PDF").click();
  const rotatedExport = await PDFDocument.load((await download(desktop, preview(desktop), "Download PDF")).bytes);
  assert.equal(rotatedExport.getPage(0).getRotation().angle, 90);
  const rotatedContent = rotatedExport.getPage(0).node.Contents();
  const rotatedBody = Buffer.from(decodePDFRawStream(rotatedContent.lookup(rotatedContent.size() - 1)).decode()).toString();
  const rotatedClip = /([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re\s+W/.exec(rotatedBody);
  assert.ok(rotatedClip && [rotated[0], 1050 - rotated[1] - rotated[3], rotated[2], rotated[3]].every((value, index) => Math.abs(value - Number(rotatedClip[index + 1])) < .0001));
  await desktopContext.close();

  for (const width of [360, 390, 430, 768]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: "reduce", acceptDownloads: true });
    const phone = await context.newPage();
    phone.on("pageerror", (error) => errors.push(error.message));
    await phone.goto(`${origin}/tools/edit`);
    const fileChooser = phone.waitForEvent("filechooser");
    await button(phone, "Choose file").tap();
    await (await fileChooser).setFiles(first);
    await phone.locator(".editor .pdf-sheet:not([hidden]) canvas").waitFor().catch(async (error) => {
      throw new Error(`Editor preview at ${width}px. ${await phone.getByRole("alert").allTextContents()} ${errors.join(" ")}`, { cause: error });
    });
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (width < 760) {
      const toolbar = phone.getByRole("navigation", { name: "Mobile editor tools" });
      await button(toolbar, "Pages").tap();
      await button(phone, "Select page 2").tap();
      await phone.locator('.editor .pdf-sheet canvas[aria-label="Rendered PDF page 2"]').waitFor();
      await button(toolbar, "Add text").tap();
      await phone.getByLabel("Overlay text").fill("Touch resize test");
      await button(toolbar, "Select").tap();
      const stage = phone.locator(".editor .pdf-stage");
      await stage.evaluate((element) => { element.scrollIntoView({ block: "center" }); });
      const before = await selectedBox(phone);
      const view = await stage.boundingBox();
      const grip = phone.locator('.editor-mark[data-selected="true"] [data-gesture="move"]');
      const move = await locationOf(grip);
      const touch = await context.newCDPSession(phone);
      async function gesture(point, dx, dy) {
        await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
        for (let step = 1; step <= 10; step++) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x + dx * step / 10, y: point.y + dy * step / 10 }] });
        await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      }
      const startingScroll = await stage.evaluate((element) => element.scrollTop);
      await stage.evaluate((element) => {
        window.editCanvas = element.querySelector(".pdf-sheet canvas");
        window.editVisibilityChanges = 0;
        const observation = new MutationObserver((records) => { window.editVisibilityChanges += records.length; });
        observation.observe(window.editCanvas.parentElement, { attributeFilter: ["hidden"] });
        observation.observe(window.editCanvas, { attributeFilter: ["width", "height"] });
      });
      await gesture(move, -20, -25);
      const moved = await selectedBox(phone);
      assert.ok(moved[0] < before[0] && moved[1] < before[1], JSON.stringify({ width, before, moved, move, view }));
      assert.equal(await stage.evaluate((element) => element.scrollTop), startingScroll);
      const handle = phone.locator('.editor-mark[data-selected="true"] [data-gesture="e"]');
      await gesture(await locationOf(handle), -19, 0);
      const resizedBox = await selectedBox(phone);
      assert.ok(resizedBox[2] < moved[2] && Math.abs(resizedBox[3] - moved[3]) < .001);
      assert.deepEqual(await stage.evaluate((element) => [element.querySelector(".pdf-sheet canvas") === window.editCanvas, window.editVisibilityChanges]), [true, 0]);
      if (width === 390) await phone.screenshot({ path: resolve(artifacts, "edit-touch-handles.png") });
      await stage.evaluate((element) => {
        window.editorScrollEnded = false;
        element.addEventListener("scrollend", () => { window.editorScrollEnded = true; }, { once: true });
      });
      await gesture({ x: view.x + 18, y: view.y + view.height * .72 }, 0, -100);
      await phone.waitForFunction(() => window.editorScrollEnded && document.querySelector(".editor .pdf-stage").scrollTop > 0);
      await touch.detach();
      await button(phone, "Download").tap();
      const exported = await download(phone, preview(phone), "Download PDF").catch((error) => {
        throw new Error(`Edited PDF download at ${width}px failed.`, { cause: error });
      });
      assert.equal((await PDFDocument.load(exported.bytes)).getPageCount(), 2);
    }
    await audit(phone);
    console.log(`Passed ${width}px editor layout${width < 760 ? ", touch gestures and download" : ""}.`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log("Upload gallery, touch editing, exact PDF geometry, browser AES-256 protection, protected ZIP contents, and accessibility passed.");
} finally {
  await browser.close();
}
