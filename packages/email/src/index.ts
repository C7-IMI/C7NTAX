export { EmailService } from "./EmailService";
export { EmailConnectorManager, matchEmailToTicket } from "./EmailConnector";
export type { ParsedEmail, TicketMatchResult, EmailConnectorConfig, IncomingEmail } from "./EmailConnector";
export { fetchUnseenEmails, markEmailsSeen } from "./imapFetch";
export type { ImapConnectionConfig, FetchedImapEmail } from "./imapFetch";
export { parseMailToEmail } from "./parseMail";
export {
  acquireGraphToken,
  fetchGraphUnread,
  fetchGraphAttachments,
  markGraphMessageRead,
  probeGraphMailbox,
  normalizeGraphFolder,
  mailboxBase,
  buildGraphAuthorizeUrl,
  exchangeGraphCode,
  refreshGraphToken,
  getGraphAccount,
  createPkcePair,
  DELEGATED_GRAPH_SCOPES,
  GraphError,
  MAX_ATTACHMENT_BYTES,
} from "./graphFetch";
export type { GraphConfig, GraphMessage, GraphToken, GraphOAuthTokens, PkcePair } from "./graphFetch";
export {
  fetchEwsUnread,
  markEwsItemsRead,
  probeEwsMailbox,
  normalizeEwsFolder,
  ewsEndpoint,
  EwsError,
} from "./ewsFetch";
export type { EwsConfig, FetchedEwsEmail, EwsItemRef } from "./ewsFetch";
export {
  stripSubjectPrefixes,
  deduceName,
  extractDomain,
  stripQuotedReply,
  deducePriority,
  isAutoReply,
} from "./fieldDeduction";
