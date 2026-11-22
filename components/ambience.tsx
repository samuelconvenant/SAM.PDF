"use client";
import { useEffect } from "react";

export function Ambience() {
  useEffect(() => {
    const media = matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    let frame = 0, x = 0, y = 0, targetX = 0, targetY = 0;
    let initialized = false;
    let active: HTMLElement | null = null;
    const glow = document.querySelector<HTMLElement>(".cursor-glow");
    function paint() {
      x += (targetX - x) * .18;
      y += (targetY - y) * .18;
      if (glow) glow.style.transform = `translate3d(${x}px,${y}px,0)`;
      frame = Math.abs(x - targetX) + Math.abs(y - targetY) > .5 ? requestAnimationFrame(paint) : 0;
    }
    function reset() {
      if (glow) glow.dataset.active = "false";
      active?.style.removeProperty("--mx");
      active?.style.removeProperty("--my");
      active = null;
      initialized = false;
      cancelAnimationFrame(frame);
      frame = 0;
    }
    function move(event: PointerEvent) {
      if (!media.matches || event.pointerType !== "mouse" || event.buttons) { reset(); return; }
      targetX = event.clientX;
      targetY = event.clientY;
      if (!initialized) { x = targetX; y = targetY; initialized = true; }
      if (glow) glow.dataset.active = "true";
      if (!frame) frame = requestAnimationFrame(paint);
      const node = event.target instanceof Element ? event.target.closest<HTMLElement>(".tool-card, .magnetic") : null;
      if (node !== active) {
        active?.style.removeProperty("--mx");
        active?.style.removeProperty("--my");
        active = node;
      }
      if (!node) return;
      const rect = node.getBoundingClientRect();
      if (node.classList.contains("magnetic")) {
        node.style.setProperty("--mx", `${(targetX - rect.left - rect.width / 2) * .055}px`);
        node.style.setProperty("--my", `${(targetY - rect.top - rect.height / 2) * .1}px`);
      } else {
        node.style.setProperty("--mx", `${targetX - rect.left}px`);
        node.style.setProperty("--my", `${targetY - rect.top}px`);
      }
    }
    const reveal = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.classList.add("revealed");
        reveal.unobserve(entry.target);
      }
    }, { threshold: .18 });
    const watch = () => document.querySelectorAll(".reveal:not(.revealed)").forEach((element) => reveal.observe(element));
    const routes = new MutationObserver(watch);
    const main = document.querySelector("main");
    if (main) routes.observe(main, { childList: true, subtree: true });
    watch();
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", reset);
    document.documentElement.addEventListener("pointerleave", reset);
    media.addEventListener("change", reset);
    return () => {
      reset(); reveal.disconnect(); routes.disconnect();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", reset);
      document.documentElement.removeEventListener("pointerleave", reset);
      media.removeEventListener("change", reset);
    };
  }, []);
  return <div className="cursor-glow" aria-hidden="true" />;
}
