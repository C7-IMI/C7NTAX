import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

/**
 * EmailService — sends transactional emails, ticket notifications,
 * follow-ups, and MFA codes. Configure SMTP via environment variables.
 */
export class EmailService {
  private transporter: Transporter;
  private defaultFrom: string;

  constructor(config?: { host?: string; port?: number; user?: string; pass?: string; from?: string; secure?: boolean }) {
    this.defaultFrom = config?.from ?? process.env.SMTP_FROM ?? "noreply@cyber7group.com";
    this.transporter = nodemailer.createTransport({
      host: config?.host ?? process.env.SMTP_HOST ?? "localhost",
      port: config?.port ?? Number(process.env.SMTP_PORT ?? 587),
      /**
       * `SMTP_SECURE` is what the configuration screens report, so it has to be what the sender
       * does. Until it was: the screens read this variable and the transport was hard-coded to
       * `false`, so a deployment on port 465 could show "secure: true" while every message was
       * attempted in clear text — a screen that contradicts the wire is worse than no screen.
       *
       * `false` is port 587 with STARTTLS, which is what most relays use; `true` is port 465, where
       * TLS *is* the connection rather than an upgrade to it. Only the exact string `"true"` counts,
       * which is how every other flag in this application is read.
       */
      secure: config?.secure ?? process.env.SMTP_SECURE === "true",
      /*
       * `auth` is **omitted entirely** when there are no credentials, rather than passed as an object
       * holding empty strings.
       *
       * That distinction is not tidiness: an `auth` object that is present tells the transport to
       * authenticate, so an unauthenticated relay — an internal relay, an address-allowlisted one, or
       * the local one a developer runs — was handed an AUTH attempt with a blank username. Some relays
       * answer that with an authentication failure instead of simply skipping auth, so a deployment
       * that needs no credentials could not send, and the error it produced looked like a wrong
       * password rather than a configuration that never had one.
       *
       * The condition is "either half is set", not "both": a relay that wants a username and no
       * password is unusual but real, and silently dropping a username somebody configured would be a
       * worse bug than the one being fixed. Verified by reading the transport's own options — absent
       * with no credentials, present when either is set.
       */
      ...(resolveSmtpCredentials(config) ? { auth: resolveSmtpCredentials(config)! } : {}),
    });
  }

  /** Verify SMTP connection */
  async verify(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }

  /** Send a generic email */
  async send(options: {
    to: string | string[];
    subject: string;
    html: string;
    /** Optional plain-text alternative (multipart/alternative) for clients that block HTML. */
    text?: string;
    cc?: string[];
    bcc?: string[];
    /**
     * The sender, when it is not the instance's `SMTP_FROM`.
     *
     * One address for every message is what this service did until the Email Studio's brand kit
     * existed; a brand kit may name a sender identity, and a message that leaves from an address the
     * configuration does not name is a message the configuration cannot explain. Blank means
     * `SMTP_FROM`, which is what every caller that does not set one gets.
     */
    from?: string;
    /** Where a reply goes, when it should not go to `from`. */
    replyTo?: string;
    attachments?: {
      filename: string;
      content: Buffer | string;
      contentType?: string;
      /** Content-ID for images referenced inline in the HTML (`<img src="cid:…">`). */
      cid?: string;
      contentDisposition?: "inline" | "attachment";
    }[];
  }): Promise<{ messageId: string }> {
    const info = await this.transporter.sendMail({
      from: options.from ?? this.defaultFrom,
      to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
      cc: options.cc,
      bcc: options.bcc,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      attachments: options.attachments,
    });
    return { messageId: info.messageId };
  }

  /** Send MFA code via email */
  async sendMfaCode(email: string, code: string): Promise<void> {
    await this.send({
      to: email,
      subject: "C7NTAX — Your Verification Code",
      html: mfaTemplate(code),
    });
  }

  /** Send ticket follow-up reminder to client */
  async sendTicketFollowUp(
    email: string,
    ticketNumber: string,
    ticketTitle: string,
    daysWaiting: number,
    portalUrl: string,
  ): Promise<void> {
    await this.send({
      to: email,
      subject: `[${ticketNumber}] Action Required — ${ticketTitle}`,
      html: followUpTemplate(ticketNumber, ticketTitle, daysWaiting, portalUrl),
    });
  }

  /** Send ticket auto-close notification */
  async sendTicketAutoClose(
    email: string,
    ticketNumber: string,
    ticketTitle: string,
  ): Promise<void> {
    await this.send({
      to: email,
      subject: `[${ticketNumber}] Ticket Closed — ${ticketTitle}`,
      html: autoCloseTemplate(ticketNumber, ticketTitle),
    });
  }

  /**
   * Tell a technician that a ticket they own has been reopened by the client.
   *
   * Internal, and therefore not the customer template with different words: it names who replied and
   * quotes what they said, because the person reading it has to decide what to do about it and the
   * client is already in the thread. The ticket's own page is the link — an internal email that asks
   * somebody to reply by email would put the answer in the wrong place.
   */
  async sendTicketReopened(
    to: string,
    options: {
      ticketNumber: string;
      ticketTitle: string;
      clientName?: string;
      contactName?: string;
      replyExcerpt: string;
      ticketUrl?: string;
    },
  ): Promise<void> {
    await this.send({
      to,
      subject: `[${options.ticketNumber}] Reopened by the client — ${options.ticketTitle}`,
      html: ticketReopenedTemplate(options),
    });
  }

  /**
   * Notify a ticket's contact that a customer-visible activity occurred
   * (a non-internal note was added, time was logged, or the status changed).
   * `cc` carries the ticket's CC contacts and anyone the author added.
   */
  async sendTicketActivity(
    to: string | string[],
    options: {
      ticketNumber: string;
      ticketTitle: string;
      eventLabel: string;
      details: string;
      clientName?: string;
      contactName?: string;
      cc?: string[];
    },
  ): Promise<void> {
    await this.send({
      to,
      cc: options.cc,
      subject: `[${options.ticketNumber}] ${options.eventLabel} — ${options.ticketTitle}`,
      html: ticketActivityTemplate(options),
    });
  }

  /** Send invoice to client */
  async sendInvoice(
    email: string,
    invoiceNumber: string,
    amount: number,
    dueDate: string,
    pdfBuffer: Buffer,
    portalUrl: string,
  ): Promise<void> {
    await this.send({
      to: email,
      subject: `Invoice ${invoiceNumber} — Due ${dueDate}`,
      html: invoiceTemplate(invoiceNumber, amount, dueDate, portalUrl),
      attachments: [
        {
          filename: `invoice-${invoiceNumber}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });
  }

  /** Send overdue invoice reminder */
  async sendOverdueReminder(
    email: string,
    invoiceNumber: string,
    amount: number,
    daysOverdue: number,
    portalUrl: string,
  ): Promise<void> {
    await this.send({
      to: email,
      subject: `Overdue Invoice ${invoiceNumber} — Payment Required`,
      html: overdueTemplate(invoiceNumber, amount, daysOverdue, portalUrl),
    });
  }
}

/**
 * The SMTP credentials this deployment has configured, or null when it has none.
 *
 * A caller's own config wins; otherwise the environment, read exactly as it was read before. Kept as a
 * function rather than inline in the constructor so the question "is there anything to authenticate
 * with" is asked once, in one place — by the transport, which must *omit* `auth` entirely when the
 * answer is no. See the note in the constructor for why that distinction matters.
 */
function resolveSmtpCredentials(config?: { user?: string; pass?: string }): { user: string; pass: string } | null {
  const user = config?.user ?? process.env.SMTP_USER ?? "";
  const pass = config?.pass ?? process.env.SMTP_PASS ?? "";
  return user || pass ? { user, pass } : null;
}

// ─── Email Templates (inline HTML, production should use MJML) ────────
// The words here are kept in step with `apps/api/src/services/emailMessages.ts` by `probe:email`, which
// renders each default and compares it line for line against what these functions produce. Two pieces of
// markup are mirrored on purpose: the `<br>` after the dash in the meta line and `white-space: nowrap`
// on the ticket number. Both exist because a ticket identifier, or a subject, broken across a line at
// 375px is what the owner called "random wrapping"; change one side without the other and the probe says so.

function mfaTemplate(code: string): string {
  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; background: #0f1923; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
    <div style="background: #c00000; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 20px; letter-spacing: 0.5px;">C7NTAX</h1>
    </div>
    <div style="padding: 32px 24px;">
      <h2 style="color: #fff; margin: 0 0 8px;">Verification Code</h2>
      <p style="color: #94a3b8; margin: 0 0 24px;">Use this code to complete your sign-in. It expires in 10 minutes.</p>
      <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 24px;">
        <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #ff5c5c; font-family: 'SF Mono', 'Cascadia Code', monospace;">${code}</span>
      </div>
      <p style="color: #64748b; font-size: 13px;">If you did not request this code, please ignore this email.</p>
    </div>
  </div>`;
}

function followUpTemplate(num: string, title: string, days: number, portal: string): string {
  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; background: #0f1923; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
    <div style="background: #f59e0b; padding: 24px; text-align: center;">
      <h1 style="color: #0f1923; margin: 0; font-size: 20px;">Action Required</h1>
    </div>
    <div style="padding: 32px 24px;">
      <p style="color: #94a3b8; margin: 0 0 16px;">Ticket <strong style="color: #fff; white-space: nowrap;">${num}</strong> —<br><em>${title}</em></p>
      <p style="color: #cbd5e1; margin: 0 0 16px;">We are waiting on your response. This ticket has been idle for <strong>${days} day${days === 1 ? "" : "s"}</strong>.</p>
      <p style="color: #cbd5e1; margin: 0 0 24px;">If no response is received within the timeframe, this ticket may be automatically closed.</p>
      <a href="${portal}" style="display: inline-block; background: #c00000; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Respond Now</a>
    </div>
  </div>`;
}

function autoCloseTemplate(num: string, title: string): string {
  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; background: #0f1923; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
    <div style="background: #64748b; padding: 24px; text-align: center;">
      <h1 style="color: #0f1923; margin: 0; font-size: 20px;">Ticket Closed</h1>
    </div>
    <div style="padding: 32px 24px;">
      <p style="color: #94a3b8; margin: 0 0 16px;">Ticket <strong style="color: #fff; white-space: nowrap;">${num}</strong> —<br><em>${title}</em></p>
      <p style="color: #cbd5e1; margin: 0;">This ticket was automatically closed due to inactivity. If this issue persists, please open a new ticket.</p>
    </div>
  </div>`;
}

function invoiceTemplate(num: string, amount: number, due: string, portal: string): string {
  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; background: #0f1923; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
    <div style="background: #c00000; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 20px;">Invoice ${num}</h1>
    </div>
    <div style="padding: 32px 24px;">
      <p style="color: #cbd5e1; margin: 0 0 8px;">Amount Due:</p>
      <p style="font-size: 28px; font-weight: 700; color: #ff5c5c; margin: 0 0 16px;">$${amount.toFixed(2)}</p>
      <p style="color: #94a3b8; margin: 0 0 16px;">Due Date: <strong style="color: #fff;">${due}</strong></p>
      <a href="${portal}" style="display: inline-block; background: #c00000; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">View &amp; Pay Invoice</a>
    </div>
  </div>`;
}

function overdueTemplate(num: string, amount: number, daysOd: number, portal: string): string {
  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; background: #0f1923; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
    <div style="background: #ef4444; padding: 24px; text-align: center;">
      <h1 style="color: #fff; margin: 0; font-size: 20px;">Payment Overdue</h1>
    </div>
    <div style="padding: 32px 24px;">
      <p style="color: #cbd5e1; margin: 0 0 8px;">Outstanding Balance:</p>
      <p style="font-size: 28px; font-weight: 700; color: #ef4444; margin: 0 0 16px;">$${amount.toFixed(2)}</p>
      <p style="color: #94a3b8; margin: 0 0 24px;">Invoice ${num} is <strong style="color: #ef4444;">${daysOd} day${daysOd === 1 ? "" : "s"} overdue</strong>.</p>
      <a href="${portal}" style="display: inline-block; background: #c00000; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Pay Now</a>
    </div>
  </div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}

function ticketActivityTemplate(o: {
  ticketNumber: string;
  ticketTitle: string;
  eventLabel: string;
  details: string;
  clientName?: string;
  contactName?: string;
}): string {
  const greeting = o.contactName
    ? `<p style="color: #cbd5e1; margin: 0 0 16px;">Hi ${escapeHtml(o.contactName)},</p>`
    : "";
  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; background: #0f1923; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
    <div style="background: #c00000; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 20px;">Ticket Update</h1>
    </div>
    <div style="padding: 32px 24px;">
      ${greeting}
      <p style="color: #94a3b8; margin: 0 0 8px;">Ticket <strong style="color: #fff; white-space: nowrap;">${escapeHtml(o.ticketNumber)}</strong> —<br><em>${escapeHtml(o.ticketTitle)}</em></p>
      <p style="color: #cbd5e1; margin: 0 0 16px;"><strong style="color: #fff;">${escapeHtml(o.eventLabel)}</strong></p>
      <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 16px; color: #cbd5e1; margin-bottom: 24px;">${escapeHtml(o.details).replace(/\r?\n/g, "<br>")}</div>
      <p style="color: #94a3b8; margin: 0;">If you have any questions, simply reply to this email.</p>
      ${o.clientName ? `<p style="color: #64748b; font-size: 13px; margin: 8px 0 0;">${escapeHtml(o.clientName)}</p>` : ""}
    </div>
  </div>`;
}

/**
 * An internal notification: a ticket the client has just reopened.
 *
 * Its own template rather than the customer one with different words. The reader is a technician who
 * has to decide what to do next, so it names the person who replied and quotes what they said, and it
 * links to the ticket instead of inviting a reply — the answer belongs in the thread, not in an inbox.
 */
function ticketReopenedTemplate(o: {
  ticketNumber: string;
  ticketTitle: string;
  clientName?: string;
  contactName?: string;
  replyExcerpt: string;
  ticketUrl?: string;
}): string {
  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; background: #0f1923; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
    <div style="background: #ea580c; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 20px;">Reopened by the client</h1>
    </div>
    <div style="padding: 32px 24px;">
      <p style="color: #94a3b8; margin: 0 0 8px;">Ticket <strong style="color: #fff; white-space: nowrap;">${escapeHtml(o.ticketNumber)}</strong> —<br><em>${escapeHtml(o.ticketTitle)}</em></p>
      <p style="color: #cbd5e1; margin: 0 0 16px;">${escapeHtml(o.contactName || o.clientName || "The client")} replied to the closing email, so this ticket is back in the queue as <strong style="color: #fff;">Customer reopened</strong>.</p>
      <div style="background: #1e293b; border: 1px solid #334155; border-left: 3px solid #ea580c; border-radius: 8px; padding: 16px; color: #cbd5e1; margin-bottom: 24px;">${escapeHtml(o.replyExcerpt).replace(/\r?\n/g, "<br>")}</div>
      ${o.ticketUrl ? `<a href="${o.ticketUrl}" style="display: inline-block; background: #c00000; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Open the ticket</a>` : ""}
      <p style="color: #64748b; font-size: 13px; margin: 16px 0 0;">Sent to the ticket's owner because the client answered a ticket that had been closed.</p>
    </div>
  </div>`;
}

export { mfaTemplate, followUpTemplate, autoCloseTemplate, invoiceTemplate, overdueTemplate, ticketActivityTemplate, ticketReopenedTemplate };
