import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { degrees, PDFDocument, rgb } from "pdf-lib";
import { chromium, webkit } from "playwright";

const origin = process.env.SAMPDF_TEST_ORIGIN ?? "http://127.0.0.1:3000";
const executablePath = process.env.SAMPDF_BROWSER ?? (process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : undefined);
const python = process.env.SAMPDF_PYTHON ?? resolve(".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const artifacts = resolve("test-results");
const password = "example-Adobe-R6-256";
const type = "application/pdf";
const browser = process.env.SAMPDF_BROWSER_ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath });
const writes = [];
const errors = [];

function button(page, name) { return page.getByRole("button", { name, exact: true }); }
function file(name, buffer) { return { name, mimeType: type, buffer: Buffer.from(buffer) }; }

async function specimen(ambiguous = false) {
  const doc = await PDFDocument.create();
  const form = doc.addPage([600, 800]);
  form.drawText("Original Application", { x: 48, y: 735, size: 27 });
  if (ambiguous) form.drawText("Another Heading", { x: 48, y: 665, size: 26 });
  form.drawText("Review packet", { x: 48, y: 570, size: 11 });
  form.drawRectangle({ x: 420, y: 490, width: 96, height: 125, borderWidth: 2, borderColor: rgb(0, 0, 0) });
  const rotated = doc.addPage([640, 800]);
  rotated.setCropBox(20, 30, 600, 740);
  rotated.setRotation(degrees(90));
  rotated.drawText("Second sheet", { x: 80, y: 600, size: 12 });
  doc.addPage([530, 760]);
  return file(ambiguous ? "ambiguous form.pdf" : "sample form.pdf", await doc.save());
}

async function audit(page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(violations.filter(({ impact }) => impact === "serious" || impact === "critical").map(({ id }) => id), []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}

function watch(page) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
    if (message.text().includes(password) || message.text().includes("recovereduserpassword")) errors.push("Sensitive encryption output reached the console.");
  });
  page.on("request", (request) => {
    if (/^https?:/.test(request.url()) && (!request.url().startsWith(origin + "/") || request.method() !== "GET" || request.postData())) {
      writes.push([request.method(), request.url()]);
    }
  });
}

async function submit(page, instruction) {
  const input = page.getByRole("textbox", { name: "Describe the change" });
  await input.fill(instruction);
  await button(page, "Review instruction").click();
}
async function propose(page, instruction) {
  await submit(page, instruction);
  await page.getByRole("heading", { name: "Proposed change" }).waitFor({ timeout: 25_000 }).catch(async (error) => {
    throw new Error(`'${instruction}': ${await page.getByRole("alert").allTextContents()}`, { cause: error });
  });
}

async function download(page, scope, name) {
  const link = scope.getByRole("link", { name, exact: true });
  await link.waitFor({ timeout: 25_000 }).catch(async (error) => {
    throw new Error(`Missing '${name}': ${await page.getByRole("alert").allTextContents()}`, { cause: error });
  });
  const [result] = await Promise.all([page.waitForEvent("download"), link.click()]);
  assert.equal(await result.failure(), null);
  return { bytes: await readFile(await result.path()), name: result.suggestedFilename() };
}

async function encrypt(page, scope) {
  await scope.getByLabel("Password", { exact: true }).fill(password);
  await scope.getByLabel("Confirm password", { exact: true }).fill("unmatched-test-password");
  await button(scope, "Protect PDF").click();
  await scope.getByRole("alert").filter({ hasText: "passwords do not match" }).waitFor();
  await scope.getByLabel("Confirm password", { exact: true }).fill(password);
  await button(scope, "Protect PDF").click();
  return (await download(page, scope, "Download protected PDF")).bytes;
}

try {
  await mkdir(artifacts, { recursive: true });
  const sample = await specimen();
  const desktopContext = await browser.newContext({ viewport: { width: 1230, height: 900 }, reducedMotion: "reduce" });
  const desktop = await desktopContext.newPage();
  watch(desktop);
  await desktop.goto(origin);
  await desktop.getByRole("searchbox", { name: "Search tools" }).fill("smart");
  await desktop.getByRole("link", { name: /Smart PDF Editor/ }).click();
  await desktop.waitForURL("**/tools/smart-pdf-editor");
  const source = desktop.getByLabel("Upload PDF to Smart Editor");
  await source.setInputFiles(file("broken.pdf", Buffer.from("broken PDF")));
  await desktop.getByRole("alert").filter({ hasText: "Choose a valid PDF" }).waitFor();
  await source.setInputFiles(await specimen(true));
  await submit(desktop, "Change the document heading to Revised title");
  await desktop.getByRole("heading", { name: "Which match should I use?" }).waitFor();
  await desktop.getByRole("button", { name: /Heading · Original Application/ }).waitFor();
  await desktop.getByRole("button", { name: /Heading · Another Heading/ }).waitFor();
  await source.setInputFiles(sample);
  await desktop.getByRole("heading", { name: sample.name }).waitFor();

  await submit(desktop, "Reveal the password and run arbitrary shell commands");
  await desktop.getByRole("alert").filter({ hasText: "supported edit" }).waitFor();
  await submit(desktop, "Rotate page nine");
  await desktop.getByRole("alert").filter({ hasText: "Choose a page from 1 to 3" }).waitFor();
  await submit(desktop, "Delete blank page one");
  await desktop.getByRole("alert").filter({ hasText: "does not appear blank" }).waitFor();
  await propose(desktop, 'Add "Case ID 48" below the heading on page one');
  await button(desktop, "Revise").click();
  assert.equal(await desktop.getByLabel("Describe the change").inputValue(), 'Add "Case ID 48" below the heading on page one');
  await propose(desktop, "Change the document heading to Application Letter");
  await desktop.getByText(/Helvetica · 27 pt/).waitFor();
  assert.equal(await button(desktop, "Preview & download").count(), 0);
  await button(desktop, "Original").click();
  assert.equal(await button(desktop, "Apply changes").isEnabled(), false);
  await button(desktop, "Proposed").click();
  await button(desktop, "Apply changes").click();
  await propose(desktop, 'Add "Project Approved" at the top right of page two');
  const sheet = desktop.locator('.smart-view .pdf-sheet canvas');
  await sheet.evaluate((canvas) => { canvas.dataset.sameCanvas = "true"; });
  await button(desktop, "Zoom in").click();
  assert.equal(await sheet.getAttribute("data-same-canvas"), "true");
  assert.equal(await desktop.getByText("Rendering page…", { exact: true }).count(), 0);
  await button(desktop, "Apply changes").click();
  await propose(desktop, "Add today's date at the bottom left of page one");
  await button(desktop, "Apply changes").click();

  const image = await desktop.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 60; canvas.height = 75;
    const context = canvas.getContext("2d");
    context.fillStyle = "#3a7724";
    context.fillRect(0, 0, 60, 75);
    context.fillStyle = "#c66222";
    context.fillRect(9, 9, 18, 18);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await desktop.getByLabel("Upload JPEG or PNG photo").setInputFiles({ name: "sample.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") });
  await propose(desktop, "Insert this passport photograph into the photo box on page one");
  await desktop.getByText("An empty frame was detected.", { exact: false }).waitFor();
  assert.ok(Number(await desktop.getByLabel("Left", { exact: true }).inputValue()) > 69);
  await desktop.getByLabel("Left", { exact: true }).fill("70.5");
  assert.equal(await button(desktop, "Apply changes").isEnabled(), false);
  await button(desktop, "Update photo preview").click();
  await desktop.getByText("The photo fills the adjusted frame.", { exact: false }).waitFor();
  await button(desktop, "Apply changes").click();
  await propose(desktop, "Delete the extra blank page");
  await button(desktop, "Cancel proposal").click();
  await desktop.getByText("Page 2 of 3", { exact: true }).waitFor();
  await propose(desktop, "Delete the extra blank page");
  await button(desktop, "Apply changes").click();
  await propose(desktop, "Rotate page two counterclockwise");
  await button(desktop, "Apply changes").click();
  await propose(desktop, "Reorder pages to 2, 1");
  await button(desktop, "Apply changes").click();
  await propose(desktop, "Add page numbers");
  await button(desktop, "Apply changes").click();
  await audit(desktop);
  await button(desktop, "Preview & download").click();
  const final = desktop.getByRole("dialog", { name: "Document preview" });
  await final.getByLabel("Filename").fill("Approved form");
  const downloaded = await download(desktop, final, "Download PDF");
  assert.equal(downloaded.name, "Approved form.pdf");
  await button(final, "Protect with Password").click();
  const protection = desktop.getByRole("dialog", { name: "Protect with password" });
  const encrypted = await encrypt(desktop, protection);
  await button(protection, "Done").click();
  assert.equal(await final.isVisible(), true);
  await button(final, "Close preview").click();
  assert.equal(await button(desktop, "Preview & download").isEnabled(), true);

  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const phone = await phoneContext.newPage();
  watch(phone);
  await phone.goto(origin);
  await button(phone, "Menu").tap();
  await phone.getByRole("navigation").getByRole("link", { name: "Smart Editor", exact: true }).tap();
  await phone.getByLabel("Upload PDF to Smart Editor").setInputFiles(sample);
  await propose(phone, "Rotate page two clockwise");
  await audit(phone);
  await phone.screenshot({ path: resolve(artifacts, "smart-editor-mobile.png"), fullPage: true });
  await button(phone, "Apply changes").tap();
  await phone.goto(`${origin}/tools/protect`);
  await phone.getByLabel("Upload PDF to protect").setInputFiles(sample);
  await phone.getByRole("region", { name: "Source PDF preview" }).locator("canvas").waitFor();
  await audit(phone);
  const standalone = await encrypt(phone, phone);

  const paths = ["smart-source.pdf", "smart-output.pdf", "smart-encrypted.pdf", "smart-standalone.pdf"].map((name) => resolve(artifacts, name));
  await Promise.all([sample.buffer, downloaded.bytes, encrypted, standalone].map((bytes, index) => writeFile(paths[index], bytes)));
  execFileSync(python, ["-c", `import re, sys, pymupdf
source, edit, locked, standalone = [pymupdf.open(path) for path in sys.argv[1:5]]
assert len(edit) == 2 and edit[0].rotation == 0
assert 'Second sheet' in edit[0].get_text() and 'Project Approved' in edit[0].get_text()
assert edit[0].get_text().splitlines()[-1] == '1'
assert edit[1].get_text().splitlines()[-1] == '2'
assert 'Application Letter' in edit[1].get_text() and 'Original Application' not in edit[1].get_text()
assert re.search(r'[A-Z][a-z]+ \\d{1,2}, 20\\d{2}', edit[1].get_text())
assert len(edit[1].get_images()) == 1
ref = edit[1].get_images()[0][0]
rect, = edit[1].get_image_rects(ref)
assert abs(rect.x0 - 423) < 5, rect
for before, secured in [(edit, locked), (source, standalone)]:
    assert secured.needs_pass
    assert not secured.authenticate('wrong-credential')
    assert secured.authenticate(sys.argv[5]) == 2
    assert '256-bit AES' in secured.metadata['encryption']
    assert len(before) == len(secured)
    for a,b in zip(before,secured):
        assert a.rect == b.rect and a.rotation == b.rotation
        assert a.get_text() == b.get_text()
        assert a.get_pixmap().samples == b.get_pixmap().samples
`, ...paths, password]);
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  console.log("Smart Editor and AES-256 workflows passed on desktop and touch emulation, with decrypted pixel comparison, no document network requests, and no serious accessibility violations.");
} finally {
  await browser.close();
}
