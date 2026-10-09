export { EmailService } from "./EmailService";
/**
 * The message bodies as they are written in code.
 *
 * Exported because they are the *default* a template now falls back to: `emailMessages.ts` reproduces
 * them block for block and word for word, and `email-studio-probe.ts` compares the two. A check that has
 * to copy the HTML it is checking would stop noticing the day the two drifted, which is the whole reason
 * the defaults live beside these senders rather than only inside the Studio.
 */
export {
  autoCloseTemplate,
  followUpTemplate,
  invoiceTemplate,
  mfaTemplate,
  overdueTemplate,
  ticketActivityTemplate,
  ticketReopenedTemplate,
} from "./EmailService";
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
