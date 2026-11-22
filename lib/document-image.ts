export type DocumentImage = { data: string; width: number; height: number };

export async function readDocumentImage(file: File, photosOnly = false): Promise<DocumentImage> {
  if (!file.size || file.size > 12 * 1024 * 1024) throw new Error("Choose a non-empty image of 12 MiB or less.");
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte);
  const prefix = new TextDecoder().decode(header);
  const other = prefix.startsWith("GIF87a") || prefix.startsWith("GIF89a") ||
    prefix.startsWith("BM") || (prefix.startsWith("RIFF") && prefix.slice(8, 12) === "WEBP");
  if (!jpeg && !png && (photosOnly || !other)) {
    throw new Error(photosOnly ? "Choose a JPEG or PNG photo." : "Choose an image in JPEG, PNG, WebP, GIF, or BMP format.");
  }
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("This image could not be opened."); });
  try {
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image preparation is unavailable in this browser.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL(jpeg ? "image/jpeg" : "image/png", .94), width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
  }
}
