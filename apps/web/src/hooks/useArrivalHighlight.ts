import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Arriving somewhere specific, rather than at the top of a page.
 *
 * A recent-activity link carries `?hl=<target>` — the key of the region it means. This hook finds that
 * region, scrolls it into view and flashes it, then **removes the parameter from the URL**. Removing it
 * matters for two reasons: a reload does not re-flash something that is no longer news, and the address
 * bar is left clean so the link can be copied without carrying the instruction.
 *
 * Three rules the implementation keeps:
 *
 * 1. **A named region wins, and a page heading is the fallback.** `data-hl="ticket-activity"` is the
 *    precise location; when the target is not on the page — the record changed shape, the field was
 *    renamed — the page's `<h1>` is flashed instead. Arriving at a page and being told where to look is
 *    better than arriving at a page with nothing happening, and than an error about a missing anchor.
 * 2. **Scrolling is instant and the flash is the feedback.** A smooth scroll fighting a freshly-mounted
 *    page's own layout is how "scroll to the right place" fails; the position is set, then the region
 *    is pointed at.
 * 3. **Motion is a preference, not a decoration.** `prefers-reduced-motion` gets the scroll and a
 *    steady outline instead of a pulse — the destination is the point, the animation is not.
 */
export const HIGHLIGHT_PARAM = "hl";
/** How long the flash lasts. Long enough to find with the eye, short enough not to nag. */
const FLASH_MS = 2600;

/** The heading of the content column — the destination when nothing more precise is named. */
function pageHeading(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-hl='page-heading']")
    ?? document.querySelector<HTMLElement>("main h1")
    ?? document.querySelector<HTMLElement>("h1");
}

function findTarget(key: string): HTMLElement | null {
  if (key === "page-heading") return pageHeading();

  const data = document.querySelector<HTMLElement>(`[data-hl="${key}"]`);
  if (data) return data;

  // A bare element id is also accepted, so a page can use a plain anchor when that is what it has.
  const byId = document.getElementById(key);
  if (byId) return byId;

  return pageHeading();
}

/**
 * Read `?hl=<target>` on arrival and point at it.
 *
 * Mounted once, in the application shell, so any page can be a destination without opting in; a page
 * opts into *precision* by putting `data-hl` on the region worth pointing at.
 */
export function useArrivalHighlight(): void {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const key = params.get(HIGHLIGHT_PARAM);
    if (!key) return;

    // One frame, so the page has rendered the thing the link is about.
    const frame = requestAnimationFrame(() => {
      const element = findTarget(key);
      if (element) {
        element.scrollIntoView({ block: "center", behavior: "auto" });
        element.classList.add("c7-arrival");
        // Scroll-margin keeps the region clear of the sticky header; the class is removed after the
        // animation so a second visit re-triggers it rather than finding it already applied.
        window.setTimeout(() => element.classList.remove("c7-arrival"), FLASH_MS);
      }

      const next = new URLSearchParams(location.search);
      next.delete(HIGHLIGHT_PARAM);
      const query = next.toString();
      navigate(`${location.pathname}${query ? `?${query}` : ""}${location.hash}`, { replace: true });
    });

    return () => cancelAnimationFrame(frame);
  }, [location.pathname, location.search, location.hash, navigate]);
}
