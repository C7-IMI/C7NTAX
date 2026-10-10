/**
 * `/admin/email/log` — the shell: the last sends, with the reason behind anything that did not go.
 *
 * This is the screen that makes the rest of the feature trustworthy. Without it, "we changed the
 * template" has no evidence and "the client never got it" has no answer — which is why it has **no
 * fallback**: when `GET /api/email/log` does not answer the screen says what could not be read and
 * describes what exists instead, and it does not draw a sample row. A fabricated line in a delivery log
 * is worse than an empty table.
 *
 * The two arrangements are in `components/email/EmailLogModern.tsx` (rows with the reason inline, chips,
 * a countable footer) and `components/email/EmailLogClassic.tsx` (a table with an Action column and the
 * reason in a dialog). The read, the figures and the words are here and in `logView.ts`, shared by both.
 *
 * **The one write this screen appears to have, it does not have.** There is no route that resends a
 * logged message, so Resend is drawn disabled with the reason beside it, per `NO_RESEND_ROUTE` — a
 * button that says Resend and cannot resend is worse than a disabled one.
 */
import { useMemo } from "react";
import { Permission } from "@C7NTAX/shared";
import { useAuth } from "../hooks/useAuth";
import { useModernInterface } from "../hooks/useNavigationStyle";
import { EmailLogModern } from "../components/email/EmailLogModern";
import { EmailLogClassic } from "../components/email/EmailLogClassic";
import { useEmailLog } from "../components/email/emailApi";
import { resolveLog, type EmailLogProps } from "../components/email/logView";
import { DELIVERY_DEFAULTS, NO_RESEND_ROUTE } from "../components/email/emailFacts";

export function EmailLogPage() {
  const modern = useModernInterface();
  const log = useEmailLog();
  const { permissions } = useAuth();
  const canManage = permissions.includes(Permission.EmailManage);

  const view = useMemo(() => resolveLog(log), [log]);

  const props: EmailLogProps = {
    rows: view.rows,
    counts: view.counts,
    countsAreWholeLog: view.countsAreWholeLog,
    status: log.status,
    message: log.message,
    reload: log.reload,
    retentionDays: DELIVERY_DEFAULTS.retentionDays,
    canManage,
    resendBlockedBecause: NO_RESEND_ROUTE,
  };

  return modern ? <EmailLogModern {...props} /> : <EmailLogClassic {...props} />;
}
