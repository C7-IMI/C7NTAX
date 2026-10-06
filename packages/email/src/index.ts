export { EmailService } from "./EmailService";
export { EmailConnectorManager, matchEmailToTicket } from "./EmailConnector";
export type { ParsedEmail, TicketMatchResult, EmailConnectorConfig, IncomingEmail } from "./EmailConnector";
export { fetchUnseenEmails, markEmailsSeen } from "./imapFetch";
export type { ImapConnectionConfig, FetchedImapEmail } from "./imapFetch";
export {
  acquireGraphToken,
  fetchGraphUnread,
  fetchGraphAttachments,
  markGraphMessageRead,
  probeGraphMailbox,
  normalizeGraphFolder,
  GraphError,
  MAX_ATTACHMENT_BYTES,
} from "./graphFetch";
export type { GraphConfig, GraphMessage, GraphToken } from "./graphFetch";
export {
  stripSubjectPrefixes,
  deduceName,
  extractDomain,
  stripQuotedReply,
  deducePriority,
  isAutoReply,
} from "./fieldDeduction";
