import Image from "@tiptap/extension-image";
import { NodeSelection } from "@tiptap/pm/state";
import type { Editor, NodeViewRendererProps } from "@tiptap/react";
import type { NodeView } from "@tiptap/pm/view";
import { draftHeight, draftImage, draftWidth, fitDraftImage, turnedSize } from "../lib/draft-image-geometry";
import type { DraftImageAttributes } from "../lib/draft-image-geometry";

const edges = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const bound = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const localImage = /^data:image\/(jpeg|png);base64,/;

function manualPageOrigin(anchor: HTMLElement, root: HTMLElement) {
  const top = Number.parseFloat(getComputedStyle(root).paddingTop) || 0;
  let previous = anchor.previousElementSibling;
  while (previous && !previous.hasAttribute("data-paper-break")) previous = previous.previousElementSibling;
  return previous instanceof HTMLElement ? previous.offsetTop + previous.offsetHeight + 18 : top;
}

export function floatImage(editor: Editor) {
  const { state, view } = editor;
  const { selection, tr } = state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") return;
  const image = draftImage(selection.node.attrs);
  const anchor = view.nodeDOM(selection.from);
  const root = view.dom;
  const block = selection.$from.depth ? view.nodeDOM(selection.$from.before(1)) : anchor;
  const style = getComputedStyle(root);
  const left = Number.parseFloat(style.paddingLeft) || 0;
  const right = Number.parseFloat(style.paddingRight) || 0;
  const scale = Math.min(1, (root.clientWidth - left - right) / draftWidth) || 1;
  const size = turnedSize(image);
  const rect = anchor instanceof HTMLElement ? anchor.querySelector(".draft-image-plane")?.getBoundingClientRect() : null;
  const paper = root.getBoundingClientRect();
  const attrs = { ...selection.node.attrs, layout: "floating",
    x: rect ? bound((rect.left - paper.left - left) / scale, 0, draftWidth - size.width) : 0,
    y: rect && block instanceof HTMLElement ? bound((rect.top - paper.top - manualPageOrigin(block, root)) / scale, 0, draftHeight - size.height) : 0 };
  if (!selection.$from.depth) tr.setNodeMarkup(selection.from, undefined, attrs);
  else {
    const end = selection.$from.after(1);
    tr.delete(selection.from, selection.to);
    const at = tr.mapping.map(end);
    tr.insert(at, selection.node.type.create(attrs));
    tr.setSelection(NodeSelection.create(tr.doc, at));
  }
  view.dispatch(tr);
  view.focus();
}

function imageView({ node, editor, getPos, view }: NodeViewRendererProps): NodeView {
  let current = node;
  let selected = false;
  const dom = document.createElement("div");
  const plane = document.createElement("div");
  const frame = document.createElement("div");
  const cropFrame = document.createElement("div");
  const picture = document.createElement("img");
  dom.className = "draft-image-anchor";
  dom.contentEditable = "false";
  plane.className = "draft-image-plane";
  frame.className = "draft-image-frame";
  cropFrame.className = "draft-image-clip";
  picture.draggable = false;
  cropFrame.append(picture);
  frame.append(cropFrame);
  plane.append(frame);
  dom.append(plane);
  let scale = 1;
  let scheduled = 0;
  let gesture: {
    initial: DraftImageAttributes; next: DraftImageAttributes; x: number; y: number; edge: string;
    id: number; crop: boolean;
  } | null = null;

  function sync(image = draftImage(current.attrs)) {
    const root = view.dom;
    if (!dom.isConnected) return;
    const style = getComputedStyle(root);
    const left = Number.parseFloat(style.paddingLeft) || 0;
    const right = Number.parseFloat(style.paddingRight) || 0;
    scale = Math.min(1, (root.clientWidth - left - right) / draftWidth);
    if (scale <= 0) return;
    const size = turnedSize(image);
    dom.dataset.layout = image.layout;
    dom.dataset.selected = String(selected);
    dom.dataset.position = image.position;
    dom.draggable = image.layout === "inline";
    plane.style.width = `${size.width * scale}px`;
    plane.style.height = `${size.height * scale}px`;
    plane.style.left = image.layout === "floating" ? `${left + image.x * scale}px` : "";
    plane.style.top = image.layout === "floating" ? `${manualPageOrigin(dom, root) + image.y * scale}px` : "";
    plane.style.zIndex = image.layout === "floating" ? String(image.layer + 102) : "";
    frame.style.width = `${image.width * scale}px`;
    frame.style.height = `${image.height * scale}px`;
    frame.style.transform = `translate(-50%, -50%) rotate(${image.angle}deg)`;
    const fit = fitDraftImage(image);
    picture.style.left = `${fit.x * scale}px`;
    picture.style.top = `${fit.y * scale}px`;
    picture.style.width = `${fit.width * scale}px`;
    picture.style.height = `${fit.height * scale}px`;
    if (localImage.test(image.src) && picture.getAttribute("src") !== image.src) picture.src = image.src;
    picture.alt = image.alt ?? "";
  }

  function repaint() {
    if (!scheduled) scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      sync(gesture?.next);
    });
  }

  const observer = new ResizeObserver(repaint);
  observer.observe(view.dom);
  const reposition = () => { if (current.attrs.layout === "floating") repaint(); };
  editor.on("update", reposition);
  repaint();

  function select() {
    const position = getPos();
    if (typeof position !== "number") return;
    const { state } = view;
    if (!(state.selection instanceof NodeSelection && state.selection.from === position)) {
      view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, position)));
    }
  }

  function start(event: PointerEvent, edge: string) {
    if (!editor.isEditable || event.button !== 0) return;
    const initial = draftImage(current.attrs);
    select();
    if (!edge && initial.layout !== "floating") return;
    event.preventDefault();
    event.stopPropagation();
    gesture = { initial, next: initial, x: event.clientX, y: event.clientY, edge, id: event.pointerId,
      crop: !!edge && view.dom.dataset.imageCrop === "true" };
    frame.setPointerCapture(event.pointerId);
  }

  for (const edge of edges) {
    const control = document.createElement("span");
    control.className = "draft-image-handle";
    control.dataset.edge = edge;
    control.addEventListener("pointerdown", (event) => start(event, edge));
    frame.append(control);
  }
  cropFrame.addEventListener("pointerdown", (event) => start(event, ""));
  frame.addEventListener("pointermove", (event) => {
    if (!gesture || event.pointerId !== gesture.id || !scale) return;
    const { initial, edge } = gesture;
    const dx = (event.clientX - gesture.x) / scale;
    const dy = (event.clientY - gesture.y) / scale;
    const angle = -initial.angle * Math.PI / 180;
    const x = dx * Math.cos(angle) - dy * Math.sin(angle);
    const y = dx * Math.sin(angle) + dy * Math.cos(angle);
    const west = edge.includes("w"), east = edge.includes("e");
    const north = edge.includes("n"), south = edge.includes("s");
    if (!edge) {
      const size = turnedSize(initial);
      gesture.next = { ...initial, x: bound(initial.x + dx, 0, draftWidth - size.width), y: bound(initial.y + dy, 0, draftHeight - size.height) };
    } else if (gesture.crop) {
      const [l, t, r, b] = initial.crop;
      gesture.next = { ...initial, crop: [
        west ? bound(l + x / initial.width, 0, .9 - r) : l,
        north ? bound(t + y / initial.height, 0, .9 - b) : t,
        east ? bound(r - x / initial.width, 0, .9 - l) : r,
        south ? bound(b - y / initial.height, 0, .9 - t) : b,
      ] };
    } else {
      let width = initial.width + (east ? x : west ? -x : 0);
      let height = initial.height + (south ? y : north ? -y : 0);
      if (initial.ratioLocked) {
        const ratio = Math.abs(width / initial.width - 1) >= Math.abs(height / initial.height - 1)
          ? width / initial.width : height / initial.height;
        const max = Math.min(draftWidth / initial.width, draftHeight / initial.height);
        const factor = bound(ratio, Math.max(24 / initial.width, 20 / initial.height), max);
        width = initial.width * factor;
        height = initial.height * factor;
      } else {
        width = bound(width, 24, draftWidth);
        height = bound(height, 20, draftHeight);
      }
      const proposed = turnedSize({ width, height, angle: initial.angle });
      const scaleToPage = Math.min(1, draftWidth / proposed.width, draftHeight / proposed.height);
      width *= scaleToPage;
      height *= scaleToPage;
      const size = turnedSize({ width, height, angle: initial.angle });
      const oldSize = turnedSize(initial);
      const centerX = (east ? width - initial.width : west ? initial.width - width : 0) / 2;
      const centerY = (south ? height - initial.height : north ? initial.height - height : 0) / 2;
      gesture.next = { ...initial, width, height,
        x: bound(initial.x + centerX * Math.cos(angle) + centerY * Math.sin(angle) + (oldSize.width - size.width) / 2, 0, draftWidth - size.width),
        y: bound(initial.y - centerX * Math.sin(angle) + centerY * Math.cos(angle) + (oldSize.height - size.height) / 2, 0, draftHeight - size.height) };
    }
    repaint();
  });

  function finish(commit: boolean) {
    if (!gesture) return;
    const { initial, next } = gesture;
    gesture = null;
    const position = getPos();
    if (commit && next !== initial && typeof position === "number") {
      view.dispatch(view.state.tr.setNodeMarkup(position, undefined, { ...current.attrs, ...next }));
    }
    repaint();
  }
  frame.addEventListener("pointerup", () => finish(true));
  frame.addEventListener("pointercancel", () => finish(false));
  frame.addEventListener("lostpointercapture", () => finish(false));
  return {
    dom,
    update(next) {
      if (next.type !== current.type) return false;
      current = next;
      repaint();
      return true;
    },
    selectNode() { selected = true; repaint(); },
    deselectNode() { selected = false; repaint(); },
    stopEvent(event) {
      return (event.target instanceof Element && !!event.target.closest(".draft-image-handle")) || !!gesture;
    },
    ignoreMutation() { return true; },
    destroy() { observer.disconnect(); cancelAnimationFrame(scheduled); editor.off("update", reposition); },
  };
}

export const PaperImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      position: { default: "left", parseHTML: (element) => element.getAttribute("data-position") || "left", renderHTML: (attrs) => ({ "data-position": attrs.position }) },
      layout: { default: "inline", rendered: false }, x: { default: 0, rendered: false }, y: { default: 0, rendered: false },
      angle: { default: 0, rendered: false }, layer: { default: 0, rendered: false }, ratioLocked: { default: true, rendered: false },
      sourceWidth: { default: null, rendered: false }, sourceHeight: { default: null, rendered: false }, crop: { default: [0, 0, 0, 0], rendered: false },
    };
  },
  parseHTML: () => [{ tag: 'img[src^="data:image/png;base64,"]' }, { tag: 'img[src^="data:image/jpeg;base64,"]' }],
  addNodeView() { return imageView; },
}).configure({ allowBase64: true });

export function reorderImage(editor: Editor, direction: -1 | 1) {
  const { selection, doc, tr } = editor.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image" || selection.$from.depth !== 0) return;
  const index = selection.$from.index();
  const neighbor = doc.maybeChild(index + direction);
  if (!neighbor || neighbor.type.name === "pageBreak") return;
  const at = selection.from + (direction < 0 ? -neighbor.nodeSize : neighbor.nodeSize);
  tr.delete(selection.from, selection.to).insert(at, selection.node);
  editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)));
}
