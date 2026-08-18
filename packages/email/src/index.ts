export { EmailService } from "./EmailService";
export { EmailConnector, EmailConnectorManager } from "./EmailConnector";
export type { ParsedEmail, TicketMatchResult, EmailConnectorConfig } from "./EmailConnector";
export { fetchUnseenEmails } from "./imapFetch";
export type { ImapConnectionConfig } from "./imapFetch";
export {
  stripSubjectPrefixes,
  deduceName,
  extractDomain,
  stripQuotedReply,
  deducePriority,
  isAutoReply,
} from "./fieldDeduction";
