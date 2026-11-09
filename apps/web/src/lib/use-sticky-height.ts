"use client";

import { type RefObject, useLayoutEffect } from "react";

// Publishes a sticky bar's rendered height as a CSS variable on <html>, so the
// bar below it and the page's scroll padding follow wrapping on narrow screens.
export function useStickyHeight(ref: RefObject<HTMLElement | null>, variable: string) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty(variable, `${element.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty(variable);
    };
  }, [ref, variable]);
}
