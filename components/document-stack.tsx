"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { wordTools } from "../lib/tools";

const cards = [
  { id: "merge", name: "Merge PDF", mark: "M", links: [{ id: "merge", name: "Open Merge PDF" }] },
  { id: "edit", name: "Edit PDF", mark: "s", links: [{ id: "edit", name: "Open Edit PDF" }] },
  { id: "convert", name: "Convert PDF", mark: "C", links: wordTools },
] as const;
const limit = (value: number, max: number) => Math.max(-max, Math.min(max, value));

export function DocumentStack() {
  const [selected, setSelected] = useState<(typeof cards)[number]["id"]>("edit");
  const stage = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const blockedClick = useRef(false);
  const target = useRef({ x: 0, y: 0 });
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    const element = group.current;
    if (!element) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, x = 0, y = 0;
    function tick() {
      frame = 0;
      x += (target.current.x - x) * .13;
      y += (target.current.y - y) * .13;
      element?.style.setProperty("--tilt-x", `${x.toFixed(2)}deg`);
      element?.style.setProperty("--tilt-y", `${y.toFixed(2)}deg`);
      element?.style.setProperty("--light", `${50 + y * 2}%`);
      if (Math.abs(target.current.x - x) + Math.abs(target.current.y - y) > .03) schedule();
    }
    function schedule() {
      if (!frame && !media.matches) frame = requestAnimationFrame(tick);
    }
    function resetMotion() {
      cancelAnimationFrame(frame);
      frame = 0;
      x = y = 0;
      target.current = { x: 0, y: 0 };
      for (const name of ["--tilt-x", "--tilt-y", "--light"]) element?.style.removeProperty(name);
    }
    wake.current = schedule;
    media.addEventListener("change", resetMotion);
    return () => {
      resetMotion();
      media.removeEventListener("change", resetMotion);
      wake.current = () => {};
    };
  }, []);

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = drag.current;
    if (gesture?.id === event.pointerId) {
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 7) return;
      if (!gesture.moved) {
        if (event.pointerType === "touch" && Math.abs(dy) > Math.abs(dx)) return;
        gesture.moved = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.dataset.dragging = "true";
      }
      target.current = { x: limit(-dy * .2, 22), y: limit(dx * .2, 26) };
    } else {
      if (event.pointerType !== "mouse") return;
      const rect = stage.current?.getBoundingClientRect();
      if (!rect) return;
      target.current = { x: limit((.5 - (event.clientY - rect.top) / rect.height) * 15, 8), y: limit(((event.clientX - rect.left) / rect.width - .5) * 20, 10) };
    }
    wake.current();
  }

  function center() {
    target.current = { x: 0, y: 0 };
    wake.current();
  }

  function release(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    blockedClick.current = drag.current.moved;
    drag.current = null;
    delete event.currentTarget.dataset.dragging;
    center();
  }

  const tool = cards.find((card) => card.id === selected)!;
  return <section className="document-showcase" aria-label="Interactive PDF tools">
    <div className="document-stage" ref={stage} onPointerMove={move}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        blockedClick.current = false;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      }}
      onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
      onPointerLeave={() => { if (!drag.current?.moved) { drag.current = null; center(); } }}>
      <div className="document-halo" aria-hidden="true"><span /><span /></div>
      <div className="document-group" ref={group}>
        {cards.map((card) => <button type="button" key={card.id} className={`document-card document-card--${card.id}`}
          aria-pressed={selected === card.id} onClick={(event) => {
            if (event.detail !== 0 && blockedClick.current) return;
            setSelected(card.id);
          }}>
          <span className="document-face">
            <span className="document-label">{card.name}</span>
            <span className="document-format" aria-hidden="true">PDF</span>
            <span className="document-rules" aria-hidden="true"><i /><i /><i /></span>
            <span className="document-seal" aria-hidden="true">{card.mark}</span>
          </span>
        </button>)}
      </div>
    </div>
    <div className="document-actions">
      <span className="sr-only" role="status">{tool.name} selected</span>
      {tool.links.map((link) => <Link key={link.id} href={`/tools/${link.id}`}>
        {link.name}<ArrowUpRight size={15} aria-hidden="true" />
      </Link>)}
    </div>
  </section>;
}
