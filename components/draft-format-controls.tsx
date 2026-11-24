"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { draftFonts, findDraftFont, fontCategories, fontDescription } from "../lib/draft-fonts";
import type { DraftFont } from "../lib/draft-fonts";
import { ensureBrowserFont } from "../lib/document-fonts";

const recentKey = "sampdf-recent-fonts";

function recentFonts(): string[] {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(recentKey) ?? "[]");
    return Array.isArray(entries) ? entries.filter((name): name is string => draftFonts.some((font) => font.name === name)).slice(0, 5) : [];
  } catch { return []; }
}

export function FontControl({ value, apply, disabled, prepare = ensureBrowserFont }: {
  value: string; apply: (font: DraftFont) => void; disabled: boolean; prepare?: (font: DraftFont) => Promise<unknown>;
}) {
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [pending, setPending] = useState("");
  const [failure, setFailure] = useState("");
  const details = useRef<HTMLDetailsElement>(null);
  const request = useRef(0);
  const query = search.trim().toLowerCase();
  const results = draftFonts.filter((font) => `${font.name} ${font.equivalent ?? ""} ${font.category}`.toLowerCase().includes(query));
  const chosen = findDraftFont(value);
  useEffect(() => {
    if (!query || !details.current?.open) return;
    for (const font of draftFonts.filter(({ name }) => name.toLowerCase().includes(query)).slice(0, 5)) {
      void ensureBrowserFont(font, false).catch(() => {});
    }
  }, [query]);
  useEffect(() => () => { request.current++; }, []);

  function pick(font: DraftFont) {
    const ticket = ++request.current;
    setFailure("");
    const applyLoaded = () => {
      if (ticket !== request.current) return;
      const next = [font.name, ...recent.filter((name) => name !== font.name)].slice(0, 5);
      try { localStorage.setItem(recentKey, JSON.stringify(next)); } catch {}
      setRecent(next);
      setPending("");
      if (details.current) details.current.open = false;
      apply(font);
    };
    if (!font.asset) { applyLoaded(); return; }
    setPending(font.name);
    void prepare(font).then(applyLoaded).catch(() => {
      if (ticket !== request.current) return;
      setPending("");
      setFailure("This font could not be loaded. Choose it again to retry.");
    });
  }

  return <details ref={details} className="create-menu" onKeyDown={(event) => {
    if (event.key === "Escape" && details.current) { request.current++; setPending(""); details.current.open = false; details.current.querySelector("summary")?.focus(); }
  }} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget) && details.current?.open) { request.current++; setPending(""); details.current.open = false; }
  }}>
    <summary aria-label={`Font picker, ${value}`} aria-disabled={disabled} onClick={(event) => {
      if (disabled) event.preventDefault();
      else { setSearch(""); setRecent(recentFonts()); }
    }} style={{ fontFamily: chosen.css }}>{value}<ChevronDown size={14} aria-hidden="true" /></summary>
    <div className="create-popover">
      <input type="search" className="font-search" aria-label="Search fonts" placeholder="Find a font" value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
      {!query && recent.length > 0 && <div className="recent-fonts" aria-label="Recent fonts">
        <small>Recent fonts</small>
        {recent.map((name) => <button key={name} type="button" className="text-button" disabled={disabled} onClick={() => pick(findDraftFont(name))}>{name}</button>)}
      </div>}
      <select aria-label="Font family" size={Math.min(7, Math.max(2, results.length + 1))} value={results.some((font) => font.name === value) ? value : ""}
        disabled={disabled} onChange={(event) => {
          const font = draftFonts.find((item) => item.name === event.currentTarget.value);
          if (font) pick(font);
        }}>
        <option value="" disabled hidden>Choose a font</option>
        {fontCategories.map((category) => {
          const group = results.filter((font) => font.category === category);
          return group.length ? <optgroup key={category} label={category}>
            {group.map((font) => <option key={font.name} value={font.name} style={{ fontFamily: font.css }}>{font.name}{font.equivalent ? ` · ${font.equivalent}` : ""}</option>)}
          </optgroup> : null;
        })}
      </select>
      {!results.length && <p>No fonts found.</p>}
      <small role="status">{pending ? `Loading ${pending}…` : failure || fontDescription(chosen)}</small>
    </div>
  </details>;
}

export function FontSizeControl({ value, apply, disabled }: { value: string; apply: (size: string) => void; disabled: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const presets = useId();
  function commit() {
    if (draft === null) return;
    const input = draft.trim();
    const size = Number(input);
    if (input && Number.isFinite(size)) apply(`${Math.max(8, Math.min(72, size))}pt`);
    else if (!input) apply("");
    setDraft(null);
  }
  return <label><span className="sr-only">Font size</span>
    <input type="number" min={8} max={72} step="any" list={presets} className="create-size" placeholder="Size"
      disabled={disabled} value={draft ?? (value ? Number.parseFloat(value) : "")} onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} />
    <datalist id={presets}>{[8, 9, 10, 11, 12, 14, 16, 18, 20, 21, 24, 28, 30, 32, 36, 48, 60, 72].map((size) => <option key={size} value={size} />)}</datalist>
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
