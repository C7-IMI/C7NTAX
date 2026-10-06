/**
 * Rich text profiles — C7NTAX has one editor, and each section asks for the
 * options it needs.
 *
 * The editor itself (formatting, Word-aware paste, inline images, link popover,
 * right-click menu, and everything added to it later) lives in one place, so new
 * capability lands everywhere at once. A profile only says which toolbar groups
 * to show, whether the surface takes file attachments, and what Ctrl+Enter does.
 * Anything section-specific beyond that — attachment chips, Save/Send buttons,
 * validation — stays with the section.
 */

/** Toolbar groups, rendered in the order they are listed. */
export type ToolbarGroup = "emphasis" | "lists" | "links" | "history";

export interface RichTextProfile {
  /** Which toolbar groups to render, in order. */
  toolbar: ToolbarGroup[];
  /**
   * Paperclip, paste and drop collect files as attachments. Email wants them;
   * a documentation field has nowhere to put them.
   */
  attachments?: { maxBytes: number };
  /** Ctrl/Cmd+Enter submits (email). Off where Enter means "new line, new item". */
  sendShortcut?: boolean;
  minHeight: number;
  placeholder: string;
  /** Accessible name for the writing area. */
  ariaLabel: string;
}

/** Outbound email: everything, plus attachments and Ctrl+Enter to send. */
export const EMAIL_PROFILE: RichTextProfile = {
  toolbar: ["emphasis", "lists", "links", "history"],
  attachments: { maxBytes: 5 * 1024 * 1024 },
  sendShortcut: true,
  minHeight: 220,
  placeholder: "Write your message…",
  ariaLabel: "Message",
};

/**
 * Long-form documentation — checklist descriptions and notes, knowledge base
 * articles, anything stored as HTML on a record. Formatting and inline images,
 * no attachment strip, and Enter stays a newline.
 */
export const DOCUMENT_PROFILE: RichTextProfile = {
  toolbar: ["emphasis", "lists", "links", "history"],
  minHeight: 120,
  placeholder: "Add description",
  ariaLabel: "Description",
};
