import { useEffect, useRef } from "react";
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
/**
 * How long to keep looking for the exact region before settling for the page heading.
 *
 * Generous on purpose: the cost of waiting is that the pointing arrives a moment late, and the cost of
 * giving up early is pointing at the wrong thing — a page that has loaded its heading but not its
 * contents looks identical to a page with no contents.
 */
const TARGET_WAIT_MS = 3000;

/** The heading of the content column — the destination when nothing more precise is named. */
function pageHeading(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>("[data-hl='page-heading']") ??
    document.querySelector<HTMLElement>("main h1") ??
    document.querySelector<HTMLElement>("h1")
  );
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

  /*
   * The arrival instruction, remembered outside the effect.
   *
   * It has to be held in a ref because the effect can run more than once for the same destination — most
   * visibly in development, where React invokes an effect twice on mount — and because this effect's own
   * first act is to clean the parameter out of the URL. Without the ref, the second run reads an already
   * tidy URL, finds nothing to do, and the flash never happens; the symptom is a link that navigates
   * correctly and points at nothing, which is exactly what happened when this was tested by *loading* the
   * page rather than by clicking through to it.
   */
  const pending = useRef<{ path: string; key: string } | null>(null);

  useEffect(() => {
    // A new destination invalidates the last instruction.
    if (pending.current && pending.current.path !== location.pathname)
      pending.current = null;
    if (!pending.current) {
      const key = new URLSearchParams(window.location.search).get(
        HIGHLIGHT_PARAM,
      );
      if (key) pending.current = { path: location.pathname, key };
    }

    const arriving = pending.current;
    if (!arriving) return;

    // The instruction has been read, so the address bar is cleaned at once: a reload should not re-flash
    // something that is no longer news.
    const next = new URLSearchParams(window.location.search);
    if (next.has(HIGHLIGHT_PARAM)) {
      next.delete(HIGHLIGHT_PARAM);
      const query = next.toString();
      navigate(
        `${location.pathname}${query ? `?${query}` : ""}${location.hash}`,
        { replace: true },
      );
    }

    let flashTimer: number | undefined;
    let settled = false;

    const pointAt = (element: HTMLElement) => {
      element.scrollIntoView({ block: "center", behavior: "auto" });
      element.classList.add("c7-arrival");
      // Removed after the animation so a second arrival re-triggers it rather than finding it applied.
      flashTimer = window.setTimeout(
        () => element.classList.remove("c7-arrival"),
        FLASH_MS,
      );
    };

    /*
     * Wait for the target, because most pages load their contents *after* they mount: the configuration
     * screen's fields, a ticket's activity and a client's summary all arrive from the API a render later.
     * Checking once, one frame in, found none of them and settled for the page heading — precisely the
     * "arrived at the page and was told nothing" outcome the region exists to avoid. So this keeps
     * looking for the precise target, and only after the wait settles for the heading.
     */
    const deadline = Date.now() + TARGET_WAIT_MS;
    const sought = arriving.key;
    const seek = () => {
      if (settled) return;
      const exact =
        document.querySelector<HTMLElement>(`[data-hl="${sought}"]`) ??
        document.getElementById(sought);
      if (exact) {
        settled = true;
        pending.current = null;
        pointAt(exact);
        return;
      }
      if (Date.now() >= deadline) {
        settled = true;
        pending.current = null;
        const fallback = pageHeading();
        if (fallback) pointAt(fallback);
        return;
      }
      window.setTimeout(seek, 100);
    };
    seek();

    return () => {
      settled = true;
      if (flashTimer !== undefined) window.clearTimeout(flashTimer);
    };
  }, [location.pathname, location.hash, navigate]);
}
