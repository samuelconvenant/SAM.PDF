import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata: Metadata = { title: "Help & privacy", description: "How samPDF handles files, PDF limits, and download issues." };

export default function Help() {
  return (
    <article className="container content-page">
      <Link href="/" className="back-link"><ArrowLeft size={17} aria-hidden="true" /> All tools</Link>
      <h1>Help & privacy</h1>
      <h2>Where do my files go?</h2>
      <p>Create PDF, Edit PDF, Smart PDF Editor, and password protection run in this browser. Word conversions are available with a local samPDF server, which removes temporary job files after processing. Save results before leaving a tool.</p>
      <h2>Which files can I use?</h2>
      <p>Merge, Split, and Organize accept PDFs. Images to PDF accepts JPEG and PNG. Each workspace accepts up to 30 files and 80 MiB total. Split and Organize take one PDF at a time.</p>
      <h2>How do I split a PDF?</h2>
      <p>Use page numbers or inclusive ranges like <code>1-3, 5, 8-10</code>. Each comma-separated entry becomes its own PDF. Multiple outputs download together as a ZIP.</p>
      <h2>When should I use Create PDF?</h2>
      <p>Start here for a new document. Type on the blank A4 draft, add tables or pictures, and use the PDF preview to check pagination and formatting.</p>
      <h2>What can I edit in an existing PDF?</h2>
      <p>Upload the PDF, then add and position text boxes and photos. You can use millimetre sizing and crop controls to fit a photo frame. A white box is a visual cover. The underlying text remains searchable and extractable.</p>
      <h2>How does Smart PDF Editor work?</h2>
      <p>Describe one action in English, such as <code>Rotate page two</code>. Review the proposed PDF before applying the change. Heading changes cover selectable PDF text, so the original remains recoverable. Scanned pages need OCR for text detection.</p>
      <h2>How does password protection work?</h2>
      <p>Protect PDF uses AES-256 encryption in your browser. A PDF reader will need the new password to open the encrypted file. Split PDF protection encrypts each PDF inside the ZIP. The ZIP container itself opens normally.</p>
      <h2>Why can’t I open a file?</h2>
      <p>Check the format and try opening it in a PDF viewer first. If the file requires a password, open it with its password and save an accessible copy before trying again. Large or image-heavy files may exceed your browser’s available memory.</p>
      <h2>What carries over to a new PDF?</h2>
      <p>samPDF copies the selected pages. Check documents that rely on bookmarks, interactive forms, digital signatures, or accessibility tags before using the exported copy.</p>
    </article>
  );
}
