import type { Bounds, Overlay, Point } from "./editor-types";
import { faceFor, findDraftFont } from "./draft-fonts";
import { getFontMetrics } from "./document-fonts";
import type { DocumentFontMetrics } from "./document-fonts";
export const clamp = (value: number, max = 1) => Math.max(0, Math.min(max, value));

export const resizeEdges = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type ResizeEdge = (typeof resizeEdges)[number];

export function moveOverlay(box: Overlay, delta: Point, snap?: Point) {
  const x = clamp(box.x + delta.x, 1 - (box.kind === "ink" ? 0 : box.width));
  const y = clamp(box.y + delta.y, 1 - (box.kind === "ink" ? 0 : box.height));
  const centerX = .5 - box.width / 2;
  const centerY = .5 - box.height / 2;
  return {
    x: snap && Math.abs(x - centerX) <= snap.x ? centerX : x,
    y: snap && Math.abs(y - centerY) <= snap.y ? centerY : y,
  };
}

export function resizeOverlay(box: Bounds, edge: ResizeEdge, delta: Point, minimum: Point): Bounds {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const minWidth = Math.min(minimum.x, box.width);
  const minHeight = Math.min(minimum.y, box.height);
  const x = edge.includes("w") ? clamp(box.x + delta.x, right - minWidth) : box.x;
  const y = edge.includes("n") ? clamp(box.y + delta.y, bottom - minHeight) : box.y;
  return { x, y,
    width: (edge.includes("e") ? Math.max(x + minWidth, clamp(right + delta.x)) : right) - x,
    height: (edge.includes("s") ? Math.max(y + minHeight, clamp(bottom + delta.y)) : bottom) - y,
  };
}

export function overlayFont(overlay: Overlay) {
  const family = findDraftFont(overlay.font ?? "Helvetica");
  return { family, face: faceFor(family, overlay.bold, overlay.italic) };
}

export function textBoxLines(overlay: Overlay, width: number, height: number, loaded?: DocumentFontMetrics) {
  const { family, face } = overlayFont(overlay);
  const font = loaded ?? getFontMetrics(family, face);
  const fontSize = overlay.size;
  const padding = 2;
  const limit = Math.max(1, width - padding * 2);
  const lines: string[] = [];
  const measure = (text: string) => font.measure(text, fontSize);
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
  const ascent = font.ascent * fontSize;
  const descender = font.descent * fontSize;
  return lines.map((text, index) => ({ text, x: padding, y: padding + ascent + index * fontSize * 1.2,
    width: measure(text), ascent, height: ascent + descender }))
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
