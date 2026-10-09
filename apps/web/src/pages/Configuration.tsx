/**
 * Administration → Configuration.
 *
 * Three screens live here, and all three are drawn from the registry the API publishes rather
 * than from hand-written forms:
 *
 *   · the hub, which lists every area and what it governs;
 *   · a section editor, which renders one area's fields;
 *   · the customer portal page, which renders the portal section *and* the two things that are
 *     not single values — per-client access and who has signed in.
 *
 * The reason for generating the form rather than writing it out: these settings were previously
 * hand-written screens whose fields had drifted away from the code that read them, so a control
 * could exist for a year without doing anything. A field can only be drawn here if the server
 * declares it, names where it comes from, and says what it changes.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Activity, AlertTriangle, CheckCircle2, ChevronRight, Cloud, Globe, Info, Monitor, Receipt,
  RotateCcw, Search, Shield, Sparkles, Wrench, type LucideIcon,
} from "lucide-react";
import api from "../api";
import { ListFooter, PageHeader, StatCard } from "../components/ui";
import { TableSkeleton } from "../components/ui/Skeleton";
import { primeContextMenusSetting } from "../hooks/useContextMenusEnabled";
import { refreshNavigationSettings, useRedesign } from "../hooks/useNavigationStyle";
import { ACCENT_COLOUR_HINT, DEFAULT_ACCENT_COLOUR, HEX_COLOUR_PATTERN } from "../lib/colourTokens";

// ── Types mirroring the API's rendered registry ─────────────────────

export interface RenderedChoice { value: string; label: string }

export interface RenderedField {
  id: string;
  label: string;
  summary: string;
  detail: string | null;
  type: "boolean" | "number" | "text" | "select" | "colour" | "url";
  source: "setting" | "environment";
  env: string | null;
  default: boolean | number | string;
  min: number | null;
  max: number | null;
  step: number | null;
  unit: string | null;
  affects: string[];
  restartRequired: boolean;
  locked: boolean;
  secret: boolean;
  value: boolean | number | string;
  saved: unknown;
  fallback: boolean | number | string;
  fromEnvironment: boolean;
  overridden: boolean;
  choices: RenderedChoice[];
  editable: boolean;
}

export interface RenderedRequirement {
  label: string;
  detail: string;
  env: string[];
  missing: string[];
  met: boolean;
  /** How it is satisfied: by the deployment's environment, or by something configured in the app. */
  satisfiedBy?: "environment" | "application" | null;
  /** A screen that can satisfy it, when one exists. */
  link?: { label: string; to: string } | null;
  whenField: string | null;
  applies: boolean;
}

export interface RenderedSection {
  id: string;
  label: string;
  summary: string;
  governs: string;
  icon: string;
  readPermission: string;
  writePermission: string;
  writable: boolean;
  requirements: RenderedRequirement[];
  fields: RenderedField[];
}

export const SECTION_ICONS: Record<string, LucideIcon> = {
  Wrench, Shield, Globe, Activity, Sparkles, Cloud, Receipt, Monitor,
};

export const iconFor = (name: string): LucideIcon => SECTION_ICONS[name] ?? Wrench;

// ── Small pieces ────────────────────────────────────────────────────

/** An on/off switch. A checkbox reads as "part of a form"; a setting is a state. */
function Switch({ checked, disabled, onChange, label }: {
  checked: boolean; disabled?: boolean; onChange: (next: boolean) => void; label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? "bg-cyber-600" : "bg-surface-border"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-150 ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export function Chip({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "warn" | "info" | "good" }) {
  const tones = {
    muted: "bg-surface-lighter text-gray-400 border-surface-border",
    warn: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    info: "bg-cyber-600/10 text-cyber-300 border-cyber-600/30",
    good: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function RequirementBanner({ requirement }: { requirement: RenderedRequirement }) {
  if (!requirement.applies) return null;
  const ok = requirement.met;
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm ${
      ok ? "border-surface-border bg-surface-light text-gray-400" : "border-amber-500/30 bg-amber-500/5 text-amber-200"
    }`}>
      {ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-400" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
      <div className="min-w-0">
        <p className="font-medium">
          {requirement.label}
          {ok
            ? requirement.satisfiedBy === "application" ? " — provided by this application's configuration" : " — provided"
            : " — not provided"}
        </p>
        <p className="text-xs mt-0.5 text-gray-400">{requirement.detail}</p>
        {!ok && requirement.missing.length > 0 && (
          <p className="text-xs mt-1 font-mono text-amber-300/90">{requirement.missing.join(", ")}</p>
        )}
        {requirement.link && (
          <Link to={requirement.link.to} className="inline-flex items-center gap-1 text-xs mt-1.5 text-cyber-400 hover:text-cyber-300">
            {requirement.link.label} <ChevronRight size={12} />
          </Link>
        )}
      </div>
    </div>
  );
}

/** One setting: its control, where its value comes from, and what it changes. */
export function FieldCard({ field, onSave, onClear, busy }: {
  field: RenderedField;
  onSave: (field: RenderedField, value: boolean | number | string) => Promise<boolean>;
  onClear: (field: RenderedField) => Promise<boolean>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<string>(String(field.value ?? ""));
  const [error, setError] = useState("");

  useEffect(() => { setDraft(String(field.value ?? "")); }, [field.value]);

  const disabled = !field.editable || field.locked || busy;
  const redesign = useRedesign();
  /** Whether the control edits a draft, and so can be applied with a button rather than on change. */
  const savesFromDraft = field.type !== "boolean" && field.type !== "select";
  const dirty = String(field.value ?? "") !== draft;

  const commit = async (value: boolean | number | string) => {
    setError("");
    const ok = await onSave(field, value);
    if (!ok) setError("That value was refused — see the message above.");
  };

  const control = (() => {
    switch (field.type) {
      case "boolean":
        return (
          <Switch
            checked={field.value === true}
            disabled={disabled}
            label={field.label}
            onChange={next => void commit(next)}
          />
        );
      case "number":
        return (
          <div className="flex items-center gap-2">
            <input
              type="number"
              className="input-field max-w-[9rem]"
              value={draft}
              min={field.min ?? undefined}
              max={field.max ?? undefined}
              step={field.step ?? undefined}
              disabled={disabled}
              onChange={e => setDraft(e.target.value)}
              onBlur={() => { if (String(field.value) !== draft) void commit(Number(draft)); }}
              onKeyDown={e => { if (e.key === "Enter") void commit(Number(draft)); }}
            />
            {field.unit && <span className="text-xs text-gray-500">{field.unit}</span>}
          </div>
        );
      case "select":
        return (
          <select
            className="input-field"
            value={String(field.value ?? "")}
            disabled={disabled}
            onChange={e => void commit(e.target.value)}
          >
            {field.choices.length === 0 && <option value="">Nothing to choose from yet</option>}
            {field.choices.map(choice => (
              <option key={choice.value} value={choice.value}>{choice.label}</option>
            ))}
          </select>
        );
      case "colour":
        return (
          <div className="flex items-center gap-2">
            <input
              type="color"
              className="h-9 w-14 rounded border border-surface-border bg-surface"
              value={HEX_COLOUR_PATTERN.test(String(field.value)) ? String(field.value) : DEFAULT_ACCENT_COLOUR}
              disabled={disabled}
              onChange={e => void commit(e.target.value)}
              aria-label={`${field.label} colour`}
            />
            <input
              className="input-field font-mono"
              value={draft}
              placeholder={ACCENT_COLOUR_HINT}
              disabled={disabled}
              onChange={e => setDraft(e.target.value)}
              onBlur={() => { if (String(field.value) !== draft) void commit(draft); }}
            />
          </div>
        );
      default:
        return (
          <input
            className={`input-field ${field.type === "url" ? "font-mono text-xs" : ""}`}
            value={draft}
            placeholder={field.type === "url" ? "https://…" : ""}
            disabled={disabled}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { if (String(field.value) !== draft) void commit(draft); }}
            onKeyDown={e => { if (e.key === "Enter") void commit(draft); }}
          />
        );
    }
  })();

  return (
    <div className="border-b border-surface-border last:border-b-0 py-4 first:pt-0 last:pb-0" data-hl={`field:${field.id}`}>
      {redesign ? (
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-medium text-white">{field.label}</h4>
              {field.source === "environment" && <Chip tone="info">Set by {field.env}</Chip>}
              {field.source === "setting" && field.fromEnvironment && !field.overridden && (
                <Chip tone="info">Deployment default ({field.env})</Chip>
              )}
              {field.overridden && <Chip tone="warn">Overrides {field.env}</Chip>}
              {field.restartRequired && <Chip tone="warn">Needs a restart</Chip>}
              {field.locked && <Chip tone="good">Required</Chip>}
              {field.secret && <Chip>{field.value ? "Configured" : "Not configured"}</Chip>}
            </div>
            <p className="text-xs text-gray-400 mt-1">{field.summary}</p>
            {field.detail && <p className="text-xs text-gray-500 mt-1 leading-relaxed">{field.detail}</p>}
            {field.source === "environment" && !field.secret && (
              <p className="text-[11px] text-gray-500 mt-1.5 font-mono">
                {field.env} = {String(field.value || "(empty)")}
              </p>
            )}
            {field.overridden && (
              <p className="text-[11px] text-amber-300/80 mt-1.5">
                The deployment sets this to <span className="font-mono">{JSON.stringify(field.fallback)}</span>.
              </p>
            )}
            {field.affects.length > 0 && (
              <p className="text-[11px] text-gray-600 mt-1.5">Changes: {field.affects.join(" · ")}</p>
            )}
            <p className="text-[11px] text-gray-600 mt-1.5">
              Default when nothing is saved: <span className="font-mono">{JSON.stringify(field.default)}</span>
            </p>
            {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
          </div>
          <div className="shrink-0 w-[16rem] max-w-full sm:max-w-[45%]">{control}</div>
          <div className="shrink-0 flex items-center gap-2">
            {savesFromDraft ? (
              <button
                type="button"
                disabled={!dirty || disabled}
                onMouseDown={e => e.preventDefault()}
                onClick={() => void commit(field.type === "number" ? Number(draft) : draft)}
                className="btn-primary text-xs py-1.5 px-3"
              >
                Save
              </button>
            ) : null}
            {field.saved !== null && field.editable && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onClear(field)}
                className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-white disabled:opacity-40"
                title="Remove the saved value so the deployment's own applies again"
              >
                <RotateCcw size={11} /> Use {field.fromEnvironment || field.env ? "the deployment's value" : "the default"}
              </button>
            )}
          </div>
        </div>
      ) : (
      <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-medium text-white">{field.label}</h4>
            {field.source === "environment" && <Chip tone="info">Set by {field.env}</Chip>}
            {field.source === "setting" && field.fromEnvironment && !field.overridden && (
              <Chip tone="info">Deployment default ({field.env})</Chip>
            )}
            {field.overridden && <Chip tone="warn">Overrides {field.env}</Chip>}
            {field.restartRequired && <Chip tone="warn">Needs a restart</Chip>}
            {field.locked && <Chip tone="good">Required</Chip>}
            {field.secret && <Chip>{field.value ? "Configured" : "Not configured"}</Chip>}
          </div>
          <p className="text-xs text-gray-400 mt-1">{field.summary}</p>
          {field.detail && <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{field.detail}</p>}
          {field.affects.length > 0 && (
            <p className="text-[11px] text-gray-600 mt-2">
              Changes: {field.affects.join(" · ")}
            </p>
          )}
        </div>
        <div className="shrink-0 w-[16rem] max-w-[45%]">{control}</div>
      </div>

      {field.source === "environment" && !field.secret && (
        <p className="text-[11px] text-gray-500 mt-2 font-mono">
          {field.env} = {String(field.value || "(empty)")}
        </p>
      )}
      {field.overridden && (
        <p className="text-[11px] text-amber-300/80 mt-2">
          The deployment sets this to <span className="font-mono">{JSON.stringify(field.fallback)}</span>.
        </p>
      )}
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      <div className="mt-2 flex items-center gap-3 flex-wrap">
        <span className="text-[11px] text-gray-600">
          Default when nothing is saved: <span className="font-mono">{JSON.stringify(field.default)}</span>
        </span>
        {field.saved !== null && field.editable && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onClear(field)}
            className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-white disabled:opacity-40"
            title="Remove the saved value so the deployment's own applies again"
          >
            <RotateCcw size={11} /> Use {field.fromEnvironment || field.env ? "the deployment's value" : "the default"}
          </button>
        )}
      </div>
      </>
      )}
    </div>
  );
}

// ── Data ────────────────────────────────────────────────────────────

function useConfiguration() {
  const [sections, setSections] = useState<RenderedSection[]>([]);
  const [loaded, setLoaded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api.get("/configuration");
      setSections(res.data?.sections ?? []);
      setLoaded(res.data?.loaded !== false);
      setError("");
    } catch {
      setError("Could not load the configuration. The API may be unreachable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  return { sections, loaded, loading, error, reload: load };
}

/** Shared by the section editor and the portal page, so both read the same registry. */
export function useConfigurationSection(sectionId: string) {
  const { sections, loaded, loading, error, reload } = useConfiguration();
  const section = sections.find(s => s.id === sectionId);

  const save = useCallback(async (field: RenderedField, value: boolean | number | string) => {
    if (!section) return false;
    try {
      await api.patch(`/configuration/${section.id}/${field.id}`, { value });
      // The right-click menus resolve their state from the stored setting, so push the new value
      // to anything already mounted instead of waiting for a reload.
      if (section.id === "workspace" && field.id === "contextMenus") {
        primeContextMenusSetting(value !== false);
      }
      // The navigation pane is the same shape of change but a bigger one: it is on screen while the
      // setting is being saved, so it has to redraw from the value the API now holds rather than
      // from a guess about what was just written. The interface layout is the same again.
      if (section.id === "workspace" && (field.id === "navigationStyle" || field.id === "interfaceStyle" || field.id === "assistantInRail")) {
        refreshNavigationSettings();
      }
      await reload();
      toast.success(`${field.label} saved`);
      return true;
    } catch (e: unknown) {
      const error = (e as { response?: { data?: { error?: { message?: string } | string } } })?.response?.data?.error;
      toast.error(typeof error === "string" ? error : (error?.message || "That value was refused"));
      return false;
    }
  }, [section, reload]);

  /** Removes the saved value, so the deployment's own applies again. */
  const clear = useCallback(async (field: RenderedField) => {
    if (!section) return false;
    try {
      await api.delete(`/configuration/${section.id}/${field.id}`);
      if (section.id === "workspace" && field.id === "contextMenus") {
        primeContextMenusSetting(field.fallback !== false);
      }
      if (section.id === "workspace" && (field.id === "navigationStyle" || field.id === "interfaceStyle" || field.id === "assistantInRail")) {
        refreshNavigationSettings();
      }
      await reload();
      toast.success(`${field.label} is back to the deployment's value`);
      return true;
    } catch (e: unknown) {
      const error = (e as { response?: { data?: { error?: { message?: string } | string } } })?.response?.data?.error;
      toast.error(typeof error === "string" ? error : (error?.message || "That value could not be cleared"));
      return false;
    }
  }, [section, reload]);

  return { section, sections, loaded, loading, error, save, clear, reload };
}

// ── Hub ─────────────────────────────────────────────────────────────

/**
 * The area rail the redesigned hub and the section editor share. Each entry is the address of the
 * area's own screen, which is the deep link Recent activity and Help already use — so the rail
 * moves a person between screens rather than re-implementing the screens it names.
 */
function AreaNav({ sections, current, onSelect, showAll = false }: {
  sections: RenderedSection[];
  current: string;
  onSelect: (id: string) => void;
  showAll?: boolean;
}) {
  const item = (id: string, label: string, count: number, Icon: LucideIcon | null) => (
    <button
      key={id}
      type="button"
      onClick={() => onSelect(id)}
      aria-current={current === id ? "true" : undefined}
      className={`shrink-0 flex items-center gap-1.5 text-left text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
        current === id
          ? "bg-cyber-600/15 text-cyber-300 border-cyber-600/30"
          : "text-gray-400 hover:text-white hover:bg-surface-lighter border-transparent"
      }`}
    >
      {Icon ? <Icon size={13} /> : null} {label}
      <span className="text-gray-600 tabular-nums">{count}</span>
    </button>
  );

  return (
    <nav
      aria-label="Configuration areas"
      className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0 lg:pr-3 lg:border-r lg:border-surface-border"
    >
      {showAll ? item("all", "All areas", sections.length, null) : null}
      {sections.map(section => item(section.id, section.label, section.fields.length, iconFor(section.icon)))}
    </nav>
  );
}

export function ConfigurationHub() {
  const { sections, loaded, loading, error } = useConfiguration();
  const redesign = useRedesign();
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("all");

  const editableTotal = useMemo(
    () => sections.reduce((n, s) => n + s.fields.filter(f => f.editable).length, 0),
    [sections],
  );
  const overriddenTotal = useMemo(
    () => sections.reduce((n, s) => n + s.fields.filter(f => f.overridden).length, 0),
    [sections],
  );
  const restartTotal = useMemo(
    () => sections.reduce((n, s) => n + s.fields.filter(f => f.restartRequired).length, 0),
    [sections],
  );

  const settingMatches = (field: RenderedField, q: string) =>
    field.label.toLowerCase().includes(q) || field.summary.toLowerCase().includes(q);

  const shownSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sections.filter(section => {
      if (area !== "all" && section.id !== area) return false;
      if (!q) return true;
      return section.label.toLowerCase().includes(q)
        || section.summary.toLowerCase().includes(q)
        || section.fields.some(field => settingMatches(field, q));
    });
  }, [sections, area, query]);

  const shownSettings = shownSections.reduce((n, section) => n + section.fields.length, 0);

  if (redesign) {
    const q = query.trim().toLowerCase();
    return (
      <div className="space-y-4 animate-fade-in">
        <PageHeader
          title="Configuration"
          subtitle="Every setting the application reads, where its value comes from, and what changing it affects."
        />

        {error && <div className="card border-red-500/30 text-sm text-red-300">{error}</div>}
        {!loaded && !loading && (
          <div className="card border-amber-500/30 text-sm text-amber-200 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              The saved settings have not been read yet, so the values below are the deployment's own.
              This resolves itself within half a minute.
            </span>
          </div>
        )}

        {loading ? <TableSkeleton /> : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  className="input-field pl-9"
                  placeholder="Search every setting…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  aria-label="Search every setting"
                />
              </div>
              <span className="chip">{shownSettings} settings · each one says where its value comes from</span>
              {q ? <span className="text-xs text-gray-500 tabular-nums">{shownSections.length} areas shown</span> : null}
            </div>

            <div className="grid gap-4 lg:grid-cols-[236px_minmax(0,1fr)]">
              <AreaNav sections={sections} current={area} onSelect={setArea} showAll />

              <div className="space-y-4 min-w-0">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <StatCard label="Areas your role can read" value={sections.length} icon={<Wrench size={13} />} />
                  <StatCard label="Settings you can change here" value={editableTotal} tone="green" icon={<Sparkles size={13} />} />
                  <StatCard
                    label="Overriding the deployment"
                    value={overriddenTotal}
                    tone={overriddenTotal > 0 ? "amber" : "neutral"}
                    icon={<AlertTriangle size={13} />}
                  />
                </div>

                {shownSections.length === 0 ? (
                  <div className="card text-sm text-gray-500">No setting matches “{query.trim()}”.</div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {shownSections.map(section => {
                      const Icon = iconFor(section.icon);
                      const unused = section.requirements.filter(r => r.applies && !r.met);
                      return (
                        <Link
                          key={section.id}
                          to={`/admin/configuration/${section.id}`}
                          className="card card--interactive group flex items-start gap-3.5"
                        >
                          <div className="p-2 rounded-lg bg-cyber-600/10 shrink-0">
                            <Icon size={18} className="text-cyber-400" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <h3 className="text-sm font-semibold text-white">{section.label}</h3>
                              <ChevronRight size={16} className="text-gray-600 group-hover:text-gray-400 shrink-0" />
                            </div>
                            <p className="text-xs text-gray-400 mt-1">{section.summary}</p>
                            {q ? (
                              <p className="text-[11px] text-cyber-300/80 mt-1.5">
                                {section.fields.filter(field => settingMatches(field, q)).map(field => field.label).slice(0, 3).join(" · ")}
                              </p>
                            ) : null}
                            <div className="flex flex-wrap items-center gap-2 mt-2.5">
                              <Chip>{section.fields.length} {section.fields.length === 1 ? "setting" : "settings"}</Chip>
                              {section.fields.some(f => f.restartRequired) && <Chip tone="warn">restart required</Chip>}
                              {unused.length > 0 && <Chip tone="warn">{unused.length} unmet requirement{unused.length === 1 ? "" : "s"}</Chip>}
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}

                {restartTotal > 0 && (
                  <p className="text-xs text-gray-500">
                    <span className="text-amber-300">{restartTotal}</span>{" "}
                    {restartTotal === 1 ? "setting is" : "settings are"} applied when the API restarts.
                  </p>
                )}

                <div className="card">
                  <div className="flex items-start gap-3">
                    <Info size={16} className="mt-0.5 shrink-0 text-gray-500" />
                    <div className="text-xs text-gray-400 space-y-1.5">
                      <p className="text-sm text-gray-300 font-medium">How a value is decided</p>
                      <p>
                        A saved setting wins. With nothing saved, the deployment's own environment variable is
                        used, and failing that the documented default. Settings marked
                        <span className="mx-1 text-cyber-300">Set by …</span> belong to the deployment — an
                        outbound credential, or a switch that decides whether authentication is enforced — and
                        are shown so they can be confirmed rather than changed from a browser session.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Configuration"
        subtitle="Every setting the application reads, where its value comes from, and what changing it affects."
      />

      {error && <div className="card border-red-500/30 text-sm text-red-300">{error}</div>}
      {!loaded && !loading && (
        <div className="card border-amber-500/30 text-sm text-amber-200 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            The saved settings have not been read yet, so the values below are the deployment's own.
            This resolves itself within half a minute.
          </span>
        </div>
      )}

      {loading ? <TableSkeleton /> : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
            <Chip tone="info">{sections.length} areas</Chip>
            <Chip>{editableTotal} settings you can change here</Chip>
            {overriddenTotal > 0 && <Chip tone="warn">{overriddenTotal} overriding the deployment</Chip>}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {sections.map(section => {
              const Icon = iconFor(section.icon);
              const unused = section.requirements.filter(r => r.applies && !r.met);
              return (
                <Link
                  key={section.id}
                  to={`/admin/configuration/${section.id}`}
                  className="card card--interactive group flex items-start gap-3.5"
                >
                  <div className="p-2 rounded-lg bg-cyber-600/10 shrink-0">
                    <Icon size={18} className="text-cyber-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-white">{section.label}</h3>
                      <ChevronRight size={16} className="text-gray-600 group-hover:text-gray-400 shrink-0" />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{section.summary}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2.5">
                      <Chip>{section.fields.length} {section.fields.length === 1 ? "setting" : "settings"}</Chip>
                      {section.fields.some(f => f.restartRequired) && <Chip tone="warn">restart required</Chip>}
                      {unused.length > 0 && <Chip tone="warn">{unused.length} unmet requirement{unused.length === 1 ? "" : "s"}</Chip>}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}

      <div className="card">
        <div className="flex items-start gap-3">
          <Info size={16} className="mt-0.5 shrink-0 text-gray-500" />
          <div className="text-xs text-gray-400 space-y-1.5">
            <p className="text-sm text-gray-300 font-medium">How a value is decided</p>
            <p>
              A saved setting wins. With nothing saved, the deployment's own environment variable is
              used, and failing that the documented default. Settings marked
              <span className="mx-1 text-cyber-300">Set by …</span> belong to the deployment — an
              outbound credential, or a switch that decides whether authentication is enforced — and
              are shown so they can be confirmed rather than changed from a browser session.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Section editor ──────────────────────────────────────────────────

/**
 * The add-in simulator, offered where the add-in is switched on.
 *
 * It opens the add-in's own taskpane with `?demo=1`, which runs the shipped pane against example
 * messages and made-up answers: the mode question, the choice of message, the review and the result
 * all behave as they do in Outlook, and nothing is created. A pop-up rather than a panel because the
 * pane is 360px wide and built for a mailbox beside it — shown inline it would demonstrate a layout
 * the add-in does not have.
 */
export function AddinSimulatorCard({ enabled }: { enabled: boolean }) {
  const open = () => {
    const width = 430;
    const height = 780;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
    window.open(
      "/addin/taskpane.html?demo=1",
      "c7ntax-addin-simulator",
      `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
    );
  };

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1">
        <Monitor size={16} className="text-cyber-400" />
        <h3 className="text-sm font-semibold text-white">Add-in simulator</h3>
        <Chip tone="info">nothing is created</Chip>
      </div>
      <p className="text-xs text-gray-400 leading-relaxed">
        Walk through the flow without installing anything: pick one of the example selections, choose
        one ticket each or a single bundled ticket, edit the review, and watch the result. It is the
        real taskpane with example messages and made-up answers, so it behaves exactly as it does in
        Outlook — and no ticket is filed, no mail is sent and no preference is saved.
      </p>
      <div className="flex items-center gap-3 mt-3">
        <button type="button" className="btn-secondary text-sm inline-flex items-center gap-2" onClick={open} disabled={!enabled}>
          <Monitor size={14} /> Open the simulator
        </button>
        <span className="text-[11px] text-gray-500">
          {enabled
            ? "Opens in a separate window, sized like the add-in's pane."
            : "Switch the Outlook add-in on first — the simulator is served by the add-in's own endpoint."}
        </span>
      </div>
    </div>
  );
}

export function ConfigurationSectionPage() {
  const { sectionId } = useParams<{ sectionId: string }>();
  const navigate = useNavigate();
  const { section, sections, loaded, loading, error, save, clear } = useConfigurationSection(sectionId ?? "");
  const [busy, setBusy] = useState(false);
  const redesign = useRedesign();

  useEffect(() => {
    if (!loading && sections.length > 0 && !section) navigate("/admin/configuration", { replace: true });
  }, [loading, sections.length, section, navigate]);

  const saveField = useCallback(async (field: RenderedField, value: boolean | number | string) => {
    setBusy(true);
    try { return await save(field, value); }
    finally { setBusy(false); }
  }, [save]);

  const clearField = useCallback(async (field: RenderedField) => {
    setBusy(true);
    try { return await clear(field); }
    finally { setBusy(false); }
  }, [clear]);

  if (loading) return <div className="space-y-6 animate-fade-in"><TableSkeleton /></div>;
  if (!section) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader title="Configuration" subtitle={error || "That area does not exist, or your role cannot read it."} />
        <Link to="/admin/configuration" className="btn-secondary inline-flex items-center gap-2 text-sm">
          <RotateCcw size={14} /> Back to Configuration
        </Link>
      </div>
    );
  }

  const Icon = iconFor(section.icon);
  const changeable = section.fields.filter(f => f.editable && !f.locked);
  const deployment = section.fields.filter(f => !f.editable || f.locked);
  const addinEnabled = section.fields.find(f => f.id === "outlookAddin")?.value !== false;

  if (redesign) {
    return (
      <div className="space-y-4 animate-fade-in">
        <PageHeader
          title={section.label}
          subtitle={section.governs}
          actions={<Link to="/admin/configuration" className="btn-secondary text-sm">All areas</Link>}
        />

        {!loaded && (
          <div className="card border-amber-500/30 text-sm text-amber-200">
            The saved settings have not been read yet, so these are the deployment's own values.
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[236px_minmax(0,1fr)]">
          <AreaNav
            sections={sections}
            current={section.id}
            onSelect={id => navigate(`/admin/configuration/${id}`)}
          />

          <div className="space-y-4 min-w-0">
            {section.requirements.map(requirement => (
              <RequirementBanner key={requirement.label} requirement={requirement} />
            ))}

            <section className="card">
              <div className="flex items-center gap-2 mb-1">
                <Icon size={16} className="text-cyber-400" />
                <h3 className="text-sm font-semibold text-white">
                  {changeable.length > 0 ? "Settings" : "Deployment settings"}
                </h3>
                {!section.writable && <Chip tone="warn">read only for your role</Chip>}
              </div>
              <p className="text-xs text-gray-500 mb-2">
                {section.summary} A value saved here wins over the deployment's own environment variable.
              </p>
              {changeable.map(field => (
                <FieldCard key={field.id} field={field} onSave={saveField} onClear={clearField} busy={busy} />
              ))}
              {changeable.length === 0 && (
                <p className="text-xs text-gray-500">
                  Nothing in this area is changed from here — these values belong to the deployment.
                </p>
              )}
              {changeable.length > 0 && (
                <ListFooter
                  from={1}
                  to={changeable.length}
                  total={changeable.length}
                  page={1}
                  pages={1}
                  onPage={() => { /* every row is on this page */ }}
                  note="Saved as each value changes"
                />
              )}
            </section>

            {deployment.length > 0 && changeable.length > 0 && (
              <section className="card">
                <h3 className="text-sm font-semibold text-white mb-4">Set by the deployment</h3>
                {deployment.map(field => (
                  <FieldCard key={field.id} field={field} onSave={saveField} onClear={clearField} busy={busy} />
                ))}
                <ListFooter
                  from={1}
                  to={deployment.length}
                  total={deployment.length}
                  page={1}
                  pages={1}
                  onPage={() => { /* every row is on this page */ }}
                  note="Each one names the environment variable that owns it"
                />
              </section>
            )}

            {section.id === "apps" && <AddinSimulatorCard enabled={addinEnabled} />}

            <p className="text-xs text-gray-500">
              A change is saved immediately and takes effect on the next action that reads it. Settings
              marked <span className="text-amber-300">Needs a restart</span> are sampled once by the service
              that uses them, so they apply when the API next starts.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <PageHeader
        title={section.label}
        subtitle={section.governs}
        actions={<Link to="/admin/configuration" className="btn-secondary text-sm">All areas</Link>}
      />

      <div className="flex flex-wrap gap-1.5">
        {sections.map(s => {
          const SIcon = iconFor(s.icon);
          return (
            <Link
              key={s.id}
              to={`/admin/configuration/${s.id}`}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                s.id === section.id
                  ? "bg-cyber-600/15 text-cyber-300 border border-cyber-600/30"
                  : "text-gray-400 hover:text-white hover:bg-surface-lighter border border-transparent"
              }`}
            >
              <SIcon size={13} /> {s.label}
            </Link>
          );
        })}
      </div>

      {!loaded && (
        <div className="card border-amber-500/30 text-sm text-amber-200">
          The saved settings have not been read yet, so these are the deployment's own values.
        </div>
      )}

      {section.requirements.map(requirement => (
        <RequirementBanner key={requirement.label} requirement={requirement} />
      ))}

      {section.fields.length === 0 ? (
        <div className="card text-center py-8 text-gray-500 text-sm">This area has no settings yet.</div>
      ) : (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Icon size={16} className="text-cyber-400" />
            <h3 className="text-sm font-semibold text-white">
              {changeable.length > 0 ? "Settings" : "Deployment settings"}
            </h3>
            {!section.writable && <Chip tone="warn">read only for your role</Chip>}
          </div>
          {changeable.map(field => (
            <FieldCard key={field.id} field={field} onSave={saveField} onClear={clearField} busy={busy} />
          ))}
          {changeable.length === 0 && (
            <p className="text-xs text-gray-500">
              Nothing in this area is changed from here — these values belong to the deployment.
            </p>
          )}
        </div>
      )}

      {deployment.length > 0 && changeable.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-white mb-4">Set by the deployment</h3>
          {deployment.map(field => (
            <FieldCard key={field.id} field={field} onSave={saveField} onClear={clearField} busy={busy} />
          ))}
        </div>
      )}

      {section.id === "apps" && <AddinSimulatorCard enabled={addinEnabled} />}

      <p className="text-xs text-gray-500">
        A change is saved immediately and takes effect on the next action that reads it. Settings
        marked <span className="text-amber-300">Needs a restart</span> are sampled once by the service
        that uses them, so they apply when the API next starts.
      </p>
    </div>
  );
}
