# samPDF

samPDF is a browser-based document workspace built with Next.js, React, TypeScript, PDF.js, and pdf-lib.

## Run locally

```powershell
npm.cmd ci
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-conversion.txt
winget install --id TheDocumentFoundation.LibreOffice --exact
npm.cmd run dev -- --hostname 127.0.0.1
```

Open http://127.0.0.1:3000. Use Python 3.11–3.13 and install LibreOffice Writer from your OS package manager or the official installer. On macOS and Linux, use `.venv/bin/python` and `npm`. If either executable is installed elsewhere, set `SAMPDF_PYTHON` or `SAMPDF_SOFFICE` to its full path before starting Next.js. You can set those paths in the project’s ignored `.env.local` file.

The browser tools, including Smart PDF Editor and Protect PDF, need only `npm.cmd ci` and `npm.cmd run dev`. Python and LibreOffice are for local Word conversion.

## Available tools

| Tool | Output |
| --- | --- |
| Merge PDF | Ordered combination of PDFs inspected in a document gallery |
| Split PDF | A PDF for one range or a ZIP with individually previewable PDFs |
| Organize PDF | PDF with your page order, rotations, and removals |
| Images to PDF | Ordered JPEG and PNG conversion to image-sized or A4 pages |
| Create PDF | A new A4 PDF from a blank rich-text draft, with tables, images, and automatic pagination |
| Edit PDF | An existing PDF with precisely positioned text boxes and JPEG or PNG photos |
| Smart PDF Editor | A revised PDF from an English instruction, with a preview and approval step |
| PDF to Word | Editable DOCX from text-based PDFs, with a LibreOffice-rendered preview |
| Word to PDF | PDF produced by LibreOffice Writer and displayed in the shared viewer |
| Protect PDF | AES-256 encrypted PDF requiring a password to open |

Merge PDF shows the first page, filename, size, page count, and merge position for each upload. Choose Grid or List view, open a card to inspect its pages, or use Scroll pages in the preview for a continuous view. Use the move buttons or drag the cards to change the order.

Generated files open in a viewer before download. Use the thumbnails, direct page navigation, zoom controls, and expanded view to inspect the actual output. The viewer keeps the current page visible while rendering the next frame and restores its page, zoom, and scroll when reopened. Set the filename in the footer. Downloading leaves the preview open and the draft intact.

Create PDF opens to a blank A4 drafting surface. Select text to apply a font, size from 8 to 72 pt, colour, highlight, or text style. Both editors share a searchable picker with 40 choices, four categories, and recent fonts. Bundled fonts load from samPDF when selected and the exporters embed the characters used. The picker identifies licensed equivalents for proprietary families and the standard PDF families used for Arial, Helvetica, Times New Roman, and Courier New. Where a family lacks a style, both editors and exporters use the closest available face. Most bundled faces cover Latin text. The bundled Roboto supports additional scripts, including Greek and Cyrillic. Export reports unsupported characters explicitly. Font versions are recorded in `lib/document-font-assets.json`, and the original license texts ship alongside the fonts in `public/document-fonts/`.

Create PDF supports Ctrl or Cmd shortcuts for text styling, alignment, undo and redo, clipboard edits, page breaks, and saving. Tab and Shift+Tab move between table cells. Save draft downloads an editable `.json` document, and Open draft restores it with its formatting and images. Writing settings controls sentence capitalization. It starts enabled, remembers the preference on this browser, and applies to text typed directly in the editor. Opening a draft or pasting text preserves its casing.

Click an image for eight resize handles and its image controls. Use Free position to move it anywhere within the current section’s printable area, or Inline to keep it in text flow. Image controls include an aspect-ratio lock, crop, rotation, replacement, duplication, and ordering. JPEG, PNG, WebP, GIF, and BMP imports use still images. In tables, drag column dividers or the lower edge of a row to resize. Drag across cells to select them for merging. Table controls include rows, columns, merging, splitting, width, padding, borders, cell colour and alignment, and moving the table between document blocks.

The draft scrolls continuously. The PDF preview shows the final pagination, selectable text, and generated objects. Use Add page before positioning a floating image on a specific page. Floating positions are measured from that section’s printable area and appear on the first exported page of the section. Arrangement controls change the order of floating images relative to one another. In the export, flowing text is drawn over floating images. Text and inline objects continue to flow onto additional pages automatically. Row heights are minimums that can grow to fit their content.

Edit PDF starts with an existing file. Drag a selected text box directly by its body or move grip. The eight independent resize handles and numeric position and size fields provide finer control. Double-click a text box on desktop or choose Edit text on a phone to type. Select a box and use the arrow keys for one-point adjustments or Shift and an arrow for ten points. The move controls also offer page transfers and optional centre snapping. Width and height use millimetres, with photo presets for 35 × 45 mm and 2 × 2 inches. Fonts, styles, and highlights apply to the full overlay box. Text wraps at the chosen font size and is clipped at the box boundary. Additions are written into the original PDF page streams and can no longer be selected as draft objects after download. A white box visually covers underlying text. That text remains searchable and extractable. Editing can invalidate digital signatures.

The six PDF editing and assembly tools process files in browser memory. PDF file workspaces accept up to 30 files and 80 MiB total. Images inserted into a draft or existing page have a 12 MiB per-image limit and are normalized to a maximum of 2,400 pixels on the longest side. Drafts are held in memory until you leave the tool.

Smart PDF Editor can review up to eight requested changes together in an unlocked PDF of up to 25 MiB and 150 pages. For example, ask “Change the full name to Jordan Lee, update the reference number to REF-206 and make the heading bold.” The editor uses a pretrained English winkNLP model for tokenization, lemmas, part-of-speech tagging and date recognition. Task-specific logic resolves supported actions and matches them to the PDF.js document index using field names, aliases, small spelling differences, text boundaries, and the positions of nearby labels and values. It can propose matches for some unlabelled identity blocks based on the relationship between a person’s name and an identifier. It asks for a choice when more than one match is plausible, or asks for a new value if the request did not supply one. There is no model API, account, or API key.

Review shows the affected pages and previous and proposed values when available. The generated PDF can be compared with the current document before approval. Recent Smart Editor edits can be refined with follow-ups such as “Also make it bold” and “Move it slightly down.” Undo last change restores the prior approved PDF during the current session. Existing commands for text additions, page numbers, page order, and photos remain available. JPEG and PNG photos have a 12 MiB input limit.

The editor writes plain text into writable AcroForm fields and updates their appearances. Flat text and OCR replacements use a white visual cover and a new text layer. The original remains recoverable. Visual replacement is intended for simple, light-background layouts within the available line width. Font choice and character coverage are limited to the built-in Latin PDF fonts for these replacements. Secure redaction, XFA editing, arbitrary modification of embedded text, and moving artwork already in the source PDF are outside the supported scope.

If no target is found and candidate pages have no selectable text, Smart PDF Editor loads the bundled English Tesseract language data and reads up to two image-only pages. Name or open a particular page to narrow a search across several scans. OCR positions and results are approximate and require confirmation. All document analysis, OCR, previews, and output stay in browser memory.

Protect PDF and Protect with Password use qpdf 12.4.2 compiled to WebAssembly in a dedicated browser worker. The worker accepts up to 80 MiB and applies AES-256 with a required open password and a cryptographically random owner password. Documents and passwords stay in worker memory until the job ends, is cancelled, or reaches its 60-second limit. For split archives, up to 150 PDFs can be encrypted individually with the same password. The ZIP container opens normally. An encrypted source requires its existing password, or its owner password when modification or other permissions are restricted. Protection rewrites the file and can affect existing digital signatures.

Word conversions send one file of up to 25 MiB to the local Next.js server on your computer. The converter runs one job at a time and removes its temporary input, output, and LibreOffice profile when the job finishes or fails. Bind the server to loopback for these conversions. The public deployment does not supply a Word conversion service. When a Word conversion is run locally, its PDF output can use the same browser protection dialog as other PDFs.

## Public hosting

The existing Next.js build serves the same-origin JavaScript workers and the qpdf WASM asset over HTTPS. Smart editing and protection require no Vercel function, Python executable, external AI provider, environment secret, or backend upload. Vercel’s function body limit therefore does not affect these tools. PDF preview disables XFA and does not execute PDF JavaScript actions. Browser resource limits still apply to unusually complex documents.

WebLLM requires a WebGPU-capable browser and a model download. Transformers.js can use WASM or WebGPU, with model weights, startup time, and memory to account for on phones. A hosted open-source generative model would need a separate inference runtime, dedicated capacity, rate limits and upload privacy controls. samPDF ships a compact trained English NLP model and layout-aware matching as a browser-first hybrid. It interprets a bounded set of tasks, and the PDF worker validates every operation against a strict schema. Vercel serves all runtime assets from the app’s origin. The build stages the OCR assets from locked npm packages, and the browser fetches them only when OCR is needed. [winkNLP model](https://github.com/winkjs/wink-eng-lite-web-model) · [Tesseract.js](https://github.com/naptha/tesseract.js) · [WebLLM](https://github.com/mlc-ai/web-llm) · [Transformers.js](https://huggingface.co/docs/transformers.js/index) · [Vercel Functions limits](https://vercel.com/docs/functions/limitations) · [qpdf WASM](https://github.com/soulehshaikh99/qpdf-wasm)

PDF to Word reconstructs layout from page geometry and may change text order, styles, or pagination. Image-only PDFs must be processed with OCR first. In mixed files, scanned pages are not converted into editable text. Word to PDF fidelity depends on installed fonts and LibreOffice support for Word features. Active content, linked document resources, and some embedded formats are rejected. The DOCX preview shows LibreOffice’s rendering of the exact generated DOCX. Microsoft Word may paginate it differently.

## Production checks

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
node tests/preview-stability.mjs
node tests/create-formatting.mjs
node tests/pdf-workspaces.mjs
node tests/writing-and-fonts.mjs
node tests/smart-and-protection.mjs
node tests/smart-language.mjs
```

The browser suite uses installed Edge on Windows by default. Set `SAMPDF_BROWSER` to a Chromium executable, or use the Playwright-managed Chromium on other platforms. The main suite starts the production build on port 4417. The focused suites use a running samPDF server on port 3000. Set `SAMPDF_TEST_ORIGIN` to use a different server. Both conversion tests require the Python and LibreOffice setup above. The Create PDF and encryption output checks use PyMuPDF from the same Python environment. Screenshots and sample output are written to `test-results/`.

The homepage document stack uses CSS perspective and Z-depth. Move the pointer to tilt, drag horizontally to rotate on touch, or select a document with the keyboard to reveal its links. Reduced-motion mode keeps the selection controls available.

[Conversion architecture and limits](IMPLEMENTATION_PLAN.md).
