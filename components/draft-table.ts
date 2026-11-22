import { Extension } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { Table, TableCell, TableHeader, TableRow, TableView, updateColumns } from "@tiptap/extension-table";
import type { Node } from "@tiptap/pm/model";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { defaultTableFormatting as defaults, tableFormatting } from "../lib/draft-table-format";

class DraftTableView extends TableView {
  constructor(...props: ConstructorParameters<typeof TableView>) {
    super(...props);
    this.format();
  }
  private format() {
    const { widthPercent, padding, borderWidth, borderColor } = tableFormatting(this.node.attrs);
    this.dom.style.width = `${widthPercent}%`;
    this.table.style.width = "100%";
    this.table.style.setProperty("--table-color", borderColor);
    this.table.style.setProperty("--table-stroke", `${borderWidth}px`);
    this.table.style.setProperty("--table-pad", `${padding}px`);
  }
  update(node: Node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    updateColumns(node, this.colgroup, this.table, this.cellMinWidth);
    this.format();
    return true;
  }
}

const DraftTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      widthPercent: { default: defaults.widthPercent, rendered: false },
      padding: { default: defaults.padding, rendered: false },
      borderWidth: { default: defaults.borderWidth, rendered: false },
      borderColor: { default: defaults.borderColor, rendered: false },
    };
  },
}).configure({ resizable: true, cellMinWidth: 28, View: DraftTableView });

const DraftRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      rowHeight: { default: null, renderHTML: (attrs) => attrs.rowHeight ? { style: `height: ${attrs.rowHeight}px` } : {} },
    };
  },
  addNodeView() {
    return ({ node }) => {
      const row = document.createElement("tr");
      const apply = (next: Node) => { row.style.height = next.attrs.rowHeight ? `${next.attrs.rowHeight}px` : ""; };
      apply(node);
      return {
        dom: row, contentDOM: row,
        update(next) {
          if (next.type !== node.type) return false;
          apply(next);
          return true;
        },
        ignoreMutation(mutation) { return mutation.type === "attributes" && mutation.target === row; },
      };
    };
  },
});

const cellAttributes = {
  background: { default: null, renderHTML: (attrs: Record<string, unknown>) => attrs.background ? { style: `background-color: ${attrs.background}` } : {} },
  cellAlign: { default: "left", renderHTML: (attrs: Record<string, unknown>) => ({ style: `text-align: ${attrs.cellAlign}` }) },
  vertical: { default: "top", renderHTML: (attrs: Record<string, unknown>) => ({ style: `vertical-align: ${attrs.vertical}` }) },
};

const DraftCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttributes }; } });
const DraftHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttributes }; } });

function rowPosition(doc: Node, inside: number) {
  const point = doc.resolve(inside);
  for (let depth = point.depth; depth > 0; depth--) {
    if (point.node(depth).type.name === "tableRow") return point.before(depth);
  }
  return null;
}

const RowResize = Extension.create({
  name: "draftRowResize",
  addProseMirrorPlugins() {
    return [new Plugin({
      view(view) {
        let finish: (() => void) | undefined;
        function pointerDown(event: PointerEvent) {
          if (event.button !== 0 || !view.editable || finish || !(event.target instanceof Element)) return;
          const row = event.target.closest<HTMLTableRowElement>(".tableWrapper tr");
          const cell = event.target.closest<HTMLTableCellElement>("th,td");
          if (!row || !cell) return;
          const rect = row.getBoundingClientRect();
          const cellRect = cell.getBoundingClientRect();
          if (rect.bottom - event.clientY > 5 || Math.abs(event.clientX - cellRect.left) <= 5 || Math.abs(event.clientX - cellRect.right) <= 5) return;
          const position = rowPosition(view.state.doc, view.posAtDOM(cell, 0));
          if (position === null) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          const startY = event.clientY;
          const initialStyle = row.style.height;
          let height = rect.height;
          let frame = 0;
          const id = event.pointerId;
          row.classList.add("draft-row-resizing");
          row.setPointerCapture(id);
          function move(pointer: PointerEvent) {
            if (pointer.pointerId !== id) return;
            height = Math.min(700, Math.max(22, Math.round(rect.height + pointer.clientY - startY)));
            if (!frame) frame = requestAnimationFrame(() => { frame = 0; row!.style.height = `${height}px`; });
          }
          function cleanup() {
            cancelAnimationFrame(frame);
            row!.removeEventListener("pointermove", move);
            row!.removeEventListener("pointerup", release);
            row!.removeEventListener("pointercancel", cleanup);
            row!.removeEventListener("lostpointercapture", cleanup);
            row!.style.height = initialStyle;
            row!.classList.remove("draft-row-resizing");
            finish = undefined;
          }
          function release(pointer: PointerEvent) {
            if (pointer.pointerId !== id) return;
            cleanup();
            const current = view.state.doc.nodeAt(position!);
            if (current?.type.name === "tableRow" && Math.abs(height - rect.height) > 1) {
              view.dispatch(view.state.tr.setNodeMarkup(position!, undefined, { ...current.attrs, rowHeight: height }));
            }
          }
          finish = cleanup;
          row.addEventListener("pointermove", move);
          row.addEventListener("pointerup", release);
          row.addEventListener("pointercancel", cleanup, { once: true });
          row.addEventListener("lostpointercapture", cleanup, { once: true });
        }
        view.dom.addEventListener("pointerdown", pointerDown, true);
        return { destroy() { finish?.(); view.dom.removeEventListener("pointerdown", pointerDown, true); } };
      },
    })];
  },
});

export const draftTableExtensions = [DraftTable, DraftRow, DraftHeader, DraftCell, RowResize];

export function moveTable(editor: Editor, direction: -1 | 1) {
  const { doc, selection, tr } = editor.state;
  if (!selection.$from.depth || selection.$from.node(1).type.name !== "table") return;
  const index = selection.$from.index(0);
  const neighbor = doc.maybeChild(index + direction);
  if (!neighbor || neighbor.type.name === "pageBreak") return;
  const start = selection.$from.before(1);
  const table = selection.$from.node(1);
  const offset = selection.from - start;
  const next = start + neighbor.nodeSize * direction;
  tr.delete(start, start + table.nodeSize).insert(next, table);
  editor.view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(next + offset))).scrollIntoView());
}
