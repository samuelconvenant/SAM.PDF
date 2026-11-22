export const defaultTableFormatting = { widthPercent: 100, padding: 6, borderWidth: 1, borderColor: "#84775e" };

export function tableFormatting(attrs?: Record<string, unknown>) {
  const defaults = defaultTableFormatting;
  return {
    widthPercent: Math.min(100, Math.max(15, Number(attrs?.widthPercent) || defaults.widthPercent)),
    padding: Math.min(28, Math.max(0, Number(attrs?.padding ?? defaults.padding))),
    borderWidth: Math.min(8, Math.max(0, Number(attrs?.borderWidth ?? defaults.borderWidth))),
    borderColor: typeof attrs?.borderColor === "string" && /^#[0-9a-f]{6}$/i.test(attrs.borderColor) ? attrs.borderColor : defaults.borderColor,
  };
}
