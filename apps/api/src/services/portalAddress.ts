/**
 * The address customers are given for the portal.
 *
 * Most deployments serve the portal from the same origin as the staff application, so the answer
 * needs no configuration at all: the deployment's own web origin, plus `/portal`. A deployment
 * that puts the portal on its own hostname — a vanity address, a separate customer-facing
 * certificate, a reverse proxy with its own name — cannot be described that way, which is what
 * the saved address on the Customer Portal screen is for.
 *
 * The order is the product's usual one: what an administrator saved, then what the deployment
 * says (`PORTAL_PUBLIC_URL`, else the deployment's own `WEB_ORIGIN`), then the origin the caller
 * itself arrived on, so a screen never has to draw an empty address. `source` travels with the
 * answer so a screen can say which of those decided it.
 */
import { configText, savedValue } from "./appSettings";

export type PortalAddressSource = "setting" | "environment" | "deployment" | "request" | "none";

export interface PortalAddress {
  /** The full address of the portal, for example `https://portal.example.com/portal`. */
  url: string;
  source: PortalAddressSource;
}

const trimSlashes = (value: string): string => value.trim().replace(/\/+$/, "");

export function portalAddress(requestOrigin = ""): PortalAddress {
  const saved = trimSlashes(String(savedValue("portal", "publicUrl") ?? ""));
  if (saved) return { url: saved, source: "setting" };

  const fromEnvironment = trimSlashes(configText("portal", "publicUrl"));
  if (fromEnvironment) return { url: fromEnvironment, source: "environment" };

  const webOrigin = trimSlashes(process.env.WEB_ORIGIN ?? "");
  if (webOrigin) return { url: `${webOrigin}/portal`, source: "deployment" };

  const origin = trimSlashes(requestOrigin);
  if (origin) return { url: `${origin}/portal`, source: "request" };

  return { url: "/portal", source: "none" };
}

/** The address alone, for the places that only need somewhere to point a link or an email. */
export function portalBaseUrl(requestOrigin = ""): string {
  return portalAddress(requestOrigin).url;
}
