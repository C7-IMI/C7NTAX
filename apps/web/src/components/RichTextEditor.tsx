import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, Quote, Link2, Link2Off,
  RemoveFormatting, Undo2, Redo2, Paperclip, X, FileText, Image as ImageIcon, Loader2,
  Copy, ExternalLink, Scissors, ClipboardPaste, CheckSquare, Trash2,
} from "lucide-react";
import { ContextMenu, useContextMenu, type MenuEntry } from "./ContextMenu";

export interface EmailAttachmentDraft {
  filename: string;
  mimeType: string;
  size: number;
  contentBase64: string;
}

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
/** Inline images are embedded in the message, so they are kept smaller than a file attachment. */
export const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Tags pasted rich text is allowed to keep before it reaches the editor. */
const PASTE_TAGS = ["b", "strong", "i", "em", "u", "s", "strike", "del", "sub", "sup", "ul", "ol", "li", "br", "p", "div", "blockquote", "h1", "h2", "h3", "h4", "a", "img", "span", "hr", "pre", "code", "table", "thead", "tbody", "tr", "td", "th"];
const PASTE_SAFE_HREF = /^(https?:|mailto:|tel:|\/|#)/i;
const PASTE_SAFE_SRC = /^(https?:|\/|data:image\/(png|jpe?g|gif|webp|bmp);base64,)/i;
/** Inline properties kept from a paste — enough for a Word document to look like itself. */
const PASTE_STYLE_PROPS = new Set([
  "color", "background-color", "font-family", "font-size", "font-weight", "font-style",
  "text-decoration", "text-align", "line-height", "margin-left", "padding-left", "vertical-align",
]);

function cleanPastedStyle(style: string): string {
  return style
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const [property = "", ...rest] = declaration.split(":");
      const name = property.trim().toLowerCase();
      const value = rest.join(":").trim();
      // Word sprinkles mso-* properties and junk values around; neither travels well.
      if (!name || name.startsWith("mso-") || name.startsWith("--")) return "";
      if (!PASTE_STYLE_PROPS.has(name) || !value) return "";
      if (/expression|javascript:|url\s*\(|@import|\\|inherit/i.test(value)) return "";
      return `${name}: ${value}`;
    })
    .filter(Boolean)
    .join("; ");
}

function cleanPastedAttrs(rawAttrs: string, tag: string): string {
  const out: string[] = [];
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(rawAttrs))) {
    const name = (match[1] ?? "").toLowerCase();
    const value = (match[2] ?? "").replace(/^["']|["']$/g, "").trim();
    if (!name || name.startsWith("on") || name.startsWith("mso") || name === "class" || name === "id" || name === "style" || name === "dir" || name === "lang") continue;
    if ((name === "href" && tag === "a") || (name === "src" && tag === "img")) {
      const pattern = name === "href" ? PASTE_SAFE_HREF : PASTE_SAFE_SRC;
      if (pattern.test(value)) out.push(`${name}="${value.replace(/"/g, "&quot;")}"`);
      continue;
    }
    if (name === "target" && tag === "a") { out.push('target="_blank"'); continue; }
    if (name === "alt" || name === "title") { out.push(`${name}="${value.slice(0, 200).replace(/"/g, "&quot;")}"`); continue; }
    if ((name === "colspan" || name === "rowspan" || name === "width" || name === "height" || name === "start") && /^\d{1,4}$/.test(value)) {
      out.push(`${name}="${value}"`);
    }
  }
  const styleMatch = rawAttrs.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  const style = styleMatch ? cleanPastedStyle(styleMatch[2] ?? styleMatch[3] ?? styleMatch[4] ?? "") : "";
  if (style) out.push(`style="${style.replace(/"/g, "&quot;")}"`);
  return out.length ? ` ${out.join(" ")}` : "";
}

function fontTagToSpan(attrs: string): string {
  const color = attrs.match(/\scolor\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  const face = attrs.match(/\sface\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  const parts: string[] = [];
  const colorValue = color?.[2] ?? color?.[3] ?? color?.[4];
  const faceValue = face?.[2] ?? face?.[3] ?? face?.[4];
  if (colorValue && /^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(colorValue)) parts.push(`color: ${colorValue}`);
  if (faceValue) parts.push(`font-family: ${faceValue}`);
  return parts.length ? `<span style="${parts.join("; ")}">` : "<span>";
}

/**
 * Keeps what a person means by "paste with formatting": Word and Google Docs send a lot of
 * machine-specific markup (mso-* styles, class names, conditional comments, font tags). This
 * strips that, keeps the structure and the safe inline styling, and drops anything executable.
 */
export function cleanPastedHtml(html: string): string {
  let out = String(html ?? "").slice(0, 200_000);
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<\?xml[\s\S]*?>/gi, "");
  out = out.replace(/<(script|style|iframe|object|embed|svg|template|meta|link|xml|o:p|w:[a-z0-9]+)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  out = out.replace(/<(script|style|iframe|object|embed|svg|template|meta|link|xml|o:p|w:[a-z0-9]+)\b[^>]*\/?>/gi, "");
  out = out.replace(/<font\b([^>]*)>/gi, (_m, attrs: string) => fontTagToSpan(attrs));
  out = out.replace(/<\/font>/gi, "</span>");
  out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9:]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g, (match, tag: string, attrs: string) => {
    const lower = tag.toLowerCase();
    if (!PASTE_TAGS.includes(lower)) return "";
    if (lower === "br" || lower === "hr") return `<${lower}>`;
    if (lower === "img") return `<img${cleanPastedAttrs(attrs, "img")}>`;
    const closing = match.startsWith("</");
    return closing ? `</${lower}>` : `<${lower}${cleanPastedAttrs(attrs, lower)}>`;
  });
  // Word wraps everything in a single paragraph div; leaving it is fine, double breaks are not.
  out = out.replace(/(<br\s*\/?>\s*){3,}/gi, "<br><br>");
  return out.trim();
}

/** Reads a File into a data URL for inline insertion. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

interface ToolbarButtonProps {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function ToolbarButton({ label, shortcut, active, disabled, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`p-1.5 rounded-md transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
        active ? "bg-cyber-600/25 text-cyber-300" : "text-gray-400 hover:text-white hover:bg-surface-lighter"
      }`}
    >
      {children}
    </button>
  );
}

const Separator = () => <span className="mx-1 h-5 w-px bg-surface-border/70" aria-hidden />;

interface RichTextEditorProps {
  onChange: (html: string, text: string) => void;
  placeholder?: string;
  minHeight?: number;
  attachments: EmailAttachmentDraft[];
  onAttachFiles: (files: File[]) => void;
  onRemoveAttachment: (index: number) => void;
  onRequestSend?: () => void;
  /** Told when an image could not be embedded (too large or unreadable) so the dialog can toast it. */
  onInlineImageError?: (message: string) => void;
  disabled?: boolean;
  attaching?: boolean;
}

/**
 * Rich text composer for outbound email — formatting toolbar, link editing, inline images,
 * attachment chips, drag-and-drop and an editor-specific context menu, in the shape people expect
 * from Outlook on the web or Gmail. The DOM is kept uncontrolled (only written on mount) so the
 * caret never jumps while typing.
 */
export function RichTextEditor({
  onChange,
  placeholder = "Write your message…",
  minHeight = 220,
  attachments,
  onAttachFiles,
  onRemoveAttachment,
  onRequestSend,
  onInlineImageError,
  disabled,
  attaching,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { menuState, open: openMenu, close: closeMenu } = useContextMenu();
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [dragging, setDragging] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [savedRange, setSavedRange] = useState<Range | null>(null);
  const [linkActive, setLinkActive] = useState(false);

  const emit = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    onChange(el.innerHTML, el.innerText.replace(/\n{3,}/g, "\n\n").trim());
  }, [onChange]);

  const saveSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editorRef.current?.contains(range.commonAncestorContainer)) return;
    setSavedRange(range.cloneRange());
  }, []);

  const restoreSelection = useCallback(() => {
    const selection = window.getSelection();
    if (savedRange && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }
  }, [savedRange]);

  /** Reads image files and drops them into the message at the caret; all other files become attachments. */
  const handleIncomingFiles = useCallback(async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    const others = files.filter((f) => !f.type.startsWith("image/"));
    if (others.length) onAttachFiles(others);
    if (!images.length) return;
    const oversized = images.filter((f) => f.size > MAX_INLINE_IMAGE_BYTES);
    const usable = images.filter((f) => f.size <= MAX_INLINE_IMAGE_BYTES);
    if (oversized.length) onInlineImageError?.(`${oversized.map((f) => f.name).join(", ")} is too large to embed (limit ${formatBytes(MAX_INLINE_IMAGE_BYTES)})`);
    if (!usable.length) return;
    try {
      const dataUrls = await Promise.all(usable.map(fileToDataUrl));
      editorRef.current?.focus();
      restoreSelection();
      for (const url of dataUrls) document.execCommand("insertHTML", false, `<img src="${url}" alt="">`);
      emit();
    } catch (error) {
      onInlineImageError?.(error instanceof Error ? error.message : "Could not embed that image");
    }
  }, [emit, onAttachFiles, onInlineImageError, restoreSelection]);

  const refreshState = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const query = (command: string) => {
      try { return document.queryCommandState(command); } catch { return false; }
    };
    let block = "";
    try { block = String(document.queryCommandValue("formatBlock") || "").toLowerCase().replace(/[<>]/g, ""); } catch { /* ignore */ }
    let inLink = false;
    try { inLink = !!(document.queryCommandState("createLink") || (window.getSelection()?.anchorNode && closestAnchor(window.getSelection()?.anchorNode))); } catch { /* ignore */ }
    setLinkActive(Boolean(inLink));
    setActive({
      bold: query("bold"),
      italic: query("italic"),
      underline: query("underline"),
      strikeThrough: query("strikeThrough"),
      insertUnorderedList: query("insertUnorderedList"),
      insertOrderedList: query("insertOrderedList"),
      blockquote: block === "blockquote",
    });
  }, []);

  function closestAnchor(node: Node | null | undefined): HTMLAnchorElement | null {
    let el = node instanceof HTMLElement ? node : node?.parentElement ?? null;
    while (el) {
      if (el.tagName === "A") return el as HTMLAnchorElement;
      el = el.parentElement;
    }
    return null;
  }

  useEffect(() => {
    const onSelectionChange = () => { if (document.activeElement === editorRef.current || editorRef.current?.contains(document.activeElement)) refreshState(); };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [refreshState]);

  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    try { document.execCommand(command, false, value); } catch { /* unsupported command */ }
    refreshState();
    emit();
  };

  const openLinkPopover = () => {
    const selection = window.getSelection();
    setSavedRange(selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null);
    const existing = closestAnchor(selection?.anchorNode)?.getAttribute("href") || "";
    setLinkValue(existing);
    setLinkOpen(true);
  };

  const applyLink = (remove = false) => {
    editorRef.current?.focus();
    const selection = window.getSelection();
    if (savedRange && selection) { selection.removeAllRanges(); selection.addRange(savedRange); }
    if (remove) {
      exec("unlink");
      setLinkOpen(false);
      return;
    }
    const raw = linkValue.trim();
    if (!raw) { setLinkOpen(false); return; }
    const url = /^(https?:|mailto:|tel:)/i.test(raw) ? raw : `https://${raw}`;
    const collapsed = selection?.isCollapsed ?? true;
    if (collapsed) exec("insertHTML", `<a href="${url}" target="_blank">${url}</a>`);
    else exec("createLink", url);
    setLinkOpen(false);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length) {
      // A copied image becomes part of the message; anything else is attached as a file.
      e.preventDefault();
      void handleIncomingFiles(files);
      return;
    }
    const html = e.clipboardData?.getData("text/html");
    const text = e.clipboardData?.getData("text/plain") ?? "";
    e.preventDefault();
    // Word and Google Docs send markup; keep its structure and styling, drop the machine parts.
    if (html && /<[a-z]/i.test(html)) document.execCommand("insertHTML", false, cleanPastedHtml(html));
    else document.execCommand("insertText", false, text);
    emit();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(e.dataTransfer?.files ?? []);
    setDragging(false);
    if (!files.length) return;
    e.preventDefault();
    void handleIncomingFiles(files);
  };

  const insertImageFiles = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    await handleIncomingFiles(images);
  };

  /** Editor-specific right-click menu: clipboard, formatting, link and image actions. */
  const openEditorMenu = (e: React.MouseEvent) => {
    if (disabled) return;
    saveSelection();
    const anchor = closestAnchor(e.target as Node);
    const image = (e.target as HTMLElement)?.closest?.("img") ?? null;
    if (!anchor && !image) {
      // Put the caret where the click landed so the menu acts on that point.
      try { document.execCommand("insertText", false, ""); } catch { /* ignore */ }
    }
    const hasSelection = !(window.getSelection()?.isCollapsed ?? true);
    const entries: MenuEntry[] = [];
    if (anchor) {
      entries.push(
        { label: "Open link", icon: ExternalLink, onSelect: () => window.open(anchor.getAttribute("href") || "", "_blank", "noopener") },
        { label: "Copy link address", icon: Copy, onSelect: () => { void navigator.clipboard?.writeText(anchor.getAttribute("href") || "").catch(() => {}); } },
        { label: "Edit link…", icon: Link2, onSelect: () => openLinkPopover() },
        { label: "Remove link", icon: Link2Off, onSelect: () => applyLink(true) },
        "separator",
      );
    } else if (image) {
      entries.push({ label: "Remove image", icon: Trash2, danger: true, onSelect: () => { image.remove(); emit(); } }, "separator");
    }
    entries.push(
      { label: "Cut", icon: Scissors, hint: "Ctrl+X", disabled: !hasSelection, onSelect: () => { restoreSelection(); exec("cut"); } },
      { label: "Copy", icon: Copy, hint: "Ctrl+C", disabled: !hasSelection, onSelect: () => { restoreSelection(); exec("copy"); } },
      { label: "Paste as plain text", icon: ClipboardPaste, hint: "Ctrl+Shift+V", onSelect: () => { void pastePlainText(); } },
      { label: "Select all", icon: CheckSquare, hint: "Ctrl+A", onSelect: () => exec("selectAll") },
      "separator",
      { label: "Bold", icon: Bold, hint: "Ctrl+B", checked: active.bold, onSelect: () => { restoreSelection(); exec("bold"); } },
      { label: "Italic", icon: Italic, hint: "Ctrl+I", checked: active.italic, onSelect: () => { restoreSelection(); exec("italic"); } },
      { label: "Underline", icon: Underline, hint: "Ctrl+U", checked: active.underline, onSelect: () => { restoreSelection(); exec("underline"); } },
      "separator",
      { label: "Insert link…", icon: Link2, hint: "Ctrl+K", onSelect: () => openLinkPopover() },
      { label: "Insert image…", icon: ImageIcon, onSelect: () => imageInputRef.current?.click() },
      { label: "Attach file…", icon: Paperclip, onSelect: () => fileInputRef.current?.click() },
      { label: "Clear formatting", icon: RemoveFormatting, onSelect: () => { restoreSelection(); exec("removeFormat"); exec("formatBlock", "<div>"); } },
      "separator",
      { label: "Undo", icon: Undo2, hint: "Ctrl+Z", onSelect: () => exec("undo") },
      { label: "Redo", icon: Redo2, hint: "Ctrl+Y", onSelect: () => exec("redo") },
    );
    openMenu(e, entries, { title: "Message" }, { allowInTextEntry: true });
  };

  async function pastePlainText() {
    editorRef.current?.focus();
    restoreSelection();
    try {
      const text = await navigator.clipboard.readText();
      if (text) document.execCommand("insertText", false, text);
      emit();
    } catch {
      // Clipboard read needs permission; the browser's own Ctrl+Shift+V still works.
      onInlineImageError?.("Clipboard access was blocked — use Ctrl+Shift+V");
    }
  }

  const iconFor = (mimeType: string) => (mimeType.startsWith("image/") ? <ImageIcon size={13} /> : <FileText size={13} />);

  return (
    <div className={`rounded-lg border bg-surface-input transition-colors ${dragging ? "border-cyber-500" : "border-surface-border"} ${disabled ? "opacity-60" : ""}`}>
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-surface-border px-1.5 py-1">
        <ToolbarButton label="Bold" shortcut="Ctrl+B" active={active.bold} disabled={disabled} onClick={() => exec("bold")}><Bold size={15} /></ToolbarButton>
        <ToolbarButton label="Italic" shortcut="Ctrl+I" active={active.italic} disabled={disabled} onClick={() => exec("italic")}><Italic size={15} /></ToolbarButton>
        <ToolbarButton label="Underline" shortcut="Ctrl+U" active={active.underline} disabled={disabled} onClick={() => exec("underline")}><Underline size={15} /></ToolbarButton>
        <ToolbarButton label="Strikethrough" active={active.strikeThrough} disabled={disabled} onClick={() => exec("strikeThrough")}><Strikethrough size={15} /></ToolbarButton>
        <Separator />
        <ToolbarButton label="Bulleted list" active={active.insertUnorderedList} disabled={disabled} onClick={() => exec("insertUnorderedList")}><List size={15} /></ToolbarButton>
        <ToolbarButton label="Numbered list" active={active.insertOrderedList} disabled={disabled} onClick={() => exec("insertOrderedList")}><ListOrdered size={15} /></ToolbarButton>
        <ToolbarButton label="Quote" active={active.blockquote} disabled={disabled} onClick={() => exec("formatBlock", active.blockquote ? "<div>" : "<blockquote>")}><Quote size={15} /></ToolbarButton>
        <Separator />
        <div className="relative">
          <ToolbarButton label="Insert link" shortcut="Ctrl+K" active={linkOpen || linkActive} disabled={disabled} onClick={openLinkPopover}><Link2 size={15} /></ToolbarButton>
          {linkOpen && (
            <div className="absolute left-0 top-full z-20 mt-1.5 w-64 rounded-lg border border-surface-border bg-surface p-2 shadow-xl">
              <label className="text-[10px] uppercase tracking-wide text-gray-500">Link address</label>
              <input
                autoFocus
                value={linkValue}
                onChange={(e) => setLinkValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); applyLink(); }
                  if (e.key === "Escape") setLinkOpen(false);
                }}
                placeholder="https://example.com"
                className="input-field mt-1 text-sm"
              />
              <div className="mt-2 flex items-center justify-end gap-1.5">
                <button type="button" onClick={() => setLinkOpen(false)} className="btn-secondary text-xs py-1 px-2">Cancel</button>
                <button type="button" onClick={() => applyLink()} className="btn-primary text-xs py-1 px-2">Apply</button>
              </div>
            </div>
          )}
        </div>
        <ToolbarButton label="Remove link" disabled={disabled} onClick={() => applyLink(true)}><Link2Off size={15} /></ToolbarButton>
        <ToolbarButton label="Clear formatting" disabled={disabled} onClick={() => { exec("removeFormat"); exec("formatBlock", "<div>"); }}><RemoveFormatting size={15} /></ToolbarButton>
        <Separator />
        <ToolbarButton label="Undo" shortcut="Ctrl+Z" disabled={disabled} onClick={() => exec("undo")}><Undo2 size={15} /></ToolbarButton>
        <ToolbarButton label="Redo" shortcut="Ctrl+Y" disabled={disabled} onClick={() => exec("redo")}><Redo2 size={15} /></ToolbarButton>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => imageInputRef.current?.click()}
            disabled={disabled}
            title="Insert image"
            aria-label="Insert image"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-gray-400 transition-colors hover:bg-surface-lighter hover:text-white disabled:opacity-40"
          >
            <ImageIcon size={14} />
            Image
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || attaching}
            title="Attach files"
            aria-label="Attach files"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-gray-400 transition-colors hover:bg-surface-lighter hover:text-white disabled:opacity-40"
          >
            {attaching ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
            Attach
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { onAttachFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
          />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { void insertImageFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
          />
        </div>
      </div>

      <div
        ref={editorRef}
        contentEditable={!disabled}
        role="textbox"
        aria-multiline="true"
        aria-label="Message"
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        onKeyUp={refreshState}
        onMouseUp={refreshState}
        onContextMenu={openEditorMenu}
        onPaste={handlePaste}
        onDragOver={(e) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onRequestSend?.(); }
          if (e.key === "k" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openLinkPopover(); }
        }}
        style={{ minHeight }}
        className="prose-invert max-w-none overflow-y-auto px-3.5 py-3 text-sm text-gray-200 outline-none empty:before:pointer-events-none empty:before:text-gray-600 empty:before:content-[attr(data-placeholder)] [&_a]:text-cyber-400 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-surface-border [&_blockquote]:pl-3 [&_blockquote]:text-gray-400 [&_img]:my-1 [&_img]:max-w-full [&_img]:rounded [&_img]:align-middle [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:rounded [&_pre]:bg-surface-lighter [&_pre]:p-2 [&_table]:w-full [&_td]:border [&_td]:border-surface-border [&_td]:p-1.5 [&_th]:border [&_th]:border-surface-border [&_th]:p-1.5 [&_ul]:list-disc [&_ul]:pl-5"
      />

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-surface-border px-3 py-2">
          {attachments.map((file, index) => (
            <span key={`${file.filename}-${index}`} className="flex items-center gap-2 rounded-md border border-surface-border bg-surface-lighter/60 px-2 py-1 text-xs text-gray-300">
              <span className="text-cyber-400">{iconFor(file.mimeType)}</span>
              <span className="max-w-[16rem] truncate" title={file.filename}>{file.filename}</span>
              <span className="text-gray-500">{formatBytes(file.size)}</span>
              <button
                type="button"
                onClick={() => onRemoveAttachment(index)}
                title={`Remove ${file.filename}`}
                aria-label={`Remove ${file.filename}`}
                className="rounded p-0.5 text-gray-500 transition-colors hover:bg-surface hover:text-white"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <ContextMenu state={menuState} onClose={closeMenu} />
    </div>
  );
}

/** Reads a File into the payload shape the API expects, rejecting anything over the limit. */
export function toAttachmentDraft(file: File): Promise<EmailAttachmentDraft> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_ATTACHMENT_BYTES) { reject(new Error(`${file.name} is larger than 5 MB`)); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        contentBase64: result.slice(result.indexOf(",") + 1),
      });
    };
    reader.readAsDataURL(file);
  });
}
