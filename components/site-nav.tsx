"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";

const links = [
  { href: "/", label: "All tools" },
  { href: "/tools/merge", label: "Merge" },
  { href: "/tools/split", label: "Split" },
  { href: "/tools/create", label: "Create PDF" },
  { href: "/tools/edit", label: "Edit PDF" },
  { href: "/tools/pdf-to-word", label: "PDF to Word" },
  { href: "/tools/word-to-pdf", label: "Word to PDF" },
  { href: "/help", label: "Help & privacy" },
];

export function SiteNav() {
  const pathname = usePathname();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const nav = useRef<HTMLElement>(null);
  const open = openFor === pathname;

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenFor(null);
        trigger.current?.focus();
      }
    }
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !nav.current?.contains(event.target)) setOpenFor(null);
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [open]);

  return (
    <nav ref={nav} className="site-nav" aria-label="Main navigation">
      <button ref={trigger} className="menu-toggle" type="button" aria-expanded={open} aria-controls="primary-links" onClick={() => setOpenFor(open ? null : pathname)}>
        {open ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />} Menu
      </button>
      <div id="primary-links" className="nav-links" data-open={open}>
        {links.map(({ href, label }) => (
          <Link key={href} className={href === "/help" ? "help-link" : undefined} href={href} aria-current={pathname === href ? "page" : undefined} onClick={() => setOpenFor(null)}>
            {label}{href === "/help" && <ArrowUpRight size={14} aria-hidden="true" />}
          </Link>
        ))}
      </div>
    </nav>
  );
}
