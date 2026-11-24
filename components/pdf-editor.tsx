"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { PointerEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bold, ChevronLeft, ChevronRight, Crop, Download, Ellipsis, Files, ImagePlus, Italic, Minus, MousePointer2, Move, Plus, Redo2, RotateCw, Scaling, Trash2, Type, Underline, Undo2 } from "lucide-react";
import type { Bounds, EditorPage, Overlay, Point } from "../lib/editor-types";
import type { PageEdit } from "../lib/pdf-protocol";
import { PagePreviews, PageThumbnail, PdfCanvas } from "./page-preview";
import type { PageGeometry } from "./page-preview";
import { readDocumentImage } from "../lib/document-image";
import { clamp, moveOverlay, overlayFont, photoLayout, resizeEdges, resizeOverlay, textBoxLines } from "../lib/overlay-layout";
import type { ResizeEdge } from "../lib/overlay-layout";
import { prepareOverlayFont } from "../lib/document-fonts";
import { ColorControl, FontControl, FontSizeControl } from "./draft-format-controls";

type Mode = "select" | Exclude<Overlay["kind"], "image">;
type MobilePanel = "pages" | "more" | "text" | "move" | "resize" | "style" | "crop";
type History = { past: EditorPage[][]; present: EditorPage[]; future: EditorPage[][] };
const modeNames = { select: "Select", text: "Text", rectangle: "Rectangle", highlight: "Highlight", ink: "Draw", image: "Image" };
const modes: Mode[] = ["select", "text", "rectangle", "highlight", "ink"];
const colorFor = (kind: Overlay["kind"]) => kind === "highlight" ? "#efd34e" : "#872922";
const textStyles = [["bold", "Bold", Bold], ["italic", "Italic", Italic], ["underline", "Underline", Underline]] as const;
const pointsPerMillimeter = 72 / 25.4;
const cropSides = ["left", "top", "right", "bottom"] as const;

function textBox(point: Point): Omit<Overlay, "id"> {
  return { kind: "text", color: colorFor("text"), font: "Helvetica", x: clamp(point.x, .94), y: clamp(point.y, .94),
    width: Math.min(.65, 1 - clamp(point.x, .94)), height: Math.min(.16, 1 - clamp(point.y, .94)), text: "New text", size: 20, points: [] };
}

function selectionHandles(box: Bounds, pageHeight: number, unit: number) {
  const { x, y, width, height } = box;
  const radius = Math.min(20 * unit, width * .24, height * .24);
  const gripY = y >= 34 * unit ? y - 25 * unit : Math.min(y + height / 2, pageHeight - 16 * unit);
  return [
    { action: "move" as const, x: x + width / 2, y: gripY, radius: Math.min(21 * unit, Math.max(radius, height * .26)), dot: Math.min(11 * unit, Math.max(6 * unit, radius * .65)) },
    ...resizeEdges.map((action) => ({ action, radius, dot: Math.min(5 * unit, radius),
      x: x + (action.includes("w") ? 0 : action.includes("e") ? width : width / 2),
      y: y + (action.includes("n") ? 0 : action.includes("s") ? height : height / 2),
    })),
  ];
}

const Mark = memo(function Mark({ value, width, height, selected, unit, editing = false }: {
  value: Overlay; width: number; height: number; selected: boolean; unit: number; editing?: boolean;
}) {
  const x = value.x * width;
  const y = value.y * height;
  const boxWidth = value.width * width;
  const boxHeight = value.height * height;
  const boxed = value.kind === "text" || value.kind === "image";
  const fit = value.photo ? photoLayout(value, boxWidth, boxHeight) : null;
  const lines = useMemo(() => value.kind === "text" && !editing ? textBoxLines(value, boxWidth, boxHeight) : [], [value.text, value.kind, value.size, value.font, value.bold, value.italic, boxWidth, boxHeight, editing]);
  const points = value.points.map((point) => `${(point.x + value.x) * width},${(point.y + value.y) * height}`).join(" ");
  return <g className="editor-mark" data-overlay-id={value.id} data-overlay-kind={value.kind} data-selected={selected}>
    {boxed ? <>
      <svg x={x} y={y} width={boxWidth} height={boxHeight} overflow="hidden" className="editor-box-content">
        <rect width={boxWidth} height={boxHeight} fill={value.cover ? "white" : "transparent"} />
        {fit && value.photo ? <image href={value.photo.data} {...fit} preserveAspectRatio="none" /> :
          !editing && <>
            {value.highlight && lines.map((line, index) => <rect key={index} x={line.x} y={line.y - line.ascent} width={line.width} height={line.height} fill={value.highlight} />)}
            <text fill={value.color} fontFamily={overlayFont(value).family.css} fontSize={value.size} fontWeight={value.bold ? 700 : 400} fontStyle={value.italic ? "italic" : "normal"}>
              {lines.map((line, index) => <tspan x={line.x} y={line.y} key={index}>{line.text}</tspan>)}
            </text>
            {value.underline && lines.map((line, index) => <path key={index} d={`M${line.x} ${line.y + value.size * .12}h${line.width}`} stroke={value.color} strokeWidth={value.size * .05} />)}
          </>}
      </svg>
      {selected && <>
        <rect className="editor-object-outline" x={x} y={y} width={boxWidth} height={boxHeight} fill="none" />
        {selectionHandles({ x, y, width: boxWidth, height: boxHeight }, height, unit).map((control) =>
          <g className={control.action === "move" ? "editor-grip" : "editor-resize-handle"} data-gesture={control.action} key={control.action} transform={`translate(${control.x} ${control.y})`}>
            <circle r={control.radius} fill="transparent" />
            <circle r={control.dot} className="editor-grip-surface" />
            {control.action === "move" && <path d={`M${-5 * unit} 0h${10 * unit}M0 ${-5 * unit}v${10 * unit}`} className="editor-grip-lines" />}
          </g>)}
      </>}
    </> : value.kind === "ink" ? <polyline points={points} fill="none" stroke={value.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /> :
      <rect x={x} y={y} width={boxWidth} height={boxHeight}
        fill={value.kind === "highlight" ? value.color : "transparent"} fillOpacity={value.kind === "highlight" ? .32 : 0} stroke={value.kind === "rectangle" ? value.color : "none"} strokeWidth={2} />}
  </g>;
});

function OverlayLayer({ geometry, page, mode, selected, busy, onAdd, onUpdate, onSelect, onPhoto, typing, onEdit, onExitTyping, snapping }: {
  geometry: PageGeometry; page: EditorPage; mode: Mode; selected: number | null; busy: boolean;
  onAdd: (overlay: Omit<Overlay, "id">) => void; onUpdate: (id: number, patch: Partial<Overlay>) => void; onSelect: (id: number | null) => void;
  onPhoto: (file: File, point: Point) => void; typing: number | null; onEdit: (id: number) => void; onExitTyping: () => void; snapping: boolean;
}) {
  const group = useRef<SVGGElement>(null);
  const gesture = useRef<{ start: Point; draft: Overlay; original: Overlay; pointer: number; action: "draw" | "move" | ResizeEdge } | null>(null);
  const animation = useRef(0);
  const [draft, setDraft] = useState<Overlay | null>(null);
  const { baseWidth: width, baseHeight: height, rotation } = geometry;
  const sideways = rotation === 90 || rotation === 270;
  const unit = (sideways ? height : width) / geometry.width;
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

  function position(event: { clientX: number; clientY: number }, bounded = true): Point | null {
    const matrix = group.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return bounded ? { x: clamp(point.x / width), y: clamp(point.y / height) } : { x: point.x / width, y: point.y / height };
  }

  function capture(event: PointerEvent, overlay: Overlay, start: Point, action: "draw" | "move" | ResizeEdge) {
    const handle = event.target instanceof Element ? event.target.closest("[data-touch-gesture], [data-overlay-id]") : null;
    const target = action === "draw" ? group.current?.ownerSVGElement : handle ?? group.current?.ownerSVGElement;
    target?.setPointerCapture(event.pointerId);
    gesture.current = { start, draft: overlay, original: overlay, pointer: event.pointerId, action };
    setDraft(overlay);
  }

  const inline = page.overlays.find((item) => item.id === typing && item.kind === "text");
  const selection = draft?.id === selected ? draft : page.overlays.find((item) => item.id === selected);
  const touchHandles = mode === "select" && !busy && selection && !inline && (selection.kind === "text" || selection.kind === "image") ? selectionHandles({
    x: selection.x * width, y: selection.y * height, width: selection.width * width, height: selection.height * height,
  }, height, unit) : [];
  function displayed(x: number, y: number) {
    const horizontal = x / width, vertical = y / height;
    return rotation === 90 ? { x: 1 - vertical, y: horizontal } : rotation === 180 ? { x: 1 - horizontal, y: 1 - vertical }
      : rotation === 270 ? { x: vertical, y: 1 - horizontal } : { x: horizontal, y: vertical };
  }
  const body = selection && !inline && selection.kind === "text" && touchHandles.length ? [
    displayed(selection.x * width, selection.y * height),
    displayed((selection.x + selection.width) * width, (selection.y + selection.height) * height),
  ] : null;

  return <div className="editor-input" data-mode={mode}
    onDoubleClick={(event) => {
      if (mode !== "select" || busy || !(event.target instanceof Element)) return;
      const element = event.target.closest("[data-overlay-id]");
      const id = Number(element?.getAttribute("data-overlay-id"));
      if (page.overlays.some((item) => item.id === id && item.kind === "text") && !event.target.closest("textarea, [data-gesture], [data-touch-gesture]:not(.editor-touch-body)")) {
        event.preventDefault();
        onEdit(id);
      }
    }}
    onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
    onDrop={(event) => {
      const point = position(event);
      const file = event.dataTransfer.files[0];
      if (!point || !file || busy) return;
      event.preventDefault();
      onPhoto(file, point);
    }}
    onPointerDown={(event) => {
      if (busy || event.button !== 0 || !event.isPrimary || gesture.current) return;
      if (mode === "select") {
        const target = event.target instanceof Element ? event.target : null;
        const item = page.overlays.find(({ id }) => id === Number(target?.closest("[data-overlay-id]")?.getAttribute("data-overlay-id")));
        onSelect(item?.id ?? null);
        onExitTyping();
        if (!item) return;
        const control = (target?.getAttribute("data-touch-gesture") ?? target?.closest("[data-gesture]")?.getAttribute("data-gesture")) as "move" | ResizeEdge | undefined;
        if (!control && event.pointerType !== "mouse") return;
        const start = position(event, false);
        if (start) {
          event.preventDefault();
          if (event.pointerType === "mouse") event.currentTarget.closest<HTMLElement>(".pdf-stage")?.focus({ preventScroll: true });
          capture(event, item, start, control ?? "move");
        }
        return;
      }
      const start = position(event);
      if (!start) return;
      const overlay: Overlay = { id: 0, kind: mode, color: colorFor(mode), ...start, width: 0, height: 0, text: "New text", size: 20, points: [{ x: 0, y: 0 }] };
      if (mode === "text") onAdd(textBox(start));
      else capture(event, overlay, start, "draw");
    }}
    onPointerMove={(event) => {
      const current = gesture.current;
      const point = current?.pointer === event.pointerId ? position(event, current.action === "draw") : null;
      if (!point || !current) return;
      const { start, original, action } = current;
      const next = current.draft;
      if (action !== "draw") {
        const delta = { x: point.x - start.x, y: point.y - start.y };
        const threshold = snapping && (original.kind === "text" || original.kind === "image") ? { x: 6 * unit / width, y: 6 * unit / height } : undefined;
        current.draft = { ...next, ...(action === "move" ? moveOverlay(original, delta, threshold) : resizeOverlay(original, action, delta, { x: 10 / width, y: 10 / height })) };
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
    onPointerUp={(event) => {
      if (gesture.current?.pointer !== event.pointerId) return;
      const current = endGesture();
      if (!current) return;
      const value = current.draft;
      if (current.action !== "draw") {
        const { original } = current;
        if (original && (original.x !== value.x || original.y !== value.y || original.width !== value.width || original.height !== value.height)) {
          onUpdate(value.id, { x: value.x, y: value.y, width: value.width, height: value.height });
        }
      } else if (value.kind === "ink" ? value.points.length > 1 : value.width > .005 && value.height > .005) onAdd(value);
    }}
    onPointerCancel={(event) => { if (gesture.current?.pointer === event.pointerId) endGesture(); }} onLostPointerCapture={(event) => { if (gesture.current?.pointer === event.pointerId) endGesture(); }}>
    <svg className="editor-overlay" data-mode={mode} viewBox={`0 0 ${sideways ? height : width} ${sideways ? width : height}`} aria-hidden={!inline || undefined}>
    <g ref={group} data-pdf-coordinates="" transform={transform}>
      {snapping && draft && gesture.current?.action === "move" && <g className="editor-guides">
        {Math.abs(draft.x + draft.width / 2 - .5) < .00001 && <path d={`M${width / 2} 0V${height}`} />}
        {Math.abs(draft.y + draft.height / 2 - .5) < .00001 && <path d={`M0 ${height / 2}H${width}`} />}
      </g>}
      {page.overlays.map((item) => <Mark key={item.id} value={draft?.id === item.id ? draft : item} width={width} height={height} unit={unit} selected={selected === item.id && typing !== item.id} editing={typing === item.id} />)}
      {draft?.id === 0 && <Mark value={draft} width={width} height={height} unit={unit} selected={false} />}
      {inline && <foreignObject x={inline.x * width} y={inline.y * height} width={inline.width * width} height={inline.height * height} className="editor-inline-box" onPointerDown={(event) => event.stopPropagation()}>
        <textarea aria-label="Type in text box" autoFocus value={inline.text} maxLength={1000} spellCheck={false}
          style={{ color: inline.color, fontFamily: overlayFont(inline).family.css, fontSize: inline.size, fontWeight: inline.bold ? 700 : 400,
            fontStyle: inline.italic ? "italic" : "normal", textDecoration: inline.underline ? "underline" : "none" }}
          onChange={(event) => onUpdate(inline.id, { text: event.currentTarget.value })}
          onKeyDown={(event) => { if (event.key === "Escape") onExitTyping(); }}
          onBlur={onExitTyping} />
      </foreignObject>}
    </g>
    </svg>
    {body && <span aria-hidden="true" className="editor-touch-handle editor-touch-body" data-touch-gesture="move" data-overlay-id={selection?.id}
      style={{ left: `${(body[0].x + body[1].x) * 50}%`, top: `${(body[0].y + body[1].y) * 50}%`,
        width: `${Math.abs(body[0].x - body[1].x) * 100}%`, height: `${Math.abs(body[0].y - body[1].y) * 100}%` }} />}
    {touchHandles.map((control) => {
      const point = displayed(control.x, control.y);
      const size = control.radius * 2 / unit;
      return <span aria-hidden="true" className="editor-touch-handle" key={control.action} data-touch-gesture={control.action} data-overlay-id={selection?.id}
        style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%`, width: size, height: size }} />;
    })}
  </div>;
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
  const [panel, setPanel] = useState<MobilePanel | null>(null);
  const [snapping, setSnapping] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imageError, setImageError] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const mobileText = useRef<HTMLTextAreaElement>(null);
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
    setPanel(null);
  }
  function update(id: number, patch: Partial<Overlay>) {
    commit((previous) => previous.map((item) => item.index === page.index ? {
      ...item, overlays: item.overlays.map((overlay) => overlay.id === id ? { ...overlay, ...patch } : overlay),
    } : item));
  }
  function add(overlay: Omit<Overlay, "id">, typeOnPage = false) {
    const id = ++counter.current;
    editPage({ overlays: [...page.overlays, { ...overlay, id }] });
    setSelected(id);
    setTyping(typeOnPage && overlay.kind === "text" ? id : null);
    setMode("select");
  }
  function visiblePoint(): Point {
    const stage = editor.current?.querySelector<HTMLElement>(".pdf-stage");
    const transform = stage?.querySelector<SVGGElement>("[data-pdf-coordinates]");
    const matrix = transform?.getScreenCTM();
    const paper = transform?.ownerSVGElement?.getBoundingClientRect();
    if (!stage || !matrix || !paper) return { x: .15, y: .18 };
    const frame = stage.getBoundingClientRect();
    const center = (a: number, b: number, c: number, d: number, limit: number) => (Math.max(0, a, c) + Math.min(b, d, limit)) / 2;
    const point = new DOMPoint(center(frame.left, frame.right, paper.left, paper.right, innerWidth), center(frame.top, frame.bottom, paper.top, paper.bottom, innerHeight)).matrixTransform(matrix.inverse());
    return { x: clamp(point.x / page.width - .28, .75), y: clamp(point.y / page.height - .045, .86) };
  }
  function openPanel(next: MobilePanel) {
    setTyping(null);
    setPanel(panel === next ? null : next);
  }
  function nudge(dx: number, dy: number) {
    if (!mark || busy) return;
    const direction = ((page.rotation % 360) + 360) % 360;
    const point = direction === 90 ? [dy, -dx] : direction === 180 ? [-dx, -dy] : direction === 270 ? [-dy, dx] : [dx, dy];
    update(mark.id, moveOverlay(mark, { x: point[0] / page.width, y: point[1] / page.height }));
  }
  function moveToPage(target: number) {
    if (!mark || current === target || !history.present[target]) return;
    const destination = history.present[target];
    const width = clamp(mark.width * page.width / destination.width);
    const height = clamp(mark.height * page.height / destination.height);
    const transferred = { ...mark, width, height, x: clamp(mark.x, 1 - width), y: clamp(mark.y, 1 - height) };
    commit(history.present.map((item, index) => index === current ? { ...item, overlays: item.overlays.filter(({ id }) => id !== mark.id) }
      : index === target ? { ...item, overlays: [...item.overlays, transferred] } : item));
    setIndex(target);
    setTyping(null);
  }
  function selectMark(id: number | null) {
    setSelected(id);
    if (id !== selected && panel !== "more") setPanel(null);
  }
  function removeMark() {
    if (!mark) return;
    editPage({ overlays: page.overlays.filter(({ id }) => id !== mark.id) });
    selectMark(null);
    setTyping(null);
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
      setPanel(null);
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
    setPanel(null);
    setHistory(({ past, present, future }) => direction === "undo"
      ? { past: past.slice(0, -1), present: past[past.length - 1], future: [present, ...future] }
      : { past: [...past, present], present: future[0], future: future.slice(1) });
  }

  return <PagePreviews file={file}>
    <div className="editor overlay-editor" ref={editor} aria-label="PDF overlay editor" data-panel={panel ?? ""} onKeyDown={(event) => {
      if (!mark || (event.target as Element).closest(".pdf-stage") === null || (event.target as Element).matches("textarea,input")) return;
      const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const move = directions[event.key];
      if (move) { event.preventDefault(); nudge(move[0] * (event.shiftKey ? 10 : 1), move[1] * (event.shiftKey ? 10 : 1)); }
    }}>
      <header className="editor-top overlay-editor-top">
        <button type="button" className="icon-button mobile-editor" aria-label="Back to PDF upload" onClick={() => {
          if (!history.past.length || window.confirm("Discard this editing session and return to the upload screen?")) onReset();
        }}><ArrowLeft size={19} /></button>
        <div className="editor-file"><h2>Document editor</h2><p title={file.name}>{file.name}</p></div>
        <div className="editor-header-actions">
          <button type="button" className="icon-button" aria-label="Undo" disabled={busy || !history.past.length} onClick={() => step("undo")}><Undo2 size={18} /></button>
          <button type="button" className="icon-button" aria-label="Redo" disabled={busy || !history.future.length} onClick={() => step("redo")}><Redo2 size={18} /></button>
          <button type="button" className="button primary" disabled={busy || importing} onClick={() => void onPreview(history.present)}>
            <span className="desktop-editor">Preview edited PDF</span><span className="mobile-editor"><Download size={16} aria-hidden="true" /> Download</span>
          </button>
        </div>
      </header>
      <p className="editor-note desktop-editor">Use the move grip to position a selected box. Drag an edge or corner to resize it.</p>
      <input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" ref={photoInput} hidden aria-label="Import JPEG or PNG photo" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void addPhoto(file, visiblePoint());
      }} />
      <div className="preview-tools editor-tools" role="group" aria-label="Editing controls">
        {modes.map((item) => <button key={item} type="button" className="button secondary compact" disabled={busy} aria-pressed={mode === item} onClick={() => setMode(item)}>{modeNames[item]}</button>)}
        <button type="button" className="button secondary compact desktop-editor" disabled={busy || importing} onClick={() => photoInput.current?.click()}><ImagePlus size={16} aria-hidden="true" /> Add image</button>
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
            onSelect={selectMark} onPhoto={(file, point) => void addPhoto(file, point)} typing={active ? typing : null} onEdit={(id) => { setSelected(id); setTyping(id); }} onExitTyping={() => setTyping(null)} snapping={snapping} />;
        }} />
        <aside className="editor-properties" aria-label="Overlay properties">
          <h3 className="desktop-editor">Page additions</h3>
          <button type="button" className="button secondary compact desktop-editor" disabled={busy} onClick={() => add(textBox({ x: .15, y: .18 }))}>Add text box</button>
          {page.overlays.length > 0 && <label className="field desktop-editor">Selected annotation<select value={selected ?? ""} onChange={(event) => {
            setTyping(null);
            setSelected(event.currentTarget.value ? Number(event.currentTarget.value) : null);
          }}>
            <option value="">Select an annotation</option>{page.overlays.map((item) => <option value={item.id} key={item.id}>{modeNames[item.kind]} {item.id}</option>)}
          </select></label>}
          {mark ? <>
            {mark.kind === "text" && <>
              <label className="field" data-section="text">Overlay text<textarea ref={mobileText} maxLength={1000} disabled={busy} value={mark.text} onChange={(event) => update(mark.id, { text: event.currentTarget.value })} /></label>
              <button type="button" className="button secondary compact desktop-editor" disabled={busy} onClick={() => setTyping(mark.id)}>Type on page</button>
              <div data-section="style"><FontControl key={mark.id} disabled={busy} value={overlayFont(mark).family.name} prepare={prepareOverlayFont}
                apply={(font) => update(mark.id, { font: font.name })} /></div>
              <div data-section="style"><FontSizeControl disabled={busy} value={`${mark.size}pt`} apply={(size) => update(mark.id, { size: size ? Number.parseFloat(size) : 20 })} /></div>
              <div className="overlay-font-toggles" data-section="style" role="group" aria-label="Text style">
                {textStyles.map(([key, label, Icon]) => <button key={key} type="button" className="icon-button" aria-label={label} aria-pressed={!!mark[key]}
                  disabled={busy} onClick={() => update(mark.id, { [key]: !mark[key] })}><Icon size={17} aria-hidden="true" /></button>)}
              </div>
              <div data-section="style"><ColorControl highlight disabled={busy} value={mark.highlight ?? ""} apply={(value) => update(mark.id, { highlight: value ?? undefined })} /></div>
              <label className="editor-toggle" data-section="style"><input type="checkbox" disabled={busy} checked={!!mark.cover} onChange={(event) => update(mark.id, { cover: event.currentTarget.checked })} /> White background</label>
              {mark.cover && <p data-section="style">This covers what you see. The original text remains searchable and extractable.</p>}
            </>}
            {mark.kind !== "image" && <label className="field" data-section="style">Color<input type="color" disabled={busy} value={mark.color} onChange={(event) => update(mark.id, { color: event.currentTarget.value })} /></label>}
            <div className="position-controls" data-section="move">{(["x", "y"] as const).map((axis) => <label key={axis} className="field">{axis === "x" ? "Left %" : "Top %"}<input type="number" min={0} max={100} step=".01" disabled={busy} value={Number((mark[axis] * 100).toFixed(2))} onChange={(event) => {
              if (Number.isFinite(event.currentTarget.valueAsNumber)) update(mark.id, {
                [axis]: clamp(event.currentTarget.valueAsNumber / 100, 1 - (axis === "x" ? mark.width : mark.height)),
              });
            }} /></label>)}</div>
            <label className="editor-toggle" data-section="move"><input type="checkbox" checked={snapping} onChange={(event) => setSnapping(event.currentTarget.checked)} /> Snap to page centre</label>
            <div className="editor-nudge" data-section="move" role="group" aria-label="Nudge selection">
              {[["left", -1, 0, ArrowLeft], ["up", 0, -1, ArrowUp], ["down", 0, 1, ArrowDown], ["right", 1, 0, ArrowRight]].map(([name, x, y, Icon]) => {
                const Arrow = Icon as typeof ArrowLeft;
                return <button key={String(name)} type="button" className="icon-button" aria-label={`Nudge ${name}`} disabled={busy} onClick={() => nudge(Number(x), Number(y))}><Arrow size={17} /></button>;
              })}
            </div>
            {history.present.length > 1 && (mark.kind === "text" || mark.kind === "image") && <label className="field" data-section="move">Move to page
              <select value={current} disabled={busy} onChange={(event) => moveToPage(Number(event.currentTarget.value))}>
                {history.present.map(({ index }, position) => <option key={index} value={position}>Page {position + 1}</option>)}
              </select>
            </label>}
            {(mark.kind === "image" || mark.kind === "text") && <div className="position-controls" data-section="resize">
              {(["width", "height"] as const).map((axis) => <label key={axis} className="field">{axis === "width" ? "Width mm" : "Height mm"}
                <input type="number" min={1} step=".1" disabled={busy} value={Number((mark[axis] * page[axis] / pointsPerMillimeter).toFixed(1))} onChange={(event) => {
                  const millimeters = event.currentTarget.valueAsNumber;
                  const start = axis === "width" ? mark.x : mark.y;
                  if (Number.isFinite(millimeters)) update(mark.id, { [axis]: clamp(Math.max(1, millimeters) * pointsPerMillimeter / page[axis], 1 - start) });
                }} />
              </label>)}
            </div>}
            {mark.kind === "image" && <>
              <label className="field" data-section="resize">Photo size<select disabled={busy} value="" onChange={(event) => {
                if (!event.currentTarget.value) return;
                const [wide, tall] = event.currentTarget.value.split("x").map(Number);
                const width = clamp(wide * pointsPerMillimeter / page.width);
                const height = clamp(tall * pointsPerMillimeter / page.height);
                update(mark.id, { width, height, x: clamp(mark.x, 1 - width), y: clamp(mark.y, 1 - height) });
              }}>
                <option value="">Choose a preset</option><option value="35x45">35 × 45 mm</option><option value="50.8x50.8">2 × 2 inches</option>
              </select></label>
              <details className="editor-crop" data-section="crop" open={panel === "crop" || undefined}><summary>Crop image</summary>
                <div className="position-controls">{cropSides.map((side) => <label key={side} className="field">Crop {side} %
                  <input type="number" min={0} max={45} disabled={busy} value={Math.round((mark.crop?.[side] ?? 0) * 100)} onChange={(event) => {
                    if (Number.isFinite(event.currentTarget.valueAsNumber)) update(mark.id, {
                      crop: { left: 0, top: 0, right: 0, bottom: 0, ...mark.crop, [side]: clamp(event.currentTarget.valueAsNumber / 100, .45) },
                    });
                  }} />
                </label>)}</div>
              </details>
            </>}
            <button type="button" className="text-button desktop-editor" disabled={busy} onClick={removeMark}>Remove annotation</button>
          </> : <p>{mode === "select" ? "Choose an annotation to edit its properties." : mode === "text" ? "Select a position on the page for the text." : "Drag on the page to place your annotation."}</p>}
        </aside>
      </div>
      {mark && <div className="mobile-editor editor-context" role="group" aria-label="Selected object controls">
        {mark.kind === "text" && <button type="button" aria-expanded={panel === "text"} onClick={() => {
          const editing = panel !== "text";
          flushSync(() => openPanel("text"));
          if (editing) mobileText.current?.focus();
        }}><Type size={17} /> Edit text</button>}
        <button type="button" aria-expanded={panel === "move"} onClick={() => openPanel("move")}><Move size={17} /> Move</button>
        {(mark.kind === "text" || mark.kind === "image") && <button type="button" aria-expanded={panel === "resize"} onClick={() => openPanel("resize")}><Scaling size={17} /> Resize</button>}
        {mark.kind === "image" ? <button type="button" aria-expanded={panel === "crop"} onClick={() => openPanel("crop")}><Crop size={17} /> Crop</button>
          : <button type="button" aria-expanded={panel === "style"} onClick={() => openPanel("style")}><Type size={17} /> Style</button>}
        <button type="button" disabled={busy} onClick={removeMark}><Trash2 size={17} /> Delete</button>
      </div>}
      <nav className="mobile-editor editor-bottom" aria-label="Mobile editor tools">
        <button type="button" aria-pressed={mode === "select" && !panel} onClick={() => { setMode("select"); setTyping(null); setPanel(null); }}><MousePointer2 size={19} /> Select</button>
        <button type="button" disabled={busy} onClick={() => {
          const box = textBox(visiblePoint());
          flushSync(() => { add({ ...box, text: "" }); setPanel("text"); });
          mobileText.current?.focus();
        }}><Type size={19} /> Add text</button>
        <button type="button" disabled={busy || importing} onClick={() => { setPanel(null); photoInput.current?.click(); }}><ImagePlus size={19} /> Add image</button>
        <button type="button" aria-expanded={panel === "pages"} onClick={() => openPanel("pages")}><Files size={19} /> Pages</button>
        <button type="button" aria-expanded={panel === "more"} onClick={() => openPanel("more")}><Ellipsis size={19} /> More</button>
      </nav>
      <button type="button" className="text-button editor-reset desktop-editor" onClick={onReset}>Clear workspace</button>
    </div>
  </PagePreviews>;
}
