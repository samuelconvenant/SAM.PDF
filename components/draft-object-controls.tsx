"use client";

import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { draftHeight, draftWidth, turnedSize } from "../lib/draft-image-geometry";
import type { DraftImageAttributes } from "../lib/draft-image-geometry";
import { floatImage, reorderImage } from "./draft-image";
import { moveTable } from "./draft-table";
import type { tableFormatting } from "../lib/draft-table-format";

type TableState = ReturnType<typeof tableFormatting> & { background: string; vertical: string; cellAlign: string; merge: boolean; split: boolean };

export function NumericField({ name, value, min, max, apply, disabled }: {
  name: string; value: number; min: number; max: number; apply: (value: number) => void; disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  function commit() {
    if (draft === null) return;
    const next = Number(draft);
    if (draft !== "" && Number.isFinite(next)) apply(Math.min(max, Math.max(min, next)));
    setDraft(null);
  }
  return <label>{name}<input type="number" value={draft ?? Number(value.toFixed(1))} min={min} max={max} step="any" disabled={disabled}
    onChange={(event) => setDraft(event.currentTarget.value)} onBlur={commit} onKeyDown={(event) => {
      if (event.key === "Enter") { event.preventDefault(); commit(); }
    }} /></label>;
}

const focusOptions = { scrollIntoView: false };

export function DraftImageControls({ editor, image, disabled, replace }: {
  editor: Editor; image: DraftImageAttributes; disabled: boolean; replace: () => void;
}) {
  const [cropping, setCropping] = useState(false);
  const update = (fields: Partial<DraftImageAttributes>) => {
    const next = { ...image, ...fields };
    const size = turnedSize(next);
    const factor = Math.min(1, draftWidth / size.width, draftHeight / size.height);
    const dims = turnedSize({ width: next.width * factor, height: next.height * factor, angle: next.angle });
    editor.chain().focus(undefined, focusOptions).updateAttributes("image", {
      ...fields, width: next.width * factor, height: next.height * factor,
      x: Math.max(0, Math.min(next.x, draftWidth - dims.width)), y: Math.max(0, Math.min(next.y, draftHeight - dims.height)),
    }).run();
  };
  function duplicate() {
    const { state, view } = editor;
    const selection = state.selection;
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") return;
    const copy = selection.node.type.create({ ...selection.node.attrs, x: Math.min(image.x + 12, draftWidth - turnedSize(image).width), y: Math.min(image.y + 12, draftHeight - turnedSize(image).height), layer: Math.min(100, image.layer + 1) });
    const tr = state.tr.insert(selection.to, copy);
    view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, selection.to)));
    view.focus();
  }
  function cropMode() {
    const next = editor.view.dom.dataset.imageCrop !== "true";
    editor.view.dom.dataset.imageCrop = String(next);
    setCropping(next);
    editor.view.focus();
  }
  return <div className="preview-tools create-toolbar" role="group" aria-label="Image controls">
    <label>Image layout <select disabled={disabled} value={image.layout} onChange={(event) => {
      if (event.currentTarget.value === "floating") floatImage(editor);
      else update({ layout: "inline" });
    }}>
      <option value="inline">Inline</option><option value="floating">Free position</option>
    </select></label>
    {image.layout === "inline" ? <label>Image position <select disabled={disabled} value={image.position} onChange={(event) => update({ position: event.currentTarget.value as DraftImageAttributes["position"] })}>
      <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option>
    </select></label> : <>
      <NumericField name="Image left" value={image.x} min={0} max={draftWidth} disabled={disabled} apply={(x) => update({ x })} />
      <NumericField name="Image top" value={image.y} min={0} max={draftHeight} disabled={disabled} apply={(y) => update({ y })} />
    </>}
    <NumericField name="Image width" value={image.width} min={24} max={draftWidth} disabled={disabled} apply={(width) => update({ width, ...(image.ratioLocked ? { height: image.height * width / image.width } : {}) })} />
    <NumericField name="Image height" value={image.height} min={20} max={draftHeight} disabled={disabled} apply={(height) => update({ height, ...(image.ratioLocked ? { width: image.width * height / image.height } : {}) })} />
    <label><input type="checkbox" checked={image.ratioLocked} disabled={disabled} onChange={(event) => update({ ratioLocked: event.currentTarget.checked })} /> Lock aspect ratio</label>
    <NumericField name="Image rotation" value={image.angle} min={-360} max={360} disabled={disabled} apply={(angle) => update({ angle })} />
    <button type="button" className="button secondary compact" aria-pressed={cropping} disabled={disabled} onClick={cropMode}>Crop image</button>
    {cropping && <button type="button" className="button secondary compact" disabled={disabled} onClick={() => update({ crop: [0, 0, 0, 0] })}>Reset crop</button>}
    <button type="button" className="button secondary compact" disabled={disabled} onClick={replace}>Replace image</button>
    <button type="button" className="button secondary compact" disabled={disabled} onClick={duplicate}>Duplicate image</button>
    {image.layout === "floating" ? <>
      <button type="button" className="button secondary compact" disabled={disabled || image.layer >= 100} onClick={() => update({ layer: image.layer + 1 })}>Bring forward</button>
      <button type="button" className="button secondary compact" disabled={disabled || image.layer <= -100} onClick={() => update({ layer: image.layer - 1 })}>Send backward</button>
    </> : <>
      <button type="button" className="button secondary compact" disabled={disabled} onClick={() => reorderImage(editor, -1)}>Move image up</button>
      <button type="button" className="button secondary compact" disabled={disabled} onClick={() => reorderImage(editor, 1)}>Move image down</button>
    </>}
    <button type="button" className="button secondary compact" disabled={disabled} onClick={() => editor.chain().focus(undefined, focusOptions).deleteSelection().run()}>Remove image</button>
    {cropping && <span className="draft-control-hint">Drag the crop handles to adjust the visible area.</span>}
  </div>;
}

export function DraftTableControls({ editor, state, disabled }: { editor: Editor; state: TableState; disabled: boolean }) {
  const chain = () => editor.chain().focus(undefined, focusOptions);
  const table = (fields: Record<string, string | number>) => chain().updateAttributes("table", fields).run();
  return <div className="preview-tools create-toolbar" role="group" aria-label="Table controls">
    <button type="button" disabled={disabled} className="button secondary compact" onClick={() => chain().addRowAfter().run()}>Add row</button>
    <button type="button" disabled={disabled} className="button secondary compact" onClick={() => chain().addColumnAfter().run()}>Add column</button>
    <button type="button" disabled={disabled} className="button secondary compact" onClick={() => chain().deleteRow().run()}>Delete row</button>
    <button type="button" disabled={disabled} className="button secondary compact" onClick={() => chain().deleteColumn().run()}>Delete column</button>
    <button type="button" disabled={disabled || !state.merge} className="button secondary compact" onClick={() => chain().mergeCells().run()}>Merge cells</button>
    <button type="button" disabled={disabled || !state.split} className="button secondary compact" onClick={() => chain().splitCell().run()}>Split cell</button>
    <NumericField name="Table width %" value={state.widthPercent} min={15} max={100} disabled={disabled} apply={(widthPercent) => table({ widthPercent })} />
    <NumericField name="Cell padding" value={state.padding} min={0} max={28} disabled={disabled} apply={(padding) => table({ padding })} />
    <NumericField name="Border thickness" value={state.borderWidth} min={0} max={8} disabled={disabled} apply={(borderWidth) => table({ borderWidth })} />
    <label>Border colour <input type="color" disabled={disabled} value={state.borderColor} onChange={(event) => editor.commands.updateAttributes("table", { borderColor: event.currentTarget.value })} /></label>
    <label>Cell background <input type="color" disabled={disabled} value={state.background} onChange={(event) => editor.commands.setCellAttribute("background", event.currentTarget.value)} /></label>
    <label>Cell text alignment <select disabled={disabled} value={state.cellAlign} onChange={(event) => chain().setCellAttribute("cellAlign", event.currentTarget.value).run()}>
      <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option>
    </select></label>
    <label>Cell vertical alignment <select disabled={disabled} value={state.vertical} onChange={(event) => chain().setCellAttribute("vertical", event.currentTarget.value).run()}>
      <option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option>
    </select></label>
    <button type="button" disabled={disabled} className="button secondary compact" onClick={() => moveTable(editor, -1)}>Move table up</button>
    <button type="button" disabled={disabled} className="button secondary compact" onClick={() => moveTable(editor, 1)}>Move table down</button>
    <button type="button" disabled={disabled} className="button secondary compact" onClick={() => chain().deleteTable().run()}>Delete table</button>
  </div>;
}
