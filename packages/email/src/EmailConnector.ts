import { TicketStatus, TicketPriority } from "@c7-overwatch/shared";

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
  private onTicketCreate?: (data: {
    boardId: string;
    email: ParsedEmail;
  }) => Promise<string>;
  private onTicketUpdate?: (data: {
    ticketId: string;
    email: ParsedEmail;
  }) => Promise<void>;

  /** Register a callback invoked when a new ticket should be created */
  onNewTicket(
    handler: (data: { boardId: string; email: ParsedEmail }) => Promise<string>
  ): void {
    this.onTicketCreate = handler;
  }

  /** Register a callback invoked when an existing ticket should be updated */
  onUpdateTicket(
    handler: (data: { ticketId: string; email: ParsedEmail }) => Promise<void>
  ): void {
    this.onTicketUpdate = handler;
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

  /** Get all connector configs (without passwords) */
  listConnectors(): Omit<EmailConnectorConfig, "password">[] {
    return Array.from(this.connectors.values()).map(({ password, ...rest }) => rest);
  }

  // ── Private ──

  /**
   * Poll a single IMAP mailbox for unread messages.
   * In production this would use the `imap` or `mail-notifier` package.
   * The stub below demonstrates the integration point.
   */
  private async pollMailbox(config: EmailConnectorConfig): Promise<void> {
    try {
      // In production: connect via IMAP, fetch unseen messages, parse them.
      // const imap = new Imap({ user: config.user, password: config.password, host: config.host, port: config.port, tls: config.secure });
      // const messages = await fetchUnseen(imap);
      // for (const raw of messages) {
      //   const email = await simpleParser(raw);
      //   await this.processEmail(config.boardId, email);
      // }

      // Stub: log attempt
      console.log(
        `[EmailConnector] Polling ${config.host}:${config.port} for board ${config.boardId}`
      );
    } catch (err) {
      console.error(`[EmailConnector] Poll failed for connector ${config.id}:`, err);
    }
  }

  /**
   * Process a single parsed email: match to ticket, then create or update.
   */
  async processEmail(boardId: string, email: ParsedEmail): Promise<void> {
    const match = matchEmailToTicket(email);

    if (match.action === "update" && match.ticketId && this.onTicketUpdate) {
      await this.onTicketUpdate({ ticketId: match.ticketId, email });
    } else if (match.action === "create" && this.onTicketCreate) {
      await this.onTicketCreate({ boardId, email });
    }
  }
}
