import type { Operation } from "./tools";
import type { EditorPage } from "./editor-types";

export type PageEdit = { index: number; rotation: number; width: number; height: number };
export type ImageFit = "fit" | "a4";
export type Job =
  | { type: "inspect"; files: File[]; image: boolean }
  | { type: "process"; operation: Operation; files: File[]; ranges: string; pages: PageEdit[]; fit: ImageFit; edits?: EditorPage[] };

export type JobResult =
  | { type: "inspected"; pages: PageEdit[]; counts: number[] }
  | { type: "processed"; data: ArrayBuffer; name: string; mime: string }
  | { type: "error"; message: string };
