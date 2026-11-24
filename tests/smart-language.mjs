import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { chromium, webkit } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";

const origin = process.env.SAMPDF_TEST_ORIGIN ?? "http://127.0.0.1:3000";
const edge = process.env.SAMPDF_BROWSER ?? (process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : undefined);
const browser = process.env.SAMPDF_BROWSER_ENGINE === "webkit" ? await webkit.launch() :
  await chromium.launch({ executablePath: edge, args: process.env.SAMPDF_BROWSER_HOST_RULE ? ["--disable-quic", "--host-resolver-rules=" + process.env.SAMPDF_BROWSER_HOST_RULE] : [] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
context.setDefaultTimeout(35_000);
context.setDefaultNavigationTimeout(100_000);
const page = await context.newPage();
const network = [];
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (r) => {
  if (/^https?:/.test(r.url()) && (!r.url().startsWith(origin + "/") || r.method() !== "GET" || r.postData())) network.push(r.url());
});

const button = (name) => page.getByRole("button", { name, exact: true });
const choice = () => page.getByRole("heading", { name: "Which match should I use?", exact: true });
const input = () => page.getByRole("textbox", { name: "Describe the change" });
const python = process.env.SAMPDF_PYTHON ?? (process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");

async function open(doc, name) {
  const upload = { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
  await page.getByLabel("Upload PDF to Smart Editor").setInputFiles(upload);
  await page.getByRole("heading", { name, exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector(".smart-prompt textarea")?.readOnly === false);
}

async function ask(request) {
  await input().fill(request);
  await button("Review instruction").click();
}

async function review(request, count) {
  if (request) await ask(request);
  await page.getByRole("heading", { name: count === 1 ? "Proposed change" : "Proposed changes", exact: true }).waitFor().catch(async (error) => {
    throw new Error(`${request}: ${await page.getByRole("alert").allTextContents()}`, { cause: error });
  });
  assert.equal(await page.locator(".smart-review .smart-changes li").count(), count);
}

async function exportApplied() {
  await button("Preview & download").click();
  const dialog = page.getByRole("dialog", { name: "Document preview", exact: true });
  const link = dialog.getByRole("link", { name: "Download PDF", exact: true });
  await link.waitFor();
  const [result] = await Promise.all([page.waitForEvent("download"), link.click()]);
  await dialog.getByRole("button", { name: "Close preview", exact: true }).click();
  return result.path();
}

function spans(path) {
  const code = `import json, pymupdf, sys
doc=pymupdf.open(sys.argv[1])
print(json.dumps([[{'value': s['text'], 'y': s['origin'][1], 'font': s['font'], 'size': s['size']} for block in page.get_text('dict')['blocks'] if 'lines' in block for line in block['lines'] for s in line['spans']] for page in doc]))`;
  return JSON.parse(execFileSync(python, ["-c", code, path], { encoding: "utf8" }));
}

try {
  await page.goto(origin + "/tools/smart-pdf-editor", { waitUntil: "domcontentloaded" });
  // A synthetic identity block with no field labels, like a typical student assignment cover.
  let doc = await PDFDocument.create();
  const sheet = doc.addPage([600, 800]);
  const font = await doc.embedFont(StandardFonts.TimesRomanBold);
  for (const [index, text] of ["ELENA MARY PATTERSON", "22/04ABC203", "COMPUTER SCIENCE"].entries()) {
    sheet.drawText(text, { x: 64, y: 728 - index * 21, size: 12, font });
  }
  sheet.drawText("Calculate the area of a circle.", { x: 70, y: 655, size: 12 });
  await open(doc, "assignment synthetic.pdf");
  await review("Chnage the nmae to Jordan Blake Rivers and the matric number to, 32/00ABC120.", 2);
  await page.getByText(/inferred from the surrounding text/).first().waitFor();
  await button("Apply changes").tap();
  let text = spans(await exportApplied())[0].map(({ value }) => value);
  assert.ok(text.some((line) => line.includes("Jordan Blake Rivers")));
  assert.ok(text.some((line) => line.includes("32/00ABC120")));
  assert.ok(text.some((line) => line.includes("Calculate the area")));
  console.log("Unlabelled identity block, joined changes, no page hints, and transposed letters passed");

  // Writable fields on multiple pages, plus a date question that lacks a supplied value.
  doc = await PDFDocument.create();
  const first = doc.addPage([610, 810]);
  const second = doc.addPage([610, 810]);
  const form = doc.getForm();
  for (const [name, value, target, y] of [
    ["fullName", "Cameron Fields", first, 680],
    ["referenceNumber", "REF-0042", second, 680],
    ["issueDate", "2026-02-01", first, 630],
  ]) {
    const field = form.createTextField(name);
    field.setText(value);
    field.addToPage(target, { x: 100, y, width: 210, height: 28 });
  }
  first.drawText("Registration request", { x: 55, y: 750, size: 28 });
  await open(doc, "fillable synthetic.pdf");
  await ask("Correct the date on the first page.");
  await page.getByRole("alert").filter({ hasText: "What new value" }).waitFor();
  await review("Could you enter Sage Green into the full name field; set ref no. to ABC123 and make the main heading bold?", 3);
  await page.getByText("Cameron Fields", { exact: true }).waitFor();
  await page.getByText("REF-0042", { exact: true }).waitFor();
  await button("Apply changes").tap();
  const approved = await PDFDocument.load(await (await import("node:fs/promises")).readFile(await exportApplied()));
  assert.equal(approved.getForm().getTextField("fullName").getText(), "Sage Green");
  assert.equal(approved.getForm().getTextField("referenceNumber").getText(), "ABC123");
  assert.equal(approved.getForm().getTextField("issueDate").getText(), "2026-02-01");
  console.log("Language variants and genuine cross-page AcroForm updates passed");

  doc = await PDFDocument.create();
  for (let index = 0; index < 2; index++) {
    const duplicate = doc.addPage([600, 800]);
    duplicate.drawText("Full name: Casey Linden", { x: 70, y: 693, size: 17 });
    duplicate.drawText("Reference No: REF-314", { x: 70, y: 655, size: 16 });
  }
  await open(doc, "repeated fields.pdf");
  await ask("The full name should read Quinn Ross.");
  await choice().waitFor();
  assert.equal(await page.getByRole("button", { name: /Full name · Casey Linden/i }).count(), 2);
  assert.equal(await button("Apply changes").count(), 0);
  await page.getByRole("button", { name: /Page 2 · Full name · Casey Linden/i }).tap();
  await review(null, 1);
  await button("Apply changes").tap();
  const repeated = spans(await exportApplied());
  assert.ok(!repeated[0].some(({ value }) => value.includes("Quinn Ross")));
  assert.ok(repeated[1].some(({ value }) => value.includes("Quinn Ross")));
  assert.ok(repeated[1].some(({ value }) => value.includes("Casey Linden")));
  await ask("Securely erase the full name.");
  await page.getByRole("alert").filter({ hasText: "original recoverable" }).waitFor();
  console.log("Repeated fields, explicit candidate selection, and secure-erasure refusal passed");

  doc = await PDFDocument.create();
  doc.addPage([600, 800]).drawText("Original Form Heading", { x: 65, y: 725, size: 25 });
  await open(doc, "follow up.pdf");
  await review("Change the title to Annual Report.", 1);
  await button("Add follow-up").tap();
  await review("Also make it bold and larger.", 1);
  await button("Apply changes").tap();
  const beforeMove = spans(await exportApplied())[0].find(({ value }) => value.includes("Annual Report"));
  assert.match(beforeMove.font, /Bold/);
  assert.equal(beforeMove.size, 30);
  await review("Move it slightly down.", 1);
  await button("Apply changes").tap();
  const moved = spans(await exportApplied())[0].filter(({ value }) => value.includes("Annual Report"));
  assert.equal(moved.length, 1);
  assert.ok(moved[0].y - beforeMove.y > 15);
  await button("Undo last change").tap();
  assert.equal(spans(await exportApplied())[0].find(({ value }) => value.includes("Annual Report")).y, beforeMove.y);
  console.log("Pending and applied follow-ups, correct output coordinates, and undo passed");

  const picture = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 1250;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#141414";
    context.font = "38px Arial";
    context.fillText("Full Name: Morgan Avery", 90, 130);
    context.fillText("Reference Number: A12340", 90, 205);
    return canvas.toDataURL("image/png");
  });
  doc = await PDFDocument.create();
  doc.addPage([600, 750]).drawImage(await doc.embedPng(picture), { x: 0, y: 0, width: 600, height: 750 });
  await open(doc, "scan synthetic.pdf");
  await ask("Change the full name to Parker Allen.");
  await choice().waitFor({ timeout: 65_000 }).catch(async (error) => { throw new Error((await page.getByRole("alert").allTextContents()).join(", "), { cause: error }); });
  await page.getByText("Confirm the text recognized by OCR.", { exact: true }).waitFor();
  await page.getByRole("button", { name: /Full Name · Morgan Avery/i }).tap();
  await review(null, 1);
  await page.getByText(/OCR is approximate/).waitFor();
  await button("Apply changes").tap();
  assert.ok(spans(await exportApplied())[0].some(({ value }) => value.includes("Parker Allen")));
  console.log("Image-only scan, real English OCR, required confirmation, and exported edit passed");

  const { violations } = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(violations.filter(({ impact }) => impact === "serious" || impact === "critical").map(({ id }) => id), []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(network, []);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
