import { z } from "zod";
import { smartPageLimit } from "./smart-commands";

const unit = z.number().min(0).max(1);
const page = z.number().int().min(0).max(smartPageLimit - 1);
const position = z.strictObject({
  edge: z.enum(["top", "bottom", "center"]), align: z.enum(["left", "right", "center"]),
});
const rect = z.strictObject({ x: unit, y: unit, width: unit, height: unit }).refine(
  ({ x, y, width, height }) => width > 0 && height > 0 && x + width <= 1.000001 && y + height <= 1.000001,
);
const point = z.strictObject({ x: unit, y: unit });
const text = z.string().min(1).max(220).regex(/^[^\u0000-\u001f\u007f]+$/u);
const color = z.string().regex(/^#[\da-f]{6}$/i);

export const smartOperation = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("remove_page"), page }),
  z.strictObject({ kind: z.literal("rotate_page"), page, angle: z.literal([90, -90, 180, 270, -270]) }),
  z.strictObject({ kind: z.literal("reorder_pages"), order: z.array(page).min(1).max(smartPageLimit) }),
  z.strictObject({ kind: z.literal("add_page_numbers"), position }),
  z.strictObject({ kind: z.literal("add_text"), page, text, position, anchor: point.optional() }),
  z.strictObject({ kind: z.literal("cover_text"), page, text, cover: rect, baseline: point, size: z.number().min(6).max(96),
    bold: z.boolean(), color, serif: z.boolean().optional(), right: unit.optional() }),
  z.strictObject({ kind: z.literal("set_field"), page, field: z.string().min(1).max(240), before: z.string().max(2000), text }),
  z.strictObject({ kind: z.literal("insert_image"), page, box: rect }),
]);

export type SmartOperation = z.infer<typeof smartOperation>;
export type SmartRect = z.infer<typeof rect>;
export const smartOperations = z.array(smartOperation).min(1).max(16);
export type SmartJob = { source: File; operations: SmartOperation[]; image?: string };

export function operationLabel(operation: SmartOperation) {
  const where = "page" in operation ? `page ${operation.page + 1}` : "";
  switch (operation.kind) {
    case "remove_page": return `Remove ${where}`;
    case "rotate_page": return `Rotate ${where} ${Math.abs(operation.angle)}° ${operation.angle < 0 ? "counterclockwise" : "clockwise"}`;
    case "reorder_pages": return `Reorder pages to ${operation.order.map((index) => index + 1).join(", ")}`;
    case "add_page_numbers": return "Add a number to each page";
    case "add_text": return `Add “${operation.text}” on ${where}`;
    case "cover_text": return `Cover original text on ${where} with “${operation.text}”`;
    case "set_field": return `Update the fillable field on ${where}`;
    case "insert_image": return `Place the uploaded photo on ${where}`;
  }
}
