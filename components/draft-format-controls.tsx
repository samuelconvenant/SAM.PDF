"use client";

import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { draftFonts, outputFontNames } from "../lib/draft-fonts";

export function FontControl({ value, apply, disabled }: { value: string; apply: (font: string) => void; disabled: boolean }) {
  const [search, setSearch] = useState("");
  const details = useRef<HTMLDetailsElement>(null);
  const query = search.trim().toLowerCase();
  const results = draftFonts.filter((font) => font.name.toLowerCase().includes(query));
  return <details ref={details} className="create-menu" onKeyDown={(event) => {
    if (event.key === "Escape" && details.current) { details.current.open = false; details.current.querySelector("summary")?.focus(); }
  }} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget) && details.current) details.current.open = false;
  }}>
    <summary aria-label={`Font picker, ${value}`} aria-disabled={disabled} onClick={(event) => {
      if (disabled) event.preventDefault();
      else setSearch("");
    }}>{value}<ChevronDown size={14} aria-hidden="true" /></summary>
    <div className="create-popover">
      <input type="search" className="font-search" aria-label="Search fonts" placeholder="Find a font" value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
      <select aria-label="Font family" size={Math.min(7, Math.max(2, results.length + 1))} value={results.some((font) => font.name === value) ? value : ""}
        disabled={disabled} onChange={(event) => {
          const chosen = draftFonts.find((font) => font.name === event.currentTarget.value);
          if (chosen) { if (details.current) details.current.open = false; apply(chosen.css); }
        }}>
        <option value="" disabled hidden>Choose a font</option>
        {results.map((font) => <option key={font.name} value={font.name} style={{ fontFamily: font.css }}>{font.name}</option>)}
      </select>
      {!results.length && <p>No fonts found.</p>}
      <small>PDF export uses {outputFontNames[draftFonts.find((font) => font.name === value)?.pdf ?? "Roboto"]} for this selection.</small>
    </div>
  </details>;
}

export function FontSizeControl({ value, apply, disabled }: { value: string; apply: (size: string) => void; disabled: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  function commit() {
    if (draft === null) return;
    const input = draft.trim();
    const size = Number(input);
    if (input && Number.isFinite(size)) apply(`${Math.max(8, Math.min(72, size))}pt`);
    else if (!input) apply("");
    setDraft(null);
  }
  return <label><span className="sr-only">Font size</span>
    <input type="number" min={8} max={72} step="any" list="draft-font-size-presets" className="create-size" placeholder="Size"
      disabled={disabled} value={draft ?? (value ? Number.parseFloat(value) : "")} onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} />
    <datalist id="draft-font-size-presets">{[8, 10, 12, 14, 16, 18, 21, 24, 28, 32, 36, 48, 60, 72].map((size) => <option key={size} value={size} />)}</datalist>
  </label>;
}

const textColors = { Black: "#222222", Slate: "#475569", Blue: "#245ec4", Red: "#ab252d", Green: "#297545", Purple: "#773fb0" };
const highlights = { Yellow: "#fff181", Green: "#b9ef99", Blue: "#ade3fb", Pink: "#ffc7de", Orange: "#ffd09c", Purple: "#e0c8ff" };
const hex = /^#?[\da-f]{6}$/i;

export function ColorControl({ highlight = false, value, apply, disabled }: {
  highlight?: boolean; value: string; apply: (value: string | null) => void; disabled: boolean;
}) {
  const [custom, setCustom] = useState("");
  const menu = useRef<HTMLDetailsElement>(null);
  const label = highlight ? "Text highlight" : "Text colour";
  const colors = highlight ? highlights : textColors;
  const pick = (color: string | null) => {
    if (menu.current) menu.current.open = false;
    apply(color);
  };
  return <details ref={menu} className="create-menu" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget) && menu.current) menu.current.open = false;
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && menu.current) { menu.current.open = false; menu.current.querySelector("summary")?.focus(); }
  }}>
    <summary aria-label={`${label} options`} aria-disabled={disabled} onClick={(event) => {
      if (disabled) event.preventDefault();
      else setCustom(value || "");
    }}><span className="color-dot" style={{ background: value || (highlight ? "#fff181" : "#222222") }} />{highlight ? "Highlight" : "Colour"}</summary>
    <div className="create-popover">
      <div className="color-swatches">{Object.entries(colors).map(([name, color]) => <button key={name} type="button"
        aria-label={highlight ? `${name} highlight` : `${name} text`} aria-pressed={value === color} title={name}
        style={{ background: color }} onClick={() => pick(color)} />)}</div>
      <label>Custom HEX <input aria-label={`${label} HEX`} type="text" value={custom} placeholder="#000000" maxLength={7}
        onChange={(event) => setCustom(event.currentTarget.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && hex.test(custom)) { event.preventDefault(); pick("#" + custom.replace(/^#/, "").toLowerCase()); }
        }} /></label>
      <div className="format-popover-actions">
        <button type="button" className="button secondary compact" disabled={!hex.test(custom)} onClick={() => pick("#" + custom.replace(/^#/, "").toLowerCase())}>Apply</button>
        <button type="button" className="text-button" onClick={() => pick(null)}>{highlight ? "Remove highlight" : "Default colour"}</button>
      </div>
    </div>
  </details>;
}
