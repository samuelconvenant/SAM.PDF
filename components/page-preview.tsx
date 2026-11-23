"use client";

import { FileText } from "lucide-react";
import { createContext, memo, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

type LoadedDocument = { pdf: PDFDocumentProxy; file: Blob };
const PreviewContext = createContext<LoadedDocument | null>(null);

export function usePdf() { return useContext(PreviewContext)?.pdf ?? null; }

export function PagePreviews({ file, children, full = false, defer = false, password, onLocked }: {
  file: Blob; children: React.ReactNode; full?: boolean; defer?: boolean; password?: string; onLocked?: () => void;
}) {
  const [document, setDocument] = useState<LoadedDocument | null>(null);
  const [failedFile, setFailedFile] = useState<Blob | null>(null);
  const [visible, setVisible] = useState(!defer);
  const loaded = useRef<PDFDocumentProxy | null>(null);
  const observed = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible || !observed.current) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); }, { rootMargin: "160px" });
    observer.observe(observed.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => () => {
    void loaded.current?.destroy().catch(() => {});
    loaded.current = null;
  }, []);

  useEffect(() => {
    if (!visible) return;
    let canceled = false;
    let dispose: (() => void) | undefined;
    void Promise.all([import("pdfjs-dist"), file.arrayBuffer()]).then(([pdfjs, buffer]) => {
      if (canceled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const loading = pdfjs.getDocument({ data: buffer, password, useSystemFonts: true, enableXfa: false });
      dispose = () => { void loading.destroy().catch(() => {}); };
      return loading.promise.then((doc) => {
        if (canceled) return;
        const previous = loaded.current;
        loaded.current = doc;
        dispose = undefined;
        setFailedFile(null);
        setDocument({ pdf: doc, file });
        void previous?.destroy().catch(() => {});
      });
    }).catch((error) => {
      dispose?.();
      dispose = undefined;
      if (canceled) return;
      if (onLocked && error?.name === "PasswordException") onLocked();
      else setFailedFile(file);
    });
    return () => { canceled = true; dispose?.(); };
  }, [file, onLocked, password, visible]);

  const failed = failedFile === file;
  return <PreviewContext.Provider value={document}>
    {failed && !defer && <p className="workspace-error" role="alert">{full ? "This PDF could not be displayed in this browser." : "Previews are unavailable for this file. You can still edit pages by number."}</p>}
    {defer ? <div ref={observed}>{children}</div> : (!full || !failed || document) && children}
  </PreviewContext.Provider>;
}

export type PageGeometry = { width: number; height: number; baseWidth: number; baseHeight: number; rotation: number };

type Frame = { key: string; index: number; file: Blob; geometry: PageGeometry; bitmap: HTMLCanvasElement };
const frameCache = new WeakMap<PDFDocumentProxy, Map<string, Frame>>();

function remember(pdf: PDFDocumentProxy, frame: Frame) {
  let cache = frameCache.get(pdf);
  if (!cache) { cache = new Map(); frameCache.set(pdf, cache); }
  cache.delete(frame.key);
  cache.set(frame.key, frame);
  let pixels = [...cache.values()].reduce((sum, item) => sum + item.bitmap.width * item.bitmap.height, 0);
  for (const [key, item] of cache) {
    if (cache.size <= 4 && pixels <= 8_000_000) break;
    cache.delete(key);
    pixels -= item.bitmap.width * item.bitmap.height;
  }
}

export const PdfCanvas = memo(function PdfCanvas({ index, rotation, zoom, overlay, onRendered, continuous = false }: {
  index: number;
  rotation?: number;
  zoom: number;
  overlay?: (geometry: PageGeometry, displayedPage: number) => ReactNode;
  onRendered?: (file: Blob) => void;
  continuous?: boolean;
}) {
  const data = useContext(PreviewContext);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [available, setAvailable] = useState(0);
  const [render, setRender] = useState<Frame | null>(null);
  const [failure, setFailure] = useState("");
  const key = `${index}:${rotation}:${zoom}:${available}`;
  const painted = useRef<Frame | null>(null);
  const positions = useRef(new Map<number, { left: number; top: number }>());

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      if (width >= 20) setAvailable(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!data || !available) return;
    const { pdf, file } = data;
    const cached = frameCache.get(pdf)?.get(key);
    if (cached) {
      remember(pdf, cached);
      setRender(cached);
      return;
    }
    let canceled = false;
    let task: RenderTask | undefined;
    const element = document.createElement("canvas");
    void pdf.getPage(index + 1).then((page) => {
      if (canceled || !element) return;
      const angle = ((rotation ?? page.rotate) % 360 + 360) % 360;
      const base = page.getViewport({ scale: 1, rotation: 0 });
      const turned = page.getViewport({ scale: 1, rotation: angle });
      const scale = Math.min((available - 18) / turned.width, 1.3) * zoom;
      const display = page.getViewport({ scale, rotation: angle });
      const density = Math.min(devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (display.width * display.height)));
      const viewport = page.getViewport({ scale: scale * density, rotation: angle });
      element.width = Math.max(1, Math.ceil(viewport.width));
      element.height = Math.max(1, Math.ceil(viewport.height));
      task = page.render({ canvas: element, viewport });
      return task.promise.then(() => {
        if (canceled) return;
        const ready = { key, index, file, bitmap: element, geometry: { width: display.width, height: display.height, baseWidth: base.width, baseHeight: base.height, rotation: angle } };
        remember(pdf, ready);
        setFailure("");
        setRender(ready);
      });
    }).catch(() => { if (!canceled) setFailure(key); });
    return () => { canceled = true; task?.cancel(); };
  }, [available, data, index, key, rotation, zoom]);

  useLayoutEffect(() => {
    const visible = canvas.current;
    const scroll = frame.current;
    if (!visible || !scroll || !render || painted.current === render) return;
    const previous = painted.current;
    const context = visible.getContext("2d");
    if (!context) return;
    visible.width = render.bitmap.width;
    visible.height = render.bitmap.height;
    context.drawImage(render.bitmap, 0, 0);
    const saved = positions.current.get(render.index);
    if (saved) {
      const ratio = previous?.index === render.index ? render.geometry.width / previous.geometry.width : 1;
      scroll.scrollLeft = saved.left * ratio;
      scroll.scrollTop = saved.top * ratio;
    } else {
      scroll.scrollLeft = 0;
      scroll.scrollTop = 0;
    }
    painted.current = render;
    positions.current.set(render.index, { left: scroll.scrollLeft, top: scroll.scrollTop });
    if (previous?.file !== render.file) onRendered?.(render.file);
  }, [onRendered, render]);

  const geometry = render?.geometry;
  return <div className={`pdf-stage${continuous ? " pdf-stage-continuous" : ""}`} ref={frame} tabIndex={continuous ? undefined : 0} role={continuous ? undefined : "region"} aria-label={continuous ? undefined : "Scrollable PDF page"} onScroll={(event) => {
    const visible = painted.current;
    if (visible) positions.current.set(visible.index, { left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop });
  }}>
    {failure === key ? <p role="alert">This page could not be rendered.</p> : !geometry && <p className="pdf-loading" role="status">Rendering page…</p>}
    <div className="pdf-sheet" hidden={!geometry} style={geometry ? { width: geometry.width, height: geometry.height } : undefined}>
      <canvas ref={canvas} aria-label={`Rendered PDF page ${(render?.index ?? index) + 1}`} />
      {render && overlay?.(render.geometry, render.index)}
    </div>
  </div>;
});

export const PageThumbnail = memo(function PageThumbnail({ index, rotation }: { index: number; rotation?: number }) {
  const pdf = usePdf();
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState<HTMLCanvasElement | null>(null);
  const completed = useRef<{ pdf: PDFDocumentProxy; index: number; rotation?: number } | null>(null);

  useLayoutEffect(() => {
    const target = canvas.current;
    if (!target || !rendered) return;
    const context = target.getContext("2d");
    if (!context) return;
    target.width = rendered.width;
    target.height = rendered.height;
    context.drawImage(rendered, 0, 0);
  }, [rendered]);

  useEffect(() => {
    if (!frame.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "120px" });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !visible) return;
    if (completed.current?.pdf === pdf && completed.current.index === index && completed.current.rotation === rotation) return;
    let canceled = false;
    let task: RenderTask | undefined;
    void pdf.getPage(index + 1).then((page) => {
      const element = document.createElement("canvas");
      if (canceled || !element) return;
      const base = page.getViewport({ scale: 1, rotation });
      const viewport = page.getViewport({ scale: Math.min(190 / base.width, 166 / base.height), rotation });
      element.width = Math.ceil(viewport.width);
      element.height = Math.ceil(viewport.height);
      task = page.render({ canvas: element, viewport });
      return task.promise.then(() => {
        if (canceled) return;
        completed.current = { pdf, index, rotation };
        setRendered(element);
      });
    }).catch(() => {});
    return () => { canceled = true; task?.cancel(); };
  }, [index, pdf, rotation, visible]);

  return <div className="thumbnail" ref={frame} aria-hidden="true">
    {!rendered && <FileText size={26} strokeWidth={1.4} />}
    <canvas ref={canvas} hidden={!rendered} />
  </div>;
});
