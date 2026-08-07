import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

/**
 * EmailService — sends transactional emails, ticket notifications,
 * follow-ups, and MFA codes. Configure SMTP via environment variables.
 */
export class EmailService {
  private transporter: Transporter;
  private defaultFrom: string;

  constructor(config?: { host?: string; port?: number; user?: string; pass?: string; from?: string }) {
    this.defaultFrom = config?.from ?? process.env.SMTP_FROM ?? "noreply@cyber7group.com";
    this.transporter = nodemailer.createTransport({
      host: config?.host ?? process.env.SMTP_HOST ?? "localhost",
      port: config?.port ?? Number(process.env.SMTP_PORT ?? 587),
      secure: false,
      auth: {
        user: config?.user ?? process.env.SMTP_USER ?? "",
        pass: config?.pass ?? process.env.SMTP_PASS ?? "",
      },
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
    cc?: string[];
    bcc?: string[];
    attachments?: { filename: string; content: Buffer | string; contentType?: string }[];
  }): Promise<{ messageId: string }> {
    const info = await this.transporter.sendMail({
      from: this.defaultFrom,
      to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
      cc: options.cc,
      bcc: options.bcc,
      subject: options.subject,
      html: options.html,
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

// ─── Email Templates (inline HTML, production should use MJML) ────────

function mfaTemplate(code: string): string {
  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; background: #0f1923; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
    <div style="background: #00d4ff; padding: 24px; text-align: center;">
      <h1 style="color: #0f1923; margin: 0; font-size: 20px;">C7NTAX</h1>
    </div>
    <div style="padding: 32px 24px;">
      <h2 style="color: #fff; margin: 0 0 8px;">Verification Code</h2>
      <p style="color: #94a3b8; margin: 0 0 24px;">Use this code to complete your sign-in. It expires in 10 minutes.</p>
      <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 24px;">
        <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #00d4ff; font-family: 'SF Mono', 'Cascadia Code', monospace;">${code}</span>
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
      <p style="color: #94a3b8; margin: 0 0 16px;">Ticket <strong style="color: #fff;">${num}</strong> — <em>${title}</em></p>
      <p style="color: #cbd5e1; margin: 0 0 16px;">We are waiting on your response. This ticket has been idle for <strong>${days} day${days === 1 ? "" : "s"}</strong>.</p>
      <p style="color: #cbd5e1; margin: 0 0 24px;">If no response is received within the timeframe, this ticket may be automatically closed.</p>
      <a href="${portal}" style="display: inline-block; background: #00d4ff; color: #0f1923; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Respond Now</a>
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
      <p style="color: #94a3b8; margin: 0 0 16px;">Ticket <strong style="color: #fff;">${num}</strong> — <em>${title}</em></p>
      <p style="color: #cbd5e1; margin: 0;">This ticket was automatically closed due to inactivity. If this issue persists, please open a new ticket.</p>
    </div>
  </div>`;
}

function invoiceTemplate(num: string, amount: number, due: string, portal: string): string {
  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; background: #0f1923; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
    <div style="background: #00d4ff; padding: 24px; text-align: center;">
      <h1 style="color: #0f1923; margin: 0; font-size: 20px;">Invoice ${num}</h1>
    </div>
    <div style="padding: 32px 24px;">
      <p style="color: #cbd5e1; margin: 0 0 8px;">Amount Due:</p>
      <p style="font-size: 28px; font-weight: 700; color: #00d4ff; margin: 0 0 16px;">$${amount.toFixed(2)}</p>
      <p style="color: #94a3b8; margin: 0 0 16px;">Due Date: <strong style="color: #fff;">${due}</strong></p>
      <a href="${portal}" style="display: inline-block; background: #00d4ff; color: #0f1923; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">View &amp; Pay Invoice</a>
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
      <a href="${portal}" style="display: inline-block; background: #00d4ff; color: #0f1923; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Pay Now</a>
    </div>
  </div>`;
}

export { mfaTemplate, followUpTemplate, autoCloseTemplate, invoiceTemplate, overdueTemplate };
