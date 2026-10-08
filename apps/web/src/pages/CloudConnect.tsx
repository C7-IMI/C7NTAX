import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../hooks/useAuth";
import {
  Plus, Plug, RefreshCw, Trash2, Key, Settings,
  ShieldCheck, Globe, Server, Cloud, CreditCard, FileText, Database,
  PlugZap, Monitor, AlertTriangle, CheckCircle, XCircle, Loader2, X, Users, Info, ExternalLink, Bot, Wand2,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { EmailConnectorsPanel } from "../components/EmailConnectorsPanel";
import { AiModelsPanel } from "../components/AiModelsPanel";
import { ConnectorSetupWizard, type ConnectorSetup } from "../components/ConnectorSetupWizard";
import { PageSkeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { DataSourceNote } from "../components/DataSourceNote";

// ── Types ──────────────────────────────────────────────────────────

interface FieldError {
  field: string;
  message: string;
  fix: string;
  example: string;
}

interface Integration {
  id: string; kind: string; name: string; enabled: boolean;
  status: string; lastSyncAt: string | null;
  credentials?: Record<string, string>;
  settings?: Record<string, any>;
}

interface SyncLog {
  id: string; entityType: string; status: string;
  recordsProcessed: number; recordsCreated: number; recordsUpdated: number;
  recordsFailed: number; startedAt: string; completedAt: string | null;
}

/** One credential, and how it should be asked for. */
interface CredentialField {
  key: string;
  /** Falls back to the key turned into words, which is all the older connectors provide. */
  label?: string;
  type?: "text" | "password" | "number";
  placeholder?: string;
  /** Where the value comes from, printed under the input. */
  hint?: string;
}

interface IntegrationType {
  kind: string; name: string; description: string;
  requiredCredentials: string[];
  /**
   * How each credential should be presented. A connector that describes its own fields gets its own
   * labels and its own sentence about where the value comes from — which matters when the value is
   * not an "API key" you can generate anywhere, but something the vendor issues in a particular
   * screen. A connector that does not falls back to the derived label.
   */
  credentialFields?: CredentialField[];
  requiredScopes?: string[];
  /** The vendor's own API reference. */
  docsUrl?: string;
  docsLabel?: string;
  /** Why this connector is shaped the way it is — one paragraph, above the fields. */
  guidance?: { tone?: "info" | "warn"; text: string };
  settings?: Array<{
    key: string; label: string; type: string; default?: any;
    options?: string[];
    /** What the setting actually does, printed under the control. */
    hint?: string;
  }>;
  /**
   * How to get this connector running, in the order it has to happen: what has to exist in the
   * vendor's product first, which credential comes from which screen, what the first sync brings.
   * Served with the catalogue so the setup wizard needs no second fetch.
   */
  setup: ConnectorSetup | null;
}

const KIND_LABELS: Record<string, string> = {
  flexpoint: "FlexPoint Payment Solutions", quickbooks: "QuickBooks Online", pax8: "Pax8",
  avanan: "Avanan", proofpoint: "Proofpoint", sentinelone: "SentinelOne",
  itglue: "ITGlue", microsoft365: "Microsoft 365", azure: "Azure", aws: "AWS",
  connectwise: "ConnectWise PSA", halopsa: "HaloPSA",
  kantata: "Kantata", scoro: "Scoro", autotask: "AutoTask PSA",
  azure_ad_sso: "Azure AD SSO", dummy: "DummyConnect Simulator",
};

const KIND_ICONS: Record<string, LucideIcon> = {
  microsoft365: Server, azure: Cloud, azure_ad_sso: ShieldCheck,
  connectwise: Plug, halopsa: Plug, kantata: Plug, scoro: Plug,
  autotask: Plug, flexpoint: CreditCard, quickbooks: FileText,
  pax8: Globe, avanan: AlertTriangle, proofpoint: ShieldCheck,
  sentinelone: ShieldCheck, itglue: Database, aws: Cloud,
};

const POLL_INTERVAL_MS = 10000;

interface InactivityReport {
  generatedAt: string;
  withSignInData: number;
  withoutSignInData: number;
  signInDataUnavailable: boolean;
  totals: Record<string, number>;
  disabledAccounts: number;
  offboardingEnabled: boolean;
  note: string;
  clients: Array<{
    companyId: string | null;
    clientName: string;
    counts: Record<string, number>;
    disabled: number;
    users: Array<{ id: string; displayName: string; userPrincipalName: string; lastSignInAt: string | null; daysSinceSignIn: number | null; bucket: string; accountEnabled: boolean }>;
  }>;
}

const BUCKET_LABELS: Record<string, string> = {
  active: "Active",
  "30_60": "30–60 days",
  "60_90": "60–90 days",
  dormant: "Over 90 days",
  unknown: "Unknown",
};

/** What the server last verified about a connection (PLAN-015 Phase B #9). */
interface LiveStatusRow {
  id: string;
  status: string;
  enabled: boolean;
  health: {
    state: "healthy" | "degraded" | "unconfigured" | "off";
    detail: string;
    verifiedAt: string | null;
    ageSeconds: number | null;
    stale: boolean;
    consecutiveFailures: number;
    missingFields: string[];
    checking: boolean;
  } | null;
}

function healthAgo(seconds: number | null): string {
  if (seconds === null) return "never verified";
  if (seconds < 60) return `verified ${seconds}s ago`;
  if (seconds < 3600) return `verified ${Math.round(seconds / 60)}m ago`;
  return `verified ${Math.round(seconds / 3600)}h ago`;
}

const HEALTH_STYLE = {
  healthy: { dot: "bg-emerald-500", text: "text-emerald-300", bg: "bg-emerald-600/10", label: "Verified" },
  degraded: { dot: "bg-red-500", text: "text-red-300", bg: "bg-red-600/10", label: "Not answering" },
  unconfigured: { dot: "bg-amber-500", text: "text-amber-300", bg: "bg-amber-600/10", label: "Incomplete" },
  off: { dot: "bg-gray-600", text: "text-gray-500", bg: "bg-surface-lighter", label: "Off" },
} as const;

// ── Credential formatting ──────────────────────────────────────────

function formatCredLabel(cred: string): string {
  return cred.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim();
}

function isSecretCred(cred: string): boolean {
  const lower = cred.toLowerCase();
  return lower.includes("secret") || lower.includes("password") || lower.includes("key")
      || lower.includes("token") || lower === "privatekey" || lower === "apisecret";
}

// ── Main Component ──────────────────────────────────────────────────

export function CloudConnectPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [types, setTypes] = useState<IntegrationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedType, setSelectedType] = useState<IntegrationType | null>(null);
  const [credForm, setCredForm] = useState<Record<string, string>>({});
  const [settingsForm, setSettingsForm] = useState<Record<string, any>>({});
  const [formName, setFormName] = useState("");
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [showLogs, setShowLogs] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { status: "testing" | "pass" | "fail"; error?: string; fieldErrors?: FieldError[] }>>({});

  // ── Error Fix Dialog state ──
  const [fixDialog, setFixDialog] = useState<{
    open: boolean;
    integration: Integration;
    fieldErrors: FieldError[];
  } | null>(null);
  // Editable field values in the dialog (keyed by field name)
  const [fixFieldValues, setFixFieldValues] = useState<Record<string, string>>({});
  // Per-field test results within the dialog
  const [fixTestResults, setFixTestResults] = useState<Record<string, { status: "idle" | "testing" | "pass" | "fail"; error?: string }>>({});
  // Last verified health per integration, from the throttled server-side check
  const [liveStatus, setLiveStatus] = useState<Record<string, LiveStatusRow>>({});
  const [inactivity, setInactivity] = useState<InactivityReport | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [modelStatus, setModelStatus] = useState<{
    connected: boolean; providerLabel: string | null; model: string | null; name: string | null;
    appFunctions: boolean; counts: { total: number; active: number };
  } | null>(null);

  /** The add-connection flow, so the page can be scrolled to it when it opens. */
  const addFlowRef = useRef<HTMLDivElement>(null);

  // ── Integration Action Panel state ──
  const [actionPanel, setActionPanel] = useState<{ open: boolean; integration: Integration } | null>(null);
  // The setup wizard, for a connector being added or one that exists and needs finishing.
  const [wizardType, setWizardType] = useState<IntegrationType | null>(null);
  const [wizardExisting, setWizardExisting] = useState<Integration | null>(null);
  const [simulatedKind, setSimulatedKind] = useState<string>("microsoft365");
  const [mockUsers, setMockUsers] = useState<Array<{ id: string; name: string; email: string; selected: boolean }>>([]);
  const [mockLoaded, setMockLoaded] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [intRes, typeRes, statusRes, inactivityRes, modelRes] = await Promise.all([
        api.get("/cloudconnect"),
        api.get("/cloudconnect/types"),
        // Live health is verified server-side on a throttle, so this poll is cheap however
        // many browser tabs are open.
        api.get("/cloudconnect/status").catch(() => null),
        // Only useful once an M365 tenant is connected; a refusal just hides the panel.
        api.get("/cloudconnect/m365/inactivity").catch(() => null),
        // Which model the application is using. A role without inference:view is refused, and the
        // summary simply does not appear — the connections below are the point of this screen.
        api.get("/inference/status").catch(() => null),
      ]);
      setIntegrations(intRes.data?.data || []);
      setTypes(typeRes.data?.types || []);
      const rows: LiveStatusRow[] = statusRes?.data?.data || [];
      setLiveStatus(Object.fromEntries(rows.map(r => [r.id, r])));
      setInactivity(inactivityRes?.data?.clients ? inactivityRes.data : null);
      setModelStatus(modelRes?.data ?? null);
    } catch { /* silent — avoid toast storms on poll */ }
    finally { setLoading(false); }
  }, []);

  // Auto-poll for real-time state
  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAll]);

  /*
   * Opening the flow scrolls to it. The Add Connection button sits in the header of a page whose
   * usual content is long, and the flow opens at the top of the content — but a reader who had
   * scrolled down to click it would otherwise be left looking at the same thing they were before.
   */
  useEffect(() => {
    if (showAdd) addFlowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [showAdd]);

  const openActionPanel = (integration: Integration) => {
    setActionPanel({ open: true, integration });
    setMockLoaded(false);
    // Load mock users for simulation
    const kind = integration.kind === "dummy" ? simulatedKind : integration.kind;
    setTimeout(() => {
      setMockUsers([
        { id: "u1", name: "John Doe", email: "john.doe@contoso.com", selected: false },
        { id: "u2", name: "Jane Smith", email: "jane.smith@contoso.com", selected: false },
        { id: "u3", name: "Bob Wilson", email: "bob.wilson@contoso.com", selected: false },
        { id: "u4", name: "Alice Chen", email: "alice.chen@contoso.com", selected: false },
        { id: "u5", name: "Mark Lee", email: "mark.lee@contoso.com", selected: false },
      ]);
      setMockLoaded(true);
    }, 500);
  };

  const fetchLogs = async (id: string) => {
    try {
      const res = await api.get(`/cloudconnect/${id}/sync-logs`);
      setSyncLogs(res.data?.data || []);
      setShowLogs(id);
    } catch { toast.error("Failed to load logs"); }
  };

  // ── Actions ──────────────────────────────────────────────────────

  const handleSelectType = (t: IntegrationType) => {
    setSelectedType(t);
    setCredForm({});
    setSettingsForm({});
    setFormName(t.name || KIND_LABELS[t.kind] || t.kind);
    if (t.settings) {
      const defaults: Record<string, any> = {};
      t.settings.forEach(s => { if (s.default !== undefined) defaults[s.key] = s.default; });
      setSettingsForm(defaults);
    }
    setShowAdd(true);
  };

  const handleCreate = async () => {
    try {
      await api.post("/cloudconnect", {
        kind: selectedType!.kind,
        name: formName,
        credentials: credForm,
        settings: settingsForm,
      });
      toast.success(`${selectedType!.name} connection created`);
      setShowAdd(false); setSelectedType(null);
      fetchAll();
    } catch { toast.error("Failed"); }
  };

  const handleTest = async (id: string) => {
    setTestResults(p => ({ ...p, [id]: { status: "testing" } }));
    try {
      const res = await api.post(`/cloudconnect/${id}/test`);
      if (res.data.connected) {
        setTestResults(p => ({ ...p, [id]: { status: "pass" } }));
        fetchAll();
      } else {
        const errs: FieldError[] = res.data.fieldErrors || [];
        setTestResults(p => ({ ...p, [id]: { status: "fail", error: "Connection test failed", fieldErrors: errs } }));
        fetchAll();
      }
    } catch (e: any) {
      const errData = e?.response?.data;
      const msg = typeof errData?.error === "string" ? errData.error : "Connection failed";
      const errs: FieldError[] = errData?.fieldErrors || [];
      setTestResults(p => ({ ...p, [id]: { status: "fail", error: msg, fieldErrors: errs } }));
      fetchAll();
    }
  };

  // ── Error Fix Dialog handlers ──

  const openFixDialog = (integration: Integration, fieldErrors: FieldError[]) => {
    // A view-only caller cannot save a fix, and the list no longer carries the stored values to
    // prefill from, so say that rather than opening a dialog whose save is guaranteed to be
    // refused by the API.
    if (!canManageIntegrations) {
      toast.error("Your role can view integrations but not change their credentials");
      return;
    }
    // A failure the server could name gives an exact field list. When it could not (a rejected
    // password rather than a missing one), every configured field becomes editable — the dialog's
    // whole purpose is to fix the connection here, and "all errors resolved" on a connection that
    // is demonstrably failing would be a lie.
    const errors = fieldErrors.length > 0
      ? fieldErrors
      : Object.keys((integration.credentials || {}) as Record<string, string>).map(field => ({
          field,
          message: "The last check could not use this value.",
          fix: "Re-enter the value exactly as the vendor issued it.",
          example: "",
        }));
    const vals: Record<string, string> = {};
    const tests: Record<string, { status: "idle" | "testing" | "pass" | "fail"; error?: string }> = {};
    for (const entry of errors) {
      vals[entry.field] = (integration.credentials as Record<string, string>)?.[entry.field] || "";
      tests[entry.field] = { status: "idle" };
    }
    setFixFieldValues(vals);
    setFixTestResults(tests);
    setFixDialog({ open: true, integration, fieldErrors: errors });
  };

  const closeFixDialog = () => {
    setFixDialog(null);
    setFixFieldValues({});
    setFixTestResults({});
    fetchAll(); // refresh landing page
  };

  const testSingleField = async (field: string) => {
    if (!fixDialog) return;
    setFixTestResults(p => ({ ...p, [field]: { status: "testing" } }));
    try {
      // PATCH just this one field + test the full integration
      const creds = { ...fixDialog.integration.credentials, [field]: fixFieldValues[field] };
      await api.patch(`/cloudconnect/${fixDialog.integration.id}`, { credentials: creds });
      const res = await api.post(`/cloudconnect/${fixDialog.integration.id}/test`);
      if (res.data.connected) {
        setFixTestResults(p => ({ ...p, [field]: { status: "pass" } }));
        // Remove this field from the error list
        setFixDialog(prev => prev ? {
          ...prev,
          fieldErrors: prev.fieldErrors.filter(fe => fe.field !== field),
        } : null);
      } else {
        const remaining = (res.data.fieldErrors || []) as FieldError[];
        const thisFieldErr = remaining.find((r: FieldError) => r.field === field);
        const msg = thisFieldErr?.message || "Still failing";
        setFixTestResults(p => ({ ...p, [field]: { status: "fail", error: msg } }));
        // Update dialog errors with fresh server response
        if (remaining.length > 0) {
          setFixDialog(prev => prev ? { ...prev, fieldErrors: remaining } : null);
        }
      }
    } catch {
      setFixTestResults(p => ({ ...p, [field]: { status: "fail", error: "Test request failed" } }));
    }
  };

  const submitAllFixes = async () => {
    if (!fixDialog) return;
    try {
      const updatedCreds = { ...fixDialog.integration.credentials, ...fixFieldValues };
      await api.patch(`/cloudconnect/${fixDialog.integration.id}`, { credentials: updatedCreds });
      toast.success("Credentials updated");
      closeFixDialog();
    } catch { toast.error("Failed to save fixes"); }
  };

  const allFieldsPassed =
    fixDialog && fixDialog.fieldErrors.length === 0 &&
    Object.values(fixTestResults).every(r => r.status === "pass" || r.status === "idle");

  const handleSync = async (id: string) => {
    try { const r = await api.post(`/cloudconnect/${id}/sync`); toast.success(`Synced ${r.data?.recordsProcessed || 0} records`); fetchAll(); }
    catch { toast.error("Sync failed"); }
  };

  const handleToggle = async (id: string, v: boolean) => {
    try { await api.patch(`/cloudconnect/${id}`, { enabled: v }); fetchAll(); }
    catch { toast.error("Failed"); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this connection?")) return;
    try { await api.delete(`/cloudconnect/${id}`); toast.success("Deleted"); fetchAll(); }
    catch { toast.error("Failed"); }
  };

  const { permissions } = useAuth();
  const canManageIntegrations = permissions.includes("integration:manage");

  /**
   * Raises the offboarding checklist. Nothing is disabled here: the checklist is the deliverable,
   * because the work is done by a person, in order, and should leave a record.
   */
  const handleOffboard = async (userId: string, label: string) => {
    if (!confirm(`Raise an offboarding checklist for ${label}? Nothing is disabled automatically.`)) return;
    try {
      const r = await api.post(`/cloudconnect/m365/users/${userId}/offboard`, {});
      toast.success(`Checklist raised: ${r.data?.tasks ?? 0} tasks`);
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || e?.response?.data?.error || "Could not raise the checklist";
      toast.error(typeof msg === "string" ? msg : "Could not raise the checklist");
    }
  };

  // ── Render Helpers ────────────────────────────────────────────────

  const statusColor = (s: string) =>
    s === "connected" ? "text-green-400 bg-green-600/20" :
    s === "error" ? "text-red-400 bg-red-600/20" : "text-gray-400 bg-gray-600/20";

  const IconFor = (kind: string): LucideIcon => KIND_ICONS[kind] || Plug;

  /** The credential inputs for the chosen connector: its own field list, or the plain names. */
  const credentialFields: CredentialField[] = selectedType
    ? (selectedType.credentialFields?.length
        ? selectedType.credentialFields
        : (selectedType.requiredCredentials || []).map(key => ({ key })))
    : [];

  // ── Tabs ──────────────────────────────────────────────────────────
  /*
   * The page used to be one long scroll: the add-flow, the email connectors panel, a Microsoft 365
   * report and then the connected integrations, in that order. Which meant the answer to "what is
   * connected, and is it working?" was below four screens of things that are not.
   *
   * So: the first tab is the answer, and everything that changes a connection lives on another one.
   *   · Connected      — what is connected, its state, and the actions that do not change it
   *                      (test, sync, explore). The Microsoft 365 report belongs here because it is
   *                      about the tenant, not about the connection.
   *   · Add a connector— browse the types and configure a new one.
   *   · Configuration  — credentials, settings, sync history and synced records for one connection.
   *   · Email          — the mailbox connectors, which are their own thing with their own runtime.
   */
  type Tab = "connected" | "add" | "configure" | "email" | "ai";
  const [tab, setTab] = useState<Tab>("connected");
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [configCredentials, setConfigCredentials] = useState<Record<string, string>>({});
  const [configSettings, setConfigSettings] = useState<Record<string, any>>({});
  const [configEntities, setConfigEntities] = useState<Array<{ entityType: string; total: number }>>([]);
  const [savingConfig, setSavingConfig] = useState(false);

  const connected = integrations.filter(int => int.status === "connected" || int.lastSyncAt || int.enabled);
  const attention = integrations.filter(int => !int.enabled || int.status === "error" || (liveStatus[int.id]?.health?.state === "degraded" || liveStatus[int.id]?.health?.state === "unconfigured"));

  /** Open one connection's configuration, with its stored credentials copied into the form. */
  const openConfiguration = useCallback((int: Integration) => {
    setConfiguring(int.id);
    setConfigCredentials({ ...(int.credentials ?? {}) });
    setConfigSettings({ ...(int.settings ?? {}) });
    setConfigEntities([]);
    api.get(`/cloudconnect/${int.id}/synced-entities`)
      .then(r => setConfigEntities(r.data?.data ?? []))
      .catch(() => { /* nothing synced yet, or the role may not read it */ });
    api.get(`/cloudconnect/${int.id}/sync-logs`)
      .then(r => setSyncLogs(r.data?.data ?? r.data ?? []))
      .catch(() => setSyncLogs([]));
    setTab("configure");
  }, []);

  const saveConfiguration = async () => {
    if (!configuring) return;
    setSavingConfig(true);
    try {
      await api.patch(`/cloudconnect/${configuring}`, { credentials: configCredentials, settings: configSettings });
      toast.success("Configuration saved — press Test to verify it");
      await fetchAll();
      void handleTest(configuring);
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || "Could not save the configuration", { duration: 9000 });
    } finally {
      setSavingConfig(false);
    }
  };

  const configuringRow = integrations.find(int => int.id === configuring) ?? null;

  /**
   * The credential fields a kind should be asked for.
   *
   * A connector that describes its own fields gets its own labels and its own sentence about where
   * each value comes from; one that does not falls back to the derived label. Nothing is invented
   * here — this is the same metadata the add-flow uses, so a connection configured after the fact is
   * asked for exactly what it was asked for when it was created.
   */
  const credentialFieldsFor = (kind: string): CredentialField[] => {
    const type = types.find(t => t.kind === kind);
    if (type?.credentialFields?.length) return type.credentialFields;
    if (type?.requiredCredentials?.length) return type.requiredCredentials.map(key => ({ key }));
    const current = integrations.find(int => int.kind === kind)?.credentials;
    return current ? Object.keys(current).map(key => ({ key })) : [];
  };

  /** The options a kind exposes, with the defaults its type declares. */
  const settingsFor = (kind: string) => types.find(t => t.kind === kind)?.settings ?? [];

  // ── Render ────────────────────────────────────────────────────────

  const TABS: Array<{ id: Tab; label: string; count?: number }> = [
    { id: "connected", label: "Connected", count: integrations.length },
    { id: "add", label: "Add a connector" },
    { id: "configure", label: "Configuration" },
    { id: "ai", label: "AI models", count: modelStatus?.counts?.total },
    { id: "email", label: "Email connectors" },
  ];

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-white">CloudConnect</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {integrations.length === 0
              ? `Connect third-party services${types.length > 0 ? ` — ${types.length} connectors available` : ""}`
              : `${integrations.length} connection${integrations.length === 1 ? "" : "s"} configured${attention.length ? ` · ${attention.length} need${attention.length === 1 ? "s" : ""} attention` : " · all in good standing"}`}
          </p>
        </div>
        {tab !== "add" ? (
          <button onClick={() => { setSelectedType(null); setShowAdd(true); setTab("add"); }} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> Add a connector
          </button>
        ) : null}
      </div>

      {/* The tabs themselves. Pronounced, because the whole page is behind them. */}
      <div className="flex flex-wrap gap-1 border-b border-surface-border">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); if (t.id !== "add") setShowAdd(false); }}
            className={`relative px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? "border-cyber-500 text-white bg-surface-lighter"
                : "border-transparent text-gray-400 hover:text-white hover:bg-surface-lighter"
            }`}
          >
            {t.label}
            {t.count ? <span className="ml-2 text-[11px] rounded-full bg-surface-lighter px-1.5 py-0.5 text-gray-400">{t.count}</span> : null}
          </button>
        ))}
      </div>

      {tab === "add" ? (
      <div ref={addFlowRef} className="scroll-mt-4">
          {/* Type Selection Grid */}
          {!selectedType && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Select Service Type</h3>
                <button onClick={() => setShowAdd(false)} className="text-sm text-gray-500 hover:text-white">Cancel</button>
              </div>
              {types.length === 0 ? (
                <div className="card text-center py-8 text-gray-500">
                  The connector list has not loaded. Reload the page, or check that your role may view integrations.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {/* The one catalogue entry that is not a data connector: a model is called when
                      somebody asks it something, and it is configured on its own tab. */}
                  <button onClick={() => { setShowAdd(false); setSelectedType(null); setTab("ai"); }}
                    className="card hover:border-cyber-500/30 transition-colors text-left p-4 cursor-pointer group border-cyber-500/20">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-cyber-600/10 group-hover:bg-cyber-600/20 transition-colors">
                        <Bot size={18} className="text-cyber-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-white font-medium text-sm truncate">AI models</p>
                        <p className="text-xs text-gray-500 truncate">
                          Claude, GPT, Gemini, DeepSeek, Grok and any OpenAI-compatible endpoint
                        </p>
                      </div>
                    </div>
                  </button>
                  {types.map(t => {
                    const Icon = IconFor(t.kind);
                    return (
                      <div key={t.kind} className="card p-4 flex flex-col gap-3 hover:border-cyber-500/30 transition-colors">
                        <button onClick={() => handleSelectType(t)} className="text-left cursor-pointer group">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-cyber-600/10 group-hover:bg-cyber-600/20 transition-colors">
                              <Icon size={18} className="text-cyber-400" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-white font-medium text-sm truncate">{t.name}</p>
                              <p className="text-xs text-gray-500 truncate">{t.description?.slice(0, 60)}</p>
                            </div>
                          </div>
                        </button>
                        {/* Two ways in, and the wizard is the one that knows the order: sixteen of
                            these fail in the vendor's product before they fail here. */}
                        <div className="flex items-center gap-2 mt-auto">
                          <button
                            onClick={() => { setWizardType(t); setWizardExisting(null); }}
                            className="btn-primary text-xs inline-flex items-center gap-1.5"
                            title={`Walk through setting up ${t.name}`}
                          >
                            <Wand2 size={12} /> Walk me through it
                          </button>
                          <button onClick={() => handleSelectType(t)} className="btn-secondary text-xs" title="Just the credential fields">
                            Fill the form
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Configuration Form */}
          {selectedType && (
            <div className="card space-y-5 animate-fade-in">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Configure {selectedType.name}</h3>
                <button onClick={() => { setShowAdd(false); setSelectedType(null); }} className="text-gray-500 hover:text-white">Cancel</button>
              </div>
              <p className="text-sm text-gray-400 -mt-3">{selectedType.description}</p>

              {/* What this connector is, in the vendor's terms — read before the first field. */}
              {selectedType.guidance && (
                <div className={`flex items-start gap-2 rounded-lg border p-3 ${selectedType.guidance.tone === "warn" ? "border-amber-500/20 bg-amber-500/5" : "border-cyber-500/20 bg-cyber-500/5"}`}>
                  {selectedType.guidance.tone === "warn"
                    ? <Info size={14} className="text-amber-400 mt-0.5 shrink-0" />
                    : <ShieldCheck size={14} className="text-cyber-400 mt-0.5 shrink-0" />}
                  <p className="text-xs text-gray-300 leading-relaxed">{selectedType.guidance.text}</p>
                </div>
              )}

              <div className="flex items-center gap-2 -mt-2">
                <label className="text-xs text-gray-500">Connection name</label>
                <input className="input-field !w-auto flex-1 max-w-sm" value={formName} onChange={e => setFormName(e.target.value)} />
              </div>

              {credentialFields.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2"><Key size={13} /> Credentials</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {credentialFields.map(f => (
                      <div key={f.key}>
                        <label className="text-xs text-gray-500 block mb-1">
                          {f.label || formatCredLabel(f.key)}
                          {selectedType.requiredCredentials?.includes(f.key) && <span className="text-cyber-400"> *</span>}
                        </label>
                        <input className="input-field"
                          type={f.type || (isSecretCred(f.key) ? "password" : "text")}
                          placeholder={f.placeholder}
                          autoComplete={isSecretCred(f.key) ? "new-password" : "off"}
                          value={credForm[f.key] || ""} onChange={e => setCredForm(p => ({ ...p, [f.key]: e.target.value }))} />
                        {f.hint && <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{f.hint}</p>}
                      </div>
                    ))}
                  </div>
                  {selectedType.docsUrl && (
                    <a href={selectedType.docsUrl} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-cyber-400 hover:text-cyber-300">
                      {selectedType.docsLabel || "API reference"} <ExternalLink size={11} />
                    </a>
                  )}
                  {selectedType.requiredScopes?.length && (
                    <p className="text-[11px] text-gray-500">
                      Needs: <span className="font-mono">{selectedType.requiredScopes.join(", ")}</span>
                    </p>
                  )}
                </div>
              )}

              {selectedType.settings?.length && <div className="space-y-3">
                <h4 className="text-sm font-semibold text-gray-400 uppercase flex items-center gap-2"><Settings size={13} /> Settings</h4>
                {selectedType.settings.map(s => (
                  <div key={s.key}>
                    {s.type === "boolean" ? (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={settingsForm[s.key] !== false}
                          onChange={e => setSettingsForm(p => ({ ...p, [s.key]: e.target.checked }))} className="rounded" />
                        <span className="text-sm text-gray-300">{s.label}</span>
                      </label>
                    ) : s.type === "select" && s.options ? (
                      <>
                        <label className="text-xs text-gray-500 block mb-1">{s.label}</label>
                        <select className="input-field" value={settingsForm[s.key] || ""}
                          onChange={e => setSettingsForm(p => ({ ...p, [s.key]: e.target.value }))}>
                          {s.options.map((o: string) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </>
                    ) : (
                      <>
                        <label className="text-xs text-gray-500 block mb-1">{s.label}</label>
                        <input className="input-field" type={s.type === "number" ? "number" : "text"}
                          value={settingsForm[s.key] ?? ""}
                          onChange={e => setSettingsForm(p => ({ ...p, [s.key]: s.type === "number" ? Number(e.target.value) : e.target.value }))} />
                      </>
                    )}
                    {s.hint && <p className={`text-[11px] text-gray-500 mt-1 leading-relaxed ${s.type === "boolean" ? "ml-6" : ""}`}>{s.hint}</p>}
                  </div>
                ))}
              </div>}
              <div className="flex gap-3 pt-2">
                <button onClick={handleCreate} className="btn-primary">Create Connection</button>
                <button onClick={() => { setShowAdd(false); setSelectedType(null); }} className="btn-secondary">Cancel</button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Email connectors (IMAP → tickets) — their own runtime, their own tab. */}
      {tab === "email" ? <EmailConnectorsPanel /> : null}

      {tab === "ai" ? <AiModelsPanel /> : null}

      {/* ═══ Configuration ═══ */}
      {tab === "configure" ? (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="card !p-0 overflow-hidden h-fit">
            <p className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 border-b border-surface-border">
              Connections
            </p>
            {integrations.length === 0 ? (
              <p className="px-4 py-4 text-xs text-gray-500">Nothing configured yet.</p>
            ) : (
              <div className="divide-y divide-surface-border">
                {integrations.map(int => (
                  <button
                    key={int.id}
                    onClick={() => openConfiguration(int)}
                    className={`w-full text-left px-4 py-3 transition-colors ${configuring === int.id ? "bg-surface-lighter" : "hover:bg-surface-lighter/50"}`}
                  >
                    <p className="text-sm text-white truncate">{int.name}</p>
                    <p className="text-[11px] text-gray-500 truncate">{KIND_LABELS[int.kind] || int.kind}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {!configuringRow ? (
            <div className="card">
              <EmptyState
                icon={<Settings size={26} />}
                title="Pick a connection to configure"
                description="Credentials, options, sync history and the records a connector has brought in. Testing and syncing live on the Connected tab, where the state is."
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="card space-y-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2 flex-wrap">
                      {configuringRow.name}
                      <DataSourceNote source={configuringRow.kind} tone="inline" />
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {KIND_LABELS[configuringRow.kind] || configuringRow.kind}
                      {configuringRow.lastSyncAt ? ` · last sync ${new Date(configuringRow.lastSyncAt).toLocaleString()}` : " · never synced"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { const type = types.find(t => t.kind === configuringRow.kind) ?? null; setWizardType(type); setWizardExisting(configuringRow); }}
                      className="btn-primary text-xs flex items-center gap-1.5"
                      title="Walk through finishing this connection"
                    >
                      <Wand2 size={12} /> Finish with the wizard
                    </button>
                    <button onClick={() => void handleTest(configuringRow.id)} className="btn-secondary text-xs flex items-center gap-1.5"><PlugZap size={12} /> Test connection</button>
                    <button onClick={() => void handleSync(configuringRow.id)} className="btn-secondary text-xs">Sync now</button>
                  </div>
                </div>

                {credentialFieldsFor(configuringRow.kind).length > 0 && (
                  <div className="space-y-3 border-t border-surface-border pt-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2"><Key size={12} /> Credentials</h4>
                    <div className="grid gap-3 md:grid-cols-2">
                      {credentialFieldsFor(configuringRow.kind).map(f => (
                        <div key={f.key}>
                          <label className="block text-xs text-gray-400 mb-1">{f.label || formatCredLabel(f.key)}</label>
                          <input
                            className="input-field"
                            type={f.type || (isSecretCred(f.key) ? "password" : "text")}
                            placeholder={f.placeholder}
                            autoComplete="off"
                            value={configCredentials[f.key] ?? ""}
                            onChange={e => setConfigCredentials(p => ({ ...p, [f.key]: e.target.value }))}
                          />
                          {f.hint && <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{f.hint}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {settingsFor(configuringRow.kind).length > 0 && (
                  <div className="space-y-3 border-t border-surface-border pt-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2"><Settings size={12} /> Options</h4>
                    {settingsFor(configuringRow.kind).map(s => (
                      <div key={s.key}>
                        {s.type === "boolean" ? (
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              className="rounded mt-0.5"
                              checked={configSettings[s.key] ?? s.default !== false}
                              onChange={e => setConfigSettings(p => ({ ...p, [s.key]: e.target.checked }))}
                            />
                            <span>
                              <span className="text-sm text-gray-300">{s.label}</span>
                              {s.hint && <span className="block text-[11px] text-gray-500 mt-0.5 leading-relaxed">{s.hint}</span>}
                            </span>
                          </label>
                        ) : (
                          <>
                            <label className="block text-xs font-medium text-gray-400 mb-1">{s.label}</label>
                            {s.type === "select" && s.options ? (
                              <select
                                className="input-field"
                                value={configSettings[s.key] ?? s.default ?? ""}
                                onChange={e => setConfigSettings(p => ({ ...p, [s.key]: e.target.value }))}
                              >
                                {s.options.map(o => <option key={o} value={o}>{o}</option>)}
                              </select>
                            ) : (
                              <input
                                className="input-field"
                                type={s.type === "number" ? "number" : "text"}
                                value={configSettings[s.key] ?? s.default ?? ""}
                                onChange={e => setConfigSettings(p => ({ ...p, [s.key]: s.type === "number" ? Number(e.target.value) : e.target.value }))}
                              />
                            )}
                            {s.hint && <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{s.hint}</p>}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-3 border-t border-surface-border pt-4">
                  <button onClick={() => void saveConfiguration()} disabled={savingConfig} className="btn-primary text-sm">
                    {savingConfig ? "Saving…" : "Save configuration"}
                  </button>
                  <span className="text-xs text-gray-500">Saving does not test anything — press Test connection afterwards.</span>
                </div>
              </div>

              <div className="card space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Recent sync history</h4>
                {syncLogs.length === 0 ? (
                  <p className="text-xs text-gray-500">No sync has run for this connection yet.</p>
                ) : (
                  <div className="space-y-2">
                    {syncLogs.slice(0, 8).map(log => (
                      <div key={log.id} className="flex items-center justify-between text-xs rounded-lg bg-surface px-3 py-2">
                        <span className="flex items-center gap-2">
                          <span className={`px-1.5 py-0.5 rounded ${log.status === "success" ? "bg-green-600/20 text-green-400" : log.status === "failed" ? "bg-red-600/20 text-red-400" : "bg-yellow-600/20 text-yellow-400"}`}>{log.status}</span>
                          <span className="text-gray-400">{log.entityType}</span>
                        </span>
                        <span className="text-gray-500">{log.recordsProcessed} processed · {new Date(log.startedAt).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Records brought in</h4>
                {configEntities.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    Nothing stored yet. A sync stores what the connector reads as records it can be read back from —
                    the entity types depend on the connector.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {configEntities.map(entity => (
                      <span key={entity.entityType} className="rounded-lg border border-surface-border bg-surface-lighter px-2.5 py-1 text-xs text-gray-300">
                        {entity.entityType} <span className="text-gray-500">{entity.total}</span>
                      </span>
                    ))}
                  </div>
                )}
                <DataSourceNote source={configuringRow.kind} detail="every record here was read from the vendor, not entered in C7NTAX" />
              </div>

              {/*
                Microsoft 365 accounts (PLAN-015 Phase B #12, moved here in 2026.10.8.017).
                This used to be a card on the Connected tab, where it was the tallest thing on a
                screen whose job is "what is connected and is it healthy". It is not health: it is an
                action on the accounts of one tenant, and the tenant is what this pane configures. The
                reporting half — every client, every tenant, any threshold — lives in Reporting.
              */}
              {configuringRow.kind === "microsoft365" && (
                <div className="card space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2">
                        <Users size={13} className="text-cyber-400" /> Microsoft 365 accounts
                      </h4>
                      <p className="text-xs text-gray-500 mt-1">{inactivity?.note ?? "Sign-in activity appears here after a sync."}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link to="/reports/standard?report=m365-inactive-accounts" className="btn-secondary text-xs flex items-center gap-1.5">
                        <ExternalLink size={12} /> Inactive accounts report
                      </Link>
                      {inactivity && inactivity.clients.length > 0 && (
                        <button onClick={() => setShowInactive(v => !v)} className="btn-secondary text-xs">{showInactive ? "Hide accounts" : "Show accounts"}</button>
                      )}
                    </div>
                  </div>

                  {inactivity && inactivity.clients.length > 0 && (
                    <div className="flex items-center gap-3 text-xs flex-wrap">
                      {(["dormant", "60_90", "30_60", "active", "unknown"] as const).map(bucket => (
                        <span key={bucket} className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${bucket === "dormant" ? "bg-red-500" : bucket === "60_90" ? "bg-orange-500" : bucket === "30_60" ? "bg-amber-500" : bucket === "active" ? "bg-emerald-500" : "bg-gray-600"}`} />
                          <span className="text-gray-400">{BUCKET_LABELS[bucket]}</span>
                          <span className="text-white font-medium">{inactivity.totals[bucket] ?? 0}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {inactivity && inactivity.clients.length === 0 && (
                    <p className="text-xs text-gray-500">
                      No accounts synced from this tenant yet. Run a sync, then the accounts, their last sign-in and the
                      offboarding actions appear here — and the report covers every connected tenant at once.
                    </p>
                  )}

                  {showInactive && inactivity && (
                    <div className="space-y-3 border-t border-surface-border pt-3">
                      {inactivity.clients.map(group => (
                        <div key={group.companyId ?? "unmapped"} className="space-y-1">
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                            {group.clientName}
                            <span className="text-gray-600 normal-case tracking-normal font-normal ml-2">
                              {group.counts.dormant ?? 0} over 90 days · {group.disabled} disabled
                            </span>
                          </p>
                          {group.users.filter(u => u.bucket === "dormant" || u.bucket === "60_90" || u.bucket === "unknown").slice(0, 12).map(u => (
                            <div key={u.id} className="flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-surface-lighter/50">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-white truncate">{u.displayName} {!u.accountEnabled && <span className="text-[10px] text-gray-500">(disabled)</span>}</p>
                                <p className="text-xs text-gray-500 truncate">
                                  {u.userPrincipalName} · {u.lastSignInAt ? `last sign-in ${u.daysSinceSignIn}d ago` : "no sign-in recorded"}
                                </p>
                              </div>
                              <span className="badge bg-surface-lighter text-gray-400 text-[10px] shrink-0">{BUCKET_LABELS[u.bucket] ?? u.bucket}</span>
                              {canManageIntegrations && inactivity.offboardingEnabled && u.bucket !== "unknown" && (
                                <button onClick={() => handleOffboard(u.id, u.userPrincipalName)} className="btn-secondary text-xs shrink-0" title="Raise an offboarding checklist — it disables nothing by itself">
                                  Offboard
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      ))}
                      <p className="text-xs text-gray-600">
                        An account with no sign-in recorded is reported as unknown, never as dormant — reading sign-in activity needs Entra ID P1 and <code className="font-mono">AuditLog.Read.All</code>.
                        Offboarding raises a checklist for a person to work through; it does not disable the account.
                        For every client and every tenant, with your own threshold, run the <Link to="/reports/standard?report=m365-inactive-accounts" className="text-cyber-400 hover:text-cyber-300">inactive accounts report</Link>.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}

      {/* ═══ Connected ═══ */}
      {tab === "connected" ? (
        <>
      {/* The model is part of "what is connected", and the summary screen is where somebody looks
          to find out. One line, and a way through to the tab that configures it. */}
      <div className="card flex items-start gap-3">
        <div className={`p-2 rounded-lg ${modelStatus?.connected ? "bg-emerald-600/10" : "bg-surface-lighter"}`}>
          <Bot size={18} className={modelStatus?.connected ? "text-emerald-400" : "text-gray-500"} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">AI model</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {modelStatus?.connected
              ? `${modelStatus.providerLabel ?? ""}${modelStatus.model ? ` · ${modelStatus.model}` : ""} — ${modelStatus.name ?? "connected"}${modelStatus.appFunctions ? ", allowed to call application functions" : ""}.`
              : "No model connected: ticket suggestions use keyword search over resolved tickets, and nothing can answer a prompt."}
          </p>
        </div>
        <button onClick={() => setTab("ai")} className="btn-secondary text-xs shrink-0">
          {modelStatus?.connected ? "Manage models" : "Connect a model"}
        </button>
      </div>
      {/* Integration List */}
      {(
        loading ? <PageSkeleton /> :
        integrations.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<Plug size={26} />}
              title="Nothing is connected yet"
              description="CloudConnect reads from the systems you already run — a PSA, an accounting system, an email security platform, Microsoft 365 — and brings what it finds into C7NTAX, so a client's invoice, their licences and their mailboxes are visible where the work happens."
              action={
                <button onClick={() => { setSelectedType(null); setShowAdd(true); setTab("add"); }} className="btn-primary text-sm">
                  <Plus size={14} className="inline mr-1.5" />Add a connector
                </button>
              }
            />
          </div>
        ) :
        <div className="space-y-3">
          {integrations.map((int: any) => {
            const IconComp = IconFor(int.kind);
            const tr = testResults[int.id];
            const isConnected = int.status === "connected";
            const live = liveStatus[int.id];
            const health = live?.health ?? null;
            const style = HEALTH_STYLE[health?.state ?? "off"];
            const healthTooltip = (h: typeof health) => {
              if (!h) return "Live status is switched off on this deployment.";
              const parts = [h.detail];
              if (h.missingFields.length > 0 && h.state !== "off") parts.push(`Missing: ${h.missingFields.map(formatCredLabel).join(", ")}`);
              if (h.consecutiveFailures > 1) parts.push(`${h.consecutiveFailures} consecutive failed checks`);
              if (h.stale && h.state !== "off") parts.push("Older than the check interval — press Test to verify now.");
              return parts.join(" · ");
            };
            return (
              <div key={int.id} className={`card space-y-4 ${int.enabled ? "border-l-2 border-l-cyber-500" : "opacity-60"}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0 cursor-pointer" onClick={() => isConnected && openActionPanel(int)} title={isConnected ? "Click to open integration actions" : ""}>
                    <div className="p-2 rounded-lg bg-cyber-600/10">
                      <IconComp size={18} className="text-cyber-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-white font-medium text-sm truncate hover:text-cyber-400 transition-colors">{int.name}</p>
                        <span className={`badge text-xs ${statusColor(int.status)}`}>
                          {int.status === "connected" ? <CheckCircle size={10} className="inline mr-0.5" /> :
                           int.status === "error" ? <XCircle size={10} className="inline mr-0.5" /> : null}
                          {int.status || "disconnected"}
                        </span>
                        {isConnected && <span className="text-[10px] text-cyber-500">click to explore →</span>}
                      </div>
                      <p className="text-xs text-gray-500">{KIND_LABELS[int.kind] || int.kind}</p>
                      <DataSourceNote source={int.kind} className="mt-1" detail={int.lastSyncAt ? `read ${new Date(int.lastSyncAt).toLocaleDateString()}` : "not read yet"} />
                      {health && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            if (health.state === "degraded" || health.state === "unconfigured") {
                              openFixDialog(int, health.missingFields.map((field: string) => ({
                                field,
                                message: "is required but not set",
                                fix: "",
                                example: "",
                              })));
                              void handleTest(int.id);
                            }
                          }}
                          title={healthTooltip(health)}
                          className={`mt-1 inline-flex items-center gap-1.5 text-[11px] rounded-md px-1.5 py-0.5 ${style.bg} ${style.text} ${health.state === "degraded" || health.state === "unconfigured" ? "hover:underline cursor-pointer" : "cursor-default"}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot} ${health.stale ? "opacity-50" : ""}`} />
                          {style.label}
                          <span className="text-gray-500">
                            · {health.checking ? "checking now…" : health.stale ? "not verified recently" : healthAgo(health.ageSeconds)}
                          </span>
                          {(health.state === "degraded" || health.state === "unconfigured") && <span className="font-medium">· Fix</span>}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/*
                      The icon is the *action*, and it does not change: a plug with a bolt reads as "test this
                      connection". It used to be a Wi-Fi glyph that turned into a green tick or a red warning,
                      which made a button look like a status light — and in this row the green tick already
                      means "enabled" on the toggle beside it. The result of a test is carried by the colour
                      here and, properly, by the health chip above, which says when it was last checked.
                    */}
                    <button onClick={() => handleTest(int.id)} className={`p-1.5 rounded-md transition-colors ${
                      tr?.status === "testing" ? "text-yellow-400 bg-yellow-600/10" :
                      tr?.status === "pass" ? "text-green-400 bg-green-600/10" :
                      tr?.status === "fail" ? "text-red-400 bg-red-600/10" : "text-gray-500 hover:text-white hover:bg-surface-lighter"}`}
                      title={tr?.status === "pass" ? "Test connection — last test passed" : tr?.status === "fail" ? "Test connection — last test failed" : "Test connection"}>
                      {tr?.status === "testing" ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />}
                    </button>
                    <button onClick={() => handleSync(int.id)} className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-surface-lighter transition-colors" title="Sync">
                      <RefreshCw size={14} />
                    </button>
                    <button onClick={() => openConfiguration(int)} className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-surface-lighter transition-colors" title="Configure this connection">
                      <Settings size={14} />
                    </button>
                    <button onClick={() => fetchLogs(int.id)} className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-surface-lighter transition-colors" title="Sync Logs">
                      <FileText size={14} />
                    </button>
                    <button onClick={() => handleToggle(int.id, !int.enabled)} className={`p-1.5 rounded-md transition-colors ${int.enabled ? "text-green-400" : "text-gray-500"} hover:bg-surface-lighter`}
                      title={int.enabled ? "Disable" : "Enable"}>
                      {int.enabled ? <CheckCircle size={14} /> : <XCircle size={14} />}
                    </button>
                    <button onClick={() => handleDelete(int.id)} className="p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-surface-lighter transition-colors" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Clickable error banner → opens fix dialog */}
                {tr?.status === "fail" && (
                  <button
                    onClick={() => openFixDialog(int, tr.fieldErrors || [])}
                    className="w-full text-left bg-red-600/5 border border-red-500/20 rounded-lg p-3 text-sm hover:border-red-500/40 transition-colors cursor-pointer group"
                  >
                    <p className="text-red-400 font-medium flex items-center gap-1.5">
                      <AlertTriangle size={13} /> Connection Failed — <span className="underline group-hover:text-red-300">Click to fix</span>
                    </p>
                    <p className="text-gray-400 text-xs mt-1">{tr.error}</p>
                    {tr.fieldErrors && tr.fieldErrors.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {tr.fieldErrors.map((fe: FieldError) => (
                          <div key={fe.field} className="flex items-start gap-2 text-xs">
                            <span className="text-red-400 font-mono shrink-0">{formatCredLabel(fe.field)}:</span>
                            <span className="text-gray-500">{fe.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </button>
                )}

                {/* Sync Logs */}
                {showLogs === int.id && (
                  <div className="border-t border-surface-border pt-3">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Recent Sync Logs</h4>
                    {syncLogs.length === 0 ? (
                      <p className="text-xs text-gray-600">No sync history yet.</p>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {syncLogs.map(log => (
                          <div key={log.id} className="flex items-center justify-between text-xs bg-surface rounded p-2">
                            <div className="flex items-center gap-2">
                              <span className={`px-1.5 py-0.5 rounded ${log.status === "success" ? "bg-green-600/20 text-green-400" : log.status === "failed" ? "bg-red-600/20 text-red-400" : "bg-yellow-600/20 text-yellow-400"}`}>
                                {log.status}
                              </span>
                              <span className="text-gray-400">{log.entityType}</span>
                            </div>
                            <div className="flex items-center gap-3 text-gray-500">
                              <span>{log.recordsProcessed} processed</span>
                              <span>{new Date(log.startedAt).toLocaleString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
        </>
      ) : null}

      {/* ═══ Integration Action Panel ═══ */}
      {actionPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setActionPanel(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative bg-navy-800 border border-surface-border rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl animate-fade-in" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-surface-border">
              <div>
                <h3 className="text-white font-semibold text-base">{actionPanel.integration.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{KIND_LABELS[actionPanel.integration.kind] || actionPanel.integration.kind}</p>
              </div>
              <button onClick={() => setActionPanel(null)} className="p-1 rounded-md text-gray-500 hover:text-white hover:bg-surface-lighter"><X size={18} /></button>
            </div>

            {/* DummyConnect type selector */}
            {actionPanel.integration.kind === "dummy" && (
              <div className="p-5 border-b border-surface-border bg-surface-lighter/30">
                <label className="text-xs text-gray-400 block mb-2">Simulate Integration Type</label>
                <select className="input-field" value={simulatedKind}
                  onChange={e => { setSimulatedKind(e.target.value); setMockLoaded(false); setTimeout(() => { setMockUsers([{ id:"u1",name:"Demo User",email:"demo@example.com",selected:false}]); setMockLoaded(true); }, 300); }}>
                  {Object.entries(KIND_LABELS).filter(([k]) => k !== "dummy").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <p className="text-[10px] text-amber-400 mt-2">⚠ DummyConnect simulates the selected integration using mock data. No live connection is made.</p>
              </div>
            )}

            {/* M365 / User-based integration body */}
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Synced Users Preview</h4>
                <span className="badge bg-green-600/20 text-green-400 text-xs">Connected</span>
              </div>

              {!mockLoaded ? (
                <div className="text-center py-8 text-gray-500"><Loader2 size={24} className="animate-spin mx-auto mb-2" />Loading users...</div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <button onClick={() => { const all = mockUsers.every(u => u.selected); setMockUsers(mockUsers.map(u => ({ ...u, selected: !all }))); }}
                      className="btn-secondary text-xs">Select All</button>
                    <select className="input-field text-sm w-48">
                      <option value="">Assign to company...</option>
                      <option value="acme">Acme Corporation</option>
                      <option value="globex">Globex Industries</option>
                      <option value="initech">Initech Solutions</option>
                    </select>
                    <button onClick={() => toast.success(`${mockUsers.filter(u => u.selected).length} users queued for sync`)}
                      className="btn-primary text-xs">Sync Selected</button>
                  </div>

                  <div className="space-y-1">
                    {mockUsers.map(u => (
                      <label key={u.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${u.selected ? "bg-cyber-600/10 border border-cyber-500/20" : "hover:bg-surface-lighter/50 border border-transparent"}`}>
                        <input type="checkbox" checked={u.selected} onChange={() => setMockUsers(mockUsers.map(m => m.id === u.id ? { ...m, selected: !m.selected } : m))} className="rounded accent-cyber-500" />
                        <div className="flex-1"><p className="text-sm text-white">{u.name}</p><p className="text-xs text-gray-500">{u.email}</p></div>
                        {u.selected && <span className="text-[10px] text-cyber-400">Queued</span>}
                      </label>
                    ))}
                  </div>

                  <div className="bg-surface-lighter rounded-lg p-3 space-y-2 text-xs">
                    <p className="text-gray-400 font-medium">Field Mapping</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex items-center justify-between"><span className="text-gray-500">Display Name →</span><span className="text-white">firstName</span></div>
                      <div className="flex items-center justify-between"><span className="text-gray-500">Mail →</span><span className="text-white">email</span></div>
                      <div className="flex items-center justify-between"><span className="text-gray-500">Job Title →</span><span className="text-white">title</span></div>
                      <div className="flex items-center justify-between"><span className="text-gray-500">Department →</span><span className="text-white">department</span></div>
                    </div>
                  </div>

                  <div className="flex gap-2 justify-end pt-2 border-t border-surface-border">
                    <button onClick={() => setActionPanel(null)} className="btn-secondary text-sm">Close</button>
                    <button onClick={() => { toast.success("Sync initiated"); setActionPanel(null); }} className="btn-primary text-sm">Sync to Contacts</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Error Fix Dialog ═══ */}
      {fixDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={closeFixDialog}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative bg-navy-800 border border-surface-border rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl animate-fade-in"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-surface-border">
              <div>
                <h3 className="text-white font-semibold text-base">Fix Connection Errors</h3>
                <p className="text-xs text-gray-500 mt-0.5">{fixDialog.integration.name} — {KIND_LABELS[fixDialog.integration.kind]}</p>
              </div>
              <button onClick={closeFixDialog} className="p-1 rounded-md text-gray-500 hover:text-white hover:bg-surface-lighter">
                <X size={18} />
              </button>
            </div>

            {/* Body: errored fields */}
            <div className="p-5 space-y-4">
              {fixDialog.fieldErrors.length === 0 && Object.keys(fixFieldValues).length === 0 ? (
                // Opened for a connection that is failing and stores nothing editable. Claiming
                // "all errors resolved" here would be the dialog lying about the row behind it.
                <div className="text-center py-6">
                  <AlertTriangle size={32} className="text-amber-400 mx-auto mb-2" />
                  <p className="text-white font-medium">Nothing to edit for this connection</p>
                  <p className="text-sm text-gray-400 mt-1 max-w-md mx-auto">
                    It stores no credentials, so the failure is in how it is reached rather than in a value here.
                    Press Test on the row to see the vendor's answer, or delete and recreate the connection.
                  </p>
                </div>
              ) : fixDialog.fieldErrors.length === 0 ? (
                <div className="text-center py-6">
                  <CheckCircle size={32} className="text-green-400 mx-auto mb-2" />
                  <p className="text-white font-medium">All errors resolved!</p>
                  <p className="text-sm text-gray-400 mt-1">Click OK to save your fixes.</p>
                </div>
              ) : (
                fixDialog.fieldErrors.map((fe) => {
                  const ft = fixTestResults[fe.field];
                  return (
                    <div key={fe.field} className="card border-l-2 border-l-red-500 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-white text-sm font-medium">{formatCredLabel(fe.field)}</p>
                          <p className="text-xs text-red-400 mt-0.5">{fe.message}</p>
                        </div>
                      </div>

                      {/* Fix instructions */}
                      <div className="bg-surface-lighter rounded-lg p-3 space-y-1 text-xs">
                        <p className="text-gray-400">
                          <span className="text-cyber-400 font-medium">Fix:</span> {fe.fix}
                        </p>
                        <p className="text-gray-500">
                          <span className="text-cyber-400 font-medium">Example:</span>{" "}
                          <code className="bg-surface px-1 py-0.5 rounded text-gray-300 font-mono">{fe.example}</code>
                        </p>
                      </div>

                      {/* Editable input + Test button */}
                      <div className="flex gap-2">
                        <input
                          className="input-field flex-1"
                          type={isSecretCred(fe.field) ? "password" : "text"}
                          value={fixFieldValues[fe.field] || ""}
                          onChange={e => setFixFieldValues(p => ({ ...p, [fe.field]: e.target.value }))}
                          placeholder={fe.example}
                        />
                        <button
                          onClick={() => testSingleField(fe.field)}
                          disabled={ft?.status === "testing"}
                          className={`px-3 py-2 rounded-lg text-xs font-medium shrink-0 transition-colors flex items-center gap-1.5 ${
                            ft?.status === "testing" ? "bg-yellow-600/20 text-yellow-400" :
                            ft?.status === "pass" ? "bg-green-600/20 text-green-400" :
                            ft?.status === "fail" ? "bg-red-600/20 text-red-400" :
                            "bg-cyber-600/20 text-cyber-400 hover:bg-cyber-600/30"
                          }`}
                        >
                          {ft?.status === "testing" ? <Loader2 size={12} className="animate-spin" /> : <PlugZap size={12} />}
                          {ft?.status === "testing" ? "Testing..." :
                           ft?.status === "pass" ? "Pass" :
                           ft?.status === "fail" ? "Fail" : "Test"}
                        </button>
                      </div>

                      {/* Test result message */}
                      {ft?.status === "fail" && ft.error && (
                        <p className="text-xs text-red-400 flex items-center gap-1">
                          <XCircle size={10} /> {ft.error}
                        </p>
                      )}
                      {ft?.status === "pass" && (
                        <p className="text-xs text-green-400 flex items-center gap-1">
                          <CheckCircle size={10} /> Verified — this field is now correct
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 p-5 border-t border-surface-border">
              <button onClick={closeFixDialog} className="btn-secondary text-sm">Cancel</button>
              <button
                onClick={submitAllFixes}
                disabled={!allFieldsPassed && fixDialog.fieldErrors.length > 0}
                className={`btn-primary text-sm ${(!allFieldsPassed && fixDialog.fieldErrors.length > 0) ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                OK — Save All Fixes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The setup wizard, for a connector being added or one that exists and needs finishing. */}
      {wizardType ? (
        <ConnectorSetupWizard
          type={wizardType}
          existing={wizardExisting ?? undefined}
          onClose={() => { setWizardType(null); setWizardExisting(null); }}
          onDone={() => { void fetchAll(); setWizardExisting(null); }}
        />
      ) : null}
    </div>
  );
}
