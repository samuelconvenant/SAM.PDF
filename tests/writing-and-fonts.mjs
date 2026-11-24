import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright";

const origin = process.env.SAMPDF_TEST_ORIGIN ?? "http://127.0.0.1:3000";
const executablePath = process.env.SAMPDF_BROWSER ?? (process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : undefined);
const python = process.env.SAMPDF_PYTHON ?? resolve(".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const mod = process.platform === "darwin" ? "Meta" : "Control";
const browser = await chromium.launch({ executablePath });
const errors = [];
const button = (scope, name) => scope.getByRole("button", { name, exact: true });
const preview = (page) => page.getByRole("dialog", { name: "Document preview", exact: true });
const picker = (page) => page.locator('summary[aria-label^="Font picker,"]:visible');

async function font(page, name) {
  await picker(page).click();
  await page.getByLabel("Search fonts").fill(name);
  await page.getByLabel("Font family", { exact: true }).selectOption(name);
  await page.locator(`summary[aria-label="Font picker, ${name}"]:visible`).waitFor();
}

async function number(page, name, value) {
  const field = page.getByLabel(name, { exact: true });
  await field.fill(String(value));
  await field.press("Enter");
}

async function saveDownload(page, click) {
  const [download] = await Promise.all([page.waitForEvent("download"), click()]);
  assert.equal(await download.failure(), null);
  return { name: download.suggestedFilename(), buffer: await readFile(await download.path()) };
}

async function exportPdf(page, action) {
  await button(page, action).click();
  const link = preview(page).getByRole("link", { name: "Download PDF", exact: true });
  try { await link.waitFor(); } catch (error) { throw new Error((await page.getByRole("alert").allTextContents()).join(" "), { cause: error }); }
  return (await saveDownload(page, () => link.click())).buffer;
}

async function upload(page, file) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), button(page, "Choose file").click()]);
  await chooser.setFiles(file);
  await page.locator(".editor .pdf-sheet:not([hidden]) canvas").waitFor();
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/tools/create`);
  const draft = page.getByRole("textbox", { name: "Document page" });
  await draft.click();
  await page.keyboard.type("h");
  assert.equal(await draft.textContent(), "H");
  await page.keyboard.press(`${mod}+Z`);
  assert.equal(await draft.textContent(), "");
  await page.keyboard.type("hello everyone. i am a student? yes! okay.");
  assert.match(await draft.textContent(), /^Hello everyone\. I am a student\? Yes! Okay\./);
  await page.keyboard.press("Enter");
  await page.keyboard.type("dr. reed scored 3.14. it worked.");
  assert.equal(await draft.locator("p").last().textContent(), "Dr. reed scored 3.14. It worked.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("name@example.com replied. https://example.com/path stays. www.example.org is another.");
  assert.equal(await draft.locator("p").last().textContent(), "name@example.com replied. https://example.com/path stays. www.example.org is another.");
  await page.keyboard.press("Enter");
  await page.evaluate(() => navigator.clipboard.writeText("keep this pasted casing. leave it unchanged."));
  await page.keyboard.press(`${mod}+V`);
  assert.equal(await draft.locator("p").last().textContent(), "keep this pasted casing. leave it unchanged.");
  await page.locator('summary[aria-label="Writing settings"]').click();
  await page.getByLabel("Auto-capitalize sentences").uncheck();
  await draft.focus();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("quiet. no change.");
  assert.equal(await draft.locator("p").last().textContent(), "quiet. no change.");
  await page.reload();
  await draft.waitFor().catch(async (error) => { throw new Error(`${errors.join(" ")} ${await page.locator("main").textContent()}`, { cause: error }); });
  await page.locator('summary[aria-label="Writing settings"]').click();
  assert.equal(await page.getByLabel("Auto-capitalize sentences").isChecked(), false);
  await draft.click();
  await page.keyboard.insertText("Embedded heading");
  await page.keyboard.press(`${mod}+A`);
  for (const key of ["B", "I", "U"]) await page.keyboard.press(`${mod}+${key}`);
  assert.equal(await draft.locator("strong em u, strong u em, em strong u, em u strong, u strong em, u em strong").textContent(), "Embedded heading");
  for (const [key, alignment] of [["E", "center"], ["R", "right"], ["J", "justify"], ["L", "left"]]) {
    await page.keyboard.press(`${mod}+${key}`);
    assert.equal(await draft.locator("p").first().evaluate((element) => element.style.textAlign || "left"), alignment);
  }
  await font(page, "Playfair Display");
  await number(page, "Font size", 25);
  await page.waitForFunction(() => document.activeElement?.classList.contains("create-document"));
  await page.locator('summary[aria-label="Text highlight options"]').click();
  await button(page, "Yellow highlight").click();
  await page.waitForFunction(() => document.activeElement?.classList.contains("create-document"));
  await page.keyboard.press(`${mod}+C`);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "Embedded heading");
  assert.match(await page.evaluate(async () => {
    for (const item of await navigator.clipboard.read()) if (item.types.includes("text/html")) return (await item.getType("text/html")).text();
    return "";
  }), /Playfair Display/);
  await page.keyboard.press(`${mod}+X`);
  assert.equal((await draft.textContent()).trim(), "");
  await page.keyboard.press(`${mod}+V`);
  assert.equal((await draft.textContent()).trim(), "Embedded heading");
  await page.keyboard.press(`${mod}+Z`);
  assert.equal((await draft.textContent()).trim(), "");
  await page.keyboard.press(`${mod}+Y`);
  assert.equal((await draft.textContent()).trim(), "Embedded heading");
  await page.keyboard.press(`${mod}+Z`);
  await page.keyboard.press(`${mod}+Shift+Z`);
  assert.equal((await draft.textContent()).trim(), "Embedded heading");
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.press(`${mod}+Enter`);
  assert.equal(await draft.locator("[data-paper-break]").count(), 1);
  await page.keyboard.insertText("Mono specimen");
  await page.keyboard.press("Shift+Home");
  await font(page, "JetBrains Mono");
  await picker(page).click();
  await page.locator('.recent-fonts').getByRole("button", { name: "Playfair Display", exact: true }).waitFor();
  await page.getByLabel("Search fonts").press("Escape");
  await draft.locator("p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await button(page, "Insert table").click();
  await draft.locator("th").first().click();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest("th")?.cellIndex), 1);
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest("th")?.cellIndex), 0);
  const before = await draft.evaluate((element) => element.editor.getJSON());
  const saved = await saveDownload(page, () => page.keyboard.press(`${mod}+S`));
  assert.equal(saved.name, "sampdf-draft.json");
  assert.deepEqual(JSON.parse(saved.buffer).document, before);
  await page.reload();
  const [draftChooser] = await Promise.all([page.waitForEvent("filechooser"), button(page, "Open draft").click()]);
  await draftChooser.setFiles({ name: saved.name, buffer: saved.buffer, mimeType: "application/json" });
  await page.getByRole("status").filter({ hasText: "Saved draft opened" }).waitFor({ state: "attached" });
  assert.deepEqual(await draft.evaluate((element) => element.editor.getJSON()), before);
  const created = await exportPdf(page, "Preview PDF");

  const doc = await PDFDocument.create();
  const source = doc.addPage([590, 1050]);
  source.drawText("Original text", { x: 32, y: 980 });
  const fixture = { name: "typography.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
  await page.goto(`${origin}/tools/edit`);
  await upload(page, fixture);
  await button(page, "Add text box").click();
  const mark = page.locator('.editor-mark[data-overlay-kind="text"]');
  assert.equal(await mark.evaluate((item) => getComputedStyle(item).filter), "none");
  const beforeDrag = Number(await mark.locator(".editor-box-content").getAttribute("x"));
  const box = await mark.locator(".editor-box-content").boundingBox();
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .4 + 35, box.y + box.height * .45 + 18, { steps: 10 });
  await page.mouse.up();
  assert.ok(Number(await mark.locator(".editor-box-content").getAttribute("x")) > beforeDrag);
  await mark.locator(".editor-box-content").dblclick({ position: { x: 35, y: 15 } });
  const inline = page.getByRole("textbox", { name: "Type in text box" });
  await inline.waitFor();
  assert.equal(await mark.locator("text").count(), 0);
  await inline.fill("Merriweather sample");
  await inline.press("Escape");
  await font(page, "Merriweather");
  await number(page, "Font size", 27);
  for (const label of ["Bold", "Italic", "Underline"]) await button(page, label).click();
  await page.getByLabel("Color", { exact: true }).fill("#053e52");
  await page.locator('summary[aria-label="Text highlight options"]').click();
  await button(page, "Pink highlight").click();
  assert.equal(await mark.locator("text").getAttribute("fill"), "#053e52");
  assert.equal(await mark.locator("text").getAttribute("font-weight"), "700");
  const edited = await exportPdf(page, "Preview edited PDF");

  await mkdir(resolve("test-results"), { recursive: true });
  const createdPath = resolve("test-results/writing-fonts-created.pdf");
  const editedPath = resolve("test-results/writing-fonts-edited.pdf");
  await writeFile(createdPath, created);
  await writeFile(editedPath, edited);
  execFileSync(python, ["-c", `import pymupdf, sys
from pathlib import Path
def spans(page):
    return [s for b in page.get_text('dict')['blocks'] for l in b.get('lines', []) for s in l['spans']]
with pymupdf.open(sys.argv[1]) as doc:
    assert len(doc) == 2
    heading = next(s for s in spans(doc[0]) if 'Embedded heading' in s['text'])
    assert 'Playfair' in heading['font'] and abs(heading['size']-25)<.01, heading
    assert any('JetBrains' in s['font'] and 'Mono specimen' in s['text'] for s in spans(doc[1]))
    assert any('Playfair' in f[3] and '+' in f[3] for f in doc[0].get_fonts())
with pymupdf.open(sys.argv[2]) as doc:
    span = next(s for s in spans(doc[0]) if s['text'] == 'Merriweather sample')
    assert 'Merriweather' in span['font'] and abs(span['size']-27)<.01 and span['color'] == 0x053e52, span
    face = next(f for f in doc[0].get_fonts() if 'Merriweather-BoldItalic' in f[3])
    assert 0 < len(doc.extract_font(face[0])[-1]) < Path('public/document-fonts/merriweather-boldItalic.ttf').stat().st_size
    assert any(d['fill'] and d['fill'][0] > .98 and .7 < d['fill'][1] < .83 for d in doc[0].get_drawings())
    assert any(d['type'] == 's' and d['color'] and abs(d['color'][1] - 62/255) < .01 for d in doc[0].get_drawings())
`, createdPath, editedPath]);
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const phone = await mobile.newPage();
  phone.on("pageerror", (error) => errors.push(error.message));
  await phone.goto(`${origin}/tools/edit`);
  await upload(phone, fixture);
  await button(phone, "Add text").tap();
  await phone.getByLabel("Overlay text").fill("Touch drag from the text itself");
  await button(phone, "Select").tap();
  const stage = phone.locator(".editor .pdf-stage");
  await stage.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const target = phone.locator(".editor-touch-body");
  const targetBox = await target.boundingBox();
  const start = { x: targetBox.x + targetBox.width * .45, y: targetBox.y + targetBox.height * .42 };
  const textBox = phone.locator(".editor-box-content");
  const initial = Number(await textBox.getAttribute("x"));
  const scroll = await stage.evaluate((element) => element.scrollTop);
  const canvas = await stage.locator("canvas").elementHandle();
  const touch = await mobile.newCDPSession(phone);
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
  for (let i = 1; i <= 10; i++) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x - i * 2, y: start.y - i * 2 }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert.ok(Number(await textBox.getAttribute("x")) < initial);
  assert.equal(await stage.evaluate((element) => element.scrollTop), scroll);
  assert.equal(await stage.locator("canvas").evaluate((element, original) => element === original, canvas), true);
  await button(phone, "Edit text").tap();
  assert.equal(await phone.getByLabel("Overlay text").evaluate((element) => document.activeElement === element), true);
  await phone.getByLabel("Overlay text").fill("Text remains editable");
  await button(phone, "Select").tap();
  assert.match(await textBox.textContent(), /Text remains editable/);
  await mobile.close();
  assert.deepEqual(errors, []);
  console.log("Passed capitalization, draft save and reopen, Word shortcuts, formatted clipboard, desktop and touch box dragging, and both font exports.");
} finally {
  await browser.close();
}
