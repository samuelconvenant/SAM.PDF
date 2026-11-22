import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { SiteNav } from "./site-nav";

export function Brand() {
  return <Link href="/" className="brand" aria-label="samPDF home">sam<span>PDF</span></Link>;
}

export function SiteHeader() {
  return <header className="site-header"><div className="container header-inner"><Brand /><SiteNav /></div></header>;
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <Brand />
        <span className="footer-privacy"><ShieldCheck size={16} aria-hidden="true" /> Files stay on this device.</span>
        <Link href="/help" className="footer-link">Help & privacy <ArrowUpRight size={15} aria-hidden="true" /></Link>
      </div>
    </footer>
  );
}
