import assets from "./document-font-assets.json";

export const fontCategories = ["Serif", "Sans-serif", "Monospaced", "Display and decorative"] as const;
type Category = (typeof fontCategories)[number];
export const fontFaces = ["regular", "bold", "italic", "boldItalic"] as const;
export type FontFaceStyle = (typeof fontFaces)[number];
export type FontAsset = keyof typeof assets;
export type StandardFamily = "Helvetica" | "Times" | "Courier";
export type DraftFont = {
  name: string;
  category: Category;
  family: string;
  css: string;
  pdf: StandardFamily | FontAsset;
  asset?: FontAsset;
  equivalent?: string;
};

const [serif, sans, mono, display] = fontCategories;
const generic = { [serif]: "serif", [sans]: "sans-serif", [mono]: "monospace", [display]: "serif" };

function embedded(name: string, category: Category, asset: FontAsset, equivalent?: string): DraftFont {
  const family = equivalent ? `${name} (${equivalent})` : name;
  const css = `"${family}", ${equivalent ? `"${equivalent}", ` : ""}${generic[category]}`;
  return { name, category, family, css, pdf: asset, asset, equivalent };
}

function standard(name: string, category: Category, pdf: StandardFamily, css: string): DraftFont {
  return { name, category, pdf, family: name, css };
}

export const draftFonts = [
  standard("Times New Roman", serif, "Times", '"Times New Roman", Times, serif'),
  embedded("Georgia", serif, "lora", "Lora"),
  embedded("Garamond", serif, "eb-garamond", "EB Garamond"),
  embedded("Cambria", serif, "caladea", "Caladea"),
  embedded("Merriweather", serif, "merriweather"),
  embedded("Playfair Display", serif, "playfair-display"),
  embedded("Libre Baskerville", serif, "libre-baskerville"),
  embedded("Lora", serif, "lora"),
  embedded("Crimson Text", serif, "crimson-text"),
  embedded("EB Garamond", serif, "eb-garamond"),
  standard("Arial", sans, "Helvetica", "Arial, sans-serif"),
  embedded("Calibri", sans, "carlito", "Carlito"),
  standard("Helvetica", sans, "Helvetica", "Helvetica, Arial, sans-serif"),
  embedded("Inter", sans, "inter"),
  embedded("Roboto", sans, "roboto"),
  embedded("Open Sans", sans, "open-sans"),
  embedded("Lato", sans, "lato"),
  embedded("Montserrat", sans, "montserrat"),
  embedded("Poppins", sans, "poppins"),
  embedded("Nunito", sans, "nunito"),
  embedded("Source Sans 3", sans, "source-sans-3"),
  embedded("Noto Sans", sans, "noto-sans"),
  embedded("Work Sans", sans, "work-sans"),
  embedded("Raleway", sans, "raleway"),
  embedded("Ubuntu", sans, "ubuntu"),
  embedded("DM Sans", sans, "dm-sans"),
  embedded("Verdana", sans, "noto-sans", "Noto Sans"),
  embedded("Tahoma", sans, "noto-sans", "Noto Sans"),
  standard("Courier New", mono, "Courier", '"Courier New", Courier, monospace'),
  embedded("Roboto Mono", mono, "roboto-mono"),
  embedded("Source Code Pro", mono, "source-code-pro"),
  embedded("IBM Plex Mono", mono, "ibm-plex-mono"),
  embedded("JetBrains Mono", mono, "jetbrains-mono"),
  embedded("Cinzel", display, "cinzel"),
  embedded("Oswald", display, "oswald"),
  embedded("Abril Fatface", display, "abril-fatface"),
  embedded("Cormorant Garamond", display, "cormorant-garamond"),
  embedded("Great Vibes", display, "great-vibes"),
  embedded("Dancing Script", display, "dancing-script"),
  embedded("Caveat", display, "caveat"),
];

const normalize = (font: string) => font.toLowerCase().replace(/["'\s]/g, "");
const legacyName = (font: string) => /^(Times|Times-Roman)$/i.test(font) ? "Times New Roman" : /^Courier$/i.test(font) ? "Courier New" : font;
const keys = new Map(draftFonts.flatMap((font) => [font.name, font.css, font.family].map((key) => [normalize(key), font] as const)));
export const defaultDraftFont = keys.get("roboto")!;

export function findDraftFont(font: unknown) {
  if (typeof font !== "string") return defaultDraftFont;
  return keys.get(normalize(legacyName(font))) ?? keys.get(normalize(font.split(",")[0])) ?? defaultDraftFont;
}

export function faceFor(font: DraftFont, bold?: boolean, italic?: boolean): FontFaceStyle {
  const variant = italic ? (bold ? "boldItalic" : "italic") : (bold ? "bold" : "regular");
  if (!font.asset) return variant;
  const available = assets[font.asset].faces;
  if (available.includes(variant)) return variant;
  if (bold && available.includes("bold")) return "bold";
  if (italic && available.includes("italic")) return "italic";
  return "regular";
}

export function fontDescription(font: DraftFont) {
  if (font.equivalent) return `Uses ${font.equivalent} in the editor and PDF.`;
  if (!font.asset) return `PDF uses the standard ${font.pdf === "Times" ? "Times-Roman" : font.pdf} family.`;
  return assets[font.asset].faces.length === 4 ? "Embedded in the PDF." : "Embedded in the PDF. Unavailable styles use the closest face in this family.";
}

export function standardPostScript(font: DraftFont, face: FontFaceStyle) {
  if (font.pdf === "Times") return { regular: "Times-Roman", bold: "Times-Bold", italic: "Times-Italic", boldItalic: "Times-BoldItalic" }[face];
  const suffix = { regular: "", bold: "-Bold", italic: "-Oblique", boldItalic: "-BoldOblique" }[face];
  return `${font.pdf}${suffix}`;
}
