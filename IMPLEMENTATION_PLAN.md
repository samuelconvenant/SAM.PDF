# samPDF architecture and conversion

Six tools process documents in the browser. Create PDF uses a lazy-loaded TipTap editor and an A4 pdfmake export with automatic pagination. Edit PDF uses PDF.js to position photo and text overlays over the uploaded document. The PDF worker embeds those additions into the original PDF and passes the result to the shared PDF.js preview. The Next.js App Router also serves both Word conversion routes. The homepage catalogue and interactive CSS 3D stack link to the same registry entries.

## Local Word conversion

- Word to PDF uses headless LibreOffice Writer with a unique profile per job. The shared PDF viewer displays the exact downloadable bytes.
- PDF to Word uses pdf2docx and PyMuPDF to reconstruct text, images, and tables where possible. LibreOffice renders the generated DOCX to a temporary preview PDF. The browser receives the DOCX and preview together and downloads the original DOCX.
- The API accepts loopback requests with a streamed size limit of 25 MiB. There is one job at a time per Next.js process. PDF reconstruction is limited to 100 pages. DOCX validation bounds archive expansion and rejects active or externally loaded content. Generated files have a combined 100 MiB limit.
- The server invokes Python with fixed arguments and writes files under a fresh OS temporary directory with a distinct LibreOffice profile. A deadline bounds conversion and the job directory is removed in a cleanup step. The UI receives a fixed error message without engine logs or document contents.
- The server is intended for personal use over loopback. Public deployment requires a separate process or container sandbox, stronger resource isolation, and authentication appropriate to its threat model.

PDF reconstruction may change paragraph flow, layout, or heading styles. Scans need OCR, which is outside this implementation. DOCX output can render differently in Microsoft Word due to fonts, pagination, or compatibility rules.

[LibreOffice command-line reference](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html) · [pdf2docx documentation](https://pdf2docx.readthedocs.io/en/latest/)
