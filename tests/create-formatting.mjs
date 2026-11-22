import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const origin = process.env.SAMPDF_TEST_ORIGIN ?? "http://127.0.0.1:3000";
const executablePath = process.env.SAMPDF_BROWSER ?? (process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : undefined);
const python = process.env.SAMPDF_PYTHON ?? resolve(".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const browser = await chromium.launch({ executablePath });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  page.setDefaultTimeout(12_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/tools/create`);
  const draft = page.getByRole("textbox", { name: "Document page" });
  const button = (name) => page.getByRole("button", { name, exact: true });
  const paper = () => draft.evaluate((element) => element.editor.getJSON().content);
  const waitForDraftFocus = () => page.waitForFunction(() => document.activeElement?.classList.contains("create-document"));
  const applyNumber = async (label, value) => {
    await page.getByLabel(label, { exact: true }).fill(String(value));
    await page.getByLabel(label, { exact: true }).press("Enter");
  };
  const useFont = async (font) => {
    await page.locator('summary[aria-label^="Font picker,"]').click();
    await page.getByLabel("Search fonts").fill(font);
    await page.getByLabel("Font family", { exact: true }).selectOption(font);
  };
  const press = async (key) => { await page.keyboard.press(key); };
  async function drag(x, y, dx, dy) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 12 });
    await page.mouse.up();
  }

  await draft.click();
  await page.keyboard.insertText("Coloured title");
  await press("Shift+Home");
  await useFont("Times New Roman");
  await applyNumber("Font size", 24);
  await page.locator('summary[aria-label="Text colour options"]').click();
  await page.getByLabel("Text colour HEX").fill("#315477");
  await page.getByLabel("Text colour HEX").press("Enter");
  await page.locator('summary[aria-label="Text highlight options"]').click();
  await button("Yellow highlight").click();
  await waitForDraftFocus();
  await press("End");
  await press("Enter");
  await page.keyboard.insertText("Second family");
  assert.match(await draft.textContent(), /Second family/);
  await press("Shift+Home");
  await useFont("Courier New");
  await applyNumber("Font size", 16);
  await page.locator('summary[aria-label="Text highlight options"]').click();
  await page.getByLabel("Text highlight HEX").fill("#90cdab");
  await page.getByLabel("Text highlight HEX").press("Enter");
  await waitForDraftFocus();
  await press("End");
  await press("Enter");
  await button("Insert table").click();
  const header = draft.locator("th").first();
  await header.locator("p").click();
  await page.keyboard.insertText("Table header");
  const oldBounds = await header.boundingBox();
  await drag(oldBounds.x + oldBounds.width - 2, oldBounds.y + oldBounds.height / 2, -55, 0);
  const resized = await header.boundingBox();
  const width = (await paper()).find((node) => node.type === "table").content[0].content[0].attrs.colwidth;
  assert.ok(width?.[0] > 0 && resized.width < oldBounds.width - 10, JSON.stringify({ oldBounds, resized, width }));
  await header.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
  const afterScroll = await header.boundingBox();
  await page.mouse.move(afterScroll.x + afterScroll.width / 2, afterScroll.y + afterScroll.height / 2);
  const rowBeforeResize = await header.boundingBox();
  await drag(rowBeforeResize.x + rowBeforeResize.width / 2, rowBeforeResize.y + rowBeforeResize.height - 2, 0, 27);
  const rowHeight = (await paper()).find((node) => node.type === "table").content[0].attrs.rowHeight;
  assert.ok(rowHeight > rowBeforeResize.height + 15, JSON.stringify({ rowHeight, rowBeforeResize, errors }));
  const row = draft.locator("tr").first();
  const first = await row.locator("th").first().boundingBox();
  const second = await row.locator("th").last().boundingBox();
  await drag(first.x + first.width / 2, first.y + first.height / 2, first.width / 2 + second.width / 2, 0);
  await button("Merge cells").click();
  assert.equal(await row.locator("th").count(), 1);
  await row.locator("th p").first().click();
  await button("Split cell").click();
  assert.equal(await row.locator("th").count(), 2);
  await header.locator("p").first().click();
  await applyNumber("Table width %", 72);
  await applyNumber("Border thickness", 3);
  await applyNumber("Cell padding", 12);
  await page.getByLabel("Border colour").fill("#591b79");
  await page.getByLabel("Cell background").fill("#eed6a7");
  await page.getByLabel("Cell text alignment").selectOption("center");
  await page.getByLabel("Cell vertical alignment").selectOption("middle");
  await button("Add row").click();
  await draft.locator("tr").nth(1).locator("td p").first().click();
  await button("Delete row").click();
  await header.locator("p").first().click();
  await button("Move table up").click();
  await button("Move table down").click();
  assert.equal((await paper()).find((node) => node.type === "table").attrs.widthPercent, 72);
  await draft.locator(":scope > p").last().click();
  await press("End");
  await press("Enter");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 180;
    canvas.height = 90;
    const context = canvas.getContext("2d");
    ["#d12124", "#257435", "#244bba"].forEach((color, index) => {
      context.fillStyle = color;
      context.fillRect(index * 60, 0, 60, 90);
    });
    return canvas.toDataURL().split(",")[1];
  });
  const picture = { name: "stripes.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") };
  await page.getByLabel("Import document image").setInputFiles(picture);
  const image = draft.locator(".draft-image-frame").first();
  await image.click();
  assert.equal(await image.locator(".draft-image-handle:visible").count(), 8);
  const replacementChooser = page.waitForEvent("filechooser");
  await button("Replace image").click();
  await (await replacementChooser).setFiles({ ...picture, name: "replacement.png" });
  await image.getByRole("img", { name: "replacement.png" }).waitFor();
  await page.getByLabel("Image layout").selectOption("floating");
  await applyNumber("Image left", 245);
  await applyNumber("Image top", 310);
  await image.scrollIntoViewIfNeeded();
  const initial = await image.boundingBox();
  await drag(initial.x + initial.width / 2, initial.y + initial.height / 2, 28, 20);
  const floating = (await paper()).find((node) => node.type === "image").attrs;
  assert.ok(floating.x > 265 && floating.y > 325, JSON.stringify(floating));
  const corner = image.locator('[data-edge="se"]');
  await corner.hover();
  let handle = await corner.boundingBox();
  await drag(handle.x + handle.width / 2, handle.y + handle.height / 2, 25, 14);
  const larger = (await paper()).find((node) => node.type === "image").attrs;
  assert.ok(larger.width > floating.width + 15 && Math.abs(larger.width / larger.height - 2) < .02, JSON.stringify({ ...larger, src: "[local image]" }));
  await page.getByLabel("Lock aspect ratio").uncheck();
  await applyNumber("Image height", 96);
  await button("Crop image").click();
  await image.scrollIntoViewIfNeeded();
  const right = image.locator('[data-edge="e"]');
  await right.hover();
  handle = await right.boundingBox();
  await drag(handle.x + handle.width / 2, handle.y + handle.height / 2, -48, 0);
  const cropped = (await paper()).find((node) => node.type === "image").attrs;
  assert.ok(cropped.crop[2] > .16);
  await button("Crop image").click();
  await button("Duplicate image").click();
  assert.equal(await draft.locator(".draft-image-frame").count(), 2);
  const layers = async () => (await paper()).filter((node) => node.type === "image").map((node) => node.attrs.layer);
  const duplicateLayers = await layers();
  await button("Bring forward").click();
  assert.deepEqual(await layers(), [duplicateLayers[0], duplicateLayers[1] + 1]);
  await button("Send backward").click();
  assert.deepEqual(await layers(), duplicateLayers);
  await button("Remove image").click();
  assert.equal(await draft.locator(".draft-image-frame").count(), 1);
  await image.click();
  await applyNumber("Image rotation", 15);
  const attrs = (await paper()).find((node) => node.type === "image").attrs;
  assert.equal(attrs.angle, 15);

  const draftState = await paper();
  const formattedHeader = draftState.find((node) => node.type === "table").content[0].content[0];
  assert.equal(formattedHeader.attrs.background, "#eed6a7");
  assert.equal(formattedHeader.attrs.cellAlign, "center");
  assert.equal(formattedHeader.attrs.vertical, "middle");
  await button("Preview PDF").click();
  const dialog = page.getByRole("dialog", { name: "Document preview" });
  await dialog.locator(".pdf-sheet:not([hidden]) canvas").waitFor({ timeout: 35_000 });
  await mkdir(resolve("test-results"), { recursive: true });
  const pdfPath = resolve("test-results/create-formatting.pdf");
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Download PDF" }).click();
  await (await downloaded).saveAs(pdfPath);
  assert.equal(await dialog.isVisible(), true);
  await button("Close preview").click();
  assert.deepEqual(await paper(), draftState);

  execFileSync(python, ["-c", `import math, pymupdf, sys
page = pymupdf.open(sys.argv[1])[0]
spans = {s['text'].strip():s for b in page.get_text('dict')['blocks'] for l in b.get('lines',[]) for s in l['spans']}
assert spans['Coloured title']['color'] == 0x315477 and spans['Coloured title']['size'] == 24 and 'Times' in spans['Coloured title']['font'], spans
assert spans['Second family']['size'] == 16 and 'Courier' in spans['Second family']['font'], spans
def rgb(n): return tuple(int(n[i:i+2],16)/255 for i in (0,2,4))
def color_match(actual, target): return actual and max(abs(a-b) for a,b in zip(actual,rgb(target)))<.012
drawings=page.get_drawings()
for key,color in [('fill','fff181'),('fill','90cdab'),('fill','eed6a7'),('color','591b79')]:
    assert any(color_match(d[key],color) for d in drawings), (key,color)
assert any(d['width'] and abs(d['width']-2.25)<.03 for d in drawings)
table_edges = [d['rect'] for d in drawings if color_match(d['color'],'591b79')]
assert abs(max(r.x1 for r in table_edges)-min(r.x0 for r in table_edges)-499.28*.72)<1.5, table_edges
assert any(r.height >= float(sys.argv[6])*.75 - 1 for r in table_edges), table_edges
image = page.get_image_info()[0]['bbox']
x,y,w,h = map(float,sys.argv[2:6])
angle=math.radians(15)
assert all(abs(a-b)<.13 for a,b in zip(image,(48+x*.75,48+y*.75,48+(x+math.cos(angle)*w+math.sin(angle)*h)*.75,48+(y+math.sin(angle)*w+math.cos(angle)*h)*.75))), image
pix=page.get_pixmap()
sample_x=round((image[0]+image[2])/2+math.cos(angle)*w*.3*.75)
sample_y=round((image[1]+image[3])/2+math.sin(angle)*w*.3*.75)
red,green,blue=pix.pixel(sample_x,sample_y)[:3]
assert green>red+30 and green>blue+30, (red,green,blue)
`, pdfPath, String(attrs.x), String(attrs.y), String(attrs.width), String(attrs.height), String(rowHeight)]);
  assert.deepEqual(errors, []);
  console.log("Create PDF formatting, actual pointer gestures, preview continuity and exported PDF assertions passed.");
} finally {
  await browser.close();
}
