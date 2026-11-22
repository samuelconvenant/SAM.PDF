type PdfFont = "Roboto" | "Helvetica" | "Times" | "Courier";
type DraftFont = { name: string; css: string; pdf: PdfFont };
const serif = '"Times New Roman", serif';
const sans = 'Arial, sans-serif';
const fixed = '"Courier New", monospace';

export const draftFonts: DraftFont[] = [
  { name: "Roboto", css: `Roboto, ${sans}`, pdf: "Roboto" },
  { name: "Arial", css: sans, pdf: "Helvetica" },
  { name: "Times New Roman", css: serif, pdf: "Times" },
  { name: "Calibri", css: `Calibri, ${sans}`, pdf: "Roboto" },
  { name: "Cambria", css: `Cambria, ${serif}`, pdf: "Times" },
  { name: "Georgia", css: `Georgia, ${serif}`, pdf: "Times" },
  { name: "Garamond", css: `Garamond, ${serif}`, pdf: "Times" },
  { name: "Verdana", css: `Verdana, ${sans}`, pdf: "Helvetica" },
  { name: "Tahoma", css: `Tahoma, ${sans}`, pdf: "Helvetica" },
  { name: "Helvetica", css: `Helvetica, ${sans}`, pdf: "Helvetica" },
  { name: "Courier New", css: fixed, pdf: "Courier" },
  { name: "Open Sans", css: `"Open Sans", ${sans}`, pdf: "Roboto" },
  { name: "Lato", css: `Lato, ${sans}`, pdf: "Roboto" },
  { name: "Montserrat", css: `Montserrat, ${sans}`, pdf: "Roboto" },
  { name: "Poppins", css: `Poppins, ${sans}`, pdf: "Roboto" },
  { name: "Inter", css: `"Inter Variable", Inter, ${sans}`, pdf: "Roboto" },
  { name: "Playfair Display", css: `"Playfair Display", Georgia, ${serif}`, pdf: "Times" },
  { name: "Merriweather", css: `Merriweather, Georgia, ${serif}`, pdf: "Times" },
  { name: "Nunito", css: `Nunito, ${sans}`, pdf: "Roboto" },
];

const normalize = (font: string) => font.toLowerCase().replace(/["'\s]/g, "");
export const outputFontNames: Record<PdfFont, string> = { Roboto: "Roboto", Helvetica: "Helvetica", Times: "Times-Roman", Courier: "Courier" };

export function findDraftFont(font: unknown) {
  if (typeof font !== "string") return draftFonts[0];
  if (font === "Times") return draftFonts[2];
  if (font === "Courier") return draftFonts[10];
  const key = normalize(font);
  return draftFonts.find((item) => normalize(item.css) === key || normalize(item.name) === key) ?? draftFonts[0];
}
