import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return <section className="container content-page not-found"><h1>Page unavailable</h1><p>That address doesn’t point to a samPDF tool.</p><Link href="/" className="button primary"><ArrowLeft size={17} aria-hidden="true" /> Browse PDF tools</Link></section>;
}
