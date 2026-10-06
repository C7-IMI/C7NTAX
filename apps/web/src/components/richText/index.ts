/**
 * The shared rich text editor. Import from here so call sites do not depend on
 * the file layout inside the module.
 */
export { RichTextEditor, toAttachmentDraft, cleanPastedHtml, fileToDataUrl, formatBytes, MAX_ATTACHMENT_BYTES, MAX_INLINE_IMAGE_BYTES, type EmailAttachmentDraft } from "./RichTextEditor";
export { EMAIL_PROFILE, DOCUMENT_PROFILE, type RichTextProfile, type ToolbarGroup } from "./profiles";
