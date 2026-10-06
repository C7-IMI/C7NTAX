import { TicketStatus, TicketPriority } from "@C7NTAX/shared";
import { fetchUnseenEmails, markEmailsSeen } from "./imapFetch";

// ─── Types for processed emails ─────────────────────────────────────

export interface ParsedEmail {
  messageId: string;
  from: { name: string; email: string };
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    content: Buffer;
  }>;
  date: Date;
  inReplyTo: string | null;
  references: string[];
}

export interface TicketMatchResult {
  matched: boolean;
  ticketId?: string;
  action: "create" | "update" | "ignore";
  confidence: number;
}

/** What a transport hands to the connector manager for one incoming message. */
export interface IncomingEmail {
  connectorId: string;
  boardId: string;
  email: ParsedEmail;
  match: TicketMatchResult;
}

export interface EmailConnectorConfig {
  id: string;
  boardId: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  folder?: string;
  pollIntervalSeconds: number;
  enabled: boolean;
}

// ─── Ticket Matching Logic ──────────────────────────────────────────

const TICKET_ID_PATTERN = /\[?#?(TKT|TICKET)[-_\s]?(\w{6,12})\]?/i;
const TICKET_ID_SUBJECT_PATTERN = /\[C7-(\d{5,10})\]/i;

/**
 * Determines whether an incoming email matches an existing ticket
 * by examining subject, in-reply-to headers, and references.
 */
export function matchEmailToTicket(email: ParsedEmail): TicketMatchResult {
  // Check for ticket ID in subject (e.g. [C7-12345678])
  const subjectMatch = TICKET_ID_SUBJECT_PATTERN.exec(email.subject);
  if (subjectMatch && subjectMatch[1]) {
    return {
      matched: true,
      ticketId: subjectMatch[1],
      action: "update",
      confidence: 0.95,
    };
  }

  // Check for ticket ID anywhere in subject
  const looseMatch = TICKET_ID_PATTERN.exec(email.subject);
  if (looseMatch && looseMatch[2]) {
    return {
      matched: true,
      ticketId: looseMatch[2],
      action: "update",
      confidence: 0.7,
    };
  }

  // Check in-reply-to header for ticket thread
  if (email.inReplyTo) {
    const replyMatch = TICKET_ID_PATTERN.exec(email.inReplyTo);
    if (replyMatch && replyMatch[2]) {
      return {
        matched: true,
        ticketId: replyMatch[2],
        action: "update",
        confidence: 0.85,
      };
    }
  }

  // No match — create new ticket
  return {
    matched: false,
    action: "create",
    confidence: 0.9,
  };
}

/**
 * Extracts a suggested priority from email content keywords.
 */
export function extractPriority(email: ParsedEmail): TicketPriority {
  const text = (email.subject + " " + email.bodyText).toLowerCase();
  const urgentWords = ["urgent", "critical", "emergency", "asap", "immediately", "down"];
  const highWords = ["important", "high priority", "broken", "error", "issue"];

  const urgentCount = urgentWords.filter((w) => text.includes(w)).length;
  const highCount = highWords.filter((w) => text.includes(w)).length;

  if (urgentCount >= 2) return TicketPriority.Critical;
  if (urgentCount >= 1 || highCount >= 2) return TicketPriority.High;
  if (highCount >= 1) return TicketPriority.Medium;
  return TicketPriority.Low;
}

// ─── Email Connector Manager ────────────────────────────────────────

/**
 * Manages multiple IMAP email connectors for different service boards.
 * Each connector polls an IMAP mailbox and ingests emails as tickets.
 */
export class EmailConnectorManager {
  private connectors: Map<string, EmailConnectorConfig> = new Map();
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private handler?: (data: IncomingEmail) => Promise<boolean>;

  /**
   * Register the single handler that turns a matched email into ticket work.
   * It returns true when the message was dealt with (ticket created, reply
   * appended, or deliberately ignored) — only then is the message marked seen,
   * so a failure leaves it unread for the next poll.
   */
  onEmail(handler: (data: IncomingEmail) => Promise<boolean>): void {
    this.handler = handler;
  }

  /** Add and optionally start an email connector */
  addConnector(config: EmailConnectorConfig): void {
    this.connectors.set(config.id, config);
    if (config.enabled) {
      this.startConnector(config.id);
    }
  }

  /** Remove a connector by id */
  removeConnector(id: string): void {
    this.stopConnector(id);
    this.connectors.delete(id);
  }

  /** Start polling for a specific connector */
  startConnector(id: string): void {
    const config = this.connectors.get(id);
    if (!config || this.intervals.has(id)) return;

    this.intervals.set(
      id,
      setInterval(() => this.pollMailbox(config), config.pollIntervalSeconds * 1000)
    );
    // Poll immediately on start
    void this.pollMailbox(config);
  }

  /** Stop polling for a connector */
  stopConnector(id: string): void {
    const interval = this.intervals.get(id);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(id);
    }
  }

  /** Trigger one immediate poll for a connector (admin/debug). */
  pollNow(id: string): void {
    const config = this.connectors.get(id);
    if (config) void this.pollMailbox(config);
  }

  /** Poll a mailbox once without taking on a schedule (used by "poll now"). */
  async pollOnce(config: EmailConnectorConfig): Promise<void> {
    await this.pollMailbox(config);
  }

  /** Get all connector configs (without passwords) */
  listConnectors(): Omit<EmailConnectorConfig, "password">[] {
    return Array.from(this.connectors.values()).map(({ password, ...rest }) => rest);
  }

  // ── Private ──

  /**
   * Poll the mailbox for unseen messages, hand each one to the handler, and
   * mark the ones that were handled as seen. A message whose handler fails
   * stays unread (and is skipped by the caller's cursor) so it is retried.
   */
  private async pollMailbox(config: EmailConnectorConfig): Promise<void> {
    try {
      const connection = {
        host: config.host,
        port: config.port,
        secure: config.secure,
        user: config.user,
        password: config.password,
        folder: config.folder,
      };
      const emails = await fetchUnseenEmails(connection);
      const handled: number[] = [];
      for (const email of emails) {
        const ok = await this.processEmail(config.id, config.boardId, email);
        if (ok) handled.push(email.uid);
      }
      if (handled.length > 0) {
        await markEmailsSeen(connection, handled).catch((e) =>
          console.error(`[EmailConnector] Could not mark ${handled.length} message(s) seen for connector ${config.id}:`, e?.message || e),
        );
      }
    } catch (err) {
      console.error(`[EmailConnector] Poll failed for connector ${config.id}:`, err);
    }
  }

  /**
   * Route one parsed email: match it to a ticket, then let the handler create
   * or append. Returns whether the message was handled (safe to mark seen).
   */
  async processEmail(connectorId: string, boardId: string, email: ParsedEmail): Promise<boolean> {
    if (!this.handler) return false;
    const match = matchEmailToTicket(email);
    try {
      return await this.handler({ connectorId, boardId, email, match });
    } catch (e: any) {
      console.error(`[EmailConnector] Handler failed for connector ${connectorId} (${email.from.email}):`, e?.message || e);
      return false;
    }
  }
}
