import assert from "node:assert/strict";
import { decodePDFRawStream, PDFDocument, PDFRawStream, rgb, StandardFonts } from "pdf-lib";
import { chromium, webkit } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

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
print(json.dumps([[{'value': s['text'], 'y': s['origin'][1], 'x': s['origin'][0], 'font': s['font'], 'size': s['size'], 'color': s['color'], 'bbox': s['bbox']} for block in page.get_text('dict')['blocks'] if 'lines' in block for line in block['lines'] for s in line['spans']] for page in doc]))`;
  return JSON.parse(execFileSync(python, ["-c", code, path], { encoding: "utf8" }));
}

async function assertRemoved(file, oldValues) {
  const bytes = await readFile(file);
  const doc = await PDFDocument.load(bytes);
  const contents = [bytes.toString("latin1")];
  for (const [, item] of doc.context.enumerateIndirectObjects()) {
    if (!(item instanceof PDFRawStream)) continue;
    try { contents.push(Buffer.from(decodePDFRawStream(item).decode()).toString("latin1")); } catch {}
  }
  for (const old of oldValues) {
    const hex = Buffer.from(old).toString("hex");
    assert.ok(contents.every((content) => !content.includes(old) && !content.toLowerCase().includes(hex)), `Old value retained in output objects: ${old}`);
  }
}

try {
  await page.goto(origin + "/tools/smart-pdf-editor", { waitUntil: "domcontentloaded" });
  // A synthetic identity block with no field labels, like a typical student assignment cover.
  let doc = await PDFDocument.create();
  const sheet = doc.addPage([600, 800]);
  const font = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
  for (const [index, text] of ["ELENA MARY PATTERSON", "22/04ABC203", "COMPUTER SCIENCE"].entries()) {
    sheet.drawText(text, { x: 64, y: 728 - index * 21, size: 12, font, color: rgb(.2, 26 / 255, .6) });
  }
  sheet.drawText("Calculate the area of a circle.", { x: 70, y: 655, size: 12 });
  await open(doc, "assignment synthetic.pdf");
  await review("Chnage the nmae to Jordan Blake Rivers and the enrollment code to, 32/00ABC120.", 2);
  await page.getByText(/inferred from the surrounding text/).first().waitFor();
  await button("Apply changes").tap();
  const replaced = await exportApplied();
  const runs = spans(replaced)[0];
  let text = runs.map(({ value }) => value);
  assert.ok(text.some((line) => line.includes("Jordan Blake Rivers")));
  assert.ok(text.some((line) => line.includes("32/00ABC120")));
  assert.ok(text.some((line) => line.includes("Calculate the area")));
  assert.ok(text.every((line) => !line.includes("enrollment code") && !line.includes("ELENA MARY PATTERSON") && !line.includes("22/04ABC203")));
  const nameRun = runs.find((run) => run.value.includes("Jordan Blake Rivers"));
  assert.equal(nameRun.font, "Times-BoldItalic");
  assert.equal(nameRun.size, 12);
  assert.equal(nameRun.x, 64);
  assert.equal(nameRun.y, 72);
  assert.equal(nameRun.color, 0x331a99);
  await assertRemoved(replaced, ["ELENA MARY PATTERSON", "22/04ABC203"]);
  console.log("Unlabelled identity block, joined changes, no page hints, and transposed letters passed");
  await ask("Make it bold.");
  await page.getByRole("alert").filter({ hasText: "Which change should this apply to" }).waitFor();
  await review("Set the name to Jordan Rivers.", 1);
  await button("Apply changes").tap();
  await review("Reduce the font size slightly.", 1);
  await button("Apply changes").tap();
  await ask("Now correct the matric number below it.");
  await page.getByRole("alert").filter({ hasText: "What new value" }).waitFor();
  await review("Now correct the matric number below it to 32/00ABC123.", 1);
  await button("Apply changes").tap();
  await review("Move both a little to the right.", 2);
  await button("Apply changes").tap();
  const both = spans(await exportApplied())[0];
  assert.ok(both.find((run) => run.value === "Jordan Rivers").x > 75);
  assert.ok(both.find((run) => run.value === "32/00ABC123").x > 75);
  assert.ok(Math.abs(both.find((run) => run.value === "Jordan Rivers").size - 10) < .01);
  console.log("Ambiguous pronouns, geometry-based field references, and two-item movement passed");

  doc = await PDFDocument.create();
  const contract = doc.addPage([600, 800]);
  contract.drawText("Campus zone: North", { x: 65, y: 700, size: 14 });
  contract.drawText("Equipment code: EX-18", { x: 65, y: 670, size: 14 });
  contract.drawText("Room sector: Blue", { x: 65, y: 640, size: 14 });
  contract.drawText("Dispatch record", { x: 310, y: 640, size: 14 });
  await open(doc, "custom labels.pdf");
  await ask("Set campus zone to East and the reactor profile to Delta.");
  await page.getByRole("alert").filter({ hasText: "couldn't locate reactor profile" }).waitFor();
  assert.equal(await button("Apply changes").count(), 0);
  await ask("Set room sector to " + "Very long value ".repeat(8).trim());
  await page.getByRole("alert").filter({ hasText: "too long for this field" }).waitFor();
  assert.equal(await button("Apply changes").count(), 0);
  await review('Set the campus zone to "Near the gate on page nine" and the equipment code to EX-29.', 2);
  await button("Apply changes").tap();
  const custom = spans(await exportApplied())[0].map(({ value }) => value).join("\n");
  assert.ok(custom.includes("Campus zone: Near the gate on page nine"));
  assert.ok(custom.includes("Equipment code: EX-29"));
  assert.ok(!custom.includes("reactor profile"));
  assert.ok(custom.includes("Dispatch record"));
  console.log("Unfamiliar labels, unresolved clauses, quoted literal placement, and overlap rejection passed");

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
  const approved = await PDFDocument.load(await readFile(await exportApplied()));
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
  assert.ok(repeated[0].some(({ value }) => value.includes("Casey Linden")));
  assert.ok(!repeated[1].some(({ value }) => value.includes("Casey Linden")));
  await review("Change the reference number everywhere it appears to REF-505.", 2);
  await button("Apply changes").tap();
  assert.ok(spans(await exportApplied()).every((sheet) => sheet.some(({ value }) => value.includes("REF-505"))));
  await ask("Securely erase the full name.");
  await page.getByRole("alert").filter({ hasText: "original recoverable" }).waitFor();
  console.log("Repeated fields, explicit candidate selection, and secure-erasure refusal passed");

  doc = await PDFDocument.create();
  const centerFont = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([600, 800]).drawText("Original Form Heading", { x: (600 - centerFont.widthOfTextAtSize("Original Form Heading", 25)) / 2,
    y: 725, size: 25, font: centerFont });
  await open(doc, "follow up.pdf");
  await review("Change the title to Annual Report.", 1);
  await button("Add follow-up").tap();
  await review("Also make it bold and larger.", 1);
  await button("Apply changes").tap();
  const beforeMove = spans(await exportApplied())[0].find(({ value }) => value.includes("Annual Report"));
  assert.match(beforeMove.font, /Bold/);
  assert.ok(Math.abs(beforeMove.size - 30) < .001);
  assert.ok(Math.abs((beforeMove.bbox[0] + beforeMove.bbox[2]) / 2 - 300) < 3);
  await review("Move it slightly down.", 1);
  await button("Apply changes").tap();
  const moved = spans(await exportApplied())[0].filter(({ value }) => value.includes("Annual Report"));
  assert.equal(moved.length, 1);
  assert.ok(moved[0].y - beforeMove.y > 15);
  await button("Undo last change").tap();
  assert.equal(spans(await exportApplied())[0].find(({ value }) => value.includes("Annual Report")).y, beforeMove.y);
  await button("Redo change").tap();
  assert.equal(spans(await exportApplied())[0].find(({ value }) => value.includes("Annual Report")).y, moved[0].y);
  console.log("Pending and applied follow-ups, center alignment, correct output coordinates, and undo/redo passed");

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
