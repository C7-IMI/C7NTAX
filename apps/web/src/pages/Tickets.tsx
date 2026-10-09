import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useParams, useSearchParams, useNavigate } from "react-router-dom";
import api from "../api";
import { useAuth } from "../hooks/useAuth";
import { Permission } from "@C7NTAX/shared";
import { orgTrail, useBreadcrumbTrail } from "../components/Breadcrumbs";
import { InferencePanel } from "../components/InferencePanel";
import { Plus, Search, Save, X, Clock, Edit3, Timer, Send, Home, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, Filter, ChevronDown, CheckSquare, Square, RotateCw, MessageSquare, Mail, Paperclip, Printer, Bell, MoreHorizontal, Link2, Package, Wrench, History, Receipt, ShieldCheck, Download, Trash2, FileText, User, Columns3, GripVertical, ExternalLink, AppWindow, SquareArrowOutUpRight, UserCheck, Flag, CircleDot, Copy, Eraser, Check, AlertTriangle, Loader2, Building2, Server } from "lucide-react";
import toast from "react-hot-toast";
import { SortableHeader, sortData, nextSort, type SortState } from "../components/SortableHeader";
import { ContextMenu, useContextMenu, isTextEntryTarget, type MenuEntry } from "../components/ContextMenu";
import { TicketBoardTabs } from "../components/TicketBoardTabs";
import { RichTextEditor, toAttachmentDraft, EMAIL_PROFILE, type EmailAttachmentDraft } from "../components/richText";
import { RecipientField, recipientFromContact, offOrgRecipients, offOrgSummary, type Recipient, type RecipientSuggestion } from "../components/RecipientField";
import { ProductPicker } from "../components/ProductPicker";
import { absoluteUrl, copyText, openInNewTab, openInNewWindow, viewMenuEntries } from "../lib/menuActions";
import { toCsv, downloadCsv, fileStamp, type CsvColumn } from "../lib/csv";
import { apiErrorMessage } from "../lib/apiError";
import { TableSkeleton, PageSkeleton } from "../components/ui/Skeleton";
import { useRedesign, useContextPane, setContextPane as setContextPanePreference } from "../hooks/useNavigationStyle";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-600/20 text-blue-400", in_progress: "bg-cyber-600/20 text-cyber-400",
  waiting_on_client: "bg-amber-600/20 text-amber-400", waiting_on_third_party: "bg-amber-600/20 text-amber-400",
  on_hold: "bg-purple-600/20 text-purple-400",
  resolved: "bg-green-600/20 text-green-400", closed: "bg-gray-600/20 text-gray-400", cancelled: "bg-red-600/20 text-red-400",
  pending_approval: "bg-yellow-600/20 text-yellow-400",
};
const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-600/20 text-red-400", high: "bg-orange-600/20 text-orange-400",
  medium: "bg-amber-600/20 text-amber-400", low: "bg-gray-600/20 text-gray-400",
};

/** The priority bar in the list's Summary cell — see the title column in the row renderer. */
const PRIORITY_BAR: Record<string, string> = {
  critical: "bg-red-500", high: "bg-orange-400", medium: "bg-amber-400", low: "bg-gray-600",
};

/** Compact relative age, as the queue reads it: 34m, 4h, 2d. */
function relativeAge(iso?: string | null): string {
  if (!iso) return "";
  const minutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
}

/**
 * The clock on a ticket as a chip: how long is left, or how long ago it went.
 *
 * It reads the board's SLA resolution target, or the due date when that is what the instance set —
 * whichever clock the ticket actually carries — and it reads the same way either way, which is why
 * the chip says "SLA" and the tooltip says which of the two it is looking at.
 */
function slaChipFor(ticket: { slaResolutionDue?: unknown; dueDate?: unknown; isOverdue?: unknown }): { tone: string; label: string; title: string } | null {
  const raw = (ticket.slaResolutionDue || ticket.dueDate) as string | null | undefined;
  if (!raw) return null;
  const diffMs = new Date(raw).getTime() - Date.now();
  const breached = diffMs < 0 || ticket.isOverdue === true;
  const minutes = Math.max(1, Math.round(Math.abs(diffMs) / 60000));
  const amount = minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
  return {
    tone: breached ? "chip--bad" : diffMs < 4 * 3600_000 ? "chip--warn" : "chip--good",
    label: breached ? `SLA breached · ${amount} ago` : `${amount} to SLA`,
    title: `${ticket.slaResolutionDue ? "SLA resolution" : "Due"} ${new Date(raw).toLocaleString()}`,
  };
}

/**
 * A state as a pill you press.
 *
 * The redesigned record header shows status, priority and assignee as the things themselves rather
 * than as fields inside a form: changing one is a click, not a dialog with a save button. The pill
 * does not own the value — it hands back what was picked and the page writes it through the route
 * the Edit form uses — so there is still exactly one place that changes a ticket.
 */
function TicketPill({
  label, value, options, onPick, disabled, tone = "",
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onPick: (value: string) => void;
  disabled?: boolean;
  tone?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        aria-expanded={open}
        title={`${label}: ${value} — press to change it`}
        className={`chip capitalize ${tone}`}
      >
        {value} <ChevronDown size={11} className="opacity-60" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute left-0 top-full z-50 mt-1 min-w-[11rem] rounded-lg border border-surface-border bg-surface p-1 shadow-xl">
            <p className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
            {options.map(option => (
              <button
                key={option.value || "none"}
                role="menuitem"
                type="button"
                disabled={option.value === value || disabled}
                onClick={() => { setOpen(false); onPick(option.value); }}
                className="w-full rounded px-2.5 py-1.5 text-left text-xs text-gray-300 hover:bg-surface-lighter hover:text-white disabled:opacity-40"
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Expense approval states (PLAN-015 Phase A #2). */
const EXPENSE_STATUS_COLORS: Record<string, string> = {
  submitted: "bg-amber-600/20 text-amber-400",
  approved: "bg-green-600/20 text-green-400",
  rejected: "bg-red-600/20 text-red-400",
  billed: "bg-cyber-600/20 text-cyber-400",
};

const BATCH_ACTIONS = [
  { value: "acknowledge", label: "Acknowledge", icon: CheckSquare },
  { value: "close", label: "Close", icon: X },
  { value: "status_in_progress", label: "Set Status → In Progress" },
  { value: "status_waiting_client", label: "Set Status → Waiting on Client" },
  { value: "status_on_hold", label: "Set Status → On Hold" },
  { value: "status_resolved", label: "Set Status → Resolved" },
  { value: "priority_high", label: "Set Priority → High" },
  { value: "priority_critical", label: "Set Priority → Critical" },
];

const TICKET_STATUSES = ["new","in_progress","waiting_on_client","waiting_on_third_party","on_hold","pending_approval","resolved","closed","cancelled"];
const TICKET_PRIORITIES = ["low","medium","high","critical"];

// ── Time entry options (mirrors ConnectWise / AutoTask work type & role lists) ──
const WORK_TYPES = ["Remote", "On-Site", "Phone", "Email", "Travel", "Backup", "Project", "Managed Services", "After Hours", "Emergency"];
const WORK_ROLES = ["Technician", "Engineer", "Consultant", "Project Manager", "Account Manager", "Dispatcher", "Administrator"];

// ── Properly capitalized display labels ──
const statusLabel = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const priorityLabel = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);

// ── Time entry display helpers ──
const timeBillingLabel = (te: any) => (te.noCharge ? "No Charge" : te.billable ? "Billable" : "Non-billable");
const timeEntryMeta = (te: any) => [te.workType, te.workRole, te.rate ? `$${Number(te.rate).toFixed(2)}/hr` : null].filter(Boolean).join(" · ");

// ── Notes vs activity split ──
// Field changes are written to the ticket as comments whose every line reads
// "Label: old → new" (see the ticket PATCH handler), and the auto-close worker writes a fixed
// sentence. Both are history, not correspondence, so they belong in Activity rather than Notes.
const isSystemActivity = (body: unknown): boolean => {
  const text = String(body ?? "").trim();
  if (!text) return false;
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length > 0 && lines.every(l => /^[A-Z][A-Za-z ]+: .+ → .+$/.test(l))) return true;
  return /^Ticket automatically closed after \d+ days? without client response\.$/.test(lines[0] ?? "");
};

// ── "Filter By" quick filters — mirrors the Service Board card status items ──
const FILTER_BY_OPTIONS = [
  { value: "workable", label: "Workable", status: "in_progress", priority: "" },
  { value: "escalated", label: "Escalated", status: "open", priority: "critical" },
  { value: "waiting", label: "Waiting", status: "waiting_on_client,waiting_on_third_party", priority: "" },
  { value: "on_hold", label: "On Hold", status: "on_hold", priority: "" },
  { value: "new", label: "New", status: "new", priority: "" },
];
const filterByFor = (status: string, priority: string) =>
  FILTER_BY_OPTIONS.find(o => o.status === status && o.priority === priority)?.value || "";

// ── Pagination page-number window with gap markers: 1 … 4 5 6 … 20 ──
function pageWindow(current: number, total: number): (number | "gap")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const wanted = new Set([1, total, current - 1, current, current + 1]);
  const pages = [...wanted].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  let prev = 0;
  for (const p of pages) {
    if (p - prev > 1) out.push("gap");
    out.push(p);
    prev = p;
  }
  return out;
}

function toLocalDateTimeValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

// ── Configurable ticket list columns (PSA-style: Autotask / ConnectWise / HaloPSA reference) ──
// Priority is available but unchecked by default. `w` is the starting width in px: the queue is read
// by scanning, and a column narrow enough to fold a ticket number over three lines cannot be scanned.
// Summary has no width of its own, because it is the one column that wants whatever is left.
type TicketColumnDef = { id: string; label: string; defaultVisible: boolean; sortField?: string; w: number };
const TICKET_COLUMNS: TicketColumnDef[] = [
  { id: "number", label: "Ticket #", defaultVisible: true, sortField: "ticketNumber", w: 104 },
  { id: "title", label: "Summary", defaultVisible: true, sortField: "title", w: 0 },
  { id: "status", label: "Status", defaultVisible: true, sortField: "status", w: 110 },
  { id: "board", label: "Board", defaultVisible: true, sortField: "board.name", w: 120 },
  { id: "client", label: "Client", defaultVisible: true, sortField: "company.name", w: 126 },
  { id: "technician", label: "Technician", defaultVisible: true, w: 126 },
  { id: "age", label: "Age", defaultVisible: true, sortField: "createdAt", w: 52 },
  { id: "sla", label: "SLA", defaultVisible: true, w: 152 },
  { id: "priority", label: "Priority", defaultVisible: false, w: 92 },
  { id: "timestamp", label: "Timestamp", defaultVisible: true, sortField: "updatedAt", w: 138 },
];

// ── Column widths (dragged on the header edge, persisted per user) ──
const MIN_COL_W = 56;
const MAX_COL_W = 720;
function loadTicketColumnWidths(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem("c7_ticket_column_widths") || "null");
    if (raw && typeof raw === "object") {
      const out: Record<string, number> = {};
      for (const def of TICKET_COLUMNS) {
        const value = Math.round(Number((raw as Record<string, unknown>)[def.id]));
        if (Number.isFinite(value) && value >= MIN_COL_W && value <= MAX_COL_W) out[def.id] = value;
      }
      return out;
    }
  } catch { /* a width we cannot read is a width we do not have */ }
  return {};
}

function loadTicketColumns(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem("c7_ticket_columns") || "null");
    if (Array.isArray(v) && v.length > 0) {
      const cols = v.filter((id: string) => TICKET_COLUMNS.some((c) => c.id === id));
      // One-time: Age and SLA arrived with the redesigned queue, and a selection saved from before
      // them would leave the two columns the queue is read by hidden — with nothing on screen to
      // say why. They are added once; from then on the choice is the user's, including removing
      // them again.
      if (!localStorage.getItem("c7_ticket_columns_v2")) {
        for (const id of ["age", "sla"]) if (!cols.includes(id)) cols.push(id);
        localStorage.setItem("c7_ticket_columns", JSON.stringify(cols));
        localStorage.setItem("c7_ticket_columns_v2", "1");
      }
      return cols;
    }
  } catch { /* ignore */ }
  return TICKET_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);
}

// ── Ticket detail tabs (ConnectWise-style toolbar; Tasks/Open Tickets/Conversions/Surveys/RMA excluded) ──
const TICKET_DETAIL_TABS = [
  { id: "ticket", label: "Ticket" },
  { id: "configurations", label: "Configurations" },
  { id: "products", label: "Products" },
  { id: "activities", label: "Activities" },
  { id: "time", label: "Time" },
  { id: "links", label: "Links" },
  { id: "expenses", label: "Expenses" },
  { id: "schedule", label: "Schedule" },
  { id: "attachments", label: "Attachments" },
  { id: "history", label: "History" },
  { id: "finance", label: "Finance" },
  { id: "audittrail", label: "Audit Trail" },
];

/**
 * The five tabs the redesigned detail screen is organised into, and the panels each one holds.
 *
 * This is a grouping, not a deletion: every one of the twelve panels above is still here and still
 * reachable, one click away at the most. Activities, History and Audit Trail are one story at three
 * depths; Time, Expenses, Products and Schedule are four answers to "what has this used, and what
 * has it cost"; Attachments and Links are both something attached to the record. Configurations left
 * the strip entirely because the estate is a fact about the *client*, and it belongs beside the
 * ticket rather than three clicks into it.
 */
/** One redesigned detail tab: a label, an icon, and the panels it holds — never an empty set. */
type TicketTabGroup = { id: string; label: string; icon: typeof FileText; tabs: [string, ...string[]] };

const TICKET_TAB_GROUPS: [TicketTabGroup, ...TicketTabGroup[]] = [
  { id: "overview", label: "Overview", icon: FileText, tabs: ["ticket"] },
  { id: "activity", label: "Activity", icon: History, tabs: ["activities", "history", "audittrail"] },
  { id: "work", label: "Work", icon: Timer, tabs: ["time", "expenses", "products", "schedule"] },
  { id: "files", label: "Files & Links", icon: Paperclip, tabs: ["attachments", "links"] },
  { id: "finance", label: "Finance", icon: Receipt, tabs: ["finance", "configurations"] },
];

/** Right-click deletion confirmation, shared by the list and the detail screen. */
function DeleteTicketDialog({ target, busy, onCancel, onConfirm }: {
  target: { ticketNumber?: string; title?: string } | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!target) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-label="Delete ticket" className="card w-full max-w-md space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-white flex items-center gap-2"><AlertTriangle size={16} className="text-red-400" /> Delete ticket</h3>
        <p className="text-sm text-gray-300">
          Delete <span className="text-white font-medium">{target.ticketNumber || "this ticket"}</span>
          {target.title ? ` — ${target.title}` : ""}?
        </p>
        <p className="text-xs text-gray-500">Notes, attachments and time entries on this ticket are deleted with it. This cannot be undone.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-white text-sm font-medium disabled:opacity-50">{busy ? "Deleting…" : "Delete ticket"}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Board tabs instead of the board dropdown (see `components/TicketBoardTabs.tsx`).
 *
 * Set this to `false` to put the original dropdown back — that is the entire revert, and the
 * dropdown markup is still here in the other branch. Delete this constant and the branch it guards
 * once the choice is settled, along with the component file.
 */
const BOARD_TABS = true;

export function TicketsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const redesign = useRedesign();
  const boardId = searchParams.get("boardId") || "";  const statusParam = searchParams.get("status") || "";
  const priorityParam = searchParams.get("priority") || "";
  const assignedParam = searchParams.get("assignedToId") || "";
  const dateFromParam = searchParams.get("dateFrom") || "";
  const dateToParam = searchParams.get("dateTo") || "";
  // The organization rail's Change Control entry scopes the list to one client.
  const companyParam = searchParams.get("companyId") || "";
  // The search term lives in the URL with the other filters, so a filtered list is a link
  // somebody can send. The box is local and debounced: three keystrokes are one request.
  const qParam = searchParams.get("q") || "";
  const [searchInput, setSearchInput] = useState(qParam);
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title:"", description:"", priority:"medium", boardId:"", companyId:"", contactId:"", contactName:"", contactEmail:"", startTime:"", endTime:"", status:"new" });
  const [sort, setSort] = useState<SortState | null>(null);
  const [boards, setBoards] = useState<Array<{id:string;name:string;ticketCode?:string|null;description?:string|null;_count?:{tickets?:number}|null}>>([]);
  const [companies, setCompanies] = useState<Array<{id:string;name:string}>>([]);
  const [contacts, setContacts] = useState<Array<{id:string;firstName:string;lastName:string;email:string}>>([]);
  const [newTicketContacts, setNewTicketContacts] = useState<Recipient[]>([]);

  // ── Batch selection ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDropdown, setBatchDropdown] = useState(false);
  const [batchApplying, setBatchApplying] = useState(false);
  const [checkedActions, setCheckedActions] = useState<Set<string>>(new Set());
  const [quickOpen, setQuickOpen] = useState(false);

  // The scoped list carries its client on every row, whereas `companies` is only
  // fetched for the new-ticket dialog — so on a filtered list the rows are the
  // only source of the client's name.
  const scopedClientName = companyParam
    ? companies.find((c) => c.id === companyParam)?.name
      ?? (tickets.find((t) => (t.company as { id?: string } | undefined)?.id === companyParam)?.company as { name?: string } | undefined)?.name
    : undefined;

  // Reached from an organization (its Change Control entry, or a client's
  // tickets), the trail names that client and the board the list is filtered to.
  useBreadcrumbTrail(
    companyParam && searchParams.get("new") !== "1"
      ? orgTrail(companyParam, scopedClientName, {
          label: boards.find((b) => b.id === boardId)?.name || "Tickets",
        })
      : null
  );

  // ── Pagination state ──
  const [pageSize, setPageSize] = useState<number | "all">(25);
  const [page, setPage] = useState(1);

  // ── Filter dialog ──
  const [showFilter, setShowFilter] = useState(false);
  const [filterForm, setFilterForm] = useState<Record<string,string>>({ status: "", priority: "", assignedToId: "", dateFrom: "", dateTo: "" });
  const [users, setUsers] = useState<Array<{id:string;firstName:string;lastName:string}>>([]);

  // ── Column display state (Choose Columns + drag reorder, persisted per user) ──
  const [visibleColumns, setVisibleColumns] = useState<string[]>(loadTicketColumns);
  const [showColumnModal, setShowColumnModal] = useState(false);
  const [dragCol, setDragCol] = useState<string | null>(null);

  /*
   * Column widths.
   *
   * The queue is a table you scan, so a column is either wide enough for the content it actually
   * holds or it folds that content over three lines and the scan stops. Widths therefore start as a
   * measurement: the list is laid out once at its natural size, every unclaimed column is read back
   * at the width its own content asked for, and those widths are kept as the baseline. A drag
   * replaces the baseline for that column and is saved per user, like the visibility and the order;
   * Summary is never measured, because it is the column that takes what is left.
   */
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(loadTicketColumnWidths);
  const [fittedWidths, setFittedWidths] = useState<Record<string, number>>({});
  const [fitNonce, setFitNonce] = useState(0);
  const tableRef = useRef<HTMLTableElement | null>(null);
  // The drag reads and writes its own copy of the widths: state is a render behind mid-gesture, and
  // the pointerup handler needs the final value rather than whatever the last render happened to see.
  const widthsRef = useRef(columnWidths);
  const applyWidths = (next: Record<string, number>, persist: boolean) => {
    widthsRef.current = next;
    setColumnWidths(next);
    if (persist) {
      try { localStorage.setItem("c7_ticket_column_widths", JSON.stringify(next)); } catch { /* storage full or unavailable */ }
    }
  };
  /** Dragged width, else measured width, else the definition's; 0 means "take what is left". */
  const widthOf = (id: string) => columnWidths[id] ?? fittedWidths[id] ?? TICKET_COLUMNS.find((c) => c.id === id)?.w ?? 140;
  const clampWidth = (w: number) => Math.max(MIN_COL_W, Math.min(MAX_COL_W, Math.round(w)));
  const refitColumns = () => { setFittedWidths({}); setFitNonce((n) => n + 1); };
  const clearColumnWidths = () => { applyWidths({}, true); refitColumns(); };
  const resetColumnWidth = (id: string) => {
    const next = { ...widthsRef.current };
    delete next[id];
    applyWidths(next, true);
    refitColumns();
  };
  // True only between pointerdown and pointerup on a resize edge, so the header does not treat the
  // same gesture as the start of a reorder.
  const resizingCol = useRef(false);
  /** Dragging the right edge of a header, live, then saved on release. */
  const startColumnResize = (event: React.PointerEvent, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    // Measure rather than trust: a flexible column's width reads 0 here, and starting from 0 would
    // make the column jump to the pointer on the first move.
    const cell = (event.currentTarget as HTMLElement).parentElement;
    const startWidth = cell ? cell.getBoundingClientRect().width : widthOf(id);
    let latest = clampWidth(startWidth);
    const build = (width: number) => ({ ...widthsRef.current, [id]: width });
    resizingCol.current = true;
    const onMove = (ev: PointerEvent) => {
      latest = clampWidth(startWidth + (ev.clientX - startX));
      applyWidths(build(latest), false);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      resizingCol.current = false;
      applyWidths(build(latest), true);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  // Two fixed leading columns (select, row actions) plus the visible ones. Fixed layout holds every
  // column at its stated width, so the table's own width is the only thing the browser has to scroll.
  // The column without a width of its own absorbs the slack, but never below FLEX_FLOOR: at a narrow
  // window the table scrolls rather than squeezing the summary down to nothing, which is the trap the
  // old wrapping layout fell into from the other side.
  const LEADING_W = 40 + 44;
  const LEADING_COLS = 2;
  const FLEX_FLOOR = 300;
  const tableWidth = LEADING_W + visibleColumns.reduce((total, id) => total + (widthOf(id) > 0 ? widthOf(id) : FLEX_FLOOR), 0);
  const clip = "overflow-hidden text-ellipsis whitespace-nowrap";

  const saveColumns = (cols: string[]) => { setVisibleColumns(cols); localStorage.setItem("c7_ticket_columns", JSON.stringify(cols)); };
  const toggleColumn = (id: string) => { saveColumns(visibleColumns.includes(id) ? visibleColumns.filter((c) => c !== id) : [...visibleColumns, id]); };
  const moveColumn = (from: string, to: string) => {
    const a = [...visibleColumns]; const fi = a.indexOf(from); const ti = a.indexOf(to);
    if (fi < 0 || ti < 0 || fi === ti) return;
    a.splice(fi, 1); a.splice(ti, 0, from); saveColumns(a);
  };

  const renderTicketCell = (t: any, colId: string) => {
    switch (colId) {
      case "number": return <td key={colId} className={`px-2 py-2 ${clip}`}><Link to={`/tickets/${t.id}`} className="text-white hover:text-cyber-400 font-medium" title={t.ticketNumber}>{t.ticketNumber}</Link></td>;
      case "title": return <td key={colId} className={`px-2 py-2 ${clip}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Priority as a bar rather than a column: it is a thing you notice while reading the
              list, not a field you sort by — and the column it replaces was one of the widest. */}
          <span
            className={`w-[3px] h-3.5 rounded-full shrink-0 ${PRIORITY_BAR[t.priority] || "bg-gray-700"}`}
            title={`Priority: ${t.priority}`}
            aria-hidden="true"
          />
          <Link to={`/tickets/${t.id}`} className="text-gray-300 hover:text-white truncate" title={t.title}>{t.title}</Link>
        </div>
      </td>;
      case "status": return <td key={colId} className={`px-2 py-2 ${clip}`}><span className={`badge whitespace-nowrap ${STATUS_COLORS[t.status]||""}`}>{(t.status)?.replace(/_/g," ")}</span>{t.isOverdue ? <span className="badge bg-red-600/20 text-red-400 ml-1.5 whitespace-nowrap">OVERDUE</span> : null}</td>;
      case "board": return <td key={colId} className={`px-2 py-2 ${clip} text-gray-400`} title={(t.board as {name?:string})?.name||""}>{(t.board as {name?:string})?.name||"-"}</td>;
      case "client": return <td key={colId} className={`px-2 py-2 ${clip} text-gray-400`} title={(t.company as {name?:string})?.name||""}>{(t.company as {name?:string})?.name||"-"}</td>;
      case "technician": {
        const name = t.assignedTo ? `${(t.assignedTo as {firstName?:string;lastName?:string}).firstName||""} ${(t.assignedTo as {firstName?:string;lastName?:string}).lastName||""}`.trim() || "-" : "-";
        return <td key={colId} className={`px-2 py-2 ${clip} text-gray-300`} title={name === "-" ? "Unassigned" : name}>{name}</td>;
      }
      case "priority": return <td key={colId} className={`px-2 py-2 ${clip}`}><span className="badge bg-surface-lighter text-gray-300 capitalize whitespace-nowrap">{t.priority || "medium"}</span></td>;
      // Age and SLA are the two columns a queue is actually triaged by: how long has this been
      // waiting, and is the clock still on our side. Both come from fields the ticket already has.
      case "age": return <td key={colId} className={`px-2 py-2 ${clip} text-gray-500`} title={t.createdAt ? `Created ${new Date(t.createdAt).toLocaleString()}` : ""}>{relativeAge(t.createdAt) || "—"}</td>;
      case "sla": {
        const chip = slaChipFor(t);
        return (
          <td key={colId} className={`px-2 py-2 ${clip}`}>
            {chip ? <span className={`chip whitespace-nowrap ${chip.tone}`} title={chip.title}>{chip.label}</span> : <span className="text-gray-600" title="This ticket has no due date or SLA target">—</span>}
          </td>
        );
      }
      case "timestamp": {
        const created = t.createdAt ? new Date(t.createdAt) : null;
        const updated = t.updatedAt ? new Date(t.updatedAt) : null;
        const changed = created && updated && updated.getTime() > created.getTime();
        return (
          <td key={colId} className={`px-2 py-2 ${clip} text-gray-500`}
            title={changed ? `Created ${created!.toLocaleString()} · Last updated ${updated!.toLocaleString()}` : `Created ${created?.toLocaleString() || "-"}`}>
            {changed ? updated!.toLocaleString() : (created?.toLocaleString() || "-")}
          </td>
        );
      }
      default: return null;
    }
  };

  const fetchBoards = () => { api.get("/boards").then(r=>setBoards(Array.isArray(r.data)?r.data:(r.data?.data||r.data||[]))).catch(()=>{}); };

  const fetchTickets = () => {
    let url = "/tickets?limit=200";
    if (boardId) url += `&boardId=${boardId}`;
    // Apply active filters (search params are the source of truth)
    if (statusParam) url += `&status=${encodeURIComponent(statusParam)}`;
    if (priorityParam) url += `&priority=${encodeURIComponent(priorityParam)}`;
    if (assignedParam) url += `&assignedToId=${encodeURIComponent(assignedParam)}`;
    if (dateFromParam) url += `&dateFrom=${encodeURIComponent(dateFromParam)}`;
    if (dateToParam) url += `&dateTo=${encodeURIComponent(dateToParam)}`;
    if (qParam) url += `&search=${encodeURIComponent(qParam)}`;
    if (companyParam && !searchParams.get("new")) url += `&companyId=${encodeURIComponent(companyParam)}`;
    api.get(url).then(r=>setTickets(r.data.data||[])).catch(()=>{}).finally(()=>setLoading(false));
  };

  useEffect(()=>{fetchBoards();},[]);
  useEffect(()=>{fetchTickets();},[boardId, statusParam, priorityParam, assignedParam, dateFromParam, dateToParam, companyParam, qParam]);

  // ── The saved views, with counts ──
  // The list on screen is filtered, so a count taken from it would be a count of the filter being
  // on. This is the scope *without* the view applied — the board and the client, and nothing else —
  // so each chip can say how much it would show before you press it. "Waiting 6" is a reason to
  // look; "Waiting" is not.
  const [scopeTickets, setScopeTickets] = useState<Array<{ status?: string; priority?: string; assignedToId?: string | null }>>([]);
  useEffect(() => {
    let url = "/tickets?limit=500";
    if (boardId) url += `&boardId=${boardId}`;
    if (companyParam && !searchParams.get("new")) url += `&companyId=${encodeURIComponent(companyParam)}`;
    api.get(url).then(r => setScopeTickets(r.data.data || [])).catch(() => setScopeTickets([]));
  }, [boardId, companyParam, searchParams]);

  const viewMatches = (view: (typeof FILTER_BY_OPTIONS)[number], t: { status?: string; priority?: string }) => {
    const statuses = view.status.split(",").filter(Boolean);
    if (statuses.length && !statuses.includes(t.status || "")) return false;
    if (view.priority && t.priority !== view.priority) return false;
    return true;
  };
  const viewCount = (view: (typeof FILTER_BY_OPTIONS)[number] | null) =>
    view ? scopeTickets.filter(t => viewMatches(view, t)).length : scopeTickets.length;
  const activeView = assignedParam ? "mine" : statusParam || priorityParam ? filterByFor(statusParam, priorityParam) : "everything";
  // "Assigned to me" is the one view that is about *you* rather than about the ticket, so it is the
  // one that toggles: pressing it again puts you back to everything.
  const applyMine = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("status");
    next.delete("priority");
    if (assignedParam && assignedParam === currentUser?.id) next.delete("assignedToId");
    else next.set("assignedToId", currentUser?.id || "");
    setSearchParams(next);
    setPage(1);
  };
  const applyView = (view: (typeof FILTER_BY_OPTIONS)[number] | null) => {
    const next = new URLSearchParams(searchParams);
    if (!view) { next.delete("status"); next.delete("priority"); }
    else {
      next.set("status", view.status);
      if (view.priority) next.set("priority", view.priority); else next.delete("priority");
    }
    setSearchParams(next);
    setPage(1);
  };

  // The box follows the URL (Back/Forward, a chip being removed, a shared link)…
  useEffect(() => { setSearchInput(qParam); }, [qParam]);
  // …and the URL follows the box, once the typing stops.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput === qParam) return;
      const next = new URLSearchParams(searchParams);
      if (searchInput.trim()) next.set("q", searchInput.trim());
      else next.delete("q");
      setSearchParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, qParam, searchParams, setSearchParams]);
  useEffect(()=>{api.get("/users?limit=200").then(r=>setUsers(r.data.data||[])).catch(()=>{});},[]);

  // Auto-open new ticket form when navigated from contact
  useEffect(() => {
    const isNew = searchParams.get("new") === "1";
    if (isNew) {
      const cId = searchParams.get("companyId") || "";
      const cName = searchParams.get("contactName") || "";
      const cEmail = searchParams.get("contactEmail") || "";
      setForm(prev => ({ ...prev, companyId: cId, contactName: cName, contactEmail: cEmail, title: cName ? `Ticket for ${cName}` : "", description: cEmail ? `Contact: ${cName} (${cEmail})` : "" }));
      api.get("/clients?limit=100").then(r => setCompanies(r.data?.data || [])).catch(() => {});
      if (cId) { api.get(`/clients/contacts?companyId=${cId}`).then(r => { const cons = r.data?.data || r.data || []; setContacts(cons); const match = cons.find((c: { email: string }) => c.email === cEmail); if (match) setForm(prev => ({ ...prev, contactId: match.id })); }).catch(() => {}); }
      setShowNew(true);
    }
  }, [searchParams]);

  const handleCompanyChange = (cId: string) => {
    setForm(prev => ({ ...prev, companyId: cId, contactName: "", contactEmail: "" }));
    if (cId) { api.get(`/clients/contacts?companyId=${cId}`).then(r => setContacts(r.data?.data || r.data || [])).catch(() => {}); }
    else { setContacts([]); }
  };

  const openNew = async () => {
    try { const cR=await api.get("/clients?limit=50"); setCompanies(cR.data?.data||[]); } catch {}
    setForm(prev=>({...prev, boardId: boardId || ""}));
    setShowNew(true);
  };
  const handleCreate = async (e: React.FormEvent) => { e.preventDefault();
    try {
      await api.post("/tickets", {
        ...form,
        additionalContactIds: newTicketContacts.map((r) => r.contactId).filter(Boolean),
      });
      toast.success("Ticket created");
      setShowNew(false);
      setForm({title:"",description:"",priority:"medium",boardId:"",companyId:"",contactId:"",contactName:"",contactEmail:"",startTime:"",endTime:"",status:"new"});
      setNewTicketContacts([]);
      fetchTickets();
    }
    catch { toast.error("Failed"); }
  };

  // ── Sorted + paginated view of the fetched tickets ──
  const sortedTickets = sortData(tickets as Array<Record<string,unknown>>, sort?.field || "updatedAt", sort?.direction || "desc") as any[];
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(sortedTickets.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const paged = pageSize === "all" ? sortedTickets : sortedTickets.slice((safePage - 1) * pageSize, safePage * pageSize);

  /*
   * Fit the columns to their content.
   *
   * Auto table layout is the only thing that knows how wide a rendered badge, an uppercase header or
   * a 12px timestamp really is, so the fit asks it: the table is laid out once at its natural width,
   * each measured column is read back, and those numbers become the baseline widths. A column
   * somebody has dragged is never measured — the user's word outranks the browser's — and Summary is
   * never measured because it is the column that takes what is left.
   */
  const unmeasured = visibleColumns.filter((id) => columnWidths[id] === undefined && (TICKET_COLUMNS.find((c) => c.id === id)?.w ?? 0) > 0);
  const fitSignature = [visibleColumns.join("|"), safePage, paged.length, sort?.field ?? "", sort?.direction ?? "", fitNonce, Object.keys(columnWidths).join("|")].join("/");
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table || unmeasured.length === 0) return;
    const headers = [...table.querySelectorAll("thead th")];
    const natural = { layout: table.style.tableLayout, width: table.style.width, minWidth: table.style.minWidth };
    table.style.tableLayout = "auto";
    table.style.width = "max-content";
    table.style.minWidth = "0px";
    const measured: Record<string, number> = {};
    for (const id of unmeasured) {
      const th = headers[visibleColumns.indexOf(id) + LEADING_COLS];
      // A hair of slack: the natural width and the width a string needs to render without an ellipsis
      // differ by a fraction, and that fraction is enough to turn a name into "Acme Corporati…".
      if (th) measured[id] = clampWidth(Math.ceil(th.getBoundingClientRect().width) + 1);
    }
    table.style.tableLayout = natural.layout;
    table.style.width = natural.width;
    table.style.minWidth = natural.minWidth;
    // Widest wins: paging into a page with a longer client name grows that column, and paging back
    // does not shrink it again, so the grid settles instead of twitching once per page. A deliberate
    // refit clears the baseline first, which is what makes this a floor rather than a ratchet.
    setFittedWidths((prev) => {
      const merged: Record<string, number> = {};
      let changed = Object.keys(prev).length !== unmeasured.length;
      for (const id of unmeasured) {
        const value = Math.max(measured[id] ?? 0, prev[id] ?? 0);
        merged[id] = value;
        if (prev[id] !== value) changed = true;
      }
      return changed ? merged : prev;
    });
    // `unmeasured` is derived from what is already in the dependency signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignature]);

  // ── Batch actions ──
  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () => {
    const pageIds = new Set(paged.map((t: any) => t.id));
    const allSelected = paged.length > 0 && [...pageIds].every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (allSelected) pageIds.forEach(id => n.delete(id)); else pageIds.forEach(id => n.add(id));
      return n;
    });
  };
  const applyBatchAction = async (action: string) => {
    if (selectedIds.size === 0) return false;
    try {
      const ids = [...selectedIds];
      let status: string | undefined;
      let priority: string | undefined;
      if (action === "acknowledge") status = "in_progress";
      else if (action === "close") status = "closed";
      else if (action.startsWith("status_")) status = action.replace("status_", "");
      else if (action.startsWith("priority_")) priority = action.replace("priority_", "");

      const payload: any = { ticketIds: ids };
      if (status) payload.status = status;
      if (priority) payload.priority = priority;

      await api.post("/tickets/batch", payload);
      return true;
    } catch { return false; }
  };

  const batchApplyChecked = async () => {
    if (selectedIds.size === 0 || checkedActions.size === 0) return;
    setBatchApplying(true);
    let success = 0;
    let fail = 0;
    for (const action of checkedActions) {
      const ok = await applyBatchAction(action);
      if (ok) success++; else fail++;
    }
    setBatchApplying(false);
    if (success > 0) toast.success(`Applied ${success} action${success!==1?"s":""} to ${selectedIds.size} ticket${selectedIds.size!==1?"s":""}`);
    if (fail > 0) toast.error(`${fail} action${fail!==1?"s":""} failed`);
    setSelectedIds(new Set());
    setCheckedActions(new Set());
    fetchTickets();
  };

  // ── Quick Actions: apply one action to all selected tickets ──
  const quickApply = async (action: string) => {
    if (selectedIds.size === 0) return;
    setQuickOpen(false);
    setBatchApplying(true);
    const ok = await applyBatchAction(action);
    setBatchApplying(false);
    if (ok) toast.success(`Applied to ${selectedIds.size} ticket${selectedIds.size !== 1 ? "s" : ""}`);
    else toast.error("Failed to apply action");
    setSelectedIds(new Set());
    fetchTickets();
  };

  // ── Individual ticket action ──
  const ticketAction = async (ticketId: string, action: string) => {
    try {
      if (action === "close") {
        await api.patch(`/tickets/${ticketId}`, { status: "closed" });
      } else if (action === "acknowledge") {
        await api.patch(`/tickets/${ticketId}`, { status: "in_progress" });
      } else if (action.startsWith("status_")) {
        await api.patch(`/tickets/${ticketId}`, { status: action.replace("status_", "") });
      } else if (action.startsWith("priority_")) {
        await api.patch(`/tickets/${ticketId}`, { priority: action.replace("priority_", "") });
      }
      toast.success("Updated");
      fetchTickets();
    } catch { toast.error("Failed"); }
  };

  // ── Right-click menu: the Tickets section ──
  const menu = useContextMenu();

  const assignTicket = async (ticketId: string, userId: string | null) => {
    try {
      await api.patch(`/tickets/${ticketId}`, { assignedToId: userId });
      toast.success(userId ? "Assigned" : "Unassigned");
      fetchTickets();
    } catch { toast.error("Could not assign"); }
  };

  // ── Delete ticket ──
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; ticketNumber?: string; title?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDeleteTicket = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/tickets/${deleteTarget.id}`);
      toast.success(`${deleteTarget.ticketNumber || "Ticket"} deleted`);
      setDeleteTarget(null);
      fetchTickets();
    } catch (error: any) {
      toast.error(apiErrorMessage(error, "Could not delete ticket"));
    } finally { setDeleting(false); }
  };

  // ── Export CSV ──
  /** Plain-text cell values matching what the table renders for each column. */
  const csvCellValue = (t: Record<string, any>, colId: string): string => {
    const person = t.assignedTo as { firstName?: string; lastName?: string } | null;
    switch (colId) {
      case "number": return String(t.ticketNumber ?? "");
      case "title": return String(t.title ?? "");
      case "status": return String(t.status ?? "").replace(/_/g, " ");
      case "board": return String((t.board as { name?: string } | null)?.name ?? "");
      case "client": return String((t.company as { name?: string } | null)?.name ?? "");
      case "technician": return person ? `${person.firstName || ""} ${person.lastName || ""}`.trim() : "";
      case "priority": return String(t.priority ?? "");
      case "age": return relativeAge(t.createdAt as string);
      case "sla": return slaChipFor(t)?.label ?? "";
      case "timestamp": {
        const created = t.createdAt ? new Date(t.createdAt as string) : null;
        const updated = t.updatedAt ? new Date(t.updatedAt as string) : null;
        const shown = created && updated && updated.getTime() > created.getTime() ? updated : created;
        return shown ? shown.toISOString() : "";
      }
      default: return "";
    }
  };

  const exportCsv = () => {
    const rows = sortedTickets;
    if (rows.length === 0) { toast.error("Nothing to export"); return; }
    const columns: CsvColumn<Record<string, any>>[] = visibleColumns
      .map(colId => TICKET_COLUMNS.find(c => c.id === colId))
      .filter((c): c is TicketColumnDef => !!c)
      .map(c => ({ key: c.id, label: c.label, value: (t: Record<string, any>) => csvCellValue(t, c.id) }));
    downloadCsv(`c7ntax-tickets-${fileStamp()}.csv`, toCsv(rows, columns));
    toast.success(`Exported ${rows.length} ticket${rows.length === 1 ? "" : "s"}${rows.length >= 200 ? " (API limit is 200)" : ""}`);
  };

  const ticketMenuHeader = (t: Record<string, any>) => ({
    title: `${t.ticketNumber ?? "Ticket"} · ${t.title || "Untitled ticket"}`,
    subtitle: [
      (t.company as { name?: string } | null)?.name,
      (t.status as string | undefined)?.replace(/_/g, " "),
      priorityLabel(t.priority as string),
      t.assignedTo ? `${(t.assignedTo as { firstName?: string }).firstName ?? ""} ${(t.assignedTo as { lastName?: string }).lastName ?? ""}`.trim() : "Unassigned",
    ].filter(Boolean).join(" · "),
  });

  const ticketMenuEntries = (t: Record<string, any>): MenuEntry[] => {
    const status = (t.status as string) ?? "";
    const priority = (t.priority as string) ?? "";
    return [
      { label: "Open ticket", icon: ExternalLink, hint: "⏎", onSelect: () => navigate(`/tickets/${t.id}`) },
      { label: "Open in new tab", icon: SquareArrowOutUpRight, onSelect: () => openInNewTab(`/tickets/${t.id}`) },
      { label: "Open in new window", icon: AppWindow, onSelect: () => openInNewWindow(`/tickets/${t.id}`) },
      "separator",
      {
        label: "Change status", icon: CircleDot,
        items: TICKET_STATUSES.map(s => ({
          label: s.replace(/_/g, " "), checked: status === s, onSelect: () => ticketAction(t.id, `status_${s}`),
        })),
      },
      {
        label: "Change priority", icon: Flag,
        items: TICKET_PRIORITIES.map(p => ({
          label: priorityLabel(p), checked: priority === p, onSelect: () => ticketAction(t.id, `priority_${p}`),
        })),
      },
      {
        label: "Assign to", icon: UserCheck,
        items: [
          { label: "Unassigned", checked: !t.assignedToId, onSelect: () => assignTicket(t.id, null) },
          ...users.map(u => ({
            label: `${u.firstName} ${u.lastName}`.trim(), checked: t.assignedToId === u.id, onSelect: () => assignTicket(t.id, u.id),
          })),
        ],
      },
      "separator",
      {
        label: "Assign to me", icon: UserCheck,
        disabled: !currentUser || t.assignedToId === currentUser.id,
        hint: t.assignedToId === currentUser?.id ? "already yours" : undefined,
        onSelect: () => currentUser && assignTicket(t.id, currentUser.id),
      },
      "separator",
      { label: "Acknowledge", icon: CheckSquare, disabled: status === "in_progress" || status === "closed", onSelect: () => ticketAction(t.id, "acknowledge") },
      { label: "Close ticket", icon: X, disabled: status === "closed", onSelect: () => ticketAction(t.id, "close") },
      "separator",
      { label: "Add note", icon: MessageSquare, onSelect: () => navigate(`/tickets/${t.id}?action=note`) },
      { label: "Log time entry", icon: Timer, onSelect: () => navigate(`/tickets/${t.id}?action=time`) },
      { label: "Email customer contact", icon: Mail, onSelect: () => navigate(`/tickets/${t.id}?action=email`) },
      { label: "Print ticket", icon: Printer, onSelect: () => navigate(`/tickets/${t.id}?action=print`) },
      "separator",
      { label: "Copy ticket number", icon: Copy, hint: t.ticketNumber, onSelect: () => copyText(String(t.ticketNumber ?? ""), "Ticket number") },
      { label: "Copy link", icon: Link2, onSelect: () => copyText(absoluteUrl(`/tickets/${t.id}`), "Link") },
      "separator",
      { label: "Delete ticket…", icon: Trash2, danger: true, onSelect: () => setDeleteTarget({ id: t.id, ticketNumber: t.ticketNumber, title: t.title }) },
    ];
  };

  const sectionMenuEntries = (): MenuEntry[] => {
    const hasFilters = !!(boardId || statusParam || priorityParam || assignedParam || dateFromParam || dateToParam);
    const view = `${window.location.pathname}${window.location.search}`;
    return [
      { label: "New ticket", icon: Plus, onSelect: () => setShowNew(true) },
      { label: "Refresh list", icon: RotateCw, onSelect: () => fetchTickets() },
      "separator",
      { label: "Filter tickets…", icon: Filter, onSelect: () => setShowFilter(true) },
      { label: "Clear filters", icon: Eraser, hint: hasFilters ? "active" : undefined, disabled: !hasFilters, onSelect: () => clearFilters() },
      { label: "Choose columns…", icon: Columns3, onSelect: () => setShowColumnModal(true) },
      "separator",
      { label: "Export as CSV", icon: Download, hint: `${sortedTickets.length} row${sortedTickets.length === 1 ? "" : "s"}`, disabled: sortedTickets.length === 0, onSelect: exportCsv },
      "separator",
      ...viewMenuEntries(view),
    ];
  };

  // ── Filter ──
  // Sync the dialog draft from URL filters (e.g. when navigating from Service Boards)
  useEffect(() => {
    setFilterForm({ status: statusParam, priority: priorityParam, assignedToId: assignedParam, dateFrom: dateFromParam, dateTo: dateToParam });
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusParam, priorityParam, assignedParam, dateFromParam, dateToParam]);

  const applyFilters = () => {
    setShowFilter(false);
    const params: Record<string, string> = {};
    if (boardId) params.boardId = boardId;
    if (filterForm.status) params.status = filterForm.status;
    if (filterForm.priority) params.priority = filterForm.priority;
    if (filterForm.assignedToId) params.assignedToId = filterForm.assignedToId;
    if (filterForm.dateFrom) params.dateFrom = filterForm.dateFrom;
    if (filterForm.dateTo) params.dateTo = filterForm.dateTo;
    setSearchParams(params);
  };
  const applyFilterBy = (v: string) => {
    const opt = FILTER_BY_OPTIONS.find(o => o.value === v);
    setFilterForm(prev => ({ ...prev, status: opt?.status || "", priority: opt?.priority || "" }));
  };
  const clearFilters = () => {
    setFilterForm({ status: "", priority: "", assignedToId: "", dateFrom: "", dateTo: "" });
    setShowFilter(false);
    setSearchParams(boardId ? { boardId } : {});
  };

  return (
    <div
      className="space-y-4 animate-fade-in"
      onContextMenu={(e) => { if (isTextEntryTarget(e.target)) return; menu.open(e, sectionMenuEntries()); }}
    >
      <ContextMenu state={menu.menuState} onClose={menu.close} />
      <DeleteTicketDialog target={deleteTarget} busy={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDeleteTicket} />
      {/* Breadcrumb */}
      {boardId && (
        <div className="flex items-center gap-2 text-sm">
          <Link to="/boards" className="text-gray-500 hover:text-white flex items-center gap-1"><Home size={13}/></Link>
          <ChevronRight size={13} className="text-gray-600"/>
          <Link to="/boards" className="text-gray-500 hover:text-white">Service Boards</Link>
          <ChevronRight size={13} className="text-gray-600"/>
          <span className="text-white font-medium">{boards.find(b=>b.id===boardId)?.name||"Board"}</span>
        </div>
      )}
      {/* Redesigned, the title and its toolbar share a single row so the list starts higher up. */}
      <div className={redesign ? "flex flex-wrap items-end justify-between gap-x-3 gap-y-2" : "space-y-4"}>
      <div>
        <h2 className={redesign ? "text-base font-semibold text-white" : "text-lg font-semibold text-white"}>Tickets</h2>
        <p className={redesign ? "text-xs text-gray-500" : "text-sm text-gray-400"}>
          {companyParam && !searchParams.get("new")
            ? `Showing ${scopedClientName ?? "one client"}'s tickets`
            : boardId && !BOARD_TABS ? `Filtered by board` : "Manage service tickets"}
        </p>
      </div>

      {/* Toolbar: board selector + Create on the left, Filter + Choose Columns on the right */}
      <div className={redesign ? "flex-1 flex flex-wrap items-center justify-between gap-2" : "flex flex-wrap items-center justify-between gap-2"}>
        <div className="flex items-center gap-2">
          {!BOARD_TABS && (
            <select
              className="input-field text-sm py-1.5"
              value={boardId}
              onChange={e=>{setSearchParams(e.target.value?{boardId:e.target.value}:{});}}
            >
              <option value="">All Boards</option>
              {boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button onClick={openNew} className="btn-primary flex items-center gap-2"><Plus size={16}/>Create</button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => { if (selectedIds.size > 0) setQuickOpen(!quickOpen); }}
              disabled={selectedIds.size === 0}
              title={selectedIds.size === 0 ? "Select one or more tickets to enable" : "Quick Actions"}
              className="btn-secondary text-sm flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronDown size={14} /><Wrench size={14} /> Quick Actions
            </button>
            {quickOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setQuickOpen(false)} />
                <div className="absolute left-0 top-full mt-1 w-max grid bg-navy-800 border border-surface-border rounded-lg shadow-xl z-50 py-1">
                  <div className="px-3 py-1.5 text-[10px] text-gray-600 uppercase font-semibold">Quick Actions</div>
                  <button onClick={() => quickApply("acknowledge")} className="text-left whitespace-nowrap px-4 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white">Acknowledge</button>
                  <button onClick={() => quickApply("close")} className="text-left whitespace-nowrap px-4 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white">Close</button>
                  <div className="border-t border-surface-border my-1" />
                  {TICKET_STATUSES.filter(s => s !== "closed" && s !== "cancelled").slice(0,5).map(s => (
                    <button key={s} onClick={() => quickApply(`status_${s}`)} className="text-left whitespace-nowrap px-4 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white">Set Status → {s.replace(/_/g, " ")}</button>
                  ))}
                  <div className="border-t border-surface-border my-1" />
                  {TICKET_PRIORITIES.map(p => (
                    <button key={p} onClick={() => quickApply(`priority_${p}`)} className="text-left whitespace-nowrap px-4 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white">Priority → {p}</button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button onClick={() => setShowFilter(true)} className="btn-secondary text-sm flex items-center gap-1.5">
            <Filter size={14} /> Filter
          </button>
          <button onClick={() => setShowColumnModal(true)} className="btn-secondary text-xs flex items-center gap-1.5"><Columns3 size={14} /> Choose Columns</button>
        </div>
      </div>
      </div>

      {/* ── Filter Dialog ── */}
      {showFilter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowFilter(false)}>
          <div className="card w-full max-w-md mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Filter Tickets</h3>
              <button onClick={() => setShowFilter(false)} className="text-gray-500 hover:text-white"><X size={18}/></button>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Filter By</label>
              <select className="input-field" value={filterByFor(filterForm.status || "", filterForm.priority || "")} onChange={e => applyFilterBy(e.target.value || "")}>
                <option value="">Any</option>
                {FILTER_BY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Status</label>
              <select className="input-field" value={filterForm.status} onChange={e => setFilterForm({...filterForm, status: e.target.value})}>
                <option value="">Any</option>
                {filterForm.status === "open" && <option value="open">Open</option>}
                {TICKET_STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Priority</label>
              <select className="input-field" value={filterForm.priority} onChange={e => setFilterForm({...filterForm, priority: e.target.value})}>
                <option value="">Any</option>
                {TICKET_PRIORITIES.map(p => <option key={p} value={p}>{priorityLabel(p)}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Assigned Technician</label>
              <select className="input-field" value={filterForm.assignedToId} onChange={e => setFilterForm({...filterForm, assignedToId: e.target.value})}>
                <option value="">Any</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Date From</label>
                <input className="input-field" type="date" value={filterForm.dateFrom} onChange={e => setFilterForm({...filterForm, dateFrom: e.target.value})} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Date To</label>
                <input className="input-field" type="date" value={filterForm.dateTo} onChange={e => setFilterForm({...filterForm, dateTo: e.target.value})} />
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2 border-t border-surface-border">
              <button onClick={clearFilters} className="btn-secondary text-sm">Clear</button>
              <button onClick={applyFilters} className="btn-primary text-sm">Apply Filters</button>
            </div>
          </div>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={()=>setShowNew(false)}>
          <form className="card w-full max-w-2xl mx-4 space-y-3 max-h-[92vh] overflow-y-auto" onClick={e=>e.stopPropagation()} onSubmit={handleCreate}>
            <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-white">New Ticket</h3><button type="button" onClick={()=>setShowNew(false)} className="text-gray-500 hover:text-white"><X size={18}/></button></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Company <span className="text-red-400">*</span></label><select className="input-field" value={form.companyId} onChange={e=>handleCompanyChange(e.target.value)} required><option value="">Select company...</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Contact</label><select className="input-field" value={form.contactId || `${form.contactName}|${form.contactEmail}`} onChange={e=>{const v = e.target.value; if (v.includes("|")) { const [name,email] = v.split("|"); setForm({...form, contactId:"", contactName:name||"", contactEmail:email||""}); } else { const c = contacts.find(x=>x.id===v); setForm({...form, contactId:v, contactName:c?`${c.firstName} ${c.lastName}`:"", contactEmail:c?.email||""}); }}}><option value="">Select contact...</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}<option value={`${form.contactName}|${form.contactEmail}`}>{form.contactName && !contacts.length ? form.contactName : ""}</option></select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Board / Queue <span className="text-red-400">*</span></label><select className="input-field" value={form.boardId} onChange={e=>setForm({...form,boardId:e.target.value})} required><option value="">Select board...</option>{boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Status</label><select className="input-field" value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="new">New</option><option value="in_progress">In Progress</option><option value="waiting_on_client">Waiting on Client</option><option value="on_hold">On Hold</option></select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Priority</label><select className="input-field" value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Start / End Time</label><div className="grid grid-cols-2 gap-1"><input className="input-field text-xs" type="datetime-local" value={form.startTime} onChange={e=>setForm({...form,startTime:e.target.value})} placeholder="Start"/><input className="input-field text-xs" type="datetime-local" value={form.endTime} onChange={e=>setForm({...form,endTime:e.target.value})} placeholder="End"/></div></div>
            </div>
            <div><label className="text-xs text-gray-500 block mb-1">Summary <span className="text-red-400">*</span></label><input className="input-field" placeholder="Brief summary of the issue" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} required/></div>
            {/* Extra people on the ticket, picked up front instead of after the fact. */}
            <div className="rounded-lg border border-surface-border bg-surface-lighter/40 px-2.5 py-2">
              <RecipientField
                label="Also"
                value={newTicketContacts}
                onChange={setNewTicketContacts}
                suggestions={contacts.filter((c) => c.id !== form.contactId)}
                placeholder="Add CC / additional contacts"
                hint="Kept on the ticket as additional contacts you can promote to CC later."
                orgName={companies.find((c) => c.id === form.companyId)?.name}
                orgEmails={contacts.map((c) => c.email)}
              />
            </div>
            <div><label className="text-xs text-gray-500 block mb-1">Description</label><textarea className="input-field" placeholder="Detailed description..." value={form.description} onChange={e=>setForm({...form,description:e.target.value})} rows={4}/></div>
            <div className="flex gap-2 justify-end pt-2 border-t border-surface-border"><button type="button" className="btn-secondary" onClick={()=>setShowNew(false)}>Cancel</button><button type="submit" className="btn-primary flex items-center gap-1.5"><Save size={14}/>Create Ticket</button></div>
          </form>
        </div>
      )}

      {/* ── Views ──
          The five the Filter dialog offers, as a strip you press rather than a dialog you fill in.
          They are the same filters the URL already carries, so a view is a link you can send. */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Ticket views">
        {FILTER_BY_OPTIONS.map(view => (
          <button
            key={view.value}
            type="button"
            onClick={() => applyView(view)}
            aria-pressed={activeView === view.value}
            className={`chip ${activeView === view.value ? "chip--on" : ""}`}
          >
            {view.label} <span className="chip__n">{viewCount(view)}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={applyMine}
          aria-pressed={activeView === "mine"}
          className={`chip ${activeView === "mine" ? "chip--on" : ""}`}
        >
          Assigned to me <span className="chip__n">{scopeTickets.filter(t => currentUser?.id && t.assignedToId === currentUser.id).length}</span>
        </button>
        <button
          type="button"
          onClick={() => applyView(null)}
          aria-pressed={activeView === "everything"}
          className={`chip ${activeView === "everything" ? "chip--on" : ""}`}
        >
          Everything <span className="chip__n">{viewCount(null)}</span>
        </button>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          className="input-field pl-9"
          placeholder="Search tickets by number or subject..."
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          aria-label="Search tickets"
        />
      </div>

      {/* The boards as tabs, with the band underneath naming the one being viewed. Under the search
          box rather than above the toolbar: the tabs choose the list, and the list's own controls
          read in the order somebody uses them — search, then narrow, then choose the board. */}
      {BOARD_TABS && (
        <TicketBoardTabs
          boards={boards}
          boardId={boardId}
          onSelect={id => setSearchParams(id ? { boardId: id } : {})}
        />
      )}

      {/* ── Active filters ── What is narrowing this list, and a way out of each one. */}
      {(() => {
        const drop = (key: string) => () => {
          const next = new URLSearchParams(searchParams);
          next.delete(key);
          setSearchParams(next);
        };
        const chips: Array<{ key: string; label: string; clear: () => void }> = [];
        if (qParam) chips.push({ key: "q", label: `Search: ${qParam}`, clear: drop("q") });
        if (statusParam) {
          const named = FILTER_BY_OPTIONS.find(o => o.status === statusParam && (!priorityParam || o.priority === priorityParam));
          chips.push({ key: "status", label: `Status: ${named?.label ?? statusParam.replace(/,/g, ", ").replace(/_/g, " ")}`, clear: drop("status") });
        }
        if (priorityParam) chips.push({ key: "priority", label: `Priority: ${priorityParam}`, clear: drop("priority") });
        if (boardId && !BOARD_TABS) chips.push({ key: "boardId", label: `Board: ${boards.find(b => b.id === boardId)?.name ?? "selected"}`, clear: drop("boardId") });
        if (companyParam && !searchParams.get("new")) chips.push({ key: "companyId", label: `Client: ${companies.find(c => c.id === companyParam)?.name ?? "selected"}`, clear: drop("companyId") });
        if (assignedParam) {
          const assigned = users.find(u => u.id === assignedParam);
          chips.push({ key: "assignedToId", label: `Assigned: ${assigned ? `${assigned.firstName} ${assigned.lastName}`.trim() : "selected"}`, clear: drop("assignedToId") });
        }
        if (dateFromParam) chips.push({ key: "dateFrom", label: `From: ${dateFromParam}`, clear: drop("dateFrom") });
        if (dateToParam) chips.push({ key: "dateTo", label: `To: ${dateToParam}`, clear: drop("dateTo") });
        if (chips.length === 0) return null;
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500 flex items-center gap-1"><Filter size={12} /> Filtered by</span>
            {chips.map(chip => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.clear}
                title={`Remove ${chip.label}`}
                className="badge bg-cyber-600/15 text-cyber-300 hover:bg-cyber-600/30 flex items-center gap-1"
              >
                {chip.label} <X size={12} />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSearchParams({})}
              className="text-xs text-gray-500 hover:text-white ml-1"
            >Clear all</button>
          </div>
        );
      })()}
      {/* ── Batch actions bar ── */}
      {selectedIds.size > 0 && (
        <div className="card flex items-center gap-3 bg-cyber-600/5 border-cyber-500/30">
          <span className="text-sm text-white font-medium">{selectedIds.size} selected</span>
          <div className="relative">
            <button onClick={() => { setBatchDropdown(!batchDropdown); if (!batchDropdown) setCheckedActions(new Set()); }} className="btn-primary text-sm flex items-center gap-1.5">
              Modify Selected <ChevronDown size={14} />
            </button>
            {batchDropdown && (
              <div className="absolute top-full mt-1 left-0 bg-navy-800 border border-surface-border rounded-lg shadow-xl z-50 min-w-[240px] py-1">
                <div className="max-h-64 overflow-y-auto">
                  {BATCH_ACTIONS.map(a => {
                    const checked = checkedActions.has(a.value);
                    return (
                      <label key={a.value}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white cursor-pointer">
                        <input type="checkbox" checked={checked} onChange={() => {
                          setCheckedActions(prev => { const n = new Set(prev); checked ? n.delete(a.value) : n.add(a.value); return n; });
                        }} className="rounded accent-cyber-500" />
                        <span>{a.label}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="border-t border-surface-border mt-1 pt-1 px-2 pb-1 flex gap-2">
                  <button
                    onClick={() => { setBatchDropdown(false); setCheckedActions(new Set()); }}
                    className="flex-1 text-xs py-1.5 rounded text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors">Cancel</button>
                  <button
                    onClick={() => { batchApplyChecked(); setBatchDropdown(false); }}
                    disabled={checkedActions.size === 0 || batchApplying}
                    className="flex-1 text-xs py-1.5 rounded bg-cyber-600/30 text-cyber-400 hover:bg-cyber-600/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">
                    OK{batchApplying ? "..." : ""}
                  </button>
                </div>
              </div>
            )}
          </div>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-500 hover:text-white">Clear selection</button>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        {loading ? <TableSkeleton /> : tickets.length===0 ? <div className="p-8 text-center text-gray-500">No tickets</div>:(
          <div className="overflow-x-auto">
            <table ref={tableRef} className="w-full table-fixed text-xs" style={{ minWidth: `${tableWidth}px` }}>
              <colgroup>
                <col style={{ width: "40px" }} />
                <col style={{ width: "44px" }} />
                {visibleColumns.map((colId) => {
                  const w = widthOf(colId);
                  // A column without a width absorbs the slack, which is how Summary stays the widest
                  // thing on the row until someone drags its edge and makes it a fixed width.
                  return w > 0 ? <col key={colId} style={{ width: `${w}px` }} /> : <col key={colId} />;
                })}
              </colgroup>
              <thead className="group"><tr className="border-b border-surface-border text-left text-gray-400">
            <th className="px-2 py-2"><button onClick={toggleSelectAll} className="text-gray-500 hover:text-white" aria-label={paged.length > 0 && paged.every((t: any) => selectedIds.has(t.id)) ? "Deselect all tickets" : "Select all tickets"}>{paged.length > 0 && paged.every((t: any) => selectedIds.has(t.id)) ? <CheckSquare size={14} className="text-cyber-400"/> : <Square size={14}/>}</button></th>
            <th className="px-2 py-2"></th>
            {visibleColumns.map((colId) => {
              const def = TICKET_COLUMNS.find((c) => c.id === colId);
              if (!def) return null;
              return (
                <th key={colId}
                  draggable
                  onDragStart={(e) => { if (resizingCol.current) { e.preventDefault(); return; } setDragCol(colId); }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragCol && dragCol !== colId) moveColumn(dragCol, colId); setDragCol(null); }}
                  onDragEnd={() => setDragCol(null)}
                  onClick={() => { if (def.sortField) setSort(nextSort(sort, def.sortField)); }}
                  className={`relative px-2 py-2 select-none overflow-hidden ${dragCol === colId ? "opacity-50" : ""} ${def.sortField ? "cursor-pointer hover:text-white" : ""}`}
                  title={`${def.label}${def.sortField ? " · click to sort" : ""} · drag to reorder · drag the right edge to resize`}
                >
                  <span className="inline-flex items-center text-xs uppercase font-semibold max-w-full">
                    <span className="truncate">{def.label}</span>
                  </span>
                  {/* The grip and the resize edge are both pinned to the inside of the header rather
                      than sitting in the flow: a column's width should be decided by the data in it,
                      not by the size of the two controls that happen to live in its header. */}
                  <GripVertical size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 cursor-grab pointer-events-none" />
                  {/* Pointerdown stops here so a drag never reorders or sorts the column. */}
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${def.label}`}
                    onPointerDown={(e) => startColumnResize(e, colId)}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => { e.stopPropagation(); resetColumnWidth(colId); }}
                    title="Drag to resize · double-click to reset"
                    className="absolute right-0 inset-y-0 w-1.5 cursor-col-resize hover:bg-cyber-500/60"
                  />
                </th>
              );
            })}
          </tr></thead>
            <tbody>{paged.map((t:any)=>(<tr key={t.id} tabIndex={0}
              onContextMenu={(e) => menu.open(e, ticketMenuEntries(t), ticketMenuHeader(t))}
              onKeyDown={(e) => menu.onKeyDown(e, e.currentTarget, ticketMenuEntries(t), ticketMenuHeader(t))}
              className={`border-b border-surface-border/50 hover:bg-surface-light/50 focus:outline-none focus:bg-surface-lighter/40 ${selectedIds.has(t.id) ? "bg-cyber-600/10" : ""}`}>
              <td className="px-2 py-2"><button onClick={() => toggleSelect(t.id)} className="text-gray-500 hover:text-white" aria-label={selectedIds.has(t.id) ? `Deselect ticket ${t.ticketNumber ?? ""}`.trim() : `Select ticket ${t.ticketNumber ?? ""}`.trim()}>{selectedIds.has(t.id) ? <CheckSquare size={14} className="text-cyber-400"/> : <Square size={14}/>}</button></td>
              <td className="px-2 py-2">
                <TicketActionMenu ticketId={t.id} currentStatus={t.status} currentPriority={t.priority} onAction={ticketAction} />
              </td>
              {visibleColumns.map((colId) => renderTicketCell(t, colId))}
            </tr>))}</tbody></table></div>)}
      </div>

      {/* ── List footer: Show All + pagination ── */}
      {!loading && tickets.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            {(statusParam || priorityParam || assignedParam || dateFromParam || dateToParam) && (
              <button
                onClick={() => setSearchParams(boardId ? { boardId } : {})}
                className="text-xs text-cyber-400 hover:text-cyber-300 hover:underline transition-colors"
                title="Show all tickets on this board"
              >
                Show All
              </button>
            )}
            <span className="text-xs text-gray-600">{sortedTickets.length} ticket{sortedTickets.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span>Show</span>
              <select
                className="input-field text-xs py-1 w-auto"
                value={String(pageSize)}
                onChange={e => { const v = e.target.value; setPage(1); setPageSize(v === "all" ? "all" : Number(v)); }}
              >
                {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                <option value="all">All</option>
              </select>
              <span>per page</span>
            </div>
            {pageSize !== "all" && totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(1)} disabled={safePage === 1} className="p-1 rounded text-gray-500 hover:text-white hover:bg-surface-lighter disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="First page"><ChevronsLeft size={14} /></button>
                <button onClick={() => setPage(safePage - 1)} disabled={safePage === 1} className="p-1 rounded text-gray-500 hover:text-white hover:bg-surface-lighter disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Previous page"><ChevronLeft size={14} /></button>
                {pageWindow(safePage, totalPages).map((p, i) => p === "gap"
                  ? <span key={`gap-${i}`} className="px-1 text-gray-600 text-xs">…</span>
                  : <button key={p} onClick={() => setPage(p)} className={`min-w-[26px] h-6 px-1.5 rounded text-xs transition-colors ${p === safePage ? "bg-cyber-600/30 text-cyber-300 font-semibold" : "text-gray-400 hover:text-white hover:bg-surface-lighter"}`}>{p}</button>
                )}
                <button onClick={() => setPage(safePage + 1)} disabled={safePage === totalPages} className="p-1 rounded text-gray-500 hover:text-white hover:bg-surface-lighter disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Next page"><ChevronRight size={14} /></button>
                <button onClick={() => setPage(totalPages)} disabled={safePage === totalPages} className="p-1 rounded text-gray-500 hover:text-white hover:bg-surface-lighter disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Last page"><ChevronsRight size={14} /></button>
              </div>
            )}
          </div>
        </div>
      )}

      {showColumnModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowColumnModal(false)}>
          <div className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Choose Columns</h3>
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {TICKET_COLUMNS.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer py-1">
                  <input type="checkbox" checked={visibleColumns.includes(c.id)} onChange={() => toggleColumn(c.id)} className="accent-cyber-500" />
                  {c.label}
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-3">Columns are sized to their content automatically. Drag a header's right edge to set your own width and double-click it to go back to the measured one; drag a header to reorder. Visibility, order and widths are saved per user.</p>
            <div className="flex items-center justify-between mt-4">
              <button
                className="text-xs text-gray-500 hover:text-white transition-colors"
                onClick={clearColumnWidths}
                disabled={Object.keys(columnWidths).length === 0}
                title="Forget every width you have set and fit the columns to their content again"
              >
                Fit columns to content
              </button>
              <button className="btn-primary text-sm px-3 py-1.5" onClick={() => setShowColumnModal(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Individual ticket "Quick Actions" dropdown menu (portal + fixed at far left so it never clips) ──
function TicketActionMenu({ ticketId, currentStatus, currentPriority, onAction }: {
  ticketId: string; currentStatus: string; currentPriority: string;
  onAction: (id: string, action: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: Math.min(r.bottom + 4, window.innerHeight - 420) });
    }
    setOpen(o => !o);
  };
  return (
    <div className="relative">
      <button ref={btnRef} onClick={toggle} className="text-gray-500 hover:text-white p-1 rounded" title="Quick Actions">
        <ChevronDown size={14} />
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed z-50 py-1 w-max grid bg-navy-800 border border-surface-border rounded-lg shadow-xl" style={{ top: pos?.top ?? 0, left: 8 }}>
            <div className="px-3 py-1.5 text-[10px] text-gray-600 uppercase font-semibold">Quick Actions</div>
            {currentStatus !== "in_progress" && (
              <button onClick={() => { onAction(ticketId, "acknowledge"); setOpen(false); }} className="text-left whitespace-nowrap px-4 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white">Acknowledge</button>
            )}
            {currentStatus !== "closed" && (
              <button onClick={() => { onAction(ticketId, "close"); setOpen(false); }} className="text-left whitespace-nowrap px-4 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white">Close</button>
            )}
            <div className="border-t border-surface-border my-1" />
            {TICKET_STATUSES.filter(s => s !== currentStatus && s !== "closed" && s !== "cancelled").slice(0,5).map(s => (
              <button key={s} onClick={() => { onAction(ticketId, `status_${s}`); setOpen(false); }} className="text-left whitespace-nowrap px-4 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white">Set Status → {s.replace(/_/g, " ")}</button>
            ))}
            <div className="border-t border-surface-border my-1" />
            {TICKET_PRIORITIES.filter(p => p !== currentPriority).map(p => (
              <button key={p} onClick={() => { onAction(ticketId, `priority_${p}`); setOpen(false); }} className="text-left whitespace-nowrap px-4 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white">Priority → {p}</button>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

export function TicketDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const menu = useContextMenu();
  const { user: currentUser, permissions: myPermissions } = useAuth();
  const [ticket, setTicket] = useState<Record<string,unknown>|null>(null);
  // ── The client's other open work ──
  // Read while the ticket is open rather than from a tab: a request is rarely the only thing a
  // client has in flight, and the ticket that explains this one is often already open beside it.
  const [clientTickets, setClientTickets] = useState<Array<{ id: string; ticketNumber: string; title: string; status: string; updatedAt?: string }>>([]);
  /*
   * The composer's own state. A note, a reply and a time entry are the same act of recording what
   * you did, so they share one box: the mode decides whether the text is emailed and whether the
   * internal flag is on, and the hours decide whether a time entry is written with it.
   */
  const [composerMode, setComposerMode] = useState<"note" | "reply" | "time">("note");
  const [composerHours, setComposerHours] = useState("0.25");
  const [composerWorkType, setComposerWorkType] = useState("Remote");
  const [composerRole, setComposerRole] = useState("Technician");
  const [composerBillable, setComposerBillable] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string,string>>({});
  const [saving, setSaving] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteInternal, setNoteInternal] = useState(false);
  const [posting, setPosting] = useState(false);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
    const [focusNoteRequested, setFocusNoteRequested] = useState(false);
  const [showTimeEntry, setShowTimeEntry] = useState(false);
  const [timeForm, setTimeForm] = useState({
    date: "", startTime: "", endTime: "", calculated: "",
    description: "", internalNotes: "", workType: "", workRole: "",
    rate: "", billing: "billable" as "billable" | "nonBillable" | "noCharge", userId: "",
  });
  const [companies, setCompanies] = useState<Array<{id:string;name:string}>>([]);
  const [contacts, setContacts] = useState<RecipientSuggestion[]>([]);
  const [agreements, setAgreements] = useState<Array<{id:string;name:string;billingPeriod:string;billingAmount:number}>>([]);
  const [selectedAgreement, setSelectedAgreement] = useState<Record<string,unknown>|null>(null);
  const [users, setUsers] = useState<Array<{id:string;firstName:string;lastName:string}>>([]);
  const [allBoards, setAllBoards] = useState<Array<{id:string;name:string}>>([]);

  // ── Friendly display for machine-generated change-log comments ──
  // Legacy change comments contain raw UUIDs, ISO dates, and enum codes like
  // "Board: 81f12ded-... → 9e4422d8-..." or "Due Date: 2026-08-13T06:04 → ...".
  // Resolve them to friendly names using loaded lookups + ticket relations.
  const friendlyActivityBody = (body: string): string => {
    if (!body) return "";
    // Only transform machine-generated change-log lines ("Label: old → new")
    if (!/^[A-Z][A-Za-z ]+: .+ → .+/m.test(body)) return body;

    const uuidMap: Record<string, string> = {};
    for (const b of allBoards) uuidMap[b.id] = b.name;
    for (const u of users) uuidMap[u.id] = `${u.firstName||""} ${u.lastName||""}`.trim();
    for (const c of companies) uuidMap[c.id] = c.name;
    for (const c of contacts) uuidMap[c.id] = `${c.firstName||""} ${c.lastName||""}`.trim();
    for (const a of agreements) uuidMap[a.id] = a.name;
    const t = ticket as any;
    if (t?.board?.id && t?.board?.name) uuidMap[t.board.id] = t.board.name;
    if (t?.company?.id && t?.company?.name) uuidMap[t.company.id] = t.company.name;
    if (t?.assignedTo?.id) uuidMap[t.assignedTo.id] = `${t.assignedTo.firstName||""} ${t.assignedTo.lastName||""}`.trim();
    if (t?.contact?.id) uuidMap[t.contact.id] = `${t.contact.firstName||""} ${t.contact.lastName||""}`.trim();
    if (t?.serviceAgreement?.id && t?.serviceAgreement?.name) uuidMap[t.serviceAgreement.id] = t.serviceAgreement.name;

    return body
      // ISO timestamps → "Aug 13, 2026, 6:04 AM"
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?/g, m => {
        const d = new Date(m);
        return isNaN(d.getTime()) ? m : d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      })
      // UUIDs → resolved friendly names
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, m => uuidMap[m] || m)
      // snake_case enums → Title Case
      .replace(/\b(in_progress|waiting_on_client|on_hold|pending_approval)\b/g, m => m.split("_").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "));
  };

  // ── Tabbed toolbar state ──
  const [activeTab, setActiveTab] = useState("ticket");
  const redesign = useRedesign();
  const contextPane = useContextPane();
  // Which sub-tab of each group was last used, so clicking back into a group returns you to the
  // panel you were on rather than resetting you to its first one.
  const [tabByGroup, setTabByGroup] = useState<Record<string, string>>({});
  const activeGroup = TICKET_TAB_GROUPS.find(g => g.tabs.includes(activeTab)) ?? TICKET_TAB_GROUPS[0];
  const pickGroup = (group: (typeof TICKET_TAB_GROUPS)[number]) => setActiveTab(tabByGroup[group.id] ?? group.tabs[0]);
  const pickTab = (tabId: string) => setActiveTab(tabId);
  useEffect(() => {
    const group = TICKET_TAB_GROUPS.find(g => g.tabs.includes(activeTab));
    if (group) setTabByGroup(prev => (prev[group.id] === activeTab ? prev : { ...prev, [group.id]: activeTab }));
  }, [activeTab]);
  useEffect(() => {
    const companyId = ticket?.companyId as string | undefined;
    if (!companyId) { setClientTickets([]); return; }
    let cancelled = false;
    api.get(`/tickets?companyId=${companyId}&limit=10`)
      .then(r => { if (!cancelled) setClientTickets(r.data.data || []); })
      .catch(() => { if (!cancelled) setClientTickets([]); });
    return () => { cancelled = true; };
  }, [ticket?.companyId]);
  const [cf, setCf] = useState<Record<string, any>>({});
  const [expenses, setExpenses] = useState<any[]>([]);
  const canManageBilling = myPermissions.includes(Permission.BillingManage);
  const canSearchCatalog = myPermissions.includes(Permission.ProductView);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [schedEntries, setSchedEntries] = useState<any[]>([]);
  const [auditEntries, setAuditEntries] = useState<any[]>([]);
  const [assetResults, setAssetResults] = useState<any[]>([]);
  const [kumoConfigResults, setKumoConfigResults] = useState<any[]>([]);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [configDialogQuery, setConfigDialogQuery] = useState("");
  const [incomingLinks, setIncomingLinks] = useState<any[]>([]);
  const [showProductDialog, setShowProductDialog] = useState(false);
  const [productForm, setProductForm] = useState<{ name: string; qty: number; unitCost: number; sku?: string | null; productId?: string | null }>({ name: "", qty: 1, unitCost: 0 });
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkResults, setLinkResults] = useState<any[]>([]);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkRel, setLinkRel] = useState("related");
  const [showExpenseDialog, setShowExpenseDialog] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ description: "", amount: "", category: "other", vendor: "", miles: "", expenseDate: "" });
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ title: "", startTime: "", endTime: "", location: "", description: "", userId: "" });
  const [schedulePurpose, setSchedulePurpose] = useState<"schedule" | "follow-up">("schedule");
  const [showAttachDialog, setShowAttachDialog] = useState(false);
  const [attachForm, setAttachForm] = useState<{ file: File | null }>({ file: null });
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [emailForm, setEmailForm] = useState({ subject: "", body: "", html: "" });
  const [emailAttachments, setEmailAttachments] = useState<EmailAttachmentDraft[]>([]);
  const [emailTo, setEmailTo] = useState<Recipient[]>([]);
  const [emailCc, setEmailCc] = useState<Recipient[]>([]);
  const [emailBcc, setEmailBcc] = useState<Recipient[]>([]);
  const [showBcc, setShowBcc] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [offOrgPrompt, setOffOrgPrompt] = useState<{ kind: "email" | "note"; addresses: string[]; companies: string[] } | null>(null);
  // The note composer emails the note to the ticket's people; this records the boxes the author
  // changed for the note being written (keyed by email), plus any Cc added on the fly.
  const [noteOverrides, setNoteOverrides] = useState<Record<string, boolean>>({});
  const [noteCc, setNoteCc] = useState<Recipient[]>([]);
  const [noteRecipientsOpen, setNoteRecipientsOpen] = useState(false);
  const [attachingEmailFiles, setAttachingEmailFiles] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showMoreActions, setShowMoreActions] = useState(false);  const [moreActionsBusy, setMoreActionsBusy] = useState(false);
  const [tabRefresh, setTabRefresh] = useState(0);

  const cfArr = (key: string): any[] => Array.isArray(cf[key]) ? cf[key] : [];
  const persistCF = async (key: string, value: any[]) => {
    const next = { ...cf, [key]: value };
    setCf(next);
    try { await api.patch(`/tickets/${id}`, { customFields: next }); }
    catch { toast.error("Save failed"); }
  };
  const uuidish = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const loadExpenses = async () => {
    try {
      const r = await api.get(`/tickets/${id}/expenses`);
      setExpenses(r.data?.data || []);
    } catch { /* the tab shows what it has */ }
  };

  const expenseDecision = async (expenseId: string, decision: "approve" | "reject", note?: string) => {
    try {
      await api.post(`/billing/expenses/${expenseId}/${decision}`, decision === "reject" ? { note } : {});
      toast.success(decision === "approve" ? "Expense approved" : "Expense rejected");
      await loadExpenses();
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, "Failed"));
    }
  };

  useEffect(() => {
    if (activeTab === "expenses" || activeTab === "finance") void loadExpenses();
    if (activeTab === "schedule") api.get("/schedule?limit=200").then(r => setSchedEntries((Array.isArray(r.data) ? r.data : (r.data?.data || [])).filter((e: any) => e.ticketId === id))).catch(() => {});
    if (activeTab === "audittrail") api.get(`/system/audit-logs?entity=tickets&entityId=${encodeURIComponent(id ?? "")}`).then(r => setAuditEntries(r.data?.data || [])).catch(() => {});
    if (activeTab === "configurations") { api.get("/kumo/assets?limit=50").then(r => setAssetResults(r.data?.data || r.data || [])).catch(() => {}); api.get("/kumo/configs/servers").then(r => setKumoConfigResults(r.data?.data || r.data || [])).catch(() => {}); }
    if (activeTab === "links") { api.get("/tickets?limit=200").then(r => { const all = r.data?.data || []; setIncomingLinks(all.filter((t: any) => t.id !== id && Array.isArray(t.customFields?.ticketLinks) && t.customFields.ticketLinks.some((l: any) => l.ticketId === id)).map((t: any) => ({ ticketId: t.id, ticketNumber: t.ticketNumber, title: t.title }))); }).catch(() => {}); }
  }, [activeTab, id, tabRefresh]);

  useEffect(() => {
    if (activeTab === "ticket" && focusNoteRequested) {
      noteInputRef.current?.focus();
      setFocusNoteRequested(false);
    }
  }, [activeTab, focusNoteRequested]);

  const load = () => {
    if(!id) return;
    api.get(`/tickets/${id}`).then(r=>{
      const t = r.data;
      setTicket(t);
      setCf(t.customFields && typeof t.customFields === "object" && !Array.isArray(t.customFields) ? t.customFields : {});
      setEditForm({
        title: t.title||"", description: t.description||"", status: t.status||"new", priority: t.priority||"medium",
        dueDate: t.dueDate?new Date(t.dueDate).toISOString().slice(0,16):"",
        startTime: t.startTime?new Date(t.startTime).toISOString().slice(0,16):"",
        endTime: t.endTime?new Date(t.endTime).toISOString().slice(0,16):"",
        companyId: t.companyId||"", contactId: t.contactId||"", assignedToId: t.assignedToId||"",
        serviceAgreementId: t.serviceAgreementId||"", boardId: t.boardId||"",
      });
      setSelectedAgreement(t.serviceAgreement||null);
      if(t.companyId){api.get(`/clients/contacts?companyId=${t.companyId}`).then(r=>setContacts(r.data?.data||r.data||[])).catch(()=>{});api.get(`/clients/${t.companyId}/agreements`).then(r=>setAgreements(r.data?.data||r.data||[])).catch(()=>{});}
    }).catch(()=>toast.error("Ticket not found"));
  };

  useEffect(()=>{load();api.get("/clients?limit=100").then(r=>setCompanies(r.data?.data||r.data||[])).catch(()=>{});api.get("/users?limit=100").then(r=>setUsers(r.data?.data||r.data||[])).catch(()=>{});api.get("/boards").then(r=>setAllBoards(Array.isArray(r.data)?r.data:(r.data?.data||r.data||[]))).catch(()=>{});},[id]);

  const handleCompanyChange = (cId: string) => {
    setEditForm(prev=>({...prev,companyId:cId,contactId:""}));
    if(cId){api.get(`/clients/contacts?companyId=${cId}`).then(r=>setContacts(r.data?.data||r.data||[])).catch(()=>{});api.get(`/clients/${cId}/agreements`).then(r=>setAgreements(r.data?.data||r.data||[])).catch(()=>{});}
    else{setContacts([]);setAgreements([]);}
  };

  const handleSave = async () => {
    setSaving(true);
    try{await api.patch(`/tickets/${id}`,editForm);setEditing(false);load();toast.success("Saved");}
    catch{toast.error("Save failed");}
    finally{setSaving(false);}
  };

  const handlePostNote = async (e?: React.FormEvent, options: { confirmedOffOrg?: boolean } = {}) => {
    if(e)e.preventDefault();
    if(!noteText.trim())return;
    const internal = noteInternal;
    // Same warning as the email dialog: outside addresses are allowed, not silent.
    if(!internal && !options.confirmedOffOrg){
      const outside = offOrgIn(noteTo, noteCc);
      if(outside.length){ setOffOrgPrompt({ kind:"note", addresses: outside, companies: [] }); return; }
    }
    setPosting(true);
    try{
      // The primary contact is ticked by default; anything added in the Cc field is
      // emailed with the note and saved onto the ticket.
      const { recipients, includePrimary } = recipientPayload(noteTo, noteCc);
      await api.post(`/tickets/${id}/comments`,{
        body:noteText,
        isInternal:internal,
        recipients,
        includePrimary,
        saveRecipients: true,
      });
      setNoteText("");setNoteInternal(false);setNoteOverrides({});setNoteCc([]);setNoteRecipientsOpen(false);
      load();
      const wentTo = internal ? 0 : new Set([...noteTo, ...noteCc].map(r => r.email.toLowerCase())).size;
      toast.success(internal ? "Internal note posted" : wentTo > 1 ? `Note posted and emailed to ${wentTo} people` : "Note posted");
    }
    catch{toast.error("Failed");}
    finally{setPosting(false);}
  };

  // Notes keep correspondence and hand-written context; Activity keeps logged time and the
  // automatic field-change records, merged newest-first.
  const ticketComments = ((ticket?.comments as any[]) || []);
  const ticketTimeEntries = ((ticket?.timeEntries as any[]) || []);
  const noteEntries = ticketComments.filter((c: any) => !isSystemActivity(c.body ?? c.content));
  const activityEntries: any[] = [
    ...ticketComments.filter((c: any) => isSystemActivity(c.body ?? c.content)).map((c: any) => ({
      id: c.id, kind: "change", body: c.body ?? c.content, at: c.createdAt,
      userName: (c.author?.firstName || c.author?.lastName) ? `${c.author.firstName||""} ${c.author.lastName||""}`.trim() : (c.fromEmail || "System"),
    })),
    ...ticketTimeEntries.map((te: any) => ({
      ...te, kind: "time", at: te.date || te.createdAt,
      userName: (te.user?.firstName || te.user?.lastName) ? `${te.user.firstName||""} ${te.user.lastName||""}`.trim() : "System",
    })),
  ].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));

  const timeMinutes = () => {
    if (!timeForm.startTime || !timeForm.endTime) return 0;
    const mins = Math.round((new Date(timeForm.endTime).getTime() - new Date(timeForm.startTime).getTime()) / 60000);
    return mins > 0 ? mins : 0;
  };
  const formatDuration = (mins: number) => (mins > 0 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : "");

  const resetTimeForm = () => setTimeForm({
    date: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10),
    startTime: "", endTime: "", calculated: "",
    description: "", internalNotes: "", workType: "", workRole: "",
    rate: "", billing: "billable", userId: currentUser?.id || "",
  });

  const openTimeEntryModal = () => {
    resetTimeForm();
    setShowTimeEntry(true);
  };

  const handleTimeEntry = async (e: React.FormEvent): Promise<boolean> => {
    e.preventDefault();
    const mins = timeMinutes();
    try {
      await api.post(`/tickets/${id}/time`, {
        date: timeForm.date || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10),
        startTime: timeForm.startTime || undefined,
        endTime: timeForm.endTime || undefined,
        description: timeForm.description,
        internalNotes: timeForm.internalNotes || undefined,
        workType: timeForm.workType || undefined,
        workRole: timeForm.workRole || undefined,
        rate: timeForm.rate ? Number(timeForm.rate) : undefined,
        billable: timeForm.billing !== "nonBillable",
        noCharge: timeForm.billing === "noCharge",
        minutes: mins || undefined,
        userId: timeForm.userId || undefined,
      });
      toast.success("Time logged"); setShowTimeEntry(false);
      resetTimeForm();
      load();
      return true;
    } catch { toast.error("Failed to log time"); return false; }
  };

  const updateTimeForm = (field: "startTime" | "endTime", value: string) => {
    const next = { ...timeForm, [field]: value };
    const start = field === "startTime" ? value : next.startTime;
    const end = field === "endTime" ? value : next.endTime;
    next.calculated = start && end
      ? formatDuration(Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000))
      : "";
    setTimeForm(next);
  };

  const refreshDetails = () => {
    load();
    setTabRefresh((value) => value + 1);
  };

  const openEmailDialog = () => {
    if (!ticket) return;
    const contact = ticket.contact as any;
    if (!contact?.email) { toast.error("This ticket has no contact email address"); return; }
    setEmailForm({ subject: `Re: ${ticket.ticketNumber || id} — ${ticket.title || ""}`, body: "", html: "" });
    setEmailAttachments([]);
    setEmailTo([recipientFromContact(contact)]);
    setEmailCc([]);
    setEmailBcc([]);
    setShowBcc(false);
    setShowEmailDialog(true);
  };

  /** The ticket's own contacts, as addressable people. */
  const ticketContactRecipients = (): Recipient[] => {
    const primary = ticket?.contact as any;
    const extra = ((ticket?.additionalContacts as any[]) || []).map((link: any) => ({
      ...recipientFromContact(link.contact),
      role: String(link.role || "cc"),
    }));
    return [...(primary?.email ? [recipientFromContact(primary)] : []), ...extra];
  };

  /** Client contacts offered in the address fields. */
  const contactSuggestions: RecipientSuggestion[] = contacts;

  /**
   * The organisation a ticket's recipients must belong to. Suggestions and name
   * matching are limited to it so a same-named contact at another client cannot
   * be picked by mistake; anything outside it warns but is still allowed.
   */
  const orgName = (ticket?.company as { name?: string })?.name;
  const orgEmails = contactSuggestions.map((c) => c.email);

  /** Contacts on the ticket who are emailed automatically, for the composer hints. */
  const autoEmailContacts = (): Array<{ name: string; email: string; role: string }> =>
    ((ticket?.additionalContacts as any[]) || [])
      .filter((link: any) => link.contact?.email && (link.role === "cc" || link.notifyOnNote))
      .map((link: any) => ({
        name: [link.contact.firstName, link.contact.lastName].filter(Boolean).join(" ").trim() || link.contact.email,
        email: String(link.contact.email).toLowerCase(),
        role: String(link.role || "cc"),
      }));

  const autoRecipientHint = (() => {
    const people = autoEmailContacts();
    if (!people.length) return undefined;
    const names = people.map((p) => p.name).join(", ");
    return `${names} also receive${people.length === 1 ? "s" : ""} this automatically.`;
  })();

  /** Everyone on the ticket, as note recipients — the primary first, then the rest. */
  const noteRecipientPool = ticketContactRecipients();
  /** Whether this person receives the note: their role decides it, unless the author changed it here. */
  const noteRecipientChecked = (recipient: Recipient): boolean => {
    const override = noteOverrides[recipient.email.toLowerCase()];
    if (override !== undefined) return override;
    const primaryId = (ticket?.contact as any)?.id;
    if (!recipient.contactId || recipient.contactId === primaryId) return true;
    const link = ((ticket?.additionalContacts as any[]) || []).find((l: any) => l.contact?.id === recipient.contactId);
    return link ? link.role === "cc" || Boolean(link.notifyOnNote) : true;
  };
  const noteTo = noteRecipientPool.filter(noteRecipientChecked);
  const toggleNoteRecipient = (recipient: Recipient) => {
    const email = recipient.email.toLowerCase();
    setNoteOverrides((prev) => ({ ...prev, [email]: !noteRecipientChecked(recipient) }));
  };

  /** Ticket contacts offered as one-click CCs — anyone not already addressed or covered automatically. */
  const quickCcContacts = ticketContactRecipients().filter((r) => {
    const email = r.email.toLowerCase();
    const primaryId = (ticket?.contact as any)?.id;
    if (r.contactId && r.contactId === primaryId) return false;
    if (autoEmailContacts().some((p) => p.email === email)) return false;
    if (emailCc.some((c) => c.email.toLowerCase() === email)) return false;
    return !emailTo.some((t) => t.email.toLowerCase() === email);
  });

  /** Turn picked recipients into the payload the API expects. */
  const recipientPayload = (to: Recipient[], cc: Recipient[]) => {
    const primaryId = (ticket?.contact as any)?.id as string | undefined;
    return {
      recipients: {
        // The primary contact travels as a flag, not an id, so it is never re-linked to the ticket.
        contactIds: to.filter((r) => r.contactId && r.contactId !== primaryId).map((r) => r.contactId),
        emails: to.filter((r) => !r.contactId).map((r) => r.email),
        ccContactIds: cc.filter((r) => r.contactId).map((r) => r.contactId),
        ccEmails: cc.filter((r) => !r.contactId).map((r) => r.email),
      },
      includePrimary: to.some((r) => r.contactId === primaryId),
      extraTo: to.filter((r) => !r.contactId).map((r) => r.email),
      extraCc: cc.filter((r) => !r.contactId).map((r) => r.email),
    };
  };

  /** Address row shared by the email dialog and the note composer. */
  const renderRecipientField = (
    label: string,
    value: Recipient[],
    onChange: (next: Recipient[]) => void,
    options: { placeholder?: string; hint?: React.ReactNode; action?: React.ReactNode; exclude?: string[] } = {},
  ) => (
    <RecipientField
      label={label}
      value={value}
      onChange={onChange}
      suggestions={contactSuggestions}
      placeholder={options.placeholder}
      hint={options.hint}
      action={options.action}
      excludeEmails={options.exclude}
      orgName={orgName}
      orgEmails={orgEmails}
    />
  );

  /** Addresses outside the ticket's organisation, for the pre-send check. */
  const offOrgIn = (...lists: Recipient[][]): string[] => offOrgRecipients(lists.flat(), orgEmails);

  /** Extra people on the ticket, added from the Contacts card or while writing a note. */
  const addTicketContactLink = async (person: Recipient) => {
    try {
      await api.post(`/tickets/${id}/contacts`, person.contactId
        ? { contactId: person.contactId, role: "additional" }
        : { email: person.email, firstName: person.name, role: "additional" });
      toast.success(`${person.name || person.email} added to the ticket`);
      load();
    } catch (error: any) {
      toast.error(apiErrorMessage(error, "Could not add that contact"));
    }
  };

  const updateTicketContactLink = async (contactId: string, mode: string) => {
    const patch = mode === "cc"
      ? { role: "cc", notifyOnNote: true }
      : mode === "notes"
        ? { role: "additional", notifyOnNote: true }
        : { role: "additional", notifyOnNote: false };
    try {
      await api.patch(`/tickets/${id}/contacts/${contactId}`, patch);
      load();
    } catch {
      toast.error("Could not update that contact");
    }
  };

  const removeTicketContactLink = async (contactId: string) => {
    try {
      await api.delete(`/tickets/${id}/contacts/${contactId}`);
      toast.success("Contact removed from the ticket");
      load();
    } catch {
      toast.error("Could not remove that contact");
    }
  };

  const attachEmailFiles = async (files: File[]) => {
    if (!files.length) return;
    setAttachingEmailFiles(true);
    try {
      const drafts = await Promise.all(files.map(toAttachmentDraft));
      setEmailAttachments(prev => [...prev, ...drafts]);
      toast.success(`${drafts.length} file${drafts.length === 1 ? "" : "s"} attached`);
    } catch (error: any) {
      toast.error(error?.message || "Could not attach that file");
    } finally {
      setAttachingEmailFiles(false);
    }
  };

  const sendContactEmail = async (e: React.FormEvent, options: { confirmedOffOrg?: boolean } = {}) => {
    e.preventDefault();
    if (!emailForm.subject.trim() || (!emailForm.body.trim() && !emailForm.html.trim())) {
      toast.error("Add a subject and a message");
      return;
    }
    // Warn once about anyone outside the ticket's organisation, then let it go.
    if (!options.confirmedOffOrg) {
      const outside = offOrgIn(emailTo, emailCc, emailBcc);
      if (outside.length) {
        setOffOrgPrompt({ kind: "email", addresses: outside, companies: [] });
        return;
      }
    }
    setSendingEmail(true);
    try {
      const { recipients, includePrimary } = recipientPayload(emailTo, emailCc);
      const response = await api.post(`/tickets/${id}/email`, {
        ...emailForm,
        attachments: emailAttachments,
        recipients,
        includePrimary,
        bcc: emailBcc.map((r) => r.email),
      });
      const count = Number(response.data?.attachments || 0);
      const copied = Number(response.data?.cc?.length || 0);
      toast.success(
        `Email sent${copied ? ` · ${copied} copied` : ""}${count ? ` with ${count} attachment${count === 1 ? "" : "s"}` : ""}`,
      );
      setShowEmailDialog(false);
      setEmailForm({ subject: "", body: "", html: "" });
      setEmailAttachments([]);
      setEmailTo([]);
      setEmailCc([]);
      setEmailBcc([]);
      load();
    } catch (error: unknown) {
      toast.error(apiErrorMessage(error, "Could not send email"));
    } finally {
      setSendingEmail(false);
    }
  };

  /** Continue after the "outside the organisation" warning. */
  const confirmOffOrgPrompt = () => {
    const pending = offOrgPrompt;
    setOffOrgPrompt(null);
    if (!pending) return;
    if (pending.kind === "email") {
      void sendContactEmail({ preventDefault() {} } as React.FormEvent, { confirmedOffOrg: true });
      return;
    }
    void handlePostNote(undefined, { confirmedOffOrg: true });
  };

  const openFollowUp = () => {
    if (!ticket) return;
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60_000);
    const contact = ticket.contact as any;
    const contactName = contact ? `${contact.firstName || ""} ${contact.lastName || ""}`.trim() : "the client";
    setSchedulePurpose("follow-up");
    setScheduleForm({
      title: `Follow-up: ${ticket.ticketNumber || id}`,
      startTime: toLocalDateTimeValue(start),
      endTime: toLocalDateTimeValue(end),
      location: "",
      description: `Follow up with ${contactName} regarding ${ticket.title || "this ticket"}.`,
      userId: String(ticket.assignedToId || ""),
    });
    setShowScheduleDialog(true);
  };

  const closeScheduleDialog = () => {
    setShowScheduleDialog(false);
    setSchedulePurpose("schedule");
    setScheduleForm({ title: "", startTime: "", endTime: "", location: "", description: "", userId: "" });
  };

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleForm.title || !scheduleForm.startTime || !scheduleForm.endTime) return;
    try {
      await api.post("/schedule", { ...scheduleForm, userId: scheduleForm.userId || undefined, ticketId: id });
      toast.success(schedulePurpose === "follow-up" ? "Follow-up scheduled" : "Scheduled");
      setShowScheduleDialog(false);
      setSchedulePurpose("schedule");
      setScheduleForm({ title: "", startTime: "", endTime: "", location: "", description: "", userId: "" });
      setTabRefresh((value) => value + 1);
    } catch (error: any) {
      toast.error(apiErrorMessage(error, "Could not create schedule entry"));
    }
  };

  /*
   * The composer's "Save and log": the text goes where its tab says it should, and the hours — if
   * there are any — become a time entry at the same time. The API takes minutes directly, so nothing
   * has to invent a start and an end to express "a quarter of an hour".
   */
  const logComposerTime = async (): Promise<boolean> => {
    const minutes = Math.round((Number(composerHours) || 0) * 60);
    if (minutes <= 0) return false;
    try {
      await api.post(`/tickets/${id}/time`, {
        date: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10),
        description: noteText.trim() || "Time logged from the ticket composer",
        workType: composerWorkType || undefined,
        workRole: composerRole || undefined,
        billable: composerBillable,
        minutes,
        userId: currentUser?.id,
      });
      return true;
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not log the time"));
      return false;
    }
  };

  const submitComposer = async (event: React.FormEvent) => {
    event.preventDefault();
    const minutes = Math.round((Number(composerHours) || 0) * 60);
    if (!noteText.trim() && minutes <= 0) {
      toast.error("Write something, or enter the hours you spent");
      return;
    }
    if (noteText.trim()) await handlePostNote(event);
    if (minutes > 0 && await logComposerTime()) {
      toast.success("Time logged");
      setComposerHours("0.25");
      setTabRefresh(value => value + 1);
      load();
    }
  };

  const applyTicketField = async (field: "status" | "priority", value: string) => {    setMoreActionsBusy(true);
    try {
      await api.patch(`/tickets/${id}`, { [field]: value });
      toast.success(`${field === "status" ? "Status" : "Priority"} updated`);
      setShowMoreActions(false);
      load();
    } catch (error: any) {
      toast.error(apiErrorMessage(error, `Could not update ${field}`));
    } finally {
      setMoreActionsBusy(false);
    }
  };

  const copyTicketLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Ticket link copied");
    } catch {
      toast.error("Could not copy ticket link");
    }
    setShowMoreActions(false);
  };

  // ── Right-click menu: this ticket ──
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const assignTicketTo = async (userId: string | null) => {
    try {
      await api.patch(`/tickets/${id}`, { assignedToId: userId });
      toast.success(userId ? "Assigned" : "Unassigned");
      load();
    } catch (error: any) { toast.error(apiErrorMessage(error, "Could not assign")); }
  };

  const confirmDeleteTicket = async () => {
    setDeleting(true);
    try {
      await api.delete(`/tickets/${id}`);
      toast.success("Ticket deleted");
      navigate("/tickets");
    } catch (error: any) {
      toast.error(apiErrorMessage(error, "Could not delete ticket"));
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  const detailMenuHeader = () => {
    const current = ticket as Record<string, any> | null;
    return {
      title: `${current?.ticketNumber ?? "Ticket"} · ${current?.title || "Untitled ticket"}`,
      subtitle: [
        (current?.company as { name?: string } | null)?.name,
        String(current?.status ?? "").replace(/_/g, " "),
        priorityLabel(String(current?.priority ?? "")),
        current?.assignedTo ? `${(current.assignedTo as { firstName?: string }).firstName ?? ""} ${(current.assignedTo as { lastName?: string }).lastName ?? ""}`.trim() : "Unassigned",
      ].filter(Boolean).join(" · "),
    };
  };

  const detailMenuEntries = (): MenuEntry[] => {
    const current = ticket as Record<string, any> | null;
    if (!current) return [];
    const path = `/tickets/${id}`;
    return [
      { label: "Open in new tab", icon: SquareArrowOutUpRight, onSelect: () => openInNewTab(path) },
      { label: "Open in new window", icon: AppWindow, onSelect: () => openInNewWindow(path) },
      "separator",
      {
        label: "Change status", icon: CircleDot,
        items: TICKET_STATUSES.map(s => ({ label: s.replace(/_/g, " "), checked: current.status === s, disabled: moreActionsBusy, onSelect: () => void applyTicketField("status", s) })),
      },
      {
        label: "Change priority", icon: Flag,
        items: TICKET_PRIORITIES.map(p => ({ label: priorityLabel(p), checked: current.priority === p, disabled: moreActionsBusy, onSelect: () => void applyTicketField("priority", p) })),
      },
      {
        label: "Assign to", icon: UserCheck,
        items: [
          { label: "Unassigned", checked: !current.assignedToId, onSelect: () => void assignTicketTo(null) },
          ...users.map(u => ({ label: `${u.firstName} ${u.lastName}`.trim(), checked: current.assignedToId === u.id, onSelect: () => void assignTicketTo(u.id) })),
        ],
      },
      {
        label: "Assign to me", icon: UserCheck,
        disabled: !currentUser || current.assignedToId === currentUser.id,
        onSelect: () => currentUser && void assignTicketTo(currentUser.id),
      },
      "separator",
      { label: "Add note", icon: MessageSquare, onSelect: () => { setActiveTab("ticket"); setFocusNoteRequested(true); } },
      { label: "Log time entry", icon: Timer, onSelect: openTimeEntryModal },
      { label: "Email customer contact", icon: Mail, onSelect: openEmailDialog },
      { label: "Attach file…", icon: Paperclip, onSelect: () => setShowAttachDialog(true) },
      { label: "Print ticket", icon: Printer, hint: "Ctrl+P", onSelect: () => window.print() },
      "separator",
      { label: "Refresh", icon: RotateCw, onSelect: () => void load() },
      { label: "Copy ticket number", icon: Copy, hint: String(current.ticketNumber ?? ""), onSelect: () => void copyText(String(current.ticketNumber ?? ""), "Ticket number") },
      { label: "Copy link", icon: Link2, onSelect: () => void copyTicketLink() },
      "separator",
      { label: "Back to ticket list", icon: ChevronLeft, onSelect: () => navigate("/tickets") },
      { label: "Delete ticket…", icon: Trash2, danger: true, onSelect: () => setDeleteOpen(true) },
    ];
  };

  // Deep links from the list's right-click menu (?action=note|time|email|attach|print).
  useEffect(() => {
    const action = searchParams.get("action");
    if (!action || !ticket) return;
    if (action === "note") { setActiveTab("ticket"); setFocusNoteRequested(true); }
    else if (action === "time") openTimeEntryModal();
    else if (action === "email") openEmailDialog();
    else if (action === "attach") setShowAttachDialog(true);
    else if (action === "print") setTimeout(() => window.print(), 60);
    const next = new URLSearchParams(searchParams);
    next.delete("action");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, ticket]);

  const uploadAttachment = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = attachForm.file;
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Attachments are limited to 5 MB"); return; }
    setUploadingAttachment(true);
    try {
      const contentBase64 = await fileToBase64(file);
      await api.post(`/tickets/${id}/attachments`, { filename: file.name, mimeType: file.type, contentBase64 });
      toast.success("File attached");
      setShowAttachDialog(false);
      setAttachForm({ file: null });
      load();
    } catch (error: any) {
      toast.error(apiErrorMessage(error, "Could not attach file"));
    } finally {
      setUploadingAttachment(false);
    }
  };

  const downloadAttachment = async (attachment: any) => {
    try {
      const response = await api.get(`/tickets/${id}/attachments/${attachment.id}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast.error(apiErrorMessage(error, "Could not download file"));
    }
  };

  if(!ticket) return <PageSkeleton />;

  // ── The record header's facts ──
  const company = ticket.company as { name?: string; notes?: string | null; companyType?: string | null; serviceLevel?: string | null; openTickets?: number | null } | null;
  const companyName = company?.name || "";
  // The client's own brief, the same note the client record carries: the thing you need while
  // reading a ticket rather than the thing you go and look up.
  const companyBrief = (company?.notes || "").trim();
  const assigneeName = ticket.assignedTo ? `${(ticket.assignedTo as { firstName?: string; lastName?: string }).firstName || ""} ${(ticket.assignedTo as { firstName?: string; lastName?: string }).lastName || ""}`.trim() : "";
  const agreementName = (ticket.serviceAgreement as { name?: string } | null)?.name || "";
  const otherOpen = clientTickets.filter(t => t.id !== id && !["closed", "cancelled", "resolved"].includes(t.status));
  // What is behind each group of tabs, and the record's own list of facts. Both read the payload,
  // so both belong after the guard that says there is one.
  const tabCounts: Record<string, number> = {
    activity: ((ticket.comments as unknown[]) || []).length,
    work: ((ticket.timeEntries as unknown[]) || []).length,
    files: ((ticket.attachments as unknown[]) || []).length,
  };
  /*
   * The clock the board put on this ticket — its SLA resolution target, or the due date if the
   * instance set one of those instead. The chip reads the same either way: how long is left, or how
   * long ago it went.
   */
  const slaTargetRaw = (ticket.slaResolutionDue || ticket.dueDate) as string | null | undefined;
  const slaChip = (() => {
    if (!slaTargetRaw) return null;
    const diffMs = new Date(slaTargetRaw).getTime() - Date.now();
    const breached = diffMs < 0 || ticket.isOverdue === true;
    const minutes = Math.max(1, Math.round(Math.abs(diffMs) / 60000));
    const amount = minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
    const what = ticket.slaResolutionDue ? "SLA resolution" : "Due";
    return {
      tone: breached ? "chip--bad" : diffMs < 4 * 3600_000 ? "chip--warn" : "chip--good",
      label: breached ? `SLA breached · ${amount} ago` : `${amount} to SLA`,
      title: `${what} ${new Date(slaTargetRaw).toLocaleString()}`,
    };
  })();

  /*
   * The record, as the mockup lays it out: the ticket's facts in one list rather than scattered
   * through cards, because that is how they are read — top to bottom, while something else is going
   * on. The dates are part of it rather than a card of their own.
   */
  const recordRows: Array<[string, string]> = [
    ["Board", (ticket.board as { name?: string })?.name || "—"],
    ["Status", statusLabel(ticket.status as string)],
    ["Priority", priorityLabel(ticket.priority as string)],
    ["Assigned to", assigneeName || "Unassigned"],
    ["Contact", ticket.contact ? `${(ticket.contact as { firstName?: string }).firstName || ""} ${(ticket.contact as { lastName?: string }).lastName || ""}`.trim() || "—" : "—"],
    ["Source", String(ticket.source || "—").replace(/_/g, " ")],
    ["Category", (ticket.category as { name?: string } | null)?.name || "—"],
    ["Opened", ticket.createdAt ? new Date(ticket.createdAt as string).toLocaleDateString() : "—"],
    ["Updated", ticket.updatedAt ? new Date(ticket.updatedAt as string).toLocaleDateString() : "—"],
    [ticket.slaResolutionDue ? "Target" : "Due", slaTargetRaw ? new Date(slaTargetRaw).toLocaleDateString() : "—"],
  ];

  return (
    <div
      className={redesign ? "space-y-4 animate-fade-in" : "space-y-6 animate-fade-in max-w-4xl"}
      onContextMenu={(e) => { if (isTextEntryTarget(e.target)) return; menu.open(e, detailMenuEntries(), detailMenuHeader()); }}
    >
      <ContextMenu state={menu.menuState} onClose={menu.close} />
      <DeleteTicketDialog target={deleteOpen ? { ticketNumber: String(ticket?.ticketNumber ?? ""), title: String(ticket?.title ?? "") } : null} busy={deleting} onCancel={() => setDeleteOpen(false)} onConfirm={confirmDeleteTicket} />
      {/* ── The record header ──
          Redesigned: where it sits, what it is, and then the states *themselves* as pills you press.
          Every pill writes through the route the Edit form uses, so a status change is a click
          rather than a dialog with a form and a save — and there is still one place that writes. */}
      {redesign ? (
        <div className="space-y-2">
          <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
            <Link to="/tickets" className="text-xs text-gray-500 hover:text-white">Tickets</Link>
            <ChevronRight size={12} className="text-gray-600" />
            <span className="text-xs font-mono text-gray-400">{(ticket.ticketNumber as string) || `#${id}`}</span>
            <span className="text-xs text-gray-600">·</span>
            <span className="text-xs text-gray-500">{(ticket.board as {name?:string})?.name || "No board"}</span>
            {companyName ? (<>
              <span className="text-xs text-gray-600">·</span>
              <span className="text-xs text-gray-500 truncate max-w-[18rem]">{companyName}</span>
            </>) : null}
            <div className="ml-auto flex items-center gap-2">
              <button onClick={copyTicketLink} className="btn-secondary text-xs flex items-center gap-1.5"><Link2 size={13} /> Copy link</button>
              {(ticket.status as string) !== "in_progress" && (ticket.status as string) !== "closed" && (
                <button onClick={() => void applyTicketField("status", "in_progress")} disabled={moreActionsBusy} className="btn-primary text-xs">
                  {moreActionsBusy ? "Working…" : "Acknowledge"}
                </button>
              )}
            </div>
          </div>

          <h1 className="text-xl font-semibold text-white leading-tight">{(ticket.title as string) || "Untitled ticket"}</h1>

          <div className="flex items-center gap-1.5 flex-wrap">
            <TicketPill
              label="Status"
              value={statusLabel(ticket.status as string)}
              options={TICKET_STATUSES.map(value => ({ value, label: statusLabel(value) }))}
              onPick={value => void applyTicketField("status", value)}
              disabled={moreActionsBusy}
            />
            <TicketPill
              label="Priority"
              value={priorityLabel(ticket.priority as string)}
              options={TICKET_PRIORITIES.map(value => ({ value, label: priorityLabel(value) }))}
              onPick={value => void applyTicketField("priority", value)}
              disabled={moreActionsBusy}
            />
            <TicketPill
              label="Assigned to"
              value={assigneeName || "Unassigned"}
              options={[{ value: "", label: "Unassigned" }, ...users.map(u => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() }))]}
              onPick={value => void assignTicketTo(value || null)}
              disabled={moreActionsBusy}
            />
            {slaChip && <span className={`chip ${slaChip.tone}`} title={slaChip.title}>{slaChip.label}</span>}
            {(ticket.source as string) && <span className="chip capitalize">{String(ticket.source).replace(/_/g, " ")}</span>}
            {agreementName && <span className="chip" title="The service agreement this ticket is billed against">{agreementName}</span>}
            <span className="chip ml-auto" title="Every field, in one form">
              <button onClick={() => setEditing(true)} className="flex items-center gap-1.5"><Edit3 size={12} /> Edit</button>
            </span>
            <span className="hidden lg:inline text-[11px] text-gray-600">Click a pill to change it — no dialog, no form, no save</span>
            {editing && (<>
              <button onClick={() => setEditing(false)} className="btn-secondary text-xs">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary text-xs">{saving ? "Saving…" : "Save"}</button>
            </>)}
          </div>
        </div>
      ) : (<>
          <div>
            <div className="flex items-center gap-2">
              <Link to="/tickets" className="text-sm text-gray-500 hover:text-white">Tickets</Link>
              <ChevronRight size={14} className="text-gray-600"/>
              <h2 className="text-lg font-semibold text-white">{(ticket.ticketNumber as string) || `Ticket #${id}`}</h2>
            </div>
            <p className="text-sm text-gray-400 mt-0.5">{(ticket.title as string)?.slice(0, 80)}</p>
          </div>
          <div className="flex items-center gap-2">
            {editing ? (<>
              <button onClick={() => setEditing(false)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">{saving ? "Saving..." : "Save"}</button>
            </>) : (
              <button onClick={() => setEditing(true)} className="btn-secondary text-sm flex items-center gap-1"><Edit3 size={14}/>Edit</button>
            )}
          </div>
        </>)}

      {/* ── Toolbar card: tabs + icon actions ──
          Redesigned, the twelve panels are grouped into five tabs the screen can hold at once, and a
          group holding more than one shows them as sub-tabs — never buried a second click deep. The
          actions sit on the same line as the tabs, so the chrome around a panel is two rows and not
          three; the sub-tab row is ordered after both. */}
      <div className={redesign ? "card p-2.5 sticky top-0 z-30 flex flex-wrap items-center gap-x-2 gap-y-1.5" : "card p-3 space-y-2"}>
        {/* Tab strip */}
        {redesign ? (
          <>
            <div className="flex items-center gap-0.5 overflow-x-auto whitespace-nowrap order-1 flex-1 min-w-0">
              {TICKET_TAB_GROUPS.map(group => (
                <button
                  key={group.id}
                  onClick={() => pickGroup(group)}
                  className={`shrink-0 flex items-center gap-1.5 px-1 pb-1.5 text-sm border-b-2 -mb-px transition-colors ${
                    activeGroup.id === group.id
                      ? "border-cyber-500 text-white font-medium"
                      : "border-transparent text-gray-500 hover:text-gray-300"
                  }`}
                >
                  <group.icon size={13} />{group.label}
                  {/* How much is behind the tab, where the payload knows: a strip that says where to
                      look is useful, one that says how much there is is a reason to look. */}
                  {tabCounts[group.id] ? <span className="chip__n">{tabCounts[group.id]}</span> : null}
                </button>
              ))}
            </div>
            {activeGroup.tabs.length > 1 && (
              <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap border-t border-surface-border pt-1.5 order-3 w-full">
                {activeGroup.tabs.map(tabId => {
                  const def = TICKET_DETAIL_TABS.find(t => t.id === tabId);
                  return (
                    <button
                      key={tabId}
                      onClick={() => pickTab(tabId)}
                      className={`shrink-0 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                        activeTab === tabId
                          ? "bg-cyber-600/20 text-cyber-400"
                          : "text-gray-500 hover:text-white hover:bg-surface-lighter"
                      }`}
                    >
                      {def?.label ?? tabId}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-0 overflow-x-auto whitespace-nowrap border-b border-surface-border pb-1.5">
            {TICKET_DETAIL_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`shrink-0 px-2 py-1 text-xs font-medium rounded-t border-b-2 -mb-px transition-colors ${
                  activeTab === t.id
                    ? "border-cyber-500 text-cyber-400 bg-surface-lighter"
                    : "border-transparent text-gray-400 hover:text-white hover:bg-surface-lighter"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Icon toolbar */}
        <div className={redesign ? "order-2 flex items-center gap-1 shrink-0" : "flex items-center gap-1 flex-wrap"}>
          <button onClick={refreshDetails} title="Refresh" aria-label="Refresh" className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"><RotateCw size={16} /></button>
          <button onClick={() => { setFocusNoteRequested(true); setActiveTab("ticket"); }} title="Add Note" aria-label="Add Note" className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"><MessageSquare size={16} /></button>
          <button onClick={() => { setActiveTab("time"); openTimeEntryModal(); }} title="Log Time" aria-label="Log Time" className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"><Timer size={16} /></button>
          <button onClick={() => { setActiveTab("attachments"); setShowAttachDialog(true); }} title="Attach File" aria-label="Attach File" className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"><Paperclip size={16} /></button>
          <button onClick={openEmailDialog} title="Email Contact" aria-label="Email Contact" className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"><Mail size={16} /></button>
          <button onClick={() => window.print()} title="Print Ticket" aria-label="Print Ticket" className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"><Printer size={16} /></button>
          <button onClick={openFollowUp} title="Schedule Follow-up" aria-label="Schedule Follow-up" className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"><Bell size={16} /></button>
          <div className="relative">
            <button onClick={() => setShowMoreActions(open => !open)} title="More Actions" aria-label="More Actions" aria-expanded={showMoreActions} className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"><MoreHorizontal size={16} /></button>
            {showMoreActions && (
              <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-56 max-h-[70vh] overflow-y-auto rounded-lg border border-surface-border bg-surface p-1 shadow-xl">
                <button role="menuitem" onClick={() => { setActiveTab("ticket"); setEditing(true); setShowMoreActions(false); }} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white rounded">Edit ticket</button>
                <button role="menuitem" onClick={copyTicketLink} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white rounded">Copy ticket link</button>
                <div className="border-t border-surface-border my-1" />
                <p className="px-3 py-1 text-[10px] uppercase text-gray-500">Set status</p>
                {([["new", "New"], ["in_progress", "In Progress"], ["waiting_on_client", "Waiting on Client"], ["on_hold", "On Hold"], ["resolved", "Resolved"], ["closed", "Closed"]] as Array<[string, string]>).map(([value, label]) => (
                  <button key={value} role="menuitem" disabled={moreActionsBusy || ticket.status === value} onClick={() => void applyTicketField("status", value)} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white disabled:opacity-40 rounded">{label}</button>
                ))}
                <div className="border-t border-surface-border my-1" />
                <p className="px-3 py-1 text-[10px] uppercase text-gray-500">Set priority</p>
                {TICKET_PRIORITIES.map(value => (
                  <button key={value} role="menuitem" disabled={moreActionsBusy || ticket.priority === value} onClick={() => void applyTicketField("priority", value)} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white disabled:opacity-40 rounded">{priorityLabel(value)}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="ticket-print-only" aria-hidden="true">
              <h1>{(ticket.ticketNumber as string) || `Ticket ${id}`}</h1>
              <h2>{(ticket.title as string) || "Untitled ticket"}</h2>
              <p>{(ticket.description as string) || "No description provided."}</p>
              <dl>
                <div><dt>Status</dt><dd>{String(ticket.status || "-").replace(/_/g, " ")}</dd></div>
                <div><dt>Priority</dt><dd>{String(ticket.priority || "-")}</dd></div>
                <div><dt>Board</dt><dd>{(ticket.board as any)?.name || "-"}</dd></div>
                <div><dt>Client</dt><dd>{(ticket.company as any)?.name || "-"}</dd></div>
                <div><dt>Contact</dt><dd>{`${(ticket.contact as any)?.firstName || ""} ${(ticket.contact as any)?.lastName || ""}`.trim() || "-"}</dd></div>
                <div><dt>Assigned To</dt><dd>{`${(ticket.assignedTo as any)?.firstName || ""} ${(ticket.assignedTo as any)?.lastName || ""}`.trim() || "-"}</dd></div>
                <div><dt>Due</dt><dd>{ticket.dueDate ? new Date(ticket.dueDate as string).toLocaleString() : "-"}</dd></div>
              </dl>
              <h3>Recent Activity</h3>
              {((ticket.comments as any[]) || []).slice(0, 10).map((comment: any) => (
                <div key={comment.id} className="ticket-print-activity"><strong>{comment.isEmail ? "Email" : comment.isInternal ? "Internal Note" : "Note"}</strong><p>{comment.body || comment.content}</p><small>{comment.author?.firstName || "System"} · {comment.createdAt ? new Date(comment.createdAt).toLocaleString() : ""}</small></div>
              ))}
          </section>

          {activeTab === "ticket" && (
      <div className={redesign ? (contextPane ? "grid grid-cols-1 xl:grid-cols-3 gap-5" : "grid grid-cols-1 gap-5") : "grid grid-cols-1 lg:grid-cols-3 gap-5"}>
        <div className={redesign ? (contextPane ? "xl:col-span-2 space-y-5" : "space-y-5") : "lg:col-span-2 space-y-5"}>
          {/* General / The record */}
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">{redesign ? "The record" : "General"}</h3>
            {redesign && !editing ? (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                {recordRows.map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3 border-b border-surface-border/50 py-1.5">
                    <dt className="shrink-0 text-xs text-gray-500">{label}</dt>
                    <dd className="min-w-0 truncate text-right text-xs text-gray-200" title={value}>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
            <div className="grid grid-cols-2 gap-3">
              {editing ? (<>
                <div><label className="text-xs text-gray-500 block mb-1">Summary</label><input className="input-field text-sm" value={editForm.title||""} onChange={e=>setEditForm({...editForm,title:e.target.value})}/></div>
                <div><label className="text-xs text-gray-500 block mb-1">Description</label><textarea className="input-field text-sm" rows={3} value={editForm.description||""} onChange={e=>setEditForm({...editForm,description:e.target.value})}/></div>
              </>) : (<>
                <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Summary</label><p className="text-white text-sm">{ticket.title as string||"-"}</p></div>
                {ticket.description ? <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Description</label><p className="text-gray-300 text-sm whitespace-pre-wrap">{(ticket.description as string)}</p></div> : null}
              </>)}
            </div>
            )}
          </div>

          {/* What the client said — the description on its own, because it is the one thing on the
              ticket that is the customer's words rather than ours. */}
          {redesign && !editing && (
            <div className="card space-y-2">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">What the client said</h3>
              <p className="whitespace-pre-wrap text-sm text-gray-300">{(ticket.description as string) || "Nothing was written on this ticket — it arrived without a description."}</p>
            </div>
          )}

          {/* Dates & Times — in the redesigned screens the dates are in The record, and logging time
              starts from the composer, so this card is the classic one. */}
          {!redesign && (
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Dates & Times</h3>
              <button onClick={openTimeEntryModal} className="text-xs text-cyber-400 hover:text-cyber-300 flex items-center gap-1"><Timer size={12}/> Add Time Entry</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {editing ? (<>
                <div><label className="text-xs text-gray-500 block mb-1">Start Time</label><input className="input-field text-xs" type="datetime-local" value={editForm.startTime||""} onChange={e=>setEditForm({...editForm,startTime:e.target.value})}/></div>
                <div><label className="text-xs text-gray-500 block mb-1">End Time</label><input className="input-field text-xs" type="datetime-local" value={editForm.endTime||""} onChange={e=>setEditForm({...editForm,endTime:e.target.value})}/></div>
                <div><label className="text-xs text-gray-500 block mb-1">Due Date</label><input className="input-field text-xs" type="datetime-local" value={editForm.dueDate||""} onChange={e=>setEditForm({...editForm,dueDate:e.target.value})}/></div>
              </>) : (<>
                <div><label className="text-xs text-gray-500 block mb-1">Created</label><p className="text-white text-xs">{ticket.createdAt?new Date(ticket.createdAt as string).toLocaleString():"-"}</p></div>
                <div><label className="text-xs text-gray-500 block mb-1">Updated</label><p className="text-white text-xs">{ticket.updatedAt?new Date(ticket.updatedAt as string).toLocaleString():"-"}</p></div>
                <div><label className="text-xs text-gray-500 block mb-1">Due Date</label><p className="text-white text-xs">{ticket.dueDate?new Date(ticket.dueDate as string).toLocaleDateString():"-"}</p></div>
                {ticket.startTime && <div><label className="text-xs text-gray-500 block mb-1">Start Time</label><p className="text-white text-xs">{new Date(ticket.startTime as string).toLocaleString()}</p></div>}
                {ticket.endTime && <div><label className="text-xs text-gray-500 block mb-1">End Time</label><p className="text-white text-xs">{new Date(ticket.endTime as string).toLocaleString()}</p></div>}
              </>)}
            </div>
          </div>
          )}

          {/* The client's other open work — read while this ticket is open, because the ticket that
              explains this one is usually already open beside it. */}
          {redesign && otherOpen.length > 0 && (
            <div className="card space-y-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">The client's other open work</h3>
              <div className="space-y-2">
                {otherOpen.slice(0, 5).map(other => (
                  <Link
                    key={other.id}
                    to={`/tickets/${other.id}`}
                    className="flex items-center gap-3 rounded-lg border border-surface-border px-2.5 py-2 transition-colors hover:bg-surface-lighter"
                  >
                    <span className="shrink-0 font-mono text-[11px] text-gray-500">{other.ticketNumber}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-gray-200">{other.title}</span>
                    <span className={`badge shrink-0 text-[10px] ${STATUS_COLORS[other.status] || ""}`}>{other.status.replace(/_/g, " ")}</span>
                    <span className="shrink-0 text-[11px] text-gray-600" title="Last updated">{relativeAge(other.updatedAt)}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Notes — and, redesigned, the composer: a note, a reply to the client and a time entry
              all start in the same place, because they are the same act of recording what you did.
              The tab is the existing internal/emailed flag, so nothing new is being written. */}
          <div className="card space-y-3">
            {redesign ? (
              <>
                <div className="flex items-center gap-1 flex-wrap">
                  {([["note", "Note", ShieldCheck], ["reply", "Reply to client", Mail], ["time", "Log time", Timer]] as const).map(([key, label, Icon]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { setComposerMode(key); setNoteInternal(key !== "reply"); }}
                      aria-pressed={composerMode === key}
                      className={`shrink-0 border-b-2 px-1 pb-1.5 text-sm transition-colors ${
                        composerMode === key ? "border-cyber-500 text-white" : "border-transparent text-gray-500 hover:text-gray-300"
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5"><Icon size={13} />{label}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Notes</h3>
            )}
            <form onSubmit={redesign ? submitComposer : handlePostNote} className="space-y-2">
              <textarea
                ref={noteInputRef}
                rows={redesign ? 3 : 4}
                className="input-field w-full text-sm resize-y min-h-[6.5rem]"
                placeholder={composerMode === "reply" ? "Reply to the client — this is emailed to the ticket contact (Ctrl+Enter to submit)" : composerMode === "time" ? "What did you work on? (Ctrl+Enter to submit)" : "What did you do? (Ctrl+Enter to submit)"}
                value={noteText}
                onChange={e=>setNoteText(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter" && (e.ctrlKey||e.metaKey)) handlePostNote(e); }}
              />
              {/* The job a time entry is made of. Always visible rather than behind the Log time
                  tab, because a note and a time entry are the same act of recording what you did —
                  and because a field you have to go and find is a field that goes unfilled. */}
              {redesign && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
                  <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
                    <input type="checkbox" checked={noteInternal} onChange={e => setNoteInternal(e.target.checked)} className="accent-cyber-500" />
                    Internal
                  </label>
                  <label className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-gray-500">
                    Work type
                    <select className="input-field w-auto py-1 text-xs" value={composerWorkType} onChange={e => setComposerWorkType(e.target.value)} aria-label="Work type">
                      {WORK_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-gray-500">
                    Role
                    <select className="input-field w-auto py-1 text-xs" value={composerRole} onChange={e => setComposerRole(e.target.value)} aria-label="Role">
                      {WORK_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-gray-500">
                    Hours
                    <input className="input-field w-20 py-1 text-xs tabular-nums" value={composerHours} onChange={e => setComposerHours(e.target.value)} aria-label="Hours" inputMode="decimal" />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
                    <input type="checkbox" checked={composerBillable} onChange={e => setComposerBillable(e.target.checked)} className="accent-cyber-500" />
                    Billable
                  </label>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <span className={`inline-flex items-center gap-1.5 self-start -mt-1 text-[11px] font-medium ${noteInternal?"text-amber-400":"text-blue-400"}`}>
                  {noteInternal ? <ShieldCheck size={11}/> : <Mail size={11}/>}
                  {noteInternal ? "Internal only — the customer is not emailed" : "Will be emailed to the ticket contact"}
                </span>
                <div className="flex items-center gap-3">
                  {redesign && (
                    <button type="button" onClick={() => setShowAttachDialog(true)} className="btn-secondary text-sm flex items-center gap-1.5">
                      <Paperclip size={13} /> Attach
                    </button>
                  )}
                  {!redesign && (
                    <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                      <input type="checkbox" checked={noteInternal} onChange={e=>setNoteInternal(e.target.checked)} />
                      Internal
                    </label>
                  )}
                  <button type="submit" disabled={posting || !noteText.trim()} className="btn-primary text-sm">{posting ? "…" : redesign ? "Save and log" : "Add Note"}</button>
                </div>
              </div>

              {/* Who the note is emailed to — the ticket's own people, plus anyone added on the fly. */}
              {!noteInternal && (
                <div className="rounded-lg border border-surface-border bg-surface-lighter/40 px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => setNoteRecipientsOpen(v => !v)}
                    className="flex w-full items-center justify-between text-xs text-gray-400 transition-colors hover:text-gray-200"
                    aria-expanded={noteRecipientsOpen}
                  >
                    <span className="flex items-center gap-1.5">
                      <Send size={12} />
                      Send as email to {noteTo.length + noteCc.length} {noteTo.length + noteCc.length === 1 ? "person" : "people"}
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] text-gray-600">
                      {noteRecipientsOpen ? "Hide" : "Change"}
                      <ChevronDown size={12} className={noteRecipientsOpen ? "rotate-180 transition-transform" : "transition-transform"} />
                    </span>
                  </button>
                  {noteRecipientsOpen && (
                    <div className="mt-2 space-y-1.5">
                      {noteRecipientPool.length === 0 && (
                        <p className="text-[11px] text-gray-600">This ticket has no contact yet — add one below.</p>
                      )}
                      {noteRecipientPool.map((recipient) => {
                        const checked = noteRecipientChecked(recipient);
                        const role = (recipient as { role?: string }).role;
                        return (
                          <label key={recipient.key} className="flex cursor-pointer select-none items-center gap-2 text-xs text-gray-300">
                            <input type="checkbox" checked={checked} onChange={() => toggleNoteRecipient(recipient)} />
                            <span className="font-medium text-white">{recipient.name || recipient.email}</span>
                            <span className="truncate text-gray-500">{recipient.email}</span>
                            <span className="ml-auto shrink-0 rounded-full bg-surface-lighter px-2 py-0.5 text-[10px] text-gray-400">
                              {role === "cc" ? "CC on all email" : role ? "Additional" : "Primary"}
                            </span>
                          </label>
                        );
                      })}
                      <div className="pt-1">
                        {renderRecipientField("Cc", noteCc, setNoteCc, {
                          placeholder: "Add a CC",
                          hint: "Anyone new here is saved to the ticket and emailed this note.",
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </form>
            <div className="space-y-3">
              {noteEntries.length === 0 && <p className="text-xs text-gray-600">No notes yet.</p>}
              {noteEntries.map((c:any,i:number)=>(
                <div key={c.id||i} className="flex gap-2 text-xs">
                  <span className={`badge shrink-0 mt-0.5 ${c.isEmail?"bg-purple-600/20 text-purple-400":c.isInternal?"bg-amber-600/20 text-amber-400":"bg-blue-600/20 text-blue-400"}`}>{c.isEmail?"Email":c.isInternal?"Internal":"Note"}</span>
                  <div className="min-w-0"><p className="text-gray-300 whitespace-pre-wrap">{friendlyActivityBody(c.body||c.content)}</p><p className="text-gray-600 mt-0.5">{(c.author?.firstName||c.author?.lastName) ? `${c.author.firstName||""} ${c.author.lastName||""}`.trim() : (c.fromEmail||"System")} · {c.createdAt?new Date(c.createdAt).toLocaleString():""}</p></div>
                </div>
              ))}
            </div>
          </div>

          {/* Activity — the region a recent-activity link from a ticket change points at. */}
          <div className="card space-y-3" data-hl="ticket-activity">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Activity</h3>
              <button onClick={openTimeEntryModal} className="btn-secondary text-xs flex items-center gap-1"><Timer size={12}/> Add Time Entry</button>
            </div>
            <div className="space-y-3">
              {activityEntries.length === 0 && <p className="text-xs text-gray-600">No activity recorded yet.</p>}
              {activityEntries.map((entry:any,i:number)=>(
                <div key={entry.id||i} className="flex gap-2 text-xs">
                  {entry.kind === "time" ? (
                    <span className="badge bg-green-600/20 text-green-400 shrink-0 mt-0.5">Time</span>
                  ) : (
                    <span className="badge bg-slate-600/20 text-slate-300 shrink-0 mt-0.5">Change</span>
                  )}
                  {entry.kind === "time" ? (
                    <div className="min-w-0">
                      <p className="text-gray-300">{entry.description}{entry.minutes ? ` (${Math.floor(entry.minutes/60)}h ${entry.minutes%60}m)` : ""} · {timeBillingLabel(entry)}</p>
                      {timeEntryMeta(entry) && <p className="text-gray-500 mt-0.5">{timeEntryMeta(entry)}</p>}
                      <p className="text-gray-600 mt-0.5">{entry.userName} · {entry.at ? new Date(entry.at).toLocaleString() : ""}</p>
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <p className="text-gray-300 whitespace-pre-wrap">{friendlyActivityBody(entry.body)}</p>
                      <p className="text-gray-600 mt-0.5">{entry.userName} · {entry.at ? new Date(entry.at).toLocaleString() : ""}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column — the CONTEXT rail, and it follows you down the panel: whose ticket this is,
            who to talk to and what they run are facts you read *while* working, not a tab you visit.
            Read-only on purpose — a state you change is a pill in the header, and the rest is Edit. */}
        {(!redesign || editing || contextPane) && (
        <div className={`space-y-5 ${redesign ? "xl:sticky xl:top-20 xl:self-start" : ""}`}>
          {redesign && contextPane && !editing ? (<>
            {/* The context column says what it is and can be put away — a rail you cannot dismiss is
                a rail that is part of the page rather than something you chose to have. */}
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500"><Columns3 size={12} /> Context</h3>
              <button
                type="button"
                onClick={() => setContextPanePreference(false)}
                title="Hide the context column"
                aria-label="Hide the context column"
                className="text-gray-600 transition-colors hover:text-white"
              >
                <X size={12} />
              </button>
            </div>
            <div className="card space-y-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5"><Building2 size={12} /> Client</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-white truncate">{companyName || "No client"}</span>
                {company?.companyType && <span className="badge bg-cyber-600/20 text-cyber-400 text-[10px]">{company.companyType}</span>}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs"><span className="text-gray-500">Open tickets</span><span className="text-white">{otherOpen.length + 1}</span></div>
                {company?.serviceLevel && (<div className="flex items-center justify-between text-xs"><span className="text-gray-500">Service level</span><span className="text-white">{company.serviceLevel}</span></div>)}
                {agreementName && (<div className="flex items-start justify-between gap-3 text-xs"><span className="text-gray-500 shrink-0">Agreement</span><span className="text-white text-right">{agreementName}</span></div>)}
                <div className="flex items-center justify-between text-xs"><span className="text-gray-500">Opened</span><span className="text-white">{ticket.createdAt ? new Date(ticket.createdAt as string).toLocaleDateString() : "—"}</span></div>
              </div>
              {companyBrief && (
                <p className="rounded-md border-l-2 border-amber-400/70 bg-amber-500/10 px-2.5 py-2 text-xs leading-relaxed text-amber-100/90">{companyBrief}</p>
              )}
              {ticket.companyId ? (
                <Link to={`/clients/${ticket.companyId as string}`} className="btn-secondary text-xs w-full justify-center flex">Open the client</Link>
              ) : null}
            </div>

            <div className="card space-y-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5"><User size={12} /> Contact</h3>
              {ticket.contact ? (<>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs"><span className="text-gray-500">Name</span><span className="text-white">{`${(ticket.contact as { firstName?: string }).firstName || ""} ${(ticket.contact as { lastName?: string }).lastName || ""}`.trim() || "—"}</span></div>
                  <div className="flex items-center justify-between gap-3 text-xs"><span className="text-gray-500 shrink-0">Email</span><span className="text-cyber-400 truncate">{(ticket.contact as { email?: string }).email || "—"}</span></div>
                  <div className="flex items-center justify-between text-xs"><span className="text-gray-500">Phone</span><span className="text-white">{(ticket.contact as { phone?: string }).phone || "—"}</span></div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={openEmailDialog} className="btn-secondary text-xs flex-1 justify-center flex items-center gap-1.5"><Mail size={12} /> Reply</button>
                  <button onClick={() => { setActiveTab("time"); openTimeEntryModal(); }} className="btn-secondary text-xs flex-1 justify-center flex items-center gap-1.5"><Timer size={12} /> Log a call</button>
                </div>
              </>) : (
                <p className="text-xs text-gray-500">No contact on this ticket yet — add one with Edit.</p>
              )}
              {(((ticket.additionalContacts as Array<{ id: string; contact?: { id: string; firstName?: string; lastName?: string; email?: string }; role?: string; notifyOnNote?: boolean }>) || []).length > 0) && (
                <div className="space-y-2 border-t border-surface-border pt-2.5">
                  {((ticket.additionalContacts as Array<{ id: string; contact?: { id: string; firstName?: string; lastName?: string; email?: string }; role?: string; notifyOnNote?: boolean }>) || []).map(link => (
                    <div key={link.id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-white">{[link.contact?.firstName, link.contact?.lastName].filter(Boolean).join(" ") || link.contact?.email}</span>
                        <span className="block truncate text-[11px] text-gray-500">{link.contact?.email}</span>
                      </span>
                      <select
                        className="shrink-0 rounded border border-surface-border bg-surface-input px-1.5 py-0.5 text-[11px] text-gray-300"
                        value={link.role === "cc" ? "cc" : link.notifyOnNote ? "notes" : "ticket"}
                        onChange={(e) => void updateTicketContactLink(link.contact?.id || "", e.target.value)}
                        title="How this contact is used on the ticket"
                      >
                        <option value="ticket">On the ticket</option>
                        <option value="cc">CC on email</option>
                        <option value="notes">Notified of notes</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
              {showAddContact ? (
                <div className="rounded-lg border border-surface-border bg-surface-lighter/40 px-2.5 py-2">
                  <RecipientField
                    label="Add"
                    value={[]}
                    onChange={(picked) => { const person = picked[0]; if (person) void addTicketContactLink(person); }}
                    suggestions={contactSuggestions}
                    placeholder="Search this client's contacts or type an address"
                    hint="Added as an additional contact — choose how they are used once added."
                    orgName={orgName}
                    orgEmails={orgEmails}
                  />
                </div>
              ) : (
                <button type="button" onClick={() => setShowAddContact(true)} className="text-xs text-cyber-400 hover:text-cyber-300 flex items-center gap-1"><Plus size={12} /> Add contact</button>
              )}
            </div>

            <div className="card space-y-3">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500"><Server size={12} /> Configurations</h3>
              <p className="text-xs text-gray-500 leading-relaxed">What this client runs — servers, workstations and network gear.</p>
              <button onClick={() => setActiveTab("configurations")} className="btn-secondary text-xs w-full justify-center flex items-center gap-1.5"><Wrench size={12} /> Open Configurations</button>
            </div>
          </>) : (<>
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Classification & Details</h3>
            {editing ? (<div className="space-y-2">
              <div><label className="text-xs text-gray-500 block mb-1">Status</label><select className="input-field" value={editForm.status||""} onChange={e=>setEditForm({...editForm,status:e.target.value})}>{TICKET_STATUSES.map(s=><option key={s} value={s}>{s.replace(/_/g," ")}</option>)}</select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Priority</label><select className="input-field" value={editForm.priority||""} onChange={e=>setEditForm({...editForm,priority:e.target.value})}>{TICKET_PRIORITIES.map(p=><option key={p} value={p}>{p}</option>)}</select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Board</label><select className="input-field" value={editForm.boardId||""} onChange={e=>setEditForm({...editForm,boardId:e.target.value})}><option value="">-</option>{allBoards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
            </div>) : (<div className="space-y-2">
              <div className="flex items-center justify-between"><span className="text-xs text-gray-500">Status</span><span className={`badge ${STATUS_COLORS[ticket.status as string]||""}`}>{(ticket.status as string)?.replace(/_/g," ")}</span></div>
              <div className="flex items-center justify-between"><span className="text-xs text-gray-500">Priority</span><span className={`badge ${PRIORITY_COLORS[ticket.priority as string]||""}`}>{ticket.priority as string}</span></div>
              <div className="flex items-center justify-between"><span className="text-xs text-gray-500">Board</span><span className="text-white text-xs">{(ticket.board as {name?:string})?.name||"-"}</span></div>
            </div>)}
          </div>

          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Client Info</h3>
            {editing ? (<div className="space-y-2">
              <div><label className="text-xs text-gray-500 block mb-1">Company</label><select className="input-field" value={editForm.companyId||""} onChange={e=>handleCompanyChange(e.target.value)}><option value="">-</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Contact</label><select className="input-field" value={editForm.contactId||""} onChange={e=>setEditForm({...editForm,contactId:e.target.value})}><option value="">-</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}</select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Assigned To</label><select className="input-field" value={editForm.assignedToId||""} onChange={e=>setEditForm({...editForm,assignedToId:e.target.value})}><option value="">-</option>{users.map(u=><option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}</select></div>
            </div>) : (<div className="space-y-2">
              <div className="flex items-center justify-between"><span className="text-xs text-gray-500">Company</span><span className="text-white text-xs">{(ticket.company as {name?:string})?.name||"-"}</span></div>
              <div className="flex items-center justify-between"><span className="text-xs text-gray-500">Contact</span><span className="text-white text-xs">{ticket.contact?`${(ticket.contact as any).firstName} ${(ticket.contact as any).lastName}`:"-"}</span></div>
              <div className="flex items-center justify-between"><span className="text-xs text-gray-500">Contact Email</span><span className="text-cyber-400 text-xs">{(ticket.contact as any)?.email||"-"}</span></div>
              <div className="flex items-center justify-between"><span className="text-xs text-gray-500">Contact Phone</span><span className="text-white text-xs">{(ticket.contact as any)?.phone||"-"}</span></div>
              <div className="flex items-center justify-between"><span className="text-xs text-gray-500">Assigned To</span><span className="text-white text-xs">{ticket.assignedTo?`${(ticket.assignedTo as any).firstName} ${(ticket.assignedTo as any).lastName}`:"-"}</span></div>
            </div>)}
          </div>
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Contacts</h3>
              <button
                type="button"
                onClick={() => setShowAddContact((v) => !v)}
                className="flex items-center gap-1 text-xs text-cyber-400 transition-colors hover:text-cyber-300"
                aria-expanded={showAddContact}
              >
                <Plus size={12} /> Add contact
              </button>
            </div>

            {/* Primary contact is the ticket's own field; the rest are links on the ticket. */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-white">
                    {ticket.contact ? `${(ticket.contact as any).firstName || ""} ${(ticket.contact as any).lastName || ""}`.trim() : "No contact"}
                  </span>
                  <span className="block truncate text-[11px] text-gray-500">{(ticket.contact as any)?.email || "—"}</span>
                </span>
                <span className="shrink-0 rounded-full bg-cyber-600/20 px-2 py-0.5 text-[10px] text-cyber-300">Primary</span>
              </div>

              {((ticket.additionalContacts as any[]) || []).map((link: any) => (
                <div key={link.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-white">
                      {[link.contact?.firstName, link.contact?.lastName].filter(Boolean).join(" ") || link.contact?.email}
                    </span>
                    <span className="block truncate text-[11px] text-gray-500">{link.contact?.email}</span>
                  </span>
                  <select
                    className="shrink-0 rounded border border-surface-border bg-surface-input px-1.5 py-0.5 text-[11px] text-gray-300"
                    value={link.role === "cc" ? "cc" : link.notifyOnNote ? "notes" : "ticket"}
                    onChange={(e) => void updateTicketContactLink(link.contact.id, e.target.value)}
                    title="How this contact is used on the ticket"
                  >
                    <option value="cc">CC on all email</option>
                    <option value="notes">Emailed notes</option>
                    <option value="ticket">Ticket only</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void removeTicketContactLink(link.contact.id)}
                    title={`Remove ${link.contact?.email} from this ticket`}
                    aria-label={`Remove ${link.contact?.email} from this ticket`}
                    className="shrink-0 text-gray-600 transition-colors hover:text-red-400"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            {showAddContact && (
              <div className="rounded-lg border border-surface-border bg-surface-lighter/40 px-2.5 py-2">
                <RecipientField
                  label="Add"
                  value={[]}
                  onChange={(picked) => {
                    const person = picked[0];
                    if (person) void addTicketContactLink(person);
                  }}
                  suggestions={contactSuggestions}
                  placeholder="Search this client's contacts or type an address"
                  hint="Added as an additional contact — choose how they are used once added."
                  orgName={orgName}
                  orgEmails={orgEmails}
                />
              </div>
            )}
          </div>
          </>)}
        </div>
        )}
      </div>)}

      {/* ── Configurations tab ── */}
      {activeTab === "configurations" && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Configurations</h3>
            <button onClick={() => setShowConfigDialog(true)} className="btn-primary text-xs flex items-center gap-1"><Plus size={12} /> Link Configuration</button>
          </div>
          {cfArr("ticketConfigurations").length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">No configurations linked to this ticket.</p>
          ) : (
            <div className="space-y-2">
              {cfArr("ticketConfigurations").map((c: any) => (
                <div key={c.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-lighter">
                  <Wrench size={14} className="text-cyber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-medium truncate">{c.name}</p>
                    <p className="text-gray-500 text-[10px]">{c.type} · linked {c.linkedAt ? new Date(c.linkedAt).toLocaleString() : ""}</p>
                  </div>
                  {c.refId && <Link to={c.kind === "kumoServer" ? "/kumo/configs" : c.kind === "kumoAsset" ? `/kumo/assets/${c.refId}` : `/assets/${c.refId}`} className="text-xs text-cyber-400 hover:text-cyber-300 shrink-0">Open</Link>}
                  <button onClick={() => persistCF("ticketConfigurations", cfArr("ticketConfigurations").filter((x: any) => x.id !== c.id))} className="text-gray-500 hover:text-red-400"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Products tab ── */}
      {activeTab === "products" && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Products</h3>
            <button onClick={() => setShowProductDialog(true)} className="btn-primary text-xs flex items-center gap-1"><Plus size={12} /> Add Product</button>
          </div>
          {cfArr("ticketProducts").length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">No products on this ticket.</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-surface-border text-left text-gray-400 text-xs uppercase"><th className="px-2 py-2">Item</th><th className="px-2 py-2">Qty</th><th className="px-2 py-2">Unit Price</th><th className="px-2 py-2 text-right">Total</th><th className="px-2 py-2 w-8"></th></tr></thead>
                <tbody>{cfArr("ticketProducts").map((p: any) => (
                  <tr key={p.id} className="border-b border-surface-border/50">
                    <td className="px-2 py-2 text-white text-xs">{p.name}{p.sku && <span className="block font-mono text-[10px] text-gray-500">{p.sku}</span>}</td>
                    <td className="px-2 py-2 text-gray-400 text-xs">{p.qty}</td>
                    <td className="px-2 py-2 text-gray-400 text-xs">${(p.unitCost || 0).toFixed(2)}</td>
                    <td className="px-2 py-2 text-right text-cyber-400 text-xs font-medium">${((p.qty || 0) * (p.unitCost || 0)).toFixed(2)}</td>
                    <td className="px-2 py-2"><button onClick={() => persistCF("ticketProducts", cfArr("ticketProducts").filter((x: any) => x.id !== p.id))} className="text-gray-500 hover:text-red-400"><Trash2 size={12} /></button></td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="text-right text-xs text-gray-400">Total: <span className="text-white font-medium">${cfArr("ticketProducts").reduce((s: number, p: any) => s + (p.qty || 0) * (p.unitCost || 0), 0).toFixed(2)}</span></p>
            </>
          )}
        </div>
      )}

      {/* ── Activities tab ── */}
      {activeTab === "activities" && (() => {
        const acts = [
          ...((ticket.comments as any[]) || []).map((c: any) => ({ kind: c.isEmail ? "Email" : c.isInternal ? "Internal" : "Note", time: c.createdAt, text: friendlyActivityBody(c.body || c.content), by: (c.author?.firstName || c.author?.lastName) ? `${c.author.firstName || ""} ${c.author.lastName || ""}`.trim() : (c.fromEmail || "System") })),
          ...((ticket.timeEntries as any[]) || []).map((te: any) => ({ kind: "Time", time: te.date || te.createdAt, text: `${te.description || ""}${te.minutes ? ` (${Math.floor(te.minutes / 60)}h ${te.minutes % 60}m)` : ""} · ${timeBillingLabel(te)}${timeEntryMeta(te) ? ` · ${timeEntryMeta(te)}` : ""}`, by: (te.user?.firstName || te.user?.lastName) ? `${te.user.firstName || ""} ${te.user.lastName || ""}`.trim() : "System" })),
        ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
        return (
          <div className="card space-y-2">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Activities</h3>
            {acts.length === 0 ? <p className="text-sm text-gray-500 py-6 text-center">No activity recorded yet.</p> : (
              <div className="space-y-1.5">
                {acts.map((a, i) => (
                  <div key={i} className="flex gap-2 text-xs items-start">
                    <span className={`badge shrink-0 mt-0.5 ${a.kind === "Email" ? "bg-purple-600/20 text-purple-400" : a.kind === "Internal" ? "bg-amber-600/20 text-amber-400" : a.kind === "Time" ? "bg-green-600/20 text-green-400" : "bg-blue-600/20 text-blue-400"}`}>{a.kind}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-gray-300 whitespace-pre-wrap">{a.text}</p>
                      <p className="text-gray-600 mt-0.5">{a.by} · {a.time ? new Date(a.time).toLocaleString() : ""}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Time tab ── */}
      {activeTab === "time" && (() => {
        const tes = (ticket.timeEntries as any[]) || [];
        const bill = tes.filter(t => t.billable).reduce((s, t) => s + (t.minutes || 0), 0);
        const non = tes.filter(t => !t.billable).reduce((s, t) => s + (t.minutes || 0), 0);
        return (
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Time</h3>
              <button onClick={openTimeEntryModal} className="btn-primary text-xs flex items-center gap-1"><Plus size={12} /> Add Time Entry</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-surface-lighter rounded-lg p-3"><p className="text-gray-500 text-xs">Billable</p><p className="text-white font-semibold">{Math.floor(bill / 60)}h {bill % 60}m</p></div>
              <div className="bg-surface-lighter rounded-lg p-3"><p className="text-gray-500 text-xs">Non-billable</p><p className="text-white font-semibold">{Math.floor(non / 60)}h {non % 60}m</p></div>
            </div>
            {tes.length === 0 ? <p className="text-sm text-gray-500 py-6 text-center">No time entries yet.</p> : (
              <div className="space-y-2">
                {tes.map((te: any) => (
                  <div key={te.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-lighter">
                    <Clock size={14} className="text-green-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs">{te.description}{te.minutes ? ` (${Math.floor(te.minutes / 60)}h ${te.minutes % 60}m)` : ""}</p>
                      {timeEntryMeta(te) && <p className="text-gray-500 text-[10px]">{timeEntryMeta(te)}</p>}
                      <p className="text-gray-500 text-[10px]">{(te.user?.firstName || te.user?.lastName) ? `${te.user.firstName || ""} ${te.user.lastName || ""}`.trim() : "System"} · {(te.date || te.createdAt) ? new Date((te.date || te.createdAt) as string).toLocaleString() : ""}</p>
                    </div>
                    <span className={`badge text-[10px] ${te.noCharge ? "bg-amber-600/20 text-amber-400" : te.billable ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}>{timeBillingLabel(te)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Links tab ── */}
      {activeTab === "links" && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Links</h3>
            <button onClick={() => { setShowLinkDialog(true); setLinkQuery(""); setLinkResults([]); api.get("/tickets?limit=200").then(r => setLinkResults((r.data?.data || []).filter((t: any) => t.id !== id))).catch(() => {}); }} className="btn-primary text-xs flex items-center gap-1"><Link2 size={12} /> Link Ticket</button>
          </div>
          {cfArr("ticketLinks").length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">No linked tickets.</p>
          ) : (
            <div className="space-y-2">
              {cfArr("ticketLinks").map((l: any) => (
                <div key={l.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-lighter">
                  <Link2 size={14} className="text-cyber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-medium truncate">{l.ticketNumber} — {l.title}</p>
                    <p className="text-gray-500 text-[10px] capitalize">{l.rel}</p>
                  </div>
                  <Link to={`/tickets/${l.ticketId}`} className="text-xs text-cyber-400 hover:text-cyber-300 shrink-0">Open</Link>
                  <button onClick={() => persistCF("ticketLinks", cfArr("ticketLinks").filter((x: any) => x.id !== l.id))} className="text-gray-500 hover:text-red-400"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
          {incomingLinks.length > 0 && (
            <>
              <p className="text-xs text-gray-500 pt-2 border-t border-surface-border">Incoming links — tickets that link to this one</p>
              <div className="space-y-2">
                {incomingLinks.map((l: any) => (
                  <div key={`in-${l.ticketId}`} className="flex items-center gap-3 p-2 rounded-lg bg-surface-lighter">
                    <Link2 size={14} className="text-purple-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-medium truncate">{l.ticketNumber} — {l.title}</p>
                      <p className="text-gray-500 text-[10px]">links to this ticket</p>
                    </div>
                    <Link to={`/tickets/${l.ticketId}`} className="text-xs text-cyber-400 hover:text-cyber-300 shrink-0">Open</Link>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Expenses tab ── */}
      {activeTab === "expenses" && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Expenses</h3>
            <button onClick={() => setShowExpenseDialog(true)} className="btn-primary text-xs flex items-center gap-1"><Plus size={12} /> Add Expense</button>
          </div>
          {expenses.length === 0 ? <p className="text-sm text-gray-500 py-6 text-center">No expenses on this ticket.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-surface-border text-left text-gray-400 text-xs uppercase"><th className="px-2 py-2">Description</th><th className="px-2 py-2">Category</th><th className="px-2 py-2">Vendor</th><th className="px-2 py-2">Date</th><th className="px-2 py-2">Status</th><th className="px-2 py-2 text-right">Amount</th><th className="px-2 py-2 w-24"></th></tr></thead>
              <tbody>{expenses.map((e: any) => (
                <tr key={e.id} className="border-b border-surface-border/50">
                  <td className="px-2 py-2 text-white text-xs">{e.description}{e.miles ? <span className="text-gray-500"> · {e.miles} mi</span> : null}</td>
                  <td className="px-2 py-2 text-gray-400 text-xs capitalize">{e.category}</td>
                  <td className="px-2 py-2 text-gray-400 text-xs">{e.vendor || "—"}</td>
                  <td className="px-2 py-2 text-gray-400 text-xs">{new Date(e.expenseDate).toLocaleDateString()}</td>
                  <td className="px-2 py-2">
                    <span className={`badge text-[10px] ${EXPENSE_STATUS_COLORS[e.status || "submitted"] || EXPENSE_STATUS_COLORS.submitted}`} title={e.decisionNote || undefined}>
                      {(e.status || "submitted").toUpperCase()}{e.syncedAt ? " · SYNCED" : ""}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right text-cyber-400 text-xs font-medium">${(e.amount || 0).toFixed(2)}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    {canManageBilling && (e.status || "submitted") === "submitted" && (
                      <>
                        <button
                          onClick={async () => { await expenseDecision(e.id, "approve"); }}
                          className="text-[10px] text-green-400 hover:text-green-300 mr-2"
                        >Approve</button>
                        {rejectingId === e.id ? (
                          <span className="inline-flex items-center gap-1 mr-2">
                            <input
                              className="input-field text-[10px] py-0.5 w-40"
                              autoFocus
                              placeholder="Why? (required)"
                              value={rejectReason}
                              onChange={ev => setRejectReason(ev.target.value)}
                              onKeyDown={ev => { if (ev.key === "Enter" && rejectReason.trim()) void expenseDecision(e.id, "reject", rejectReason).then(() => { setRejectingId(null); setRejectReason(""); }); if (ev.key === "Escape") setRejectingId(null); }}
                            />
                            <button
                              onClick={async () => { await expenseDecision(e.id, "reject", rejectReason); setRejectingId(null); setRejectReason(""); }}
                              disabled={!rejectReason.trim()}
                              className="text-[10px] text-amber-400 hover:text-amber-300"
                            >Send</button>
                            <button onClick={() => { setRejectingId(null); setRejectReason(""); }} className="text-[10px] text-gray-500 hover:text-gray-300">Cancel</button>
                          </span>
                        ) : (
                          <button
                            onClick={() => { setRejectingId(e.id); setRejectReason(""); }}
                            className="text-[10px] text-amber-400 hover:text-amber-300 mr-2"
                          >Reject</button>
                        )}
                      </>
                    )}
                    {canManageBilling && (e.status || "submitted") === "approved" && !e.syncedAt && (
                      <button
                        onClick={async () => {
                          try { await api.post(`/billing/expenses/${e.id}/sync`); toast.success("Pushed to accounting"); }
                          catch (err: unknown) { toast.error(apiErrorMessage(err, "Could not push")); }
                          void loadExpenses();
                        }}
                        className="text-[10px] text-cyber-400 hover:text-cyber-300 mr-2"
                      >Push</button>
                    )}
                    <button onClick={async () => { try { await api.delete(`/billing/expenses/${e.id}`); toast.success("Deleted"); void loadExpenses(); } catch (err: unknown) { toast.error(apiErrorMessage(err, "Failed")); } }} className="text-gray-500 hover:text-red-400"><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Schedule tab ── */}
      {activeTab === "schedule" && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Schedule</h3>
            <button onClick={() => { closeScheduleDialog(); setShowScheduleDialog(true); }} className="btn-primary text-xs flex items-center gap-1"><Plus size={12} /> Schedule Entry</button>
          </div>
          {schedEntries.length === 0 ? <p className="text-sm text-gray-500 py-6 text-center">No scheduled entries for this ticket.</p> : (
            <div className="space-y-2">
              {schedEntries.map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-lighter">
                  <Clock size={14} className="text-cyber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-medium">{s.title}</p>
                    <p className="text-gray-500 text-[10px]">{new Date(s.startTime).toLocaleString()} — {new Date(s.endTime).toLocaleString()}{s.location ? ` · ${s.location}` : ""}</p>
                  </div>
                  <span className="badge text-[10px] bg-cyber-600/20 text-cyber-400 capitalize">{s.status || "scheduled"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Attachments tab ── */}
      {activeTab === "attachments" && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Attachments</h3>
            <button onClick={() => setShowAttachDialog(true)} className="btn-primary text-xs flex items-center gap-1"><Paperclip size={12} /> Attach File</button>
          </div>
          {((ticket.attachments as any[]) || []).length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">No attachments on this ticket.</p>
          ) : (
            <div className="space-y-2">
              {((ticket.attachments as any[]) || []).map((a: any) => (
                <div key={a.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-lighter">
                  <FileText size={14} className="text-cyber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-medium truncate">{a.filename}</p>
                    <p className="text-gray-500 text-[10px]">{a.size ? (a.size < 1024 ? `${a.size} B` : a.size < 1048576 ? `${(a.size / 1024).toFixed(1)} KB` : `${(a.size / 1048576).toFixed(1)} MB`) : "—"} · {a.mimeType} · {a.createdAt ? new Date(a.createdAt).toLocaleString() : ""}</p>
                  </div>
                  <button disabled={!a.storagePath || a.storagePath === "pending-upload"} onClick={() => void downloadAttachment(a)} className="text-gray-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed" title={a.storagePath === "pending-upload" ? "File content is unavailable for this legacy attachment" : `Download ${a.filename}`} aria-label={`Download ${a.filename}`}><Download size={14} /></button>
                  <button onClick={async () => { try { await api.delete(`/tickets/${id}/attachments/${a.id}`); toast.success("Deleted"); load(); } catch { toast.error("Failed"); } }} className="text-gray-500 hover:text-red-400"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── History tab (field change log) ── */}
      {activeTab === "history" && (() => {
        const changes = ((ticket.comments as any[]) || []).filter((c: any) => (c.body || "").includes(" → "));
        return (
          <div className="card space-y-2">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">History</h3>
            {changes.length === 0 ? <p className="text-sm text-gray-500 py-6 text-center">No field changes recorded yet.</p> : (
              <div className="space-y-2">
                {changes.map((c: any) => (
                  <div key={c.id} className="p-2 rounded-lg bg-surface-lighter">
                    <p className="text-gray-300 text-xs whitespace-pre-wrap">{friendlyActivityBody(c.body)}</p>
                    <p className="text-gray-600 text-[10px] mt-1">{(c.author?.firstName || c.author?.lastName) ? `${c.author.firstName || ""} ${c.author.lastName || ""}`.trim() : "System"} · {c.createdAt ? new Date(c.createdAt).toLocaleString() : ""}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Finance tab ── */}
      {activeTab === "finance" && (() => {
        const tes = (ticket.timeEntries as any[]) || [];
        const bill = tes.filter(t => t.billable).reduce((s, t) => s + (t.minutes || 0), 0);
        const non = tes.filter(t => !t.billable).reduce((s, t) => s + (t.minutes || 0), 0);
        const expTotal = expenses.reduce((s, e) => s + (e.amount || 0), 0);
        const prodTotal = cfArr("ticketProducts").reduce((s: number, p: any) => s + (p.qty || 0) * (p.unitCost || 0), 0);
        const sa = ticket.serviceAgreement as any;
        return (
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Finance</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <div className="bg-surface-lighter rounded-lg p-3"><p className="text-gray-500 text-xs">Billable Time</p><p className="text-white font-semibold">{Math.floor(bill / 60)}h {bill % 60}m</p></div>
              <div className="bg-surface-lighter rounded-lg p-3"><p className="text-gray-500 text-xs">Non-billable</p><p className="text-white font-semibold">{Math.floor(non / 60)}h {non % 60}m</p></div>
              <div className="bg-surface-lighter rounded-lg p-3"><p className="text-gray-500 text-xs">Expenses</p><p className="text-white font-semibold">${expTotal.toFixed(2)}</p></div>
              <div className="bg-surface-lighter rounded-lg p-3"><p className="text-gray-500 text-xs">Products</p><p className="text-white font-semibold">${prodTotal.toFixed(2)}</p></div>
              <div className="bg-surface-lighter rounded-lg p-3"><p className="text-gray-500 text-xs">Agreement</p><p className="text-white font-semibold text-xs truncate">{sa?.name || "None"}</p></div>
            </div>
            {sa && <div className="flex items-center justify-between text-xs"><span className="text-gray-500">Agreement amount</span><span className="text-white">${(sa.billingAmount || 0).toFixed(2)} / {sa.billingPeriod || "period"}</span></div>}
            <div className="flex gap-2 pt-1 border-t border-surface-border">
              <Link to="/billing" className="btn-secondary text-xs">View Invoices</Link>
              <Link to={`/billing/time`} className="btn-secondary text-xs">Time & Expenses</Link>
            </div>
          </div>
        );
      })()}

      {/* ── Audit Trail tab ── */}
      {activeTab === "audittrail" && (
        <div className="card space-y-2">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Audit Trail</h3>
          {auditEntries.length === 0 ? <p className="text-sm text-gray-500 py-6 text-center">No audit records for this ticket.</p> : (
            <div className="space-y-1.5">
              {auditEntries.map((a: any) => {
                const fields = Object.keys(a.changes || {}).map(k => k.replace(/([A-Z])/g, " $1").toLowerCase().trim()).join(", ");
                return (
                  <div key={a.id} className="flex items-start gap-3 py-1 text-xs">
                    <div className="shrink-0 text-gray-600 font-mono w-20">{new Date(a.createdAt).toLocaleTimeString()}</div>
                    <span className="badge bg-cyber-600/20 text-cyber-400 shrink-0">{(a.action || "").replace(/:/g, " → ")}</span>
                    <span className="text-gray-400 truncate flex-1">{fields ? `Changed: ${fields}` : "Operation recorded"}</span>
                    <span className="text-gray-600 shrink-0 ml-auto"><User size={10} className="inline mr-1" />{a.userName || "System"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Dialogs ── */}
      {showEmailDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowEmailDialog(false)}>
          <form className="card flex w-full max-w-3xl flex-col gap-3" onClick={e => e.stopPropagation()} onSubmit={sendContactEmail}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Mail size={16} /> Email Contact</h3>
              <button type="button" onClick={() => setShowEmailDialog(false)} title="Close" aria-label="Close" className="rounded p-1 text-gray-500 transition-colors hover:bg-surface-lighter hover:text-white"><X size={16} /></button>
            </div>

            <div className="space-y-2">
              {renderRecipientField("To", emailTo, setEmailTo, { placeholder: "Recipient", hint: "Replies return to the shared mailbox." })}
              {renderRecipientField("Cc", emailCc, setEmailCc, {
                placeholder: "Add a CC",
                action: (
                  <button
                    type="button"
                    onClick={() => setShowBcc((v) => !v)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-surface hover:text-gray-200"
                    title={showBcc ? "Hide BCC" : "Add a BCC"}
                  >
                    {showBcc ? "Hide Bcc" : "Bcc"}
                  </button>
                ),
                hint: autoRecipientHint,
              })}
              {showBcc && renderRecipientField("Bcc", emailBcc, setEmailBcc, { placeholder: "Add a BCC" })}
              {quickCcContacts.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pl-16">
                  <span className="text-[11px] text-gray-600">On this ticket:</span>
                  {quickCcContacts.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => setEmailCc((prev) => [...prev, r])}
                      className="rounded-full border border-surface-border px-2 py-0.5 text-[11px] text-gray-400 transition-colors hover:border-cyber-400 hover:text-cyber-300"
                    >
                      + {r.name || r.email}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <label className="block text-xs text-gray-400">
              Subject
              <input className="input-field mt-1" value={emailForm.subject} onChange={e => setEmailForm({ ...emailForm, subject: e.target.value })} maxLength={200} required />
            </label>

            <div>
              <span className="mb-1 block text-xs text-gray-400">Message</span>
              <RichTextEditor
                profile={EMAIL_PROFILE}
                onChange={(html, text) => setEmailForm(prev => ({ ...prev, html, body: text }))}
                placeholder="Write your message… (Ctrl+Enter to send)"
                attachments={emailAttachments}
                onAttachFiles={attachEmailFiles}
                onRemoveAttachment={(index) => setEmailAttachments(prev => prev.filter((_, i) => i !== index))}
                onRequestSend={() => { if (!sendingEmail) void sendContactEmail(new Event("submit") as unknown as React.FormEvent); }}
                disabled={sendingEmail}
                attaching={attachingEmailFiles}
              />
            </div>

            <p className="text-xs text-gray-500">
              Formatting is sent as rich text with a plain-text fallback. Files you attach are stored on the ticket, so they also appear under <span className="text-gray-400">Attachments</span>. Sending requires the configured SMTP service.
            </p>

            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setShowEmailDialog(false)} className="btn-secondary text-sm">Cancel</button>
              <button type="submit" disabled={sendingEmail || !emailForm.subject.trim() || (!emailForm.body.trim() && !emailForm.html.trim())} className="btn-primary text-sm flex items-center gap-2">
                {sendingEmail ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : "Send Email"}
              </button>
            </div>
          </form>
        </div>
      )}

      {offOrgPrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={() => setOffOrgPrompt(null)}>
          <div className="card w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
              <AlertTriangle size={16} className="text-amber-400" /> Outside {orgName || "this client"}
            </h3>
            <p className="text-sm text-gray-300">
              {offOrgSummary(offOrgPrompt.addresses, orgName || "this client", offOrgPrompt.companies)}
            </p>
            <ul className="space-y-1">
              {offOrgPrompt.addresses.map((address) => (
                <li key={address} className="rounded-md bg-surface-lighter px-2 py-1 text-xs text-gray-200">{address}</li>
              ))}
            </ul>
            <p className="text-xs text-gray-500">You can continue — just make sure this is the right person and not a same-named contact at another client.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={() => setOffOrgPrompt(null)}>Go back</button>
              <button type="button" className="btn-primary text-sm" onClick={confirmOffOrgPrompt}>
                {offOrgPrompt.kind === "email" ? "Send anyway" : "Add note anyway"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfigDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowConfigDialog(false)}>
          <div className="card w-full max-w-md mx-4 space-y-3 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white">Link Configuration</h3>
            <input className="input-field" placeholder="Search assets and Kumo configurations..." onChange={e => { setConfigDialogQuery(e.target.value); }} />
            <p className="text-xs text-gray-500">Assets</p>
            {assetResults.filter((a: any) => !configDialogQuery || (a.name || a.tag || "").toLowerCase().includes(configDialogQuery.toLowerCase())).slice(0, 8).map((a: any) => (
              <div key={a.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-lighter">
                <Wrench size={14} className="text-cyber-400 shrink-0" />
                <div className="flex-1 min-w-0"><p className="text-white text-xs font-medium truncate">{a.name || a.tag || a.id}</p><p className="text-gray-500 text-[10px]">Asset</p></div>
                <button onClick={() => { persistCF("ticketConfigurations", [...cfArr("ticketConfigurations"), { id: uuidish(), name: a.name || a.tag || a.id, type: "Asset", kind: "asset", refId: a.id, linkedAt: new Date().toISOString() }]); setShowConfigDialog(false); toast.success("Linked"); }} className="btn-secondary text-xs">Link</button>
              </div>
            ))}
            <p className="text-xs text-gray-500">Kumo Configurations</p>
            {kumoConfigResults.filter((c: any) => !configDialogQuery || (c.kumoAsset?.name || c.hostname || "").toLowerCase().includes(configDialogQuery.toLowerCase())).slice(0, 8).map((c: any) => (
              <div key={c.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-lighter">
                <Wrench size={14} className="text-cyber-400 shrink-0" />
                <div className="flex-1 min-w-0"><p className="text-white text-xs font-medium truncate">{c.kumoAsset?.name || c.hostname || c.id}</p><p className="text-gray-500 text-[10px]">Kumo Config</p></div>
                <button onClick={() => { persistCF("ticketConfigurations", [...cfArr("ticketConfigurations"), { id: uuidish(), name: c.kumoAsset?.name || c.hostname || c.id, type: "Kumo Server", kind: "kumoServer", refId: c.id, linkedAt: new Date().toISOString() }]); setShowConfigDialog(false); toast.success("Linked"); }} className="btn-secondary text-xs">Link</button>
              </div>
            ))}
            <div className="flex justify-end"><button onClick={() => setShowConfigDialog(false)} className="btn-secondary text-sm">Close</button></div>
          </div>
        </div>
      )}

      {showProductDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowProductDialog(false)}>
          <form className="card w-full max-w-sm mx-4 space-y-3" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); if (!productForm.name.trim()) return; persistCF("ticketProducts", [...cfArr("ticketProducts"), { id: uuidish(), ...productForm }]); setProductForm({ name: "", qty: 1, unitCost: 0 }); setShowProductDialog(false); toast.success("Added"); }}>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Package size={16} /> Add Product</h3>
            {canSearchCatalog ? (
              <ProductPicker
                value={productForm.name}
                onValueChange={name => setProductForm({ ...productForm, name, sku: null, productId: null })}
                onPick={p => setProductForm({ ...productForm, name: p.name, sku: p.sku, productId: p.id, unitCost: p.sellPrice })}
                pickedSku={productForm.sku ?? null}
                priceBasis="sell"
                autoFocus
                required
              />
            ) : (
              <input className="input-field" placeholder="Product name *" value={productForm.name} onChange={e => setProductForm({ ...productForm, name: e.target.value })} required />
            )}
            <div className="grid grid-cols-2 gap-2"><input className="input-field" type="number" placeholder="Qty" min={1} value={productForm.qty} onChange={e => setProductForm({ ...productForm, qty: Number(e.target.value) })} /><input className="input-field" type="number" placeholder="Unit price" step="0.01" min={0} value={productForm.unitCost} onChange={e => setProductForm({ ...productForm, unitCost: Number(e.target.value) })} /></div>
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setShowProductDialog(false)} className="btn-secondary text-sm">Cancel</button><button type="submit" className="btn-primary text-sm">Add</button></div>
          </form>
        </div>
      )}

      {showLinkDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowLinkDialog(false)}>
          <div className="card w-full max-w-md mx-4 space-y-3 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Link2 size={16} /> Link Ticket</h3>
            <input className="input-field" placeholder="Search tickets..." value={linkQuery} onChange={e => setLinkQuery(e.target.value)} />
            <select className="input-field" value={linkRel} onChange={e => setLinkRel(e.target.value)}>
              <option value="related">Related</option><option value="parent">Parent</option><option value="child">Child</option><option value="duplicate">Duplicate</option>
            </select>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {linkResults.filter((t: any) => !linkQuery || `${t.ticketNumber} ${t.title}`.toLowerCase().includes(linkQuery.toLowerCase())).slice(0, 12).map((t: any) => (
                <div key={t.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-lighter">
                  <div className="flex-1 min-w-0"><p className="text-white text-xs font-medium truncate">{t.ticketNumber}</p><p className="text-gray-500 text-[10px] truncate">{t.title}</p></div>
                  <button onClick={() => { persistCF("ticketLinks", [...cfArr("ticketLinks"), { id: uuidish(), ticketId: t.id, ticketNumber: t.ticketNumber, title: t.title, rel: linkRel, linkedAt: new Date().toISOString() }]); setShowLinkDialog(false); toast.success("Linked"); }} className="btn-secondary text-xs">Link</button>
                </div>
              ))}
            </div>
            <div className="flex justify-end"><button onClick={() => setShowLinkDialog(false)} className="btn-secondary text-sm">Close</button></div>
          </div>
        </div>
      )}

      {showExpenseDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowExpenseDialog(false)}>
          <form className="card w-full max-w-sm mx-4 space-y-3" onClick={e => e.stopPropagation()} onSubmit={async e => { e.preventDefault(); try { await api.post("/billing/expenses", { ...expenseForm, amount: Number(expenseForm.amount), ticketId: id, miles: expenseForm.miles === "" ? null : Number(expenseForm.miles), expenseDate: expenseForm.expenseDate || new Date().toISOString() }); toast.success("Expense submitted for approval"); setShowExpenseDialog(false); setExpenseForm({ description: "", amount: "", category: "other", vendor: "", miles: "", expenseDate: "" }); await loadExpenses(); } catch (err: unknown) { toast.error(apiErrorMessage(err, "Failed")); } }}>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Receipt size={16} /> Add Expense</h3>
            <input className="input-field" placeholder="Description *" value={expenseForm.description} onChange={e => setExpenseForm({ ...expenseForm, description: e.target.value })} required />
            <div className="grid grid-cols-2 gap-2">
              <input className="input-field" type="number" placeholder="Amount *" step="0.01" min={0} value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} required />
              <select className="input-field" value={expenseForm.category} onChange={e => setExpenseForm({ ...expenseForm, category: e.target.value })}>
                <option value="other">Other</option><option value="parking">Parking</option><option value="hardware">Hardware</option><option value="mileage">Mileage</option><option value="travel">Travel</option><option value="software">Software</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input-field" placeholder="Vendor" value={expenseForm.vendor} onChange={e => setExpenseForm({ ...expenseForm, vendor: e.target.value })} />
              <input className="input-field" type="number" placeholder="Miles" step="0.1" min={0} value={expenseForm.miles} onChange={e => setExpenseForm({ ...expenseForm, miles: e.target.value })} />
            </div>
            <input className="input-field" type="date" value={expenseForm.expenseDate} onChange={e => setExpenseForm({ ...expenseForm, expenseDate: e.target.value })} />
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setShowExpenseDialog(false)} className="btn-secondary text-sm">Cancel</button><button type="submit" className="btn-primary text-sm">Add</button></div>
          </form>
        </div>
      )}

      {showScheduleDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeScheduleDialog}>
          <form className="card w-full max-w-sm mx-4 space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} onSubmit={handleScheduleSubmit}>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Clock size={16} /> {schedulePurpose === "follow-up" ? "Schedule Follow-up" : "Schedule Entry"}</h3>
            <input className="input-field" placeholder="Title *" value={scheduleForm.title} onChange={e => setScheduleForm({ ...scheduleForm, title: e.target.value })} required />
            <div className="grid grid-cols-2 gap-2"><input className="input-field text-xs" type="datetime-local" value={scheduleForm.startTime} onChange={e => setScheduleForm({ ...scheduleForm, startTime: e.target.value })} required /><input className="input-field text-xs" type="datetime-local" value={scheduleForm.endTime} onChange={e => setScheduleForm({ ...scheduleForm, endTime: e.target.value })} required /></div>
            <input className="input-field" placeholder="Location (optional)" value={scheduleForm.location} onChange={e => setScheduleForm({ ...scheduleForm, location: e.target.value })} />
            <textarea className="input-field" rows={3} placeholder="Description or follow-up notes" value={scheduleForm.description} onChange={e => setScheduleForm({ ...scheduleForm, description: e.target.value })} />
            <select className="input-field" aria-label="Assign schedule entry" value={scheduleForm.userId} onChange={e => setScheduleForm({ ...scheduleForm, userId: e.target.value })}><option value="">Assign to me</option>{users.map(user => <option key={user.id} value={user.id}>{user.firstName} {user.lastName}</option>)}</select>
            <div className="flex gap-2 justify-end"><button type="button" onClick={closeScheduleDialog} className="btn-secondary text-sm">Cancel</button><button type="submit" className="btn-primary text-sm">{schedulePurpose === "follow-up" ? "Schedule Follow-up" : "Schedule"}</button></div>
          </form>
        </div>
      )}

      {showAttachDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAttachDialog(false)}>
          <form className="card w-full max-w-sm mx-4 space-y-3" onClick={e => e.stopPropagation()} onSubmit={uploadAttachment}>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Paperclip size={16} /> Attach File</h3>
            <p className="text-xs text-gray-500">Upload a file up to 5 MB. File contents are stored with the API.</p>
            <input type="file" className="input-field" onChange={e => setAttachForm({ file: e.target.files?.[0] || null })} />
            {attachForm.file && <p className="text-xs text-gray-400">{attachForm.file.name} · {(attachForm.file.size / 1024).toFixed(1)} KB</p>}
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setShowAttachDialog(false)} className="btn-secondary text-sm">Cancel</button><button type="submit" disabled={!attachForm.file || uploadingAttachment} className="btn-primary text-sm">{uploadingAttachment ? "Uploading…" : "Attach"}</button></div>
          </form>
        </div>
      )}

      {showTimeEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowTimeEntry(false)}>
          <form className="card w-full max-w-lg mx-4 space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} onSubmit={handleTimeEntry}>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Timer size={16} /> Add Time Entry</h3>
            <p className="text-xs text-gray-500">Log work performed on {ticket.ticketNumber as string} — {ticket.title as string}.</p>

            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-gray-500 block mb-1">Work Date</label><input className="input-field text-xs" type="date" value={timeForm.date} onChange={e => setTimeForm({ ...timeForm, date: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Resource</label>
                <select className="input-field text-xs" value={timeForm.userId} onChange={e => setTimeForm({ ...timeForm, userId: e.target.value })}>
                  {currentUser && !users.some(u => u.id === currentUser.id) && <option value={currentUser.id}>{`${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim() || currentUser.email}</option>}
                  {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-gray-500 block mb-1">Start Time</label><input className="input-field text-xs" type="datetime-local" value={timeForm.startTime} onChange={e => updateTimeForm("startTime", e.target.value)} required /></div>
              <div><label className="text-xs text-gray-500 block mb-1">End Time</label><input className="input-field text-xs" type="datetime-local" value={timeForm.endTime} onChange={e => updateTimeForm("endTime", e.target.value)} required /></div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-gray-500 block mb-1">Duration</label><input className="input-field text-xs" readOnly value={timeForm.calculated} placeholder="Auto-calculated" /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Billing</label>
                <select className="input-field text-xs" value={timeForm.billing} onChange={e => setTimeForm({ ...timeForm, billing: e.target.value as any })}>
                  <option value="billable">Billable</option>
                  <option value="nonBillable">Non-billable</option>
                  <option value="noCharge">No Charge</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-gray-500 block mb-1">Work Type</label>
                <select className="input-field text-xs" value={timeForm.workType} onChange={e => setTimeForm({ ...timeForm, workType: e.target.value })}>
                  <option value="">— Select —</option>
                  {WORK_TYPES.map(w => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div><label className="text-xs text-gray-500 block mb-1">Work Role</label>
                <select className="input-field text-xs" value={timeForm.workRole} onChange={e => setTimeForm({ ...timeForm, workRole: e.target.value })}>
                  <option value="">— Select —</option>
                  {WORK_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-gray-500 block mb-1">Hourly Rate (optional)</label><input className="input-field text-xs" type="number" min="0" step="0.01" placeholder="Use agreement rate" value={timeForm.rate} onChange={e => setTimeForm({ ...timeForm, rate: e.target.value })} /></div>
              <div className="flex items-end pb-1">{timeForm.billing === "noCharge" && <p className="text-[10px] text-amber-400">No Charge entries are billed at $0 and excluded from invoices.</p>}</div>
            </div>

            <div><label className="text-xs text-gray-500 block mb-1">Notes (shown on invoice)</label><textarea className="input-field text-sm" rows={2} placeholder="Describe the work performed" value={timeForm.description} onChange={e => setTimeForm({ ...timeForm, description: e.target.value })} required /></div>
            <div><label className="text-xs text-gray-500 block mb-1">Internal Notes (not shown to client)</label><textarea className="input-field text-sm" rows={2} placeholder="Internal detail (optional)" value={timeForm.internalNotes} onChange={e => setTimeForm({ ...timeForm, internalNotes: e.target.value })} /></div>

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowTimeEntry(false)} className="btn-secondary text-sm">Cancel</button>
              <button type="submit" className="btn-primary text-sm">Save Time Entry</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
