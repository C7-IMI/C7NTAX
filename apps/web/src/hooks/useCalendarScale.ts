import { useEffect, useRef, useState } from "react";

/**
 * Proportional scaling for calendar cards.
 *
 * The inner element keeps its natural responsive size (the "current" size —
 * e.g. max-w-3xl on desktop, fluid on narrow screens) and is visually scaled
 * with a uniform CSS transform so square day cells and the overall aspect
 * ratio never distort. The scale is width-driven: the calendar fills the
 * available container width (k = availW / baseW, clamped to ≥ 1 so the
 * current size is the minimum). Date cards and all inner content scale
 * together with the container because the transform wraps everything.
 *
 * Usage:
 *   const { outerRef, innerRef, scale, scaledW, scaledH } = useCalendarScale();
 *   <div ref={outerRef} className="card p-3">
 *     <div style={{ width: scaledW || undefined, height: scaledH || undefined }}>
 *       <div ref={innerRef} style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
 *         ...calendar content...
 *       </div>
 *     </div>
 *   </div>
 */
export function useCalendarScale<O extends HTMLElement, I extends HTMLElement>() {
  const outerRef = useRef<O>(null);
  const innerRef = useRef<I>(null);
  const [scale, setScale] = useState(1);
  const [base, setBase] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const update = () => {
      // Layout size is unaffected by CSS transforms, so these are the
      // natural (unscaled) dimensions — i.e. the current size = minimum.
      const baseW = inner.offsetWidth;
      const baseH = inner.offsetHeight;
      if (baseW <= 0 || baseH <= 0) return;
      setBase((prev) => (prev.w === baseW && prev.h === baseH ? prev : { w: baseW, h: baseH }));

      // Width-driven: fill the container width; never below the current size.
      const availW = Math.max(outer.clientWidth - 24, baseW); // card p-3 padding
      setScale(Math.max(1, availW / baseW));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(outer);
    ro.observe(inner);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return {
    outerRef,
    innerRef,
    scale,
    scaledW: base.w > 0 ? Math.round(base.w * scale) : 0,
    scaledH: base.h > 0 ? Math.round(base.h * scale) : 0,
  };
}
