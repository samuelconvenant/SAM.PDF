import { degrees } from "pdf-lib";
import type { PDFPage } from "pdf-lib";

export function coordinates(page: PDFPage) {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  let left = Math.max(media.x, crop.x);
  let bottom = Math.max(media.y, crop.y);
  let right = Math.min(media.x + media.width, crop.x + crop.width);
  let top = Math.min(media.y + media.height, crop.y + crop.height);
  if (right <= left || top <= bottom) {
    ({ x: left, y: bottom } = media);
    right = left + media.width;
    top = bottom + media.height;
  }
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  const swap = angle === 90 || angle === 270;
  const width = swap ? top - bottom : right - left;
  const height = swap ? right - left : top - bottom;
  if (![0, 90, 180, 270].includes(angle) || width <= 0 || height <= 0) throw new Error("The page dimensions or rotation are unsupported.");

  function point(x: number, y: number) {
    switch (angle) {
      case 90: return { x: left + y, y: bottom + x };
      case 180: return { x: right - x, y: bottom + y };
      case 270: return { x: right - y, y: top - x };
      default: return { x: left + x, y: top - y };
    }
  }
  function visual(x: number, y: number) {
    switch (angle) {
      case 90: return { x: y - bottom, y: x - left };
      case 180: return { x: right - x, y: y - bottom };
      case 270: return { x: top - y, y: right - x };
      default: return { x: x - left, y: top - y };
    }
  }
  return { width, height, point, visual, rotate: degrees(angle) };
}
