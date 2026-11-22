import { Encodings, Font } from "@pdf-lib/standard-fonts";
import type { Overlay } from "./editor-types";

export const overlayFonts = {
  Helvetica: "Arial, Helvetica, sans-serif",
  "Times-Roman": "'Times New Roman', Times, serif",
  Courier: "'Courier New', Courier, monospace",
};
export type OverlayFont = keyof typeof overlayFonts;
export const clamp = (value: number, max = 1) => Math.max(0, Math.min(max, value));

export function textBoxLines(overlay: Overlay, width: number, height: number) {
  const font = Font.load(overlay.font ?? "Helvetica");
  const fontSize = overlay.size;
  const padding = 2;
  const limit = Math.max(1, width - padding * 2);
  const lines: string[] = [];
  function measure(text: string) {
    let advance = 0;
    let previous = "";
    for (const character of text) {
      const code = character.codePointAt(0)!;
      const glyph = Encodings.WinAnsi.canEncodeUnicodeCodePoint(code) ? Encodings.WinAnsi.encodeUnicodeCodePoint(code).name : "question";
      advance += (font.getWidthOfGlyph(glyph) ?? 500) + (font.getXAxisKerningForPair(previous, glyph) ?? 0);
      previous = glyph;
    }
    return advance * fontSize / 1000;
  }
  for (const paragraph of overlay.text.replace(/\r/g, "").replace(/\t/g, "    ").split("\n")) {
    let line = "";
    for (const token of paragraph.match(/\S+|\s+/g) ?? []) {
      if (line && measure(line + token) > limit) {
        lines.push(line.trimEnd());
        line = "";
      }
      if (!line && /^\s+$/.test(token)) continue;
      for (const character of token) {
        if (line && measure(line + character) > limit) {
          lines.push(line.trimEnd());
          line = "";
        }
        line += character;
      }
    }
    lines.push(line.trimEnd());
  }
  const baseline = Math.max(0, font.Ascender ?? 780) * fontSize / 1000 + padding;
  const descender = Math.abs(font.Descender ?? -220) * fontSize / 1000;
  return lines.map((text, index) => ({ text, x: padding, y: baseline + index * fontSize * 1.2 }))
    .filter((line) => line.y + descender <= height);
}

export function photoLayout(overlay: Overlay, width: number, height: number) {
  const photo = overlay.photo!;
  const { left, top, right, bottom } = overlay.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const visibleWidth = photo.width * (1 - left - right);
  const visibleHeight = photo.height * (1 - top - bottom);
  const scale = Math.max(width / visibleWidth, height / visibleHeight);
  return {
    x: (width - visibleWidth * scale) / 2 - photo.width * left * scale,
    y: (height - visibleHeight * scale) / 2 - photo.height * top * scale,
    width: photo.width * scale,
    height: photo.height * scale,
  };
}
