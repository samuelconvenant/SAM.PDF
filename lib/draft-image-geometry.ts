export const draftWidth = 665;
export const draftHeight = 985;

export type DraftImageAttributes = {
  src: string; alt: string | null; width: number; height: number; sourceWidth: number; sourceHeight: number;
  position: "left" | "center" | "right"; layout: "inline" | "floating"; x: number; y: number;
  angle: number; layer: number; ratioLocked: boolean; crop: [number, number, number, number];
};

export function draftImage(attrs: Record<string, unknown> | undefined): DraftImageAttributes {
  const width = Number(attrs?.width) || 320;
  const height = Number(attrs?.height) || 200;
  return {
    src: String(attrs?.src ?? ""), alt: typeof attrs?.alt === "string" ? attrs.alt : null,
    width, height, sourceWidth: Number(attrs?.sourceWidth) || width, sourceHeight: Number(attrs?.sourceHeight) || height,
    position: attrs?.position === "center" || attrs?.position === "right" ? attrs.position : "left",
    layout: attrs?.layout === "floating" ? "floating" : "inline", x: Number(attrs?.x) || 0, y: Number(attrs?.y) || 0,
    angle: Number(attrs?.angle) || 0, layer: Number(attrs?.layer) || 0, ratioLocked: attrs?.ratioLocked !== false,
    crop: Array.isArray(attrs?.crop) && attrs.crop.length === 4 ? attrs.crop as DraftImageAttributes["crop"] : [0, 0, 0, 0],
  };
}

export function turnedSize(image: Pick<DraftImageAttributes, "width" | "height" | "angle">) {
  const angle = image.angle * Math.PI / 180;
  return {
    width: Math.abs(Math.cos(angle)) * image.width + Math.abs(Math.sin(angle)) * image.height,
    height: Math.abs(Math.sin(angle)) * image.width + Math.abs(Math.cos(angle)) * image.height,
  };
}

export function fitDraftImage(image: DraftImageAttributes) {
  const [left, top, right, bottom] = image.crop;
  const width = image.sourceWidth * (1 - left - right);
  const height = image.sourceHeight * (1 - top - bottom);
  const scale = image.ratioLocked ? Math.max(image.width / width, image.height / height) : 0;
  const sx = scale || image.width / width;
  const sy = scale || image.height / height;
  return {
    x: (image.width - width * sx) / 2 - image.sourceWidth * left * sx,
    y: (image.height - height * sy) / 2 - image.sourceHeight * top * sy,
    width: image.sourceWidth * sx, height: image.sourceHeight * sy,
  };
}
