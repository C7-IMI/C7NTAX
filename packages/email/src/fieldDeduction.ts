/**
 * Field deduction for the email-to-ticket connector (ConnectWise Asio-style
 * matching). Pure, testable functions — no I/O.
 */

/** Strip Re:/FW: prefixes and existing ticket-number tags from a subject. */
export function stripSubjectPrefixes(subject: string): string {
  let s = (subject || "").trim();
  // Remove leading RE:/FW:/AW: chains (optionally numbered, e.g. "RE[3]:")
  const chain = /^(?:(?:re|fw|aw)\s*\[\d+\]\s*:|\s*(?:re|fw|aw)\s*:)+/i;
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(chain, "").trim();
  }
  // Remove existing ticket tags like [C7-12345678] / [TKT-abc123]
  s = s.replace(/\[(?:c7-\d{5,10}|tkt[-_\s]?\w{6,12})\]/gi, "").trim();
  s = s.replace(/^\s*[-–—:]\s*/, "").trim();
  return s;
}

/** Split a display name into first/last; fall back to the email local part. */
export function deduceName(displayName: string, emailAddress: string): { firstName: string; lastName: string } {
  const name = (displayName || "").trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
    return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
  }
  const local = (emailAddress || "").split("@")[0] || "";
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  const capitalized = cleaned
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .trim();
  return capitalized ? { firstName: capitalized, lastName: "" } : { firstName: "Unknown", lastName: "Sender" };
}

/** Extract a comparable domain from an email address or website URL. */
export function extractDomain(value: string | null | undefined): string {
  if (!value) return "";
  let v = value.trim().toLowerCase();
  if (v.includes("@")) {
    const at = v.split("@")[1];
    if (at) v = at;
  }
  const domain = v.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0];
  v = domain ? domain.replace(/^www\./, "") : v;
  return v;
}

/** Strip quoted-reply trailers and > quoting from an email body. */
export function stripQuotedReply(bodyText: string): string {
  let text = (bodyText || "").replace(/\r\n/g, "\n");
  // Cut at common reply separators
  const cut = text.search(/\n\s*(?:on\s+.+wrote:|from:.*\n\s*sent:|---\s*original message\s*---|begin forwarded message)/i);
  if (cut >= 0) text = text.slice(0, cut);
  // Drop lines that are pure quoting and signature lines
  const lines = text
    .split("\n")
    .filter((l) => !/^\s*>\s?/.test(l))
    .filter((l) => l.trim().length > 0 || l.trim() === "" && false)
    .filter((l, i, arr) => {
      const t = l.trim();
      if (!t) return true;
      // drop long dash signature separators (30+ chars of -_=)
      if (/^[-_=]{30,}$/.test(t)) return false;
      return true;
    });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const BASE_PRIORITY_WORDS = {
  urgent: ["urgent", "critical", "emergency", "asap", "immediately", "down"],
  high: ["important", "high priority", "broken", "error", "issue"],
};

/** Merge subject/body keywords + connector-specific keywords into a priority. */
export function deducePriority(subject: string, bodyText: string, extraKeywords: string[] = []): "low" | "medium" | "high" | "critical" {
  const text = `${subject || ""} ${bodyText || ""} ${(extraKeywords || []).join(" ")}`.toLowerCase();
  const urgentCount = BASE_PRIORITY_WORDS.urgent.filter((w) => text.includes(w)).length;
  const highCount = BASE_PRIORITY_WORDS.high.filter((w) => text.includes(w)).length;
  if (urgentCount >= 2) return "critical";
  if (urgentCount >= 1 || highCount >= 2) return "high";
  if (highCount >= 1) return "medium";
  return "low";
}

/** Detect common auto-responder signals (out-of-office etc.). */
export function isAutoReply(subject: string, bodyText: string): boolean {
  const s = `${subject || ""}`.toLowerCase();
  const b = `${bodyText || ""}`.toLowerCase();
  if (/automatic reply|out of office|out-of-office|vacation responder|auto.?response/i.test(s)) return true;
  if (b.length < 400 && /out of (the )?office|automatic reply|auto.?response/i.test(b)) return true;
  return false;
}
