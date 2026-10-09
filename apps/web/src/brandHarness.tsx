/**
 * TEMPORARY verification harness — not part of the product, deleted before the task ends.
 *
 * The Branding section's four routes are wired by the coordinator (`App.tsx` / `navModel.ts`), which this
 * effort must not touch, so while they are unwired the only way to drive the pages in a real browser is
 * to mount them directly. This module does exactly that and nothing else: it renders one of the four
 * pages inside the same providers the application uses (`AuthProvider` reads the session cookie that the
 * signed-in tab already has), into a host element it creates.
 *
 * Usage from the console of the signed-in tab at http://localhost:3010:
 *   const h = await import("/src/brandHarness.tsx"); h.mount("identity");
 *   h.unmount();
 */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import { BrandingIdentityPage } from "./pages/BrandingIdentity";
import { BrandingDocumentsPage } from "./pages/BrandingDocuments";
import { BrandingClientsPage } from "./pages/BrandingClients";
import { BrandingReportsPage } from "./pages/BrandingReports";

const PAGES: Record<string, { path: string; element: React.ReactElement }> = {
  identity: { path: "/admin/branding", element: <BrandingIdentityPage /> },
  documents: { path: "/admin/branding/documents", element: <BrandingDocumentsPage /> },
  clients: { path: "/admin/branding/clients", element: <BrandingClientsPage /> },
  reports: { path: "/admin/branding/reports", element: <BrandingReportsPage /> },
};

let root: Root | null = null;
let host: HTMLElement | null = null;

export function mount(which: keyof typeof PAGES | string): void {
  unmount();
  const page = PAGES[which as string];
  if (!page) throw new Error(`No such branding screen: ${String(which)}`);
  host = document.createElement("div");
  host.id = "brand-harness";
  host.style.cssText = "position:fixed;inset:0;z-index:9000;overflow:auto;background:var(--navy-950,#0b1220);padding:1rem";
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    <AuthProvider>
      <MemoryRouter initialEntries={[page.path]}>{page.element}</MemoryRouter>
    </AuthProvider>,
  );
}

export function unmount(): void {
  if (root) {
    root.unmount();
    root = null;
  }
  if (host) {
    host.remove();
    host = null;
  }
}
