"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { ChevronLeft, ChevronRight, ImagePlus, Minus, Plus, Redo2, RotateCw, Trash2, Undo2 } from "lucide-react";
import type { EditorPage, Overlay, Point } from "../lib/editor-types";
import type { PageEdit } from "../lib/pdf-protocol";
import { PagePreviews, PageThumbnail, PdfCanvas } from "./page-preview";
import type { PageGeometry } from "./page-preview";
import { readDocumentImage } from "../lib/document-image";
import { clamp, overlayFonts, photoLayout, textBoxLines } from "../lib/overlay-layout";
import type { OverlayFont } from "../lib/overlay-layout";

type Mode = "select" | Exclude<Overlay["kind"], "image">;
type History = { past: EditorPage[][]; present: EditorPage[]; future: EditorPage[][] };
const modeNames = { select: "Select", text: "Text", rectangle: "Rectangle", highlight: "Highlight", ink: "Draw", image: "Image" };
const modes: Mode[] = ["select", "text", "rectangle", "highlight", "ink"];
const colorFor = (kind: Overlay["kind"]) => kind === "highlight" ? "#efd34e" : "#872922";
const fontNames: Record<OverlayFont, string> = { Helvetica: "Sans serif", "Times-Roman": "Serif", Courier: "Monospace" };
const pointsPerMillimeter = 72 / 25.4;
const cropSides = ["left", "top", "right", "bottom"] as const;

function textBox(point: Point): Omit<Overlay, "id"> {
  return { kind: "text", color: colorFor("text"), font: "Helvetica", x: clamp(point.x, .94), y: clamp(point.y, .94),
    width: Math.min(.65, 1 - clamp(point.x, .94)), height: Math.min(.16, 1 - clamp(point.y, .94)), text: "New text", size: 20, points: [] };
}

function Mark({ value, width, height, selected, onSelect, onResize }: {
  value: Overlay; width: number; height: number; selected: boolean;
  onSelect?: (event: PointerEvent<SVGGElement>) => void;
  onResize?: (event: PointerEvent<SVGRectElement>) => void;
}) {
  const x = value.x * width;
  const y = value.y * height;
  const boxWidth = value.width * width;
  const boxHeight = value.height * height;
  const boxed = value.kind === "text" || value.kind === "image";
  const fit = value.photo ? photoLayout(value, boxWidth, boxHeight) : null;
  const points = value.points.map((point) => `${(point.x + value.x) * width},${(point.y + value.y) * height}`).join(" ");
  return <g className="editor-mark" data-selected={selected} onPointerDown={onSelect}>
    {boxed ? <>
      <svg x={x} y={y} width={boxWidth} height={boxHeight} overflow="hidden" className="editor-box-content">
        <rect width={boxWidth} height={boxHeight} fill={value.cover ? "white" : "transparent"} />
        {fit && value.photo ? <image href={value.photo.data} {...fit} preserveAspectRatio="none" /> :
          <text fill={value.color} fontFamily={overlayFonts[value.font ?? "Helvetica"]} fontSize={value.size}>
            {textBoxLines(value, boxWidth, boxHeight).map((line, index) => <tspan x={line.x} y={line.y} key={index}>{line.text}</tspan>)}
          </text>}
      </svg>
      {selected && <>
        <rect className="editor-object-outline" x={x} y={y} width={boxWidth} height={boxHeight} fill="none" />
        <rect className="editor-resize-handle" x={x + boxWidth - 5} y={y + boxHeight - 5} width={10} height={10} onPointerDown={onResize} />
      </>}
    </> : value.kind === "ink" ? <polyline points={points} fill="none" stroke={value.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /> :
      <rect x={x} y={y} width={boxWidth} height={boxHeight}
        fill={value.kind === "highlight" ? value.color : "transparent"} fillOpacity={value.kind === "highlight" ? .32 : 0} stroke={value.kind === "rectangle" ? value.color : "none"} strokeWidth={2} />}
  </g>;
}

function OverlayLayer({ geometry, page, mode, selected, busy, onAdd, onUpdate, onSelect, onPhoto, typing, onExitTyping }: {
  geometry: PageGeometry; page: EditorPage; mode: Mode; selected: number | null; busy: boolean;
  onAdd: (overlay: Omit<Overlay, "id">) => void; onUpdate: (id: number, patch: Partial<Overlay>) => void; onSelect: (id: number | null) => void;
  onPhoto: (file: File, point: Point) => void; typing: number | null; onExitTyping: () => void;
}) {
  const group = useRef<SVGGElement>(null);
  const gesture = useRef<{ start: Point; draft: Overlay; existing: boolean; resizing: boolean } | null>(null);
  const animation = useRef(0);
  const [draft, setDraft] = useState<Overlay | null>(null);
  const { baseWidth: width, baseHeight: height, rotation } = geometry;
  const sideways = rotation === 90 || rotation === 270;
  const transform = { 0: "", 90: `translate(${height} 0) rotate(90)`, 180: `translate(${width} ${height}) rotate(180)`, 270: `translate(0 ${width}) rotate(270)` }[rotation] ?? "";
  useEffect(() => () => cancelAnimationFrame(animation.current), []);

  function endGesture() {
    const current = gesture.current;
    gesture.current = null;
    cancelAnimationFrame(animation.current);
    animation.current = 0;
    setDraft(null);
    return current;
  }

  function position(event: { clientX: number; clientY: number }): Point | null {
    const matrix = group.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: clamp(point.x / width), y: clamp(point.y / height) };
  }

  function capture(event: PointerEvent, overlay: Overlay, start: Point, existing: boolean, resizing = false) {
    const svg = group.current?.ownerSVGElement;
    svg?.setPointerCapture(event.pointerId);
    gesture.current = { start, draft: overlay, existing, resizing };
    setDraft(overlay);
  }

  const inline = page.overlays.find((item) => item.id === typing && item.kind === "text");
  return <svg className="editor-overlay" data-mode={mode} viewBox={`0 0 ${sideways ? height : width} ${sideways ? width : height}`} aria-hidden={!inline || undefined}
    onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
    onDrop={(event) => {
      const point = position(event);
      const file = event.dataTransfer.files[0];
      if (!point || !file || busy) return;
      event.preventDefault();
      onPhoto(file, point);
    }}
    onPointerDown={(event) => {
      if (busy || event.button !== 0) return;
      if (mode === "select") { onSelect(null); onExitTyping(); return; }
      const start = position(event);
      if (!start) return;
      const overlay: Overlay = { id: 0, kind: mode, color: colorFor(mode), ...start, width: 0, height: 0, text: "New text", size: 20, points: [{ x: 0, y: 0 }] };
      if (mode === "text") onAdd(textBox(start));
      else capture(event, overlay, start, false);
    }}
    onPointerMove={(event) => {
      const current = gesture.current;
      const point = current && position(event);
      if (!point || !current) return;
      const { start, existing } = current;
      const next = current.draft;
      if (existing) {
        const original = page.overlays.find((item) => item.id === next.id);
        if (!original) return;
        if (current.resizing) {
          current.draft = { ...next,
            width: Math.max(.01, clamp(original.width + point.x - start.x, 1 - original.x)),
            height: Math.max(.01, clamp(original.height + point.y - start.y, 1 - original.y)) };
        } else {
          current.draft = { ...next,
            x: clamp(original.x + point.x - start.x, 1 - (original.kind === "ink" ? 0 : original.width)),
            y: clamp(original.y + point.y - start.y, 1 - (original.kind === "ink" ? 0 : original.height)) };
        }
      } else if (next.kind === "ink") {
        if (next.points.length >= 2000) return;
        current.draft = { ...next, points: [...next.points, { x: point.x - start.x, y: point.y - start.y }] };
      } else {
        current.draft = { ...next, x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) };
      }
      if (!animation.current) animation.current = requestAnimationFrame(() => {
        animation.current = 0;
        setDraft(gesture.current?.draft ?? null);
      });
    }}
    onPointerUp={() => {
      const current = endGesture();
      if (!current) return;
      const value = current.draft;
      if (current.existing) {
        const original = page.overlays.find((item) => item.id === value.id);
        if (original && (original.x !== value.x || original.y !== value.y || original.width !== value.width || original.height !== value.height)) {
          onUpdate(value.id, { x: value.x, y: value.y, width: value.width, height: value.height });
        }
      } else if (value.kind === "ink" ? value.points.length > 1 : value.width > .005 && value.height > .005) onAdd(value);
    }}
    onPointerCancel={endGesture} onLostPointerCapture={() => { if (gesture.current) endGesture(); }}>
    <g ref={group} transform={transform}>
      {page.overlays.map((item) => <Mark key={item.id} value={draft?.id === item.id ? draft : item} width={width} height={height} selected={selected === item.id}
        onResize={(event) => {
          if (busy || event.button !== 0) return;
          event.stopPropagation();
          const point = position(event);
          if (point) capture(event, item, point, true, true);
        }}
        onSelect={(event) => {
        if (mode !== "select" || busy || event.button !== 0) return;
        event.stopPropagation();
        onExitTyping();
        onSelect(item.id);
        const point = position(event);
        if (point) capture(event, item, point, true);
      }} />)}
      {draft?.id === 0 && <Mark value={draft} width={width} height={height} selected={false} />}
      {inline && <foreignObject x={inline.x * width} y={inline.y * height} width={inline.width * width} height={inline.height * height} className="editor-inline-box" onPointerDown={(event) => event.stopPropagation()}>
        <textarea aria-label="Type in text box" autoFocus value={inline.text} maxLength={1000} spellCheck={false}
          style={{ color: inline.color, fontFamily: overlayFonts[inline.font ?? "Helvetica"], fontSize: inline.size }}
          onChange={(event) => onUpdate(inline.id, { text: event.currentTarget.value })}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => { if (event.key === "Escape") onExitTyping(); }}
          onBlur={onExitTyping} />
      </foreignObject>}
    </g>
  </svg>;
}

export default function PdfEditor({ file, pages, busy, onChange, onPreview, onReset }: {
  file: File; pages: PageEdit[]; busy: boolean; onChange: () => void; onPreview: (pages: EditorPage[]) => Promise<void>; onReset: () => void;
}) {
  const [history, setHistory] = useState<History>(() => ({ past: [], present: pages.map((page) => ({ ...page, overlays: [] })), future: [] }));
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<Mode>("select");
  const [selected, setSelected] = useState<number | null>(null);
  const [typing, setTyping] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [imageError, setImageError] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const photoJob = useRef(false);
  const counter = useRef(0);
  const current = Math.min(index, history.present.length - 1);
  const page = history.present[current];
  const mark = page.overlays.find((item) => item.id === selected);

  function commit(change: EditorPage[] | ((previous: EditorPage[]) => EditorPage[])) {
    onChange();
    setHistory(({ past, present: previous }) => ({ past: [...past.slice(-79), previous], present: typeof change === "function" ? change(previous) : change, future: [] }));
  }
  function editPage(patch: Partial<EditorPage>) {
    commit(history.present.map((item, position) => position === current ? { ...item, ...patch } : item));
  }
  function navigate(next: number) {
    setIndex(next);
    setSelected(null);
    setTyping(null);
  }
  function update(id: number, patch: Partial<Overlay>) {
    editPage({ overlays: page.overlays.map((item) => item.id === id ? { ...item, ...patch } : item) });
  }
  function add(overlay: Omit<Overlay, "id">, typeOnPage = false) {
    const id = ++counter.current;
    editPage({ overlays: [...page.overlays, { ...overlay, id }] });
    setSelected(id);
    setTyping(typeOnPage && overlay.kind === "text" ? id : null);
    setMode("select");
  }
  async function addPhoto(file: File, point: Point = { x: .12, y: .16 }) {
    if (photoJob.current || busy) return;
    photoJob.current = true;
    setImporting(true);
    setImageError("");
    try {
      const photo = await readDocumentImage(file, true);
      const width = Math.min(.3, .36 * page.height / page.width * photo.width / photo.height);
      const height = width * page.width / page.height * photo.height / photo.width;
      const id = ++counter.current;
      const overlay: Overlay = {
        id, kind: "image", photo, color: "#000000", text: "", points: [], size: 20,
        x: clamp(point.x, 1 - width), y: clamp(point.y, 1 - height), width, height,
      };
      commit((previous) => previous.map((item) => item.index === page.index ? { ...item, overlays: [...item.overlays, overlay] } : item));
      setSelected(id);
      setTyping(null);
      setMode("select");
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "This photo could not be inserted.");
    } finally {
      photoJob.current = false;
      setImporting(false);
    }
  }
  function step(direction: "undo" | "redo") {
    onChange();
    setSelected(null);
    setTyping(null);
    setHistory(({ past, present, future }) => direction === "undo"
      ? { past: past.slice(0, -1), present: past[past.length - 1], future: [present, ...future] }
      : { past: [...past, present], present: future[0], future: future.slice(1) });
  }

  return <PagePreviews file={file}>
    <div className="editor" aria-label="PDF overlay editor">
      <header className="editor-top">
        <div><h2>Document editor</h2><p>{file.name}</p></div>
        <button type="button" className="button primary" disabled={busy || importing} onClick={() => void onPreview(history.present)}>Preview edited PDF</button>
      </header>
      <p className="editor-note">Add text boxes and photos to the uploaded PDF. Drag an item to move it, or use its handle to resize it.</p>
      <div className="preview-tools editor-tools" role="group" aria-label="Editing controls">
        {modes.map((item) => <button key={item} type="button" className="button secondary compact" disabled={busy} aria-pressed={mode === item} onClick={() => setMode(item)}>{modeNames[item]}</button>)}
        <input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" ref={photoInput} hidden aria-label="Import JPEG or PNG photo" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void addPhoto(file);
        }} />
        <button type="button" className="button secondary compact" disabled={busy || importing} onClick={() => photoInput.current?.click()}><ImagePlus size={16} aria-hidden="true" /> Add image</button>
        <button type="button" className="icon-button" aria-label="Undo" disabled={busy || !history.past.length} onClick={() => step("undo")}><Undo2 size={18} /></button>
        <button type="button" className="icon-button" aria-label="Redo" disabled={busy || !history.future.length} onClick={() => step("redo")}><Redo2 size={18} /></button>
        <button type="button" className="icon-button" aria-label="Rotate selected page" disabled={busy} onClick={() => editPage({ rotation: (page.rotation + 90) % 360 })}><RotateCw size={18} /></button>
        <button type="button" className="icon-button" aria-label="Delete selected page" disabled={busy || history.present.length < 2} onClick={() => {
          commit(history.present.filter((_, position) => position !== current));
          navigate(Math.min(current, history.present.length - 2));
        }}><Trash2 size={18} /></button>
      </div>
      {importing && <p className="editor-note" role="status">Preparing image…</p>}
      {imageError && <p className="workspace-error" role="alert">{imageError}</p>}
      <div className="preview-tools" aria-label="Editor view controls">
        <button type="button" className="icon-button" aria-label="Previous editor page" disabled={!current} onClick={() => navigate(current - 1)}><ChevronLeft size={18} /></button>
        <span className="page-indicator" role="status">{current + 1} / {history.present.length}</span>
        <button type="button" className="icon-button" aria-label="Next editor page" disabled={current === history.present.length - 1} onClick={() => navigate(current + 1)}><ChevronRight size={18} /></button>
        <button type="button" className="icon-button" aria-label="Zoom out editor" disabled={zoom <= .5} onClick={() => setZoom(zoom - .25)}><Minus size={18} /></button>
        <span className="page-indicator">{Math.round(zoom * 100)}%</span>
        <button type="button" className="icon-button" aria-label="Zoom in editor" disabled={zoom >= 2.5} onClick={() => setZoom(zoom + .25)}><Plus size={18} /></button>
      </div>
      <div className="editor-grid">
        <ol className="preview-thumbnails" aria-label="Editor page thumbnails">
          {history.present.map((item, position) => <li key={item.index}><button type="button" aria-label={`Select page ${position + 1}`} aria-current={position === current ? "page" : undefined} onClick={() => navigate(position)}>
            <PageThumbnail index={item.index} rotation={item.rotation} /><span>{position + 1}</span>
          </button></li>)}
        </ol>
        <PdfCanvas index={page.index} rotation={page.rotation} zoom={zoom} overlay={(geometry, displayedPage) => {
          const visible = history.present.find((item) => item.index === displayedPage);
          const active = displayedPage === page.index;
          return visible && <OverlayLayer key={displayedPage} geometry={geometry} page={visible} mode={mode}
            selected={active ? selected : null} busy={busy || !active} onAdd={(item) => add(item, mode === "text")} onUpdate={update}
            onSelect={setSelected} onPhoto={(file, point) => void addPhoto(file, point)} typing={active ? typing : null} onExitTyping={() => setTyping(null)} />;
        }} />
        <aside className="editor-properties" aria-label="Overlay properties">
          <h3>Page additions</h3>
          <button type="button" className="button secondary compact" disabled={busy} onClick={() => add(textBox({ x: .15, y: .18 }))}>Add text box</button>
          {page.overlays.length > 0 && <label className="field">Selected annotation<select value={selected ?? ""} onChange={(event) => {
            setTyping(null);
            setSelected(event.currentTarget.value ? Number(event.currentTarget.value) : null);
          }}>
            <option value="">Select an annotation</option>{page.overlays.map((item) => <option value={item.id} key={item.id}>{modeNames[item.kind]} {item.id}</option>)}
          </select></label>}
          {mark ? <>
            {mark.kind === "text" && <>
              <label className="field">Overlay text<textarea maxLength={1000} disabled={busy} value={mark.text} onChange={(event) => update(mark.id, { text: event.currentTarget.value })} /></label>
              <button type="button" className="button secondary compact" disabled={busy} onClick={() => setTyping(mark.id)}>Type on page</button>
              <label className="field">Text font<select disabled={busy} value={mark.font ?? "Helvetica"} onChange={(event) => update(mark.id, { font: event.currentTarget.value as OverlayFont })}>
                {Object.entries(fontNames).map(([value, name]) => <option value={value} key={value}>{name}</option>)}
              </select></label>
              <label className="field">Font size <select disabled={busy} value={mark.size} onChange={(event) => update(mark.id, { size: Number(event.currentTarget.value) })}>
                {[8, 10, 12, 14, 16, 18, 20, 24, 30, 36, 48, 60].map((size) => <option key={size} value={size}>{size} pt</option>)}
              </select></label>
              <label className="editor-toggle"><input type="checkbox" disabled={busy} checked={!!mark.cover} onChange={(event) => update(mark.id, { cover: event.currentTarget.checked })} /> White background</label>
              {mark.cover && <p>This covers what you see. The original text remains searchable and extractable.</p>}
            </>}
            {mark.kind !== "image" && <label className="field">Color<input type="color" disabled={busy} value={mark.color} onChange={(event) => update(mark.id, { color: event.currentTarget.value })} /></label>}
            <div className="position-controls">{(["x", "y"] as const).map((axis) => <label key={axis} className="field">{axis === "x" ? "Left %" : "Top %"}<input type="number" min={0} max={100} step=".01" disabled={busy} value={Number((mark[axis] * 100).toFixed(2))} onChange={(event) => {
              if (Number.isFinite(event.currentTarget.valueAsNumber)) update(mark.id, {
                [axis]: clamp(event.currentTarget.valueAsNumber / 100, 1 - (axis === "x" ? mark.width : mark.height)),
              });
            }} /></label>)}</div>
            {(mark.kind === "image" || mark.kind === "text") && <div className="position-controls">
              {(["width", "height"] as const).map((axis) => <label key={axis} className="field">{axis === "width" ? "Width mm" : "Height mm"}
                <input type="number" min={1} step=".1" disabled={busy} value={Number((mark[axis] * page[axis] / pointsPerMillimeter).toFixed(1))} onChange={(event) => {
                  const millimeters = event.currentTarget.valueAsNumber;
                  const start = axis === "width" ? mark.x : mark.y;
                  if (Number.isFinite(millimeters)) update(mark.id, { [axis]: clamp(Math.max(1, millimeters) * pointsPerMillimeter / page[axis], 1 - start) });
                }} />
              </label>)}
            </div>}
            {mark.kind === "image" && <>
              <label className="field">Photo size<select disabled={busy} value="" onChange={(event) => {
                if (!event.currentTarget.value) return;
                const [wide, tall] = event.currentTarget.value.split("x").map(Number);
                const width = clamp(wide * pointsPerMillimeter / page.width);
                const height = clamp(tall * pointsPerMillimeter / page.height);
                update(mark.id, { width, height, x: clamp(mark.x, 1 - width), y: clamp(mark.y, 1 - height) });
              }}>
                <option value="">Choose a preset</option><option value="35x45">35 × 45 mm</option><option value="50.8x50.8">2 × 2 inches</option>
              </select></label>
              <details className="editor-crop"><summary>Crop image</summary>
                <div className="position-controls">{cropSides.map((side) => <label key={side} className="field">Crop {side} %
                  <input type="number" min={0} max={45} disabled={busy} value={Math.round((mark.crop?.[side] ?? 0) * 100)} onChange={(event) => {
                    if (Number.isFinite(event.currentTarget.valueAsNumber)) update(mark.id, {
                      crop: { left: 0, top: 0, right: 0, bottom: 0, ...mark.crop, [side]: clamp(event.currentTarget.valueAsNumber / 100, .45) },
                    });
                  }} />
                </label>)}</div>
              </details>
            </>}
            <button type="button" className="text-button" disabled={busy} onClick={() => {
              editPage({ overlays: page.overlays.filter((item) => item.id !== mark.id) });
              setSelected(null);
              setTyping(null);
            }}>Remove annotation</button>
          </> : <p>{mode === "select" ? "Choose an annotation to edit its properties." : mode === "text" ? "Select a position on the page for the text." : "Drag on the page to place your annotation."}</p>}
        </aside>
      </div>
      <button type="button" className="text-button editor-reset" onClick={onReset}>Clear workspace</button>
    </div>
  </PagePreviews>;
}
