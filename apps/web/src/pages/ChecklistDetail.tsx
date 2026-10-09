import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  CalendarDays, CheckCircle2, ChevronDown, ChevronUp, Circle, CornerDownLeft, Loader2, Trash2, User as UserIcon,
} from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import { RichTextEditor, DOCUMENT_PROFILE } from "../components/richText";
import { kumoClientTrail, useBreadcrumbTrail } from "../components/Breadcrumbs";
import { useRedesign } from "../hooks/useNavigationStyle";

interface Person { id: string; firstName: string; lastName: string; email?: string }

interface Task {
  id: string;
  title: string;
  notes: string | null;
  position: number;
  dueDate: string | null;
  completedAt: string | null;
  assignedToId: string | null;
  assignedTo: Person | null;
}

interface Checklist {
  id: string;
  name: string;
  description: string | null;
  dueDate: string | null;
  companyId: string;
  company: { id: string; name: string } | null;
  assignedToId: string | null;
  assignedTo: Person | null;
  tasks: Task[];
  taskCount: number;
  completedCount: number;
  progress: number;
}

const personName = (person: Person | null | undefined) =>
  person ? [person.firstName, person.lastName].filter(Boolean).join(" ").trim() || "Unnamed" : "";

const dateValue = (value: string | null) => (value ? new Date(value).toISOString().slice(0, 10) : "");

const dueText = (value: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Due Date";

/** Due in the past, or today, is worth colouring; everything else is plain. */
function dueTone(value: string | null, completed: boolean) {
  if (!value || completed) return "text-gray-400";
  const days = Math.round((new Date(value).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  if (days < 0) return "text-red-400";
  if (days === 0) return "text-amber-400";
  return "text-gray-400";
}

/** Assignee chip used by the checklist header and by every task row. */
function AssigneeControl({
  value, users, onChange, disabled,
}: {
  value: Person | null;
  users: Person[];
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${value ? "text-cyber-300" : "text-gray-500"}`}>
      <UserIcon size={13} />
      <select
        className="cursor-pointer appearance-none bg-transparent pr-1 text-xs outline-none"
        value={value?.id || ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        title="Assignee"
        aria-label="Assignee"
      >
        <option value="">Unassigned</option>
        {users.map((user) => (
          <option key={user.id} value={user.id} className="bg-surface text-white">{personName(user)}</option>
        ))}
      </select>
    </span>
  );
}

/** Due-date chip: a date input dressed as a label so empty rows read "Due Date". */
function DueControl({
  value, onSave, completed,
}: {
  value: string | null;
  onSave: (value: string | null) => void;
  completed?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${dueTone(value, Boolean(completed))}`}>
      <CalendarDays size={13} />
      <input
        type="date"
        value={dateValue(value)}
        onChange={(e) => onSave(e.target.value || null)}
        title="Due date"
        aria-label="Due date"
        className="w-[6.5rem] cursor-pointer bg-transparent text-xs outline-none [&::-webkit-calendar-picker-indicator]:opacity-0 hover:[&::-webkit-calendar-picker-indicator]:opacity-60"
      />
      {value && <span className="sr-only">{dueText(value)}</span>}
    </span>
  );
}

export function ChecklistDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const redesign = useRedesign();
  const [, setTick] = useState(0);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [users, setUsers] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingDescription, setSavingDescription] = useState(false);
  const [draftRows, setDraftRows] = useState<number[]>([]);
  const draftRefs = useRef<Map<number, HTMLInputElement | null>>(new Map());
  const descriptionRef = useRef("");
  const descriptionTimer = useRef<number | null>(null);
  const nextDraftKey = useRef(1);

  useBreadcrumbTrail(
    checklist
      ? kumoClientTrail(checklist.companyId, checklist.company?.name, { label: "Checklists", to: "/kumo/checklists" }, { label: checklist.name })
      : null,
  );

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!id) return;
    if (!options.silent) setLoading(true);
    try {
      const response = await api.get(`/checklists/${id}`);
      setChecklist(response.data);
      descriptionRef.current = response.data?.description || "";
    } catch {
      toast.error("Could not load that checklist");
      navigate("/kumo/checklists");
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api.get("/users?limit=200").then((r) => setUsers(r.data?.data || [])).catch(() => {}); }, []);

  const saveChecklist = async (patch: Record<string, unknown>, options: { silent?: boolean } = {}) => {
    const previous = checklist;
    setChecklist((prev) => (prev ? { ...prev, ...patch } as Checklist : prev));
    try {
      const response = await api.patch(`/checklists/${id}`, patch);
      setChecklist(response.data);
    } catch {
      toast.error("Could not save that change");
      setChecklist(previous);
    } finally {
      if (!options.silent) void load({ silent: true });
    }
  };

  /** Direct field edits (name, assignee, due) save as they change. */
  const patchChecklist = (patch: Record<string, unknown>) => void saveChecklist(patch);

  const flushDescription = (html: string) => {
    descriptionRef.current = html;
    if (descriptionTimer.current) window.clearTimeout(descriptionTimer.current);
    descriptionTimer.current = window.setTimeout(() => {
      descriptionTimer.current = null;
      setSavingDescription(true);
      void saveChecklist({ description: descriptionRef.current }, { silent: true })
        .finally(() => setSavingDescription(false));
    }, 700);
  };

  const addTask = async (title: string, options: { keepDraft?: boolean } = {}) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      await api.post(`/checklists/${id}/tasks`, { title: trimmed });
      await load({ silent: true });
      if (options.keepDraft) focusDraft(draftRows[draftRows.length - 1] ?? 0);
    } catch {
      toast.error("Could not add that task");
    }
  };

  const patchTask = async (task: Task, patch: Record<string, unknown>) => {
    setChecklist((prev) => (prev ? { ...prev, tasks: prev.tasks.map((t) => (t.id === task.id ? { ...t, ...patch } as Task : t)) } : prev));
    try {
      const response = await api.patch(`/checklists/${id}/tasks/${task.id}`, patch);
      setChecklist((prev) => (prev ? { ...prev, tasks: prev.tasks.map((t) => (t.id === task.id ? { ...t, ...response.data } : t)) } : prev));
      void load({ silent: true });
    } catch {
      toast.error("Could not save that task");
      void load({ silent: true });
    }
  };

  const removeTask = async (task: Task) => {
    try {
      await api.delete(`/checklists/${id}/tasks/${task.id}`);
      void load({ silent: true });
    } catch { toast.error("Could not delete that task"); }
  };

  /** Up/down reorder — kept simple and predictable rather than drag-and-drop. */
  const moveTask = async (task: Task, direction: -1 | 1) => {
    if (!checklist) return;
    const ordered = [...checklist.tasks].sort((a, b) => a.position - b.position);
    const index = ordered.findIndex((t) => t.id === task.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    // Destructuring swaps need non-optional positions; the bounds are checked above.
    const moved = ordered[index] as Task;
    const replaced = ordered[target] as Task;
    ordered[index] = replaced;
    ordered[target] = moved;
    setChecklist({ ...checklist, tasks: ordered });
    try {
      await api.post(`/checklists/${id}/tasks/reorder`, { taskIds: ordered.map((t) => t.id) });
    } catch { toast.error("Could not reorder tasks"); }
    finally { void load({ silent: true }); }
  };

  const addDraftRow = () => {
    nextDraftKey.current += 1;
    const key = nextDraftKey.current;
    setDraftRows((prev) => [...prev, key]);
    window.setTimeout(() => focusDraft(key), 30);
  };

  const focusDraft = (key: number) => {
    draftRefs.current.get(key)?.focus();
    setTick((t) => t + 1);
  };

  const tasks = useMemo(
    () => (checklist?.tasks ? [...checklist.tasks].sort((a, b) => a.position - b.position) : []),
    [checklist],
  );

  if (loading || !checklist) {
    return <div className="card text-center text-gray-500">Loading checklist…</div>;
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <CheckCircle2 size={22} className={checklist.taskCount && checklist.completedCount === checklist.taskCount ? "text-emerald-400" : "text-cyber-400"} />
          <input
            className="min-w-[12rem] flex-1 border-b border-transparent bg-transparent text-xl font-semibold text-white outline-none focus:border-surface-border"
            value={checklist.name}
            onChange={(e) => setChecklist({ ...checklist, name: e.target.value })}
            onBlur={() => {
              const name = checklist.name.trim();
              if (!name) { void load({ silent: true }); return; }
              if (name !== checklist.name) setChecklist((prev) => (prev ? { ...prev, name } : prev));
              if (name) patchChecklist({ name });
            }}
            aria-label="Checklist name"
          />
          <div className="flex items-center gap-4">
            <AssigneeControl value={checklist.assignedTo} users={users} onChange={(assignedToId) => patchChecklist({ assignedToId })} />
            <DueControl value={checklist.dueDate} onSave={(dueDate) => patchChecklist({ dueDate })} />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-2 text-[11px] text-gray-600">
            Description
            {savingDescription && <span className="flex items-center gap-1 text-cyber-400"><Loader2 size={10} className="animate-spin" /> saving…</span>}
          </div>
          <RichTextEditor
            profile={DOCUMENT_PROFILE}
            initialHtml={checklist.description || ""}
            onChange={(html) => flushDescription(html)}
            placeholder="Add Description"
            minHeight={120}
          />
        </div>

        <div className="flex items-center gap-3 text-xs text-gray-500">
          {redesign && (
            <span className={`chip text-[10px] ${checklist.taskCount > 0 && checklist.completedCount === checklist.taskCount ? "chip--good" : ""}`}>
              {checklist.taskCount === 0 ? "no tasks" : checklist.completedCount === checklist.taskCount ? "complete" : checklist.completedCount > 0 ? "in progress" : "not started"}
            </span>
          )}
          <span className="tabular-nums">{checklist.completedCount} of {checklist.taskCount} tasks complete</span>
          <span className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-lighter">
            <span className="block h-full rounded-full bg-cyber-500 transition-all" style={{ width: `${checklist.progress}%` }} />
          </span>
          <span className="text-gray-600">
            {checklist.company && <>· <Link to={`/kumo/organizations/${checklist.companyId}`} className="text-cyber-400 hover:text-cyber-300">{checklist.company.name}</Link></>}
          </span>
        </div>
      </div>

      {/* The same record as fields rather than controls: what this checklist is attached to, who has
          it, when it is due, and how far it has got. The editable form above is untouched — this is
          a read of it, not a second way to write it. */}
      {redesign && (
        <div className="card">
          <dl>
            <div className="flex items-start justify-between gap-3 border-b border-surface-border/60 py-2">
              <dt className="text-xs text-gray-500">Client</dt>
              <dd className="text-right text-sm text-gray-200">
                {checklist.company
                  ? <Link to={`/kumo/organizations/${checklist.companyId}`} className="text-cyber-400 hover:text-cyber-300">{checklist.company.name}</Link>
                  : "—"}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-surface-border/60 py-2">
              <dt className="text-xs text-gray-500">Assignee</dt>
              <dd className="text-right text-sm text-gray-200">{personName(checklist.assignedTo) || "Unassigned"}</dd>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-surface-border/60 py-2">
              <dt className="text-xs text-gray-500">Due date</dt>
              <dd className="text-right text-sm text-gray-200">{checklist.dueDate ? dueText(checklist.dueDate) : "No due date"}</dd>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-surface-border/60 py-2">
              <dt className="text-xs text-gray-500">Tasks complete</dt>
              <dd className="text-right text-sm text-gray-200 tabular-nums">{checklist.completedCount} of {checklist.taskCount}</dd>
            </div>
          </dl>
        </div>
      )}

      <div className="card p-0">
        <div className="divide-y divide-surface-border/60">
          {tasks.map((task, index) => (
            <div key={task.id} className="group flex items-center gap-3 px-3 py-2 hover:bg-surface-lighter/30">
              <button
                onClick={() => void patchTask(task, { completed: !task.completedAt })}
                title={task.completedAt ? "Mark as not done" : "Mark as done"}
                aria-label={task.completedAt ? `Reopen ${task.title}` : `Complete ${task.title}`}
                className={`shrink-0 ${task.completedAt ? "text-emerald-400" : "text-gray-500 hover:text-white"}`}
              >
                {task.completedAt ? <CheckCircle2 size={18} /> : <Circle size={18} />}
              </button>

              <input
                className={`min-w-0 flex-1 border-b border-transparent bg-transparent text-sm outline-none focus:border-surface-border ${
                  task.completedAt ? "text-gray-500 line-through" : "text-white"
                }`}
                defaultValue={task.title}
                onBlur={(e) => {
                  const title = e.target.value.trim();
                  if (!title) { e.target.value = task.title; return; }
                  if (title !== task.title) void patchTask(task, { title });
                }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
                aria-label={`Task ${index + 1}`}
              />

              <div className="flex shrink-0 items-center gap-4">
                <AssigneeControl value={task.assignedTo} users={users} onChange={(assignedToId) => void patchTask(task, { assignedToId })} />
                <DueControl value={task.dueDate} completed={Boolean(task.completedAt)} onSave={(dueDate) => void patchTask(task, { dueDate })} />
              </div>

              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <button onClick={() => void moveTask(task, -1)} disabled={index === 0} title="Move up" aria-label={`Move ${task.title} up`} className="rounded p-1 text-gray-600 hover:bg-surface hover:text-white disabled:opacity-25"><ChevronUp size={13} /></button>
                <button onClick={() => void moveTask(task, 1)} disabled={index === tasks.length - 1} title="Move down" aria-label={`Move ${task.title} down`} className="rounded p-1 text-gray-600 hover:bg-surface hover:text-white disabled:opacity-25"><ChevronDown size={13} /></button>
                <button onClick={() => void removeTask(task)} title="Delete task" aria-label={`Delete ${task.title}`} className="rounded p-1 text-gray-600 hover:bg-surface hover:text-red-400"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}

          {draftRows.map((key) => (
            <div key={`draft-${key}`} className="flex items-center gap-3 px-3 py-2">
              <Circle size={18} className="shrink-0 text-gray-600" />
              <input
                ref={(node) => { draftRefs.current.set(key, node); }}
                className="min-w-0 flex-1 border-b border-transparent bg-transparent text-sm text-white outline-none placeholder:text-gray-600 focus:border-surface-border"
                placeholder="Task name"
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const value = e.currentTarget.value;
                  e.currentTarget.value = "";
                  void addTask(value);
                }}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if (value) { e.target.value = ""; void addTask(value); }
                }}
                aria-label="Task name"
              />
            </div>
          ))}

          <button
            onClick={addDraftRow}
            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-gray-500 transition-colors hover:bg-surface-lighter/30 hover:text-gray-300"
          >
            <CornerDownLeft size={16} className="shrink-0 text-gray-600" />
            Add task
          </button>
        </div>
      </div>
    </div>
  );
}
