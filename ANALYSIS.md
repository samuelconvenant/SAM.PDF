# samPDF reference analysis

## Scope and workspace

This document records the original reference study. The existing implementation has since been upgraded to samPDF. See the [current implementation plan](IMPLEMENTATION_PLAN.md) for the architecture audit and conversion decision.

On November 21, 2026, REA's browser scenario tool launched the installed Edge Chromium browser in an isolated headless profile. It returned screenshots, DOM snapshots, and accessibility trees from the public site. I reviewed representative catalogue and tool routes at 1440 × 900 and 390 × 844. The mobile captures use a narrow browser viewport. Physical phone behavior remains untested.

## Observations

| Surface | What the inspection showed | Opportunity for samPDF |
| --- | --- | --- |
| Desktop catalogue | The header gives direct access to Merge, Split, and Compress, plus grouped Convert and All Tools navigation. Clicking the header's Merge link reached the tool and exposed its file chooser. A centered introduction leads to an eight-option category row and a five-column grid at 1440 px. Cards pair a colored icon with a name and description. | Keep direct routes to common tasks. Use a compact featured section and a searchable list with clearer task descriptions. |
| Mobile catalogue | The 390 px view collapses the header to a hamburger, brand, and app launcher. Tapping the hamburger opened a grouped directory with links to individual tools while staying on the homepage. Category pills wrap over four rows. Tool cards form a single column with the icon and title on the same line. | Keep the first task near the top with a compact filter disclosure. Give the menu a visible label and keyboard focus states. |
| Catalogue interaction | Clicking Organize changed the visible catalogue to four entries for merge, split, page organization, and scanning. The URL stayed on the homepage. The resting accessibility capture exposed the filter labels as text. | Use native buttons with a selected state and announce the result count. Keep keyboard focus on the chosen filter. |
| Tool entry screens | Merge, Split, and Compress share a sparse layout with a task name, short explanation, large file chooser, and secondary cloud controls. Desktop Split and Compress expose drop guidance. Mobile Merge shows a nearly full-width picker with secondary controls underneath. Split presents singular file selection while Merge and Compress present plural selection. | Share a tool workspace shell and define input rules per operation. Keep the file chooser available on touch and keyboard, with drag and drop as a desktop shortcut. |
| Related public pages | The catalogue links to conversion, pricing, desktop, mobile, business, and help pages. The JPG to PDF, Organize PDF, and Pricing pages were also checked through the public web reader. | Launch around the document tasks and a short help page. Keep commercial and account flows outside the proposed first release. |

Sources. [Home](https://www.ilovepdf.com/), [Merge PDF](https://www.ilovepdf.com/merge_pdf), [Split PDF](https://www.ilovepdf.com/split_pdf), [Compress PDF](https://www.ilovepdf.com/compress_pdf), [Organize PDF](https://www.ilovepdf.com/organize-pdf), [JPG to PDF](https://www.ilovepdf.com/jpg_to_pdf), [Pricing](https://www.ilovepdf.com/pricing).

## Motion and evidence limits

The normal-motion desktop home and reduced-motion mobile home rendered fully visible tool lists at rest. The filter interaction confirmed the settled state. These captures leave the reference's transition duration, hover behavior, and animation libraries unverified. The tool captures cover the public empty state. I left file upload, cloud sign-in, processing, and download behavior untested. The study covers representative pages, with deeper routes and signed-in features outside its coverage.

The original implementation can use brief transitions where a user needs feedback, especially when a file joins a queue, a page changes position, or a result is ready. A one-time GSAP document-stack animation is worth prototyping if it makes the merge action easier to understand. The proposed release uses native scrolling and static document imagery to keep input responsive. Three.js would add value only for a future interactive document preview that needs 3D; a flat page organizer works with DOM and canvas.

## REA evidence

| Capture | Evidence ID |
| --- | --- |
| Desktop home, normal motion | `ev_373009e0396bbe7b05c32386b23a9a2850ba05d666230e2fc6d951a57f2dba30` |
| Mobile home, reduced motion | `ev_a903f5997043e1e80665866266f41c42ffd1ebb3519c9cbd53fe6d3a39c5b25f` |
| Mobile Merge | `ev_5246b5d9645e151ef8755abe505bc26489efd7f47581d2eb12bb3327933757f9` |
| Desktop Split | `ev_6fb68ee74adc25493ba16cabcd30e2aeb90a62e213a07e89a78cf31993b1424b` |
| Desktop Compress | `ev_8985844652f8db13a87212acf52d3b59116c5d1964732fae6edcae19076e2e02` |
| Desktop Organize filter | `ev_1d2cbd93372f377e7631fca02efb2f924d7f82aecaf7556990325d1ed495d7f4` |
| Mobile menu opened | `ev_9715a1ff08e2c32d3404e9aaa85f9307ca725f5bb79bba9a7111bec5800460f9` |
| Desktop header navigation to Merge | `ev_59388634b7a81fe6d59c38ad90200de0afab45a8c5baa88bced0ed0ab2122bad` |

REA terminated its owned Chromium sessions. A separate shell-launched debugging browser was blocked by automatic policy. The REA scenario provider supplied the browser evidence for this report.
