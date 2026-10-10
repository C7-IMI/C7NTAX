import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  CheckCircle2, ClipboardList, Copy, Filter, ListChecks, Plus, RefreshCw, Search, Square, SquareCheckBig,
  Trash2, User as UserIcon, CalendarDays,
} from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import { ContextMenu, useContextMenu, isTextEntryTarget, type MenuEntry } from "../components/ContextMenu";
import { RichTextEditor, DOCUMENT_PROFILE } from "../components/richText";
import { SortableHeader, sortData, nextSort, type SortState } from "../components/SortableHeader";
import { kumoTrail, useBreadcrumbTrail, kumoClientTrail } from "../components/Breadcrumbs";
import { currentView, copyText, openInNewTab, openInNewWindow, viewMenuEntries } from "../lib/menuActions";
import { toCsv, downloadCsv, fileStamp, type CsvColumn } from "../lib/csv";
import { PageHeader, ListFooter, ListViews, StatCard, Tabs } from "../components/ui";
import { useModernInterface } from "../hooks/useNavigationStyle";

interface ChecklistRow {
  id: string;
  name: string;
  description: string | null;
  dueDate: string | null;
  updatedAt: string;
  taskCount: number;
  completedCount: number;
  progress: number;
  company: { id: string; name: string } | null;
  assignedTo: { id: string; firstName: string; lastName: string } | null;
}

interface TaskRow {
  id: string;
  title: string;
  dueDate: string | null;
  completedAt: string | null;
  assignedTo: { id: string; firstName: string; lastName: string } | null;
  checklist: { id: string; name: string; company: { id: string; name: string } | null } | null;
}

const personName = (person: { firstName?: string; lastName?: string } | null | undefined) =>
  person ? [person.firstName, person.lastName].filter(Boolean).join(" ").trim() || "Unnamed" : "";

const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

/** Due dates read as a status: overdue, today, soon, or just a date. */
function dueLabel(value: string | null | undefined, completed?: boolean) {
  if (!value) return { text: "Due date", tone: "text-gray-600" };
  const due = new Date(value);
  const days = Math.round((due.getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  if (!completed && days < 0) return { text: formatDate(value), tone: "text-red-400" };
  if (!completed && days === 0) return { text: "Today", tone: "text-amber-400" };
  if (days <= 3) return { text: formatDate(value), tone: "text-amber-300" };
  return { text: formatDate(value), tone: "text-gray-400" };
}

const COLUMNS: Array<{ id: string; label: string; always?: boolean }> = [
  { id: "name", label: "Checklist Name", always: true },
  { id: "company", label: "Client" },
  { id: "assignee", label: "Assignee" },
  { id: "due", label: "Due" },
  { id: "progress", label: "Tasks" },
];

const COLUMN_KEY = "c7_checklist_columns";

function loadColumns(): string[] {
  try {
    const raw = localStorage.getItem(COLUMN_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch { /* default below */ }
  return COLUMNS.map((c) => c.id);
}

export function ChecklistsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const companyId = searchParams.get("companyId") || "";
  const menu = useContextMenu();

  const [tab, setTab] = useState<"checklists" | "tasks">("checklists");
  const modern = useModernInterface();
  const [view, setView] = useState("all");
  const [checklists, setChecklists] = useState<ChecklistRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [users, setUsers] = useState<Array<{ id: string; firstName: string; lastName: string }>>([]);
  const [filter, setFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [sort, setSort] = useState<SortState | null>({ field: "updatedAt", direction: "desc" });
  const [visibleColumns, setVisibleColumns] = useState<string[]>(loadColumns);
  const [showColumns, setShowColumns] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", companyId: "", assignedToId: "", dueDate: "", description: "", tasks: "" });

  useBreadcrumbTrail(
    companyId && clients.find((c) => c.id === companyId)
      ? kumoClientTrail(companyId, clients.find((c) => c.id === companyId)!.name, { label: "Checklists", to: "/kumo/checklists" })
      : kumoTrail({ label: "Checklists", to: "/kumo/checklists" }),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, taskRes] = await Promise.all([
        api.get("/checklists", { params: { companyId: companyId || undefined } }),
        // My tasks are the ones still to do — completing one clears it from the list.
        api.get("/checklists/my-tasks", { params: { companyId: companyId || undefined } }),
      ]);
      setChecklists(listRes.data?.data || []);
      setTasks(taskRes.data?.data || []);
    } catch {
      toast.error("Could not load checklists");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    Promise.all([api.get("/clients?limit=200"), api.get("/users?limit=200")])
      .then(([c, u]) => {
        setClients(c.data?.data || []);
        setUsers(u.data?.data || []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    try { localStorage.setItem(COLUMN_KEY, JSON.stringify(visibleColumns)); } catch { /* ignore */ }
  }, [visibleColumns]);

  const shows = (id: string) => visibleColumns.includes(id);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const rows = checklists.filter((row) => {
      if (assigneeFilter && row.assignedTo?.id !== assigneeFilter) return false;
      if (!needle) return true;
      return [row.name, row.company?.name, personName(row.assignedTo)].some((value) => (value || "").toLowerCase().includes(needle));
    });
    return sortData(rows as unknown as Array<Record<string, unknown>>, sort?.field || "updatedAt", sort?.direction || "desc") as unknown as ChecklistRow[];
  }, [checklists, filter, assigneeFilter, sort]);

  const visibleTasks = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return tasks.filter((task) => !needle || [task.title, task.checklist?.name, task.checklist?.company?.name].some((value) => (value || "").toLowerCase().includes(needle)));
  }, [tasks, filter]);

  /*
   * The state a checklist is in, and — on the other tab — a task. Both are things the rows already
   * say; the strip only counts them, and a view narrows what is on screen without re-reading
   * anything. A checklist counts as done when it has tasks and every one of them is complete.
   */
  const isComplete = (row: ChecklistRow) => row.taskCount > 0 && row.completedCount === row.taskCount;
  const isOverdue = (row: ChecklistRow) =>
    Boolean(row.dueDate) && !isComplete(row) && new Date(row.dueDate as string).getTime() < new Date().setHours(0, 0, 0, 0);

  const checklistViews = [
    { id: "all", label: "All", count: checklists.length },
    { id: "open", label: "Open", count: checklists.filter((row) => !isComplete(row)).length },
    { id: "complete", label: "Complete", count: checklists.filter(isComplete).length },
    { id: "overdue", label: "Overdue", count: checklists.filter(isOverdue).length },
  ];
  const taskViews = [
    { id: "all", label: "All", count: tasks.length },
    { id: "open", label: "Open", count: tasks.filter((task) => !task.completedAt).length },
    { id: "done", label: "Done", count: tasks.filter((task) => Boolean(task.completedAt)).length },
  ];
  const inView = (row: ChecklistRow) =>
    view === "open" ? !isComplete(row) : view === "complete" ? isComplete(row) : view === "overdue" ? isOverdue(row) : true;
  const shownRows = visible.filter(inView);
  const shownTasks = visibleTasks.filter((task) =>
    view === "open" ? !task.completedAt : view === "done" ? Boolean(task.completedAt) : true);

  /** The two tabs show different lists, so the view the strip named is let go when the tab changes. */
  const switchTab = (next: "checklists" | "tasks") => { setTab(next); setView("all"); };

  const openChecklist = (id: string) => navigate(`/kumo/checklists/${id}`);

  const duplicate = async (row: ChecklistRow) => {
    try {
      const response = await api.post(`/checklists/${row.id}/duplicate`, {});
      toast.success(`Copied "${row.name}"`);
      void load();
      if (response.data?.id) openChecklist(response.data.id);
    } catch { toast.error("Could not copy that checklist"); }
  };

  const remove = async (row: ChecklistRow) => {
    if (!window.confirm(`Delete "${row.name}" and its ${row.taskCount} task${row.taskCount === 1 ? "" : "s"}?`)) return;
    try {
      await api.delete(`/checklists/${row.id}`);
      toast.success("Checklist deleted");
      setSelected((prev) => { const next = new Set(prev); next.delete(row.id); return next; });
      void load();
    } catch { toast.error("Could not delete that checklist"); }
  };

  const removeSelected = async () => {
    const targets = shownRows.filter((row) => selected.has(row.id));
    if (!targets.length) return;
    if (!window.confirm(`Delete ${targets.length} checklist${targets.length === 1 ? "" : "s"}?`)) return;
    setBusy(true);
    try {
      await Promise.all(targets.map((row) => api.delete(`/checklists/${row.id}`)));
      toast.success(`${targets.length} checklist${targets.length === 1 ? "" : "s"} deleted`);
      setSelected(new Set());
      void load();
    } catch { toast.error("Some checklists could not be deleted"); }
    finally { setBusy(false); }
  };

  const toggleTask = async (task: TaskRow) => {
    const completed = !task.completedAt;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completedAt: completed ? new Date().toISOString() : null } : t)));
    try {
      await api.patch(`/checklists/${task.checklist?.id}/tasks/${task.id}`, { completed });
      void load();
    } catch {
      toast.error("Could not update that task");
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completedAt: task.completedAt } : t)));
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const company = form.companyId || companyId;
    if (!form.name.trim()) { toast.error("Give the checklist a name"); return; }
    if (!company) { toast.error("Choose the client this checklist belongs to"); return; }
    setCreating(true);
    try {
      const response = await api.post("/checklists", {
        name: form.name,
        companyId: company,
        assignedToId: form.assignedToId || undefined,
        dueDate: form.dueDate || undefined,
        description: form.description || undefined,
        tasks: form.tasks.split("\n").map((line) => line.trim()).filter(Boolean),
      });
      toast.success("Checklist created");
      setShowNew(false);
      setForm({ name: "", companyId: "", assignedToId: "", dueDate: "", description: "", tasks: "" });
      if (response.data?.id) openChecklist(response.data.id);
      else void load();
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { error?: { message?: string } | string } } })?.response?.data?.error;
      toast.error(typeof message === "string" ? message : message?.message || "Could not create that checklist");
    } finally { setCreating(false); }
  };

  const exportCsv = () => {
    const columns: CsvColumn<ChecklistRow>[] = [
      { key: "name", label: "Checklist", value: (row) => row.name },
      { key: "client", label: "Client", value: (row) => row.company?.name || "" },
      { key: "assignee", label: "Assignee", value: (row) => personName(row.assignedTo) },
      { key: "due", label: "Due", value: (row) => formatDate(row.dueDate) },
      { key: "tasks", label: "Tasks", value: (row) => `${row.completedCount} of ${row.taskCount}` },
      { key: "updated", label: "Updated", value: (row) => new Date(row.updatedAt).toISOString() },
    ];
    const rows = tab === "checklists" ? visible : [];
    if (!rows.length) { toast.error("Nothing to export on this tab"); return; }
    downloadCsv(`checklists-${fileStamp()}.csv`, toCsv(rows, columns));
  };

  const sectionMenu = (): MenuEntry[] => [
    { label: "New checklist", icon: Plus, onSelect: () => setShowNew(true) },
    { label: "Refresh", icon: RefreshCw, onSelect: () => void load() },
    "separator",
    { label: "Export CSV", onSelect: exportCsv },
    ...viewMenuEntries(currentView()),
  ];

  const rowMenu = (row: ChecklistRow): MenuEntry[] => [
    { label: "Open", onSelect: () => openChecklist(row.id) },
    { label: "Open in new tab", onSelect: () => openInNewTab(`/kumo/checklists/${row.id}`) },
    { label: "Open in new window", onSelect: () => openInNewWindow(`/kumo/checklists/${row.id}`) },
    "separator",
    { label: "Duplicate", icon: Copy, onSelect: () => void duplicate(row) },
    { label: "Copy link", onSelect: () => void copyText(absoluteChecklistUrl(row.id), "Checklist link") },
    "separator",
    { label: "Copy name", onSelect: () => void copyText(row.name, "Checklist name") },
    { label: "Delete", icon: Trash2, danger: true, onSelect: () => void remove(row) },
  ];

  const allVisibleSelected = shownRows.length > 0 && shownRows.every((row) => selected.has(row.id));

  return (
    <div
      className="space-y-4 animate-fade-in"
      onContextMenu={(e) => { if (isTextEntryTarget(e.target)) return; menu.open(e, sectionMenu()); }}
    >
      <ContextMenu state={menu.menuState} onClose={menu.close} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader variant="section" title="Checklists" subtitle={tab === "checklists"
              ? `${visible.length} of ${checklists.length} checklists${companyId ? ` · ${clients.find((c) => c.id === companyId)?.name || ""}` : ""}`
              : `${visibleTasks.length} task${visibleTasks.length === 1 ? "" : "s"} assigned to you`} />
        <div className="flex items-center gap-2">
          {companyId && (
            <button onClick={() => setSearchParams({})} className="btn-secondary text-sm flex items-center gap-1" title="Show every client">
              {clients.find((c) => c.id === companyId)?.name || "Client"} ✕
            </button>
          )}
          <button onClick={() => setShowNew(true)} className="btn-primary text-sm flex items-center gap-1"><Plus size={14} /> New</button>
        </div>
      </div>

      {/* The figures the page already holds, read from the two lists beneath it: how many checklists
          there are, how many are done, how many are past their date, and the tasks waiting on you. */}
      {modern && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Checklists" value={checklists.length} icon={<ClipboardList size={13} />} tone="cyber" />
          <StatCard label="Complete" value={checklists.filter(isComplete).length} icon={<CheckCircle2 size={13} />} tone="green" />
          <StatCard label="Overdue" value={checklists.filter(isOverdue).length} icon={<CalendarDays size={13} />} tone="red" />
          <StatCard label="Tasks assigned to you" value={tasks.length} icon={<ListChecks size={13} />} tone="neutral" />
        </div>
      )}

      {modern ? (
        <Tabs
          label="Checklist sections"
          items={[
            { id: "checklists" as const, label: "Checklists" },
            { id: "tasks" as const, label: "My Tasks" },
          ]}
          value={tab === "tasks" ? "tasks" : "checklists"}
          onChange={(id) => switchTab(id === "tasks" ? "tasks" : "checklists")}
        />
      ) : (
      <div className="flex items-center gap-4 border-b border-surface-border">
        {([["checklists", "Checklists"], ["tasks", "My Tasks"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => switchTab(key)}
            className={`-mb-px border-b-2 px-1 pb-2 text-sm transition-colors ${
              tab === key ? "border-cyber-500 text-white" : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      )}

      {modern && (
        <div className="flex flex-wrap items-center gap-2">
          <ListViews
            views={tab === "tasks" ? taskViews : checklistViews}
            value={view}
            onChange={setView}
            label={tab === "tasks" ? "Task views" : "Checklist views"}
          />
          <span className="text-xs text-gray-500 tabular-nums">
            {tab === "tasks"
              ? `${shownTasks.length} of ${visibleTasks.length} task${visibleTasks.length === 1 ? "" : "s"} shown`
              : `${shownRows.length} of ${visible.length} checklist${visible.length === 1 ? "" : "s"} shown`}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
          <input
            className="input-field pl-8 text-sm"
            placeholder="Filter columns or search keywords…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          <Filter size={12} /> Assignee
          <select className="input-field py-1 text-xs" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
            <option value="">Anyone</option>
            {users.map((u) => <option key={u.id} value={u.id}>{personName(u)}</option>)}
          </select>
        </label>
        {selected.size > 0 && (
          <button onClick={() => void removeSelected()} disabled={busy} className="btn-secondary text-xs flex items-center gap-1 text-red-400">
            <Trash2 size={12} /> Delete {selected.size} selected
          </button>
        )}
        <div className="relative">
          <button onClick={() => setShowColumns((v) => !v)} className="btn-secondary text-xs" title="Choose columns">Columns</button>
          {showColumns && (
            <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-surface-border bg-surface p-1.5 shadow-xl">
              {COLUMNS.map((column) => (
                <label key={column.id} className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${column.always ? "text-gray-600" : "text-gray-300 hover:bg-surface-lighter"} ${column.always ? "cursor-not-allowed" : "cursor-pointer"}`}>
                  <input
                    type="checkbox"
                    disabled={column.always}
                    checked={shows(column.id)}
                    onChange={(e) => setVisibleColumns((prev) => (e.target.checked ? [...prev, column.id] : prev.filter((id) => id !== column.id)))}
                  />
                  {column.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="card text-center text-gray-500">Loading…</div>
      ) : tab === "checklists" ? (
        checklists.length === 0 ? (
          <div className="card text-center py-12">
            <ClipboardList size={40} className="mx-auto mb-3 text-gray-600" />
            <p className="text-gray-500">No checklists{companyId ? " for this client" : ""} yet.</p>
            <button onClick={() => setShowNew(true)} className="btn-primary mt-3 text-sm">Create the first one</button>
          </div>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wider text-gray-500">
                  <th className="w-10 px-3 py-2">
                    <button
                      onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(shownRows.map((row) => row.id)))}
                      title={allVisibleSelected ? "Clear selection" : "Select all"}
                      aria-label={allVisibleSelected ? "Clear selection" : "Select all"}
                      className="text-gray-500 hover:text-white"
                    >
                      {allVisibleSelected ? <SquareCheckBig size={14} /> : <Square size={14} />}
                    </button>
                  </th>
                  {shows("name") && <SortableHeader label="Checklist Name" field="name" sort={sort} onSort={(field) => setSort(nextSort(sort, field))} className="px-3 py-2" />}
                  {shows("company") && <SortableHeader label="Client" field="company.name" sort={sort} onSort={(field) => setSort(nextSort(sort, field))} className="px-3 py-2" />}
                  {shows("assignee") && <SortableHeader label="Assignee" field="assignedTo.firstName" sort={sort} onSort={(field) => setSort(nextSort(sort, field))} className="px-3 py-2" />}
                  {shows("due") && <SortableHeader label="Due" field="dueDate" sort={sort} onSort={(field) => setSort(nextSort(sort, field))} className="px-3 py-2" />}
                  {shows("progress") && <SortableHeader label="Tasks" field="completedCount" sort={sort} onSort={(field) => setSort(nextSort(sort, field))} className="px-3 py-2" />}
                  <th className="w-24 px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {modern && shownRows.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-500">Nothing in this view.</td></tr>
                )}
                {shownRows.map((row) => (
                  <tr
                    key={row.id}
                    className="group border-b border-surface-border/60 last:border-0 hover:bg-surface-lighter/40"
                    onContextMenu={(e) => menu.open(e, rowMenu(row), { title: row.name })}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={(e) => setSelected((prev) => { const next = new Set(prev); if (e.target.checked) next.add(row.id); else next.delete(row.id); return next; })}
                        aria-label={`Select ${row.name}`}
                      />
                    </td>
                    {shows("name") && (
                      <td className="px-3 py-2">
                        <Link to={`/kumo/checklists/${row.id}`} className="flex items-center gap-2 text-cyber-300 hover:text-cyber-200">
                          <CheckCircle2 size={16} className={row.taskCount && row.completedCount === row.taskCount ? "text-emerald-400" : "text-gray-500"} />
                          <span className="font-medium">{row.name}</span>
                        </Link>
                      </td>
                    )}
                    {shows("company") && <td className="px-3 py-2 text-gray-400">{row.company?.name || "—"}</td>}
                    {shows("assignee") && (
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1.5 ${row.assignedTo ? "text-gray-300" : "text-gray-600"}`}>
                          <UserIcon size={12} /> {personName(row.assignedTo) || "Unassigned"}
                        </span>
                      </td>
                    )}
                    {shows("due") && (
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1.5 ${dueLabel(row.dueDate, row.taskCount > 0 && row.completedCount === row.taskCount).tone}${modern ? " tabular-nums" : ""}`}>
                          <CalendarDays size={12} /> {dueLabel(row.dueDate).text}
                        </span>
                      </td>
                    )}
                    {shows("progress") && (
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {modern ? (
                            <span className={`chip text-[10px] ${row.taskCount > 0 && row.completedCount === row.taskCount ? "chip--good" : ""}`}>
                              {row.taskCount > 0 && row.completedCount === row.taskCount ? "complete" : "open"}
                              <span className="chip__n">{row.completedCount}/{row.taskCount}</span>
                            </span>
                          ) : (
                            <span className="tabular-nums text-gray-400">{row.completedCount} of {row.taskCount}</span>
                          )}
                          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-lighter">
                            <span className="block h-full rounded-full bg-cyber-500" style={{ width: `${row.progress}%` }} />
                          </span>
                        </div>
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button onClick={() => void duplicate(row)} title="Duplicate" aria-label={`Duplicate ${row.name}`} className="rounded p-1 text-gray-500 hover:bg-surface hover:text-white"><Copy size={13} /></button>
                        <button onClick={() => void remove(row)} title="Delete" aria-label={`Delete ${row.name}`} className="rounded p-1 text-gray-500 hover:bg-surface hover:text-red-400"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {modern && (
              <ListFooter
                from={1}
                to={shownRows.length}
                total={shownRows.length}
                page={1}
                pages={1}
                onPage={() => {}}
                note={`${checklists.length} checklist${checklists.length === 1 ? "" : "s"} in total`}
              />
            )}
          </div>
        )
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="w-10 px-3 py-2"><ListChecks size={13} /></th>
                <th className="px-3 py-2">Task</th>
                <th className="px-3 py-2">Checklist</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">State</th>
              </tr>
            </thead>
            <tbody>
              {shownTasks.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">{modern && visibleTasks.length > 0 ? "Nothing in this view." : <>Nothing assigned to you{companyId ? " for this client" : ""}.</>}</td></tr>
              )}
              {shownTasks.map((task) => (
                <tr key={task.id} className="border-b border-surface-border/60 last:border-0 hover:bg-surface-lighter/40">
                  <td className="px-3 py-2">
                    <button
                      onClick={() => void toggleTask(task)}
                      title={task.completedAt ? "Mark as not done" : "Mark as done"}
                      aria-label={task.completedAt ? `Reopen ${task.title}` : `Complete ${task.title}`}
                      className={task.completedAt ? "text-emerald-400" : "text-gray-500 hover:text-white"}
                    >
                      <CheckCircle2 size={16} />
                    </button>
                  </td>
                  <td className={`px-3 py-2 ${task.completedAt ? "text-gray-500 line-through" : "text-white"}`}>{task.title}</td>
                  <td className="px-3 py-2">
                    {task.checklist && <Link to={`/kumo/checklists/${task.checklist.id}`} className="text-cyber-300 hover:text-cyber-200">{task.checklist.name}</Link>}
                  </td>
                  <td className="px-3 py-2 text-gray-400">{task.checklist?.company?.name || "—"}</td>
                  <td className="px-3 py-2"><span className={`${dueLabel(task.dueDate, Boolean(task.completedAt)).tone}${modern ? " tabular-nums" : ""}`}>{dueLabel(task.dueDate).text}</span></td>
                  <td className="px-3 py-2 text-xs text-gray-500">{modern
                    ? <span className={`chip text-[10px] ${task.completedAt ? "chip--good" : ""}`}>{task.completedAt ? "Done" : "Open"}</span>
                    : task.completedAt ? "Done" : "Open"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {modern && (
            <ListFooter
              from={1}
              to={shownTasks.length}
              total={shownTasks.length}
              page={1}
              pages={1}
              onPage={() => {}}
              note={`${tasks.length} task${tasks.length === 1 ? "" : "s"} assigned to you`}
            />
          )}
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowNew(false)}>
          <form className="card w-full max-w-2xl space-y-3 overflow-y-auto max-h-[92vh]" onClick={(e) => e.stopPropagation()} onSubmit={create}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold text-white">New Checklist</h3>
              <button type="button" onClick={() => setShowNew(false)} className="rounded p-1 text-gray-500 hover:bg-surface-lighter hover:text-white" aria-label="Close" title="Close">✕</button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs text-gray-400 sm:col-span-2">
                Name <span className="text-red-400">*</span>
                <input className="input-field mt-1" placeholder="New PC Setup List" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
              </label>
              <label className="text-xs text-gray-400">
                Client <span className="text-red-400">*</span>
                <select
                  className="input-field mt-1"
                  value={form.companyId || companyId}
                  disabled={Boolean(companyId)}
                  onChange={(e) => setForm({ ...form, companyId: e.target.value })}
                  required
                >
                  <option value="">Select client…</option>
                  {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-400">
                Assignee
                <select className="input-field mt-1" value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}>
                  <option value="">Unassigned</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{personName(u)}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-400">
                Due date
                <input type="date" className="input-field mt-1" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </label>
              <label className="text-xs text-gray-400 sm:col-span-2">
                Tasks — one per line
                <textarea
                  className="input-field mt-1 text-sm"
                  rows={5}
                  placeholder={"Install custom Cisco AnyConnect client\nImport profile xml file\nDuo enrollment"}
                  value={form.tasks}
                  onChange={(e) => setForm({ ...form, tasks: e.target.value })}
                />
              </label>
            </div>

            <div>
              <span className="mb-1 block text-xs text-gray-400">Description</span>
              <RichTextEditor
                profile={DOCUMENT_PROFILE}
                onChange={(html) => setForm((prev) => ({ ...prev, description: html }))}
                placeholder="What is this checklist for?"
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-surface-border pt-3">
              <button type="button" className="btn-secondary text-sm" onClick={() => setShowNew(false)}>Cancel</button>
              <button type="submit" disabled={creating} className="btn-primary text-sm">{creating ? "Creating…" : "Create Checklist"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const absoluteChecklistUrl = (id: string) => `${window.location.origin}/kumo/checklists/${id}`;
