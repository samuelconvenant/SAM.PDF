import { Encodings, Font } from "@pdf-lib/standard-fonts";
import { faceFor, fontFaces, standardPostScript } from "./draft-fonts";
import type { DraftFont, FontAsset, FontFaceStyle } from "./draft-fonts";

export function fontPath(asset: FontAsset, face: FontFaceStyle) {
  return `/document-fonts/${asset}-${face}.ttf`;
}

const bytes = new Map<string, Promise<ArrayBuffer>>();

export function fontBytes(asset: FontAsset, face: FontFaceStyle) {
  const path = fontPath(asset, face);
  let pending = bytes.get(path);
  if (!pending) {
    pending = fetch(path).then((response) => {
      if (!response.ok) throw new Error("The document font could not be loaded. Try selecting it again.");
      return response.arrayBuffer();
    }).catch((error) => {
      bytes.delete(path);
      throw error;
    });
    bytes.set(path, pending);
  }
  return pending;
}

const browserFaces = new Map<string, Promise<void>>();

export function ensureBrowserFont(font: DraftFont, allStyles = true) {
  if (!font.asset) return Promise.resolve();
  const asset = font.asset;
  const styles = allStyles ? fontFaces : ["regular"] as const;
  return Promise.all(styles.map((requested) => {
    const key = `${font.family}:${requested}`;
    let pending = browserFaces.get(key);
    if (!pending) {
      const bold = requested === "bold" || requested === "boldItalic";
      const italic = requested === "italic" || requested === "boldItalic";
      pending = fontBytes(asset, faceFor(font, bold, italic)).then(async (buffer) => {
        const face = new FontFace(font.family, buffer, { weight: bold ? "700" : "400", style: italic ? "italic" : "normal" });
        document.fonts.add(await face.load());
      }).catch((error) => {
        browserFaces.delete(key);
        throw error;
      });
      browserFaces.set(key, pending);
    }
    return pending;
  })).then(() => {});
}

export type DocumentFontMetrics = {
  measure: (text: string, size: number) => number;
  ascent: number;
  descent: number;
  supports: (char: number) => boolean;
};

const metrics = new Map<string, DocumentFontMetrics>();
const loadingMetrics = new Map<string, Promise<DocumentFontMetrics>>();

function standardMetrics(name: string) {
  const existing = metrics.get(name);
  if (existing) return existing;
  const source = Font.load(name as Parameters<typeof Font.load>[0]);
  const supports = (code: number) => Encodings.WinAnsi.canEncodeUnicodeCodePoint(code);
  const result: DocumentFontMetrics = {
    ascent: Math.max(0, source.Ascender ?? 780) / 1000, descent: Math.abs(source.Descender ?? -220) / 1000, supports,
    measure(text, size) {
      let previous = "", width = 0;
      for (const char of text) {
        const code = char.codePointAt(0)!;
        const glyph = supports(code) ? Encodings.WinAnsi.encodeUnicodeCodePoint(code).name : "question";
        width += (source.getWidthOfGlyph(glyph) ?? 500) + (source.getXAxisKerningForPair(previous, glyph) ?? 0);
        previous = glyph;
      }
      return width * size / 1000;
    },
  };
  metrics.set(name, result);
  return result;
}

export function getFontMetrics(font: DraftFont, face: FontFaceStyle) {
  return font.asset ? metrics.get(fontPath(font.asset, face)) ?? standardMetrics("Helvetica") : standardMetrics(standardPostScript(font, face));
}

export function loadFontMetrics(font: DraftFont, face: FontFaceStyle) {
  if (!font.asset) return Promise.resolve(getFontMetrics(font, face));
  const asset = font.asset;
  const key = fontPath(asset, face);
  const cached = metrics.get(key);
  if (cached) return Promise.resolve(cached);
  let pending = loadingMetrics.get(key);
  if (!pending) {
    pending = Promise.all([import("@pdf-lib/fontkit"), fontBytes(asset, face)]).then(([{ default: fontkit }, buffer]) => {
      const source = fontkit.create(new Uint8Array(buffer));
      const characters = new Set(source.characterSet);
      const result: DocumentFontMetrics = {
        ascent: source.ascent / source.unitsPerEm, descent: Math.abs(source.descent) / source.unitsPerEm,
        supports: (char) => characters.has(char),
        measure: (text, size) => source.layout(text).glyphs.reduce((width, glyph) => width + glyph.advanceWidth, 0) * size / source.unitsPerEm,
      };
      metrics.set(key, result);
      return result;
    }).finally(() => loadingMetrics.delete(key));
    loadingMetrics.set(key, pending);
  }
  return pending;
}

export function prepareOverlayFont(font: DraftFont) {
  const faces = new Set(fontFaces.map((style) => faceFor(font, style === "bold" || style === "boldItalic", style === "italic" || style === "boldItalic")));
  return Promise.all([ensureBrowserFont(font), ...[...faces].map((face) => loadFontMetrics(font, face))]);
}

export function assertFontCoverage(font: DraftFont, metrics: DocumentFontMetrics, text: string) {
  if (Array.from(text).some((char) => !/[\n\r\t]/.test(char) && !metrics.supports(char.codePointAt(0)!))) {
    throw new Error(`${font.name} cannot display one or more characters in this PDF. Select a font with the required characters, such as Roboto for supported Greek or Cyrillic text.`);
  }
}
