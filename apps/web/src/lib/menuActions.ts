import toast from "react-hot-toast";
import { AppWindow, SquareArrowOutUpRight } from "lucide-react";
import type { MenuEntry } from "../components/ContextMenu";

/**
 * Actions shared by the application right-click menus, so every section's menu
 * behaves the same way (see CONTEXT-MENUS-ROLLBACK.md).
 */

export const absoluteUrl = (path: string) => `${window.location.origin}${path}`;

export function openInNewTab(path: string): void {
  window.open(absoluteUrl(path), "_blank", "noopener");
}

/** Window features make this a real popup window rather than another tab. */
export function openInNewWindow(path: string): void {
  window.open(absoluteUrl(path), "_blank", "noopener,width=1280,height=880,left=80,top=60");
}

export async function copyText(value: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Could not copy to the clipboard");
  }
}

/** The current view's own URL, filters and all. */
export function currentView(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** The "open this view in…" pair that ends every section menu. */
export function viewMenuEntries(view = currentView()): MenuEntry[] {
  return [
    { label: "Open this view in new tab", icon: SquareArrowOutUpRight, onSelect: () => openInNewTab(view) },
    { label: "Open this view in new window", icon: AppWindow, onSelect: () => openInNewWindow(view) },
  ];
}
