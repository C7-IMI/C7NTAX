import { useEffect, useMemo, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Bot, PlugZap, Plus, ShieldCheck, Info, Trash2, Power, PowerOff, Pencil, List, Star, AlertTriangle, ExternalLink, KeyRound, X, Wand2 } from "lucide-react";
import { ModelSetupWizard, type ModelSetupType } from "./ModelSetupWizard";

/**
 * AI models — the connections that let a model work inside C7NTAX.
 *
 * Deliberately not a connector row: a data connector reads somebody else's records on a schedule,
 * whereas a model connection is called at the moment somebody asks it something, and its credentials
 * are its whole configuration. So it lives in the same place as the other connections (C7NC),
 * behind its own tab, backed by the provider catalogue the API serves — the same catalogue the
 * request builder reads, which is why the dialog cannot offer a field the engine does not use.
 */

interface AiCredentialField {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "select";
  required: boolean;
  hint: string;
  placeholder?: string;
  options?: string[];
}

interface AiProviderType {
  id: string;
  label: string;
  vendor: string;
  summary: string;
  shape: string;
  auth: string;
  baseUrl: string;
  addressRequired: boolean;
  credentials: AiCredentialField[];
  shortlist: string[];
  defaultModel: string;
  keyUrl: string;
  docs: { url: string; label: string };
  guidance: { tone?: "info" | "warn"; text: string };
  toolCalling: boolean | "model-dependent";
}

interface RuntimeField {
  key: string;
  label: string;
  type: "text" | "number" | "boolean";
  default?: unknown;
  hint: string;
}

interface LastTest {
  ok: boolean;
  detail: string | null;
  at: string;
  latencyMs: number;
  model?: string;
}

interface AiProvider {
  id: string;
  name: string;
  provider: string;
  model: string;
  apiEndpoint: string | null;
  isActive: boolean;
  isDefault: boolean;
  hasApiKey: boolean;
  maxTokens: number;
  temperature: number;
  topP: number;
  config?: {
    credentials?: Record<string, string>;
    appFunctions?: boolean;
    lastTest?: LastTest;
    models?: Array<{ id: string; label?: string }>;
    modelsFetchedAt?: string;
  };
}

interface AiStatus {
  connected: boolean;
  provider: string | null;
  providerLabel: string | null;
  model: string | null;
  name: string | null;
  appFunctions: boolean;
  toolCalling: boolean | "model-dependent";
  lastTest: LastTest | null;
}

interface ModelListResponse {
  models: Array<{ id: string; label?: string }>;
  source: "provider" | "cached" | "shortlist" | "unavailable" | "none";
  detail?: string | null;
  shortlist?: string[];
  latencyMs?: number;
}

/** The API returns { error: { message, status } }; show the message, not the object. */
function errText(e: any, fallback: string): string {
  const raw = e?.response?.data?.error;
  return (typeof raw === "string" ? raw : raw?.message) || e?.message || fallback;
}

function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

/** What the model is allowed to do, in words rather than a boolean. */
const toolCallingLabel = (toolCalling: AiProviderType["toolCalling"]) =>
  toolCalling === true ? "Supports app functions" : toolCalling === "model-dependent" ? "App functions depend on the model" : "Text only";

export function AiModelsPanel() {
  const [types, setTypes] = useState<AiProviderType[]>([]);
  const [runtimeFields, setRuntimeFields] = useState<RuntimeField[]>([]);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AiProviderType | null>(null);
  const [editing, setEditing] = useState<AiProvider | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [modelsFor, setModelsFor] = useState<{ id: string; data: ModelListResponse } | null>(null);
  /** The setup wizard: a provider being connected, or one that exists and needs finishing. */
  const [wizard, setWizard] = useState<{ type: AiProviderType; existing?: AiProvider } | null>(null);

  // The dialog's fields, as strings: an empty field and an unset one are the same thing here.
  const [form, setForm] = useState<Record<string, string>>({});
  const [formName, setFormName] = useState("");
  const [formModel, setFormModel] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formAppFunctions, setFormAppFunctions] = useState(false);
  const [saving, setSaving] = useState(false);

  const typeOf = useMemo(() => {
    const map: Record<string, AiProviderType> = {};
    for (const type of types) map[type.id] = type;
    return map;
  }, [types]);

  /**
   * The models offered in the list: the vendor's own answer when it gave one, otherwise the names
   * this build knows. The two are never mixed — the header above says which one you are looking at.
   */
  const modelOptions = useMemo(() => {
    if (!modelsFor) return [];
    const source = modelsFor.data.models.length
      ? modelsFor.data.models
      : (modelsFor.data.shortlist ?? []).map(id => ({ id, label: undefined as string | undefined }));
    return [...source].sort((a, b) => a.id.localeCompare(b.id));
  }, [modelsFor]);

  const fetchAll = async () => {
    try {
      const [typeRes, providerRes, statusRes] = await Promise.all([
        api.get("/inference/provider-types"),
        api.get("/inference/providers"),
        api.get("/inference/status"),
      ]);
      setTypes(typeRes.data.types ?? []);
      setRuntimeFields(typeRes.data.runtimeFields ?? []);
      setProviders(providerRes.data ?? []);
      setStatus(statusRes.data ?? null);
    } catch (e) {
      toast.error(errText(e, "Could not load the model catalogue"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchAll(); }, []);

  const openConnect = (type: AiProviderType) => {
    setEditing(null);
    setSelected(type);
    setForm({});
    setFormName(type.label);
    setFormModel(type.defaultModel);
    setFormApiKey("");
    setFormAppFunctions(false);
  };

  const openEdit = (provider: AiProvider) => {
    const type = typeOf[provider.provider];
    if (!type) return;
    setSelected(type);
    setEditing(provider);
    setForm({ ...(provider.config?.credentials ?? {}) });
    setFormName(provider.name);
    setFormModel(provider.model);
    setFormApiKey("");
    setFormAppFunctions(provider.config?.appFunctions === true);
  };

  const closeDialog = () => { setSelected(null); setEditing(null); };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      // Credentials the dialog asked for, minus the key, which has a column of its own.
      const credentials: Record<string, string> = {};
      for (const field of selected.credentials) {
        if (field.key === "apiKey") continue;
        const value = form[field.key];
        if (value !== undefined && value !== "") credentials[field.key] = value;
      }
      // A provider whose key is optional (a local server) still needs its address, which arrives as
      // a credential field.
      const apiEndpoint = credentials.baseUrl || credentials.endpoint || editing?.apiEndpoint || null;

      const payload: Record<string, unknown> = {
        name: formName.trim() || selected.label,
        provider: selected.id,
        model: formModel.trim(),
        apiEndpoint,
        credentials,
        appFunctions: formAppFunctions,
      };
      if (formApiKey.trim()) payload.apiKey = formApiKey.trim();
      // The numeric settings only travel when they were actually typed, so an untouched field keeps
      // whatever the connection already had rather than being reset to a default.
      for (const field of runtimeFields) {
        if (field.key === "model" || field.type !== "number") continue;
        const raw = form[field.key];
        if (raw !== undefined && raw !== "") {
          const value = Number(raw);
          if (Number.isFinite(value)) payload[field.key] = value;
        }
      }

      const saved = editing
        ? await api.patch(`/inference/providers/${editing.id}`, payload)
        : await api.post("/inference/providers", payload);

      toast.success(editing ? "Model connection updated" : `${saved.data.name} connected`);
      closeDialog();
      await fetchAll();

      // A new connection that has never been called is the exact moment to call it: the operator is
      // still looking at the screen, and the vendor's answer is the only proof the key is right.
      if (!editing) {
        void runTest(saved.data.id, { silent: true });
      }
    } catch (e) {
      toast.error(errText(e, "Could not save the connection"));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (id: string, opts: { silent?: boolean } = {}) => {
    setBusy(id);
    try {
      const res = await api.post(`/inference/providers/${id}/test`, {});
      const body = res.data as { success: boolean; detail: string | null; latencyMs: number; models?: unknown[] };
      if (body.success) toast.success(`${body.detail ?? "Connection works"} · ${body.latencyMs}ms`);
      else toast.error(`Test failed: ${body.detail ?? "no answer from the vendor"}`);
      await fetchAll();
    } catch (e) {
      if (!opts.silent) toast.error(errText(e, "Test failed"));
    } finally {
      setBusy(null);
    }
  };

  const showModels = async (provider: AiProvider) => {
    setBusy(provider.id);
    try {
      const res = await api.get(`/inference/providers/${provider.id}/models`);
      setModelsFor({ id: provider.id, data: res.data });
    } catch (e) {
      toast.error(errText(e, "Could not read the model list"));
    } finally {
      setBusy(null);
    }
  };

  const useModel = async (provider: AiProvider, model: string) => {
    setBusy(provider.id);
    try {
      await api.patch(`/inference/providers/${provider.id}`, { model });
      toast.success(`Using ${model}`);
      setModelsFor(null);
      await fetchAll();
    } catch (e) {
      toast.error(errText(e, "Could not change the model"));
    } finally {
      setBusy(null);
    }
  };

  const activate = async (provider: AiProvider) => {
    setBusy(provider.id);
    try {
      await api.post(`/inference/providers/${provider.id}/activate`, {});
      toast.success(`${provider.name} is now the model the application uses`);
      await fetchAll();
    } catch (e) {
      toast.error(errText(e, "Could not make this the active model"));
    } finally {
      setBusy(null);
    }
  };

  const deactivate = async (provider: AiProvider) => {
    setBusy(provider.id);
    try {
      await api.post(`/inference/providers/${provider.id}/deactivate`, {});
      toast.success(`${provider.name} is no longer active`);
      await fetchAll();
    } catch (e) {
      toast.error(errText(e, "Could not stop using this model"));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (provider: AiProvider) => {
    if (!window.confirm(`Remove ${provider.name}? Its API key is deleted with it.`)) return;
    setBusy(provider.id);
    try {
      await api.delete(`/inference/providers/${provider.id}`);
      toast.success(`${provider.name} removed`);
      await fetchAll();
    } catch (e) {
      toast.error(errText(e, "Could not remove the connection"));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="card py-8 text-center text-gray-500">Loading the model catalogue…</div>;

  return (
    <div className="space-y-5">
      {/* What is in use, said once and plainly — everything below is configuration. */}
      <div className={`card border ${status?.connected ? "border-emerald-500/20" : "border-amber-500/20"}`}>
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${status?.connected ? "bg-emerald-600/10" : "bg-amber-600/10"}`}>
            <Bot size={18} className={status?.connected ? "text-emerald-400" : "text-amber-400"} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">
              {status?.connected
                ? `${status.providerLabel ?? status.provider}${status.model ? ` · ${status.model}` : ""} is in use`
                : "No model is connected"}
            </p>
            <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
              {status?.connected
                ? `${status.name ?? "This connection"} answers ticket suggestions and the assistant${status.appFunctions ? ", and may call this application's functions when you ask it something" : "; it may not call application functions yet"}. ${status.toolCalling === true ? "" : status.toolCalling === "model-dependent" ? "Whether it can call functions depends on the model." : ""}`
                : "Ticket suggestions fall back to keyword search over resolved tickets, and the assistant has nothing to answer with. Connect any provider below — the key stays on this server."}
            </p>
          </div>
        </div>
      </div>

      {/* ── The models that are connected ─────────────────────────────────── */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Connected models</h3>
        {providers.length === 0 ? (
          <div className="card text-center py-6 text-gray-500 text-sm">
            Nothing connected yet. Pick a provider below.
          </div>
        ) : (
          <div className="space-y-2">
            {providers.map(provider => {
              const type = typeOf[provider.provider];
              const lastTest = provider.config?.lastTest;
              const models = provider.config?.models ?? [];
              return (
                <div key={provider.id} className="card">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-white font-medium text-sm">{provider.name}</p>
                        <span className="text-[11px] text-gray-500">{type?.label ?? provider.provider}</span>
                        {provider.isActive && provider.isDefault ? (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-600/10 text-emerald-300">In use</span>
                        ) : provider.isActive ? (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-surface-lighter text-gray-400">Active, not the default</span>
                        ) : (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-surface-lighter text-gray-500">Not active</span>
                        )}
                        {provider.config?.appFunctions ? (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-cyber-600/10 text-cyber-300">App functions</span>
                        ) : null}
                      </div>
                      <p className="text-xs text-gray-400 mt-1 font-mono truncate">{provider.model || "no model set"}</p>
                      <p className="text-[11px] text-gray-500 mt-1">
                        {lastTest
                          ? <>Last test {lastTest.ok ? "passed" : "failed"} {ago(lastTest.at)} · {lastTest.latencyMs}ms{lastTest.detail ? ` · ${lastTest.detail}` : ""}</>
                          : "Never tested — press Test connection to ask the vendor about this key."}
                        {models.length ? ` · ${models.length} models known` : ""}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={() => void runTest(provider.id)}
                        disabled={busy === provider.id}
                        title="Test connection"
                        aria-label="Test connection"
                        className="btn-secondary p-2"
                      >
                        <PlugZap size={14} className={lastTest && !lastTest.ok ? "text-red-400" : ""} />
                      </button>
                      <button
                        onClick={() => void showModels(provider)}
                        disabled={busy === provider.id}
                        title="Models this key can see"
                        aria-label="Models this key can see"
                        className="btn-secondary p-2"
                      >
                        <List size={14} />
                      </button>
                      {provider.isActive && provider.isDefault ? (
                        <button
                          onClick={() => void deactivate(provider)}
                          disabled={busy === provider.id}
                          title="Stop using this model"
                          aria-label="Stop using this model"
                          className="btn-secondary p-2"
                        >
                          <PowerOff size={14} />
                        </button>
                      ) : (
                        <button
                          onClick={() => void activate(provider)}
                          disabled={busy === provider.id}
                          title="Use this model for the application"
                          aria-label="Use this model for the application"
                          className="btn-secondary p-2"
                        >
                          <Power size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(provider)}
                        title="Edit this connection"
                        aria-label="Edit this connection"
                        className="btn-secondary p-2"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => { const type = typeOf[provider.provider]; if (type) setWizard({ type, existing: provider }); }}
                        title="Finish setting this up, step by step"
                        aria-label="Finish setting this up, step by step"
                        className="btn-secondary p-2"
                      >
                        <Wand2 size={14} />
                      </button>
                      <button
                        onClick={() => void remove(provider)}
                        disabled={busy === provider.id}
                        title="Remove this connection"
                        aria-label="Remove this connection"
                        className="btn-secondary p-2"
                      >
                        <Trash2 size={14} className="text-red-400" />
                      </button>
                    </div>
                  </div>

                  {/* The vendor's own model list, when it has been asked. */}
                  {modelsFor?.id === provider.id ? (
                    <div className="mt-3 border-t border-surface-border pt-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-gray-400">
                          {modelsFor.data.source === "provider"
                            ? `The vendor lists ${modelsFor.data.models.length} model${modelsFor.data.models.length === 1 ? "" : "s"} for this key${modelsFor.data.latencyMs ? ` (${modelsFor.data.latencyMs}ms)` : ""}.`
                            : modelsFor.data.source === "unavailable"
                              ? `The vendor could not be asked: ${modelsFor.data.detail ?? "no reason given"}. These are the names this build knows.`
                              : "These are the names this build knows — press Test connection to ask the vendor."}
                        </p>
                        <button onClick={() => setModelsFor(null)} className="text-gray-500 hover:text-white" title="Close the model list" aria-label="Close the model list">
                          <X size={14} />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2 max-h-40 overflow-y-auto">
                        {modelOptions.map(model => (
                          <button
                            key={model.id}
                            onClick={() => void useModel(provider, model.id)}
                            title={`Use ${model.id}`}
                            className={`text-[11px] font-mono px-2 py-1 rounded border transition-colors ${
                              model.id === provider.model
                                ? "border-cyber-500 text-white bg-surface-lighter"
                                : "border-surface-border text-gray-400 hover:text-white hover:border-cyber-500/40"
                            }`}
                          >
                            {model.id}{model.label ? <span className="text-gray-500"> · {model.label}</span> : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── The catalogue ─────────────────────────────────────────────────── */}
      {!selected ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Connect a model</h3>
            <span className="text-[11px] text-gray-500">{types.length} providers</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {types.map(type => {
              const connectedHere = providers.filter(p => p.provider === type.id).length;
              return (
                <div key={type.id} className="card p-4 flex flex-col gap-3 hover:border-cyber-500/30 transition-colors">
                  <button onClick={() => openConnect(type)} className="text-left cursor-pointer group">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-cyber-600/10 group-hover:bg-cyber-600/20 transition-colors">
                        <Bot size={18} className="text-cyber-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-white font-medium text-sm truncate">{type.label}</p>
                          {connectedHere ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-600/10 text-emerald-300">connected</span> : null}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{type.summary}</p>
                        <p className="text-[11px] text-gray-600 mt-1">{toolCallingLabel(type.toolCalling)}</p>
                      </div>
                    </div>
                  </button>
                  {/* The wizard is the short path: where the key is created, what the account needs
                      first, and a vendor test before anything depends on it. */}
                  <div className="flex items-center gap-2 mt-auto">
                    <button
                      onClick={() => setWizard({ type })}
                      className="btn-primary text-xs inline-flex items-center gap-1.5"
                      title={`Walk through connecting ${type.label}`}
                    >
                      <Wand2 size={12} /> Walk me through it
                    </button>
                    <button onClick={() => openConnect(type)} className="btn-secondary text-xs" title="Just the fields">
                      Fill the form
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* ── The connect dialog ──────────────────────────────────────────── */
        <div className="card space-y-4 animate-fade-in">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-white">{editing ? `Edit ${editing.name}` : `Connect ${selected.label}`}</h3>
              <p className="text-sm text-gray-400 mt-0.5">{selected.summary}</p>
            </div>
            <button onClick={closeDialog} className="text-gray-500 hover:text-white" title="Cancel" aria-label="Cancel">
              <X size={16} />
            </button>
          </div>

          <div className={`flex items-start gap-2 rounded-lg border p-3 ${selected.guidance.tone === "warn" ? "border-amber-500/20 bg-amber-500/5" : "border-cyber-500/20 bg-cyber-500/5"}`}>
            {selected.guidance.tone === "warn"
              ? <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
              : <ShieldCheck size={14} className="text-cyber-400 mt-0.5 shrink-0" />}
            <p className="text-xs text-gray-300 leading-relaxed">{selected.guidance.text}</p>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 shrink-0">Connection name</label>
            <input className="input-field !w-auto flex-1 max-w-sm" value={formName} onChange={e => setFormName(e.target.value)} />
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2"><KeyRound size={13} /> Credentials</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {selected.credentials.map(field => {
                const label = (
                  <label className="text-xs text-gray-500 block mb-1">
                    {field.label}
                    {field.required && <span className="text-cyber-400"> *</span>}
                  </label>
                );
                // The key has a column of its own and is never sent back to the browser, so it is
                // rendered as write-only: empty means "keep what is stored".
                if (field.key === "apiKey") {
                  return (
                    <div key={field.key}>
                      {label}
                      <input
                        className="input-field"
                        type="password"
                        autoComplete="new-password"
                        placeholder={editing?.hasApiKey ? "a key is stored — type to replace it" : field.placeholder}
                        value={formApiKey}
                        onChange={e => setFormApiKey(e.target.value)}
                      />
                      <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{field.hint}</p>
                    </div>
                  );
                }
                return (
                  <div key={field.key}>
                    {label}
                    {field.type === "select" ? (
                      <select className="input-field" value={form[field.key] ?? ""} onChange={e => setForm(p => ({ ...p, [field.key]: e.target.value }))}>
                        <option value="">{field.required ? "Choose…" : "Default"}</option>
                        {(field.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}
                      </select>
                    ) : (
                      <input
                        className="input-field"
                        type={field.type === "password" ? "password" : "text"}
                        autoComplete={field.type === "password" ? "new-password" : "off"}
                        placeholder={field.placeholder}
                        value={form[field.key] ?? ""}
                        onChange={e => setForm(p => ({ ...p, [field.key]: e.target.value }))}
                      />
                    )}
                    <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{field.hint}</p>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {selected.keyUrl ? (
                <a href={selected.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-cyber-400 hover:text-cyber-300">
                  Where to create a key <ExternalLink size={11} />
                </a>
              ) : null}
              <a href={selected.docs.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-cyber-400 hover:text-cyber-300">
                {selected.docs.label} <ExternalLink size={11} />
              </a>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">How it is used</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Model</label>
                <input
                  className="input-field font-mono"
                  list="ai-model-suggestions"
                  placeholder={selected.defaultModel || "the model name, as the vendor spells it"}
                  value={formModel}
                  onChange={e => setFormModel(e.target.value)}
                />
                <datalist id="ai-model-suggestions">
                  {selected.shortlist.map(id => <option key={id} value={id} />)}
                </datalist>
                <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                  {selected.shortlist.length
                    ? `Suggestions: ${selected.shortlist.join(", ")}. Save, then use the model list on the row to read the names the vendor is serving today — that list is the authority, not this one.`
                    : "This provider does not publish a model list, so the name is whatever you were given — for Azure it is the deployment name."}
                  {selected.addressRequired ? " The address above is part of the call, so a wrong one looks like a wrong key." : ""}
                </p>
              </div>
              {runtimeFields.filter(f => f.key !== "model").map(field => (
                <div key={field.key}>
                  {field.type === "boolean" ? (
                    <label className="flex items-start gap-2 cursor-pointer mt-5">
                      <input type="checkbox" checked={formAppFunctions} onChange={e => setFormAppFunctions(e.target.checked)} className="mt-0.5" />
                      <span>
                        <span className="text-sm text-gray-200 flex items-center gap-1"><Star size={12} className="text-cyber-400" /> {field.label}</span>
                        <span className="block text-[11px] text-gray-500 leading-relaxed mt-0.5">{field.hint}</span>
                      </span>
                    </label>
                  ) : (
                    <>
                      <label className="text-xs text-gray-500 block mb-1">{field.label}</label>
                      <input className="input-field" placeholder={String(field.default ?? "")} value={form[field.key] ?? ""} onChange={e => setForm(p => ({ ...p, [field.key]: e.target.value }))} />
                      <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{field.hint}</p>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button onClick={() => void save()} disabled={saving} className="btn-primary flex items-center gap-2">
              <Plus size={14} /> {saving ? "Saving…" : editing ? "Save changes" : "Connect"}
            </button>
            <button onClick={closeDialog} className="btn-secondary">Cancel</button>
            <span className="text-[11px] text-gray-500 flex items-center gap-1">
              <Info size={11} /> A new connection is tested as soon as it is saved.
            </span>
          </div>
        </div>
      )}

      {wizard ? (
        <ModelSetupWizard
          type={wizard.type as unknown as ModelSetupType}
          runtimeFields={runtimeFields as unknown as Parameters<typeof ModelSetupWizard>[0]["runtimeFields"]}
          existing={wizard.existing as unknown as Parameters<typeof ModelSetupWizard>[0]["existing"]}
          onClose={() => setWizard(null)}
          onDone={() => { void fetchAll(); }}
        />
      ) : null}
    </div>
  );
}
