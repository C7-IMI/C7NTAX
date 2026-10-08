/**
 * Where a piece of data came from.
 *
 * A PSA shows data that is often not its own: an invoice issued in FlexPoint, a licence count read
 * from Microsoft 365, a contact pulled out of IT Glue. Once it is on screen it looks exactly like
 * data C7NTAX owns — so somebody edits it, wonders why the edit vanished, or quotes a figure that
 * came from a system they had forgotten was in the chain.
 *
 * This is the sentence that stops that: one small note, on every surface that renders a connected
 * system's data, naming the system. It is deliberately quiet — a caption, not a badge — and it is
 * consistent enough to become a reading habit rather than something noticed once.
 *
 *     <DataSourceNote source="FlexPoint Payment Solutions" />
 *     <DataSourceNote source="Microsoft 365" detail="read 4 minutes ago" />
 */
import type { ReactNode } from "react";
import { Plug } from "lucide-react";

/** The display names, in one place, so a rename is one edit rather than a search. */
export const CONNECTOR_NAMES: Record<string, string> = {
  flexpoint: "FlexPoint Payment Solutions",
  quickbooks: "QuickBooks Online",
  microsoft365: "Microsoft 365",
  azure: "Azure",
  aws: "AWS",
  pax8: "Pax8",
  connectwise: "ConnectWise PSA",
  halopsa: "HaloPSA",
  kantata: "Kantata",
  scoro: "Scoro",
  autotask: "AutoTask PSA",
  itglue: "IT Glue",
  sentinelone: "SentinelOne",
  avanan: "Avanan",
  proofpoint: "Proofpoint",
  azure_ad_sso: "Azure AD SSO",
};

/**
 * The note itself.
 *
 * `source` is the connector's display name (or a key from `CONNECTOR_NAMES`); `detail` is for the
 * one extra fact that stops a question — when it was read, which mailbox it came from, which
 * account it belongs to.
 */
export function DataSourceNote({
  source,
  detail,
  className = "",
  tone = "muted",
}: {
  source: string;
  detail?: ReactNode;
  className?: string;
  /** `muted` for a caption under data; `inline` for a chip beside a heading. */
  tone?: "muted" | "inline";
}) {
  const name = CONNECTOR_NAMES[source] ?? source;
  if (tone === "inline") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-lighter px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 ${className}`}
        title={`This data is read from ${name}`}
      >
        <Plug size={10} className="shrink-0" />
        {name}
      </span>
    );
  }
  return (
    <p className={`flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-500 ${className}`}>
      <Plug size={11} className="mt-0.5 shrink-0" />
      <span>
        Data from <span className="text-gray-400">{name}</span>
        {detail ? <> · {detail}</> : null}
      </span>
    </p>
  );
}

export default DataSourceNote;
