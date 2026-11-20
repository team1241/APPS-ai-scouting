"use client";

import { type RefObject, useLayoutEffect } from "react";

// Publishes a sticky bar's rendered height as a CSS variable on <html>, so the
// bar below it and the page's scroll padding follow wrapping on narrow screens.
// A bar that is only sticky at some widths publishes 0 while it scrolls with the page.
export function useStickyHeight(ref: RefObject<HTMLElement | null>, variable: string) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const root = document.documentElement;
    const update = () => {
      const sticky = getComputedStyle(element).position === "sticky";
      root.style.setProperty(variable, `${sticky ? element.offsetHeight : 0}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      root.style.removeProperty(variable);
    };
  }, [ref, variable]);
}
