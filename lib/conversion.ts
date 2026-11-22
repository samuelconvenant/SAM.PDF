export const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const conversionMaxBytes = 25 * 1024 * 1024;
export const conversionKinds = ["pdf-to-word", "word-to-pdf"] as const;
export type ConversionKind = (typeof conversionKinds)[number];
