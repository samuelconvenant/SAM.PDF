import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../components/site";
import { Ambience } from "../components/ambience";
import "@fontsource-variable/inter";
import "./globals.css";
import "./premium.css";
import "./documents.css";
import "./create.css";
import "./document-stack.css";

export const metadata: Metadata = {
  title: { default: "samPDF — Professional PDF workspace", template: "%s · samPDF" },
  description: "Merge, split, annotate, organize, and convert documents in your browser. Preview the result before downloading.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <Ambience />
        <a className="skip" href="#main">Skip to content</a>
        <SiteHeader />
        <main id="main" tabIndex={-1}>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
