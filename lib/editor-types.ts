export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; width: number; height: number };
export type Overlay = {
  id: number;
  kind: "text" | "rectangle" | "highlight" | "ink" | "image";
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  size: number;
  points: Point[];
  font?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  highlight?: string;
  cover?: boolean;
  photo?: DocumentImage;
  crop?: Record<"left" | "top" | "right" | "bottom", number>;
};
export type EditorPage = { index: number; rotation: number; width: number; height: number; overlays: Overlay[] };
import type { DocumentImage } from "./document-image";

