import Link from "next/link";
import { ArrowDownRight, ShieldCheck, ScanLine, Layers3 } from "lucide-react";
import { Catalogue } from "../components/catalogue";
import { DocumentStack } from "../components/document-stack";

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <div className="hero-copy">
            <h1>Every PDF.<br /><em>Perfectly Handled.</em></h1>
            <p className="hero-description">Merge, annotate, convert, and organize your documents in one beautifully designed workspace.</p>
            <Link className="button primary magnetic" href="#tools">Explore PDF tools <ArrowDownRight size={17} aria-hidden="true" /></Link>
          </div>
          <DocumentStack />
        </div>
      </section>
      <Catalogue />
      <section className="container principles reveal" aria-labelledby="principles-title">
        <div><h2 id="principles-title">Made for the way<br />you work.</h2><p>From first draft to final document.</p></div>
        <ul>
          <li><Layers3 aria-hidden="true" /><div><h3>One workspace</h3><p>Assemble a packet, extract a section, or mark up a draft without changing apps.</p></div></li>
          <li><ScanLine aria-hidden="true" /><div><h3>Inspect every result</h3><p>Review the generated document, page by page, before you save it.</p></div></li>
          <li><ShieldCheck aria-hidden="true" /><div><h3>Private by design</h3><p>PDF editing runs in your browser. Word conversion uses the local samPDF server on your computer.</p></div></li>
        </ul>
      </section>
    </>
  );
}
