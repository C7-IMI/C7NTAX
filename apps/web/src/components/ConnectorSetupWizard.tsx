import { useCallback, useMemo, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";
import {
  Wand2, ArrowLeft, ArrowRight, Check, Loader2, ExternalLink, PlugZap, RefreshCw, Info,
  ShieldCheck, Link2, CircleAlert, CheckCircle2,
} from "lucide-react";
import { Choice, FactPanel, Hint, Label, Row, WizardShell } from "./wizard/WizardShell";
import { apiErrorMessage } from "../lib/apiError";

/**
 * The setup wizard for a data connector, driven entirely by what the API serves about it.
 *
 * The OAuth app wizard's lesson was not "build a wizard for this connector" — it was that a
 * connection is finished when it has been *proved*, and that the steps before it are where people
 * get stuck. So this one walks the same journey for any connector: what it is and what it will not
 * do, what has to exist in the vendor's product first, the credentials grouped by where they come
 * from, the connector's own settings, and then a real test against the vendor with the option to
 * switch it on and sync immediately.
 *
 * Nothing here is per-connector: the plan (`setup`), the fields and the settings all arrive with the
 * connector's catalogue entry, which is why adding a connector does not add a wizard.
 */

export interface SetupPrerequisite { title: string; detail: string; link?: string }
export interface SetupGroup { title: string; note: string; fields: string[] }
export interface ConnectorSetup {
  overview: string;
  prerequisites: SetupPrerequisite[];
  credentialGroups: SetupGroup[];
  settingsNote?: string;
  firstSync: { title: string; detail: string };
  nextSteps: string[];
}

export interface CredentialField {
  key: string;
  /** Falls back to the key turned into words, which is all the older connectors provide. */
  label?: string;
  type?: "text" | "password" | "url" | "select" | "number";
  required?: boolean;
  hint?: string;
  placeholder?: string;
  options?: string[];
}

export interface SettingField {
  key: string;
  label: string;
  type: string;
  default?: unknown;
  options?: string[];
  hint?: string;
}

export interface SetupType {
  kind: string;
  name: string;
  description: string;
  credentialFields?: CredentialField[];
  settings?: SettingField[];
  requiredScopes?: string[];
  guidance?: { tone?: "info" | "warn"; text: string };
  docsUrl?: string;
  docsLabel?: string;
  setup: ConnectorSetup | null;
}

export interface SetupConnection {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  status: string;
  credentials?: Record<string, string>;
  settings?: Record<string, unknown>;
  lastSyncAt?: string | null;
  errorMessage?: string | null;
}

interface FieldError { field: string; message: string; fix: string; example: string }

/** The label a field is shown under: the spec's own, or the key turned into words. */
function fieldLabel(field: CredentialField): string {
  return field.label || field.key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim();
}

const SECRET = (key: string) => /secret|password|key|token/i.test(key) && !/keyUrl/i.test(key);

/**
 * The steps. A connector with settings gets one more, and the last step is always the same: prove it,
 * then switch it on.
 */
export function setupSteps(setup: ConnectorSetup | null): string[] {
  return ["What this is", "Prepare", "Credentials", ...(setup?.settingsNote ? ["Settings"] : []), "Test & finish"];
}

export function ConnectorSetupWizard({
  type,
  existing,
  onClose,
  onDone,
}: {
  type: SetupType;
  /** Present when the wizard is finishing a connection that already exists. */
  existing?: SetupConnection;
  onClose: () => void;
  onDone: (id?: string) => void;
}) {
  const steps = useMemo(() => setupSteps(type.setup), [type.setup]);
  const [step, setStep] = useState(0);
  const stepName = steps[step] ?? steps[0]!;

  const [name, setName] = useState(existing?.name ?? type.name);
  const [credentials, setCredentials] = useState<Record<string, string>>(() => {
    const start: Record<string, string> = {};
    for (const field of type.credentialFields ?? []) {
      const stored = existing?.credentials?.[field.key];
      // Secrets are never sent to a browser, so a stored one shows as "keep what is there" and an
      // empty box means exactly that rather than "erase it".
      start[field.key] = SECRET(field.key) ? "" : (stored ?? "");
    }
    return start;
  });
  const [settings, setSettings] = useState<Record<string, unknown>>(() => {
    const start: Record<string, unknown> = {};
    for (const field of type.settings ?? []) {
      start[field.key] = existing?.settings?.[field.key] ?? field.default;
    }
    return start;
  });

  const [connectionId, setConnectionId] = useState<string | null>(existing?.id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail?: string } | null>(null);
  const [syncResult, setSyncResult] = useState<{ records: number; errors: string[] } | null>(null);
  const [enabled, setEnabled] = useState(existing?.enabled ?? false);

  const fields = type.credentialFields ?? [];
  const fieldOf = (key: string) => fields.find(f => f.key === key);
  const missing = fields.filter(f => f.required && !(credentials[f.key] ?? "").trim() && !(SECRET(f.key) && existing));

  const goTo = (target: string) => {
    const index = steps.indexOf(target);
    if (index >= 0) setStep(index);
  };

  const save = useCallback(async (): Promise<string | null> => {
    const payload = { name: name.trim() || type.name, credentials, settings };
    if (connectionId) {
      await api.patch(`/cloudconnect/${connectionId}`, payload);
      return connectionId;
    }
    const { data } = await api.post("/cloudconnect", { kind: type.kind, ...payload });
    setConnectionId(data.id);
    return data.id as string;
  }, [connectionId, credentials, name, settings, type.kind, type.name]);

  /** Save, then ask the vendor. One button, because saving without testing is how a broken
   *  connection looks configured. */
  const saveAndTest = async () => {
    setBusy("test");
    setError(null);
    setFieldErrors([]);
    setTestResult(null);
    try {
      const id = await save();
      if (!id) throw new Error("The connection could not be saved");
      const { data } = await api.post(`/cloudconnect/${id}/test`);
      if (data.connected) {
        setTestResult({ ok: true });
        toast.success(`${type.name} answered — the credentials work`);
      } else {
        setTestResult({ ok: false, detail: data.message ?? data.error ?? undefined });
        setFieldErrors(data.fieldErrors ?? []);
        toast.error(`${type.name} did not answer — see what it said`);
      }
    } catch (e) {
      setError(apiErrorMessage(e, "Could not save and test the connection"));
    } finally {
      setBusy(null);
    }
  };

  const enableAndSync = async () => {
    if (!connectionId) return;
    setBusy("sync");
    try {
      await api.patch(`/cloudconnect/${connectionId}`, { enabled: true });
      setEnabled(true);
      const { data } = await api.post(`/cloudconnect/${connectionId}/sync`);
      setSyncResult({ records: data.recordsProcessed ?? 0, errors: data.errors ?? [] });
      toast.success(`${data.recordsProcessed ?? 0} records read`);
    } catch (e) {
      setError(apiErrorMessage(e, "Could not switch it on and sync"));
    } finally {
      setBusy(null);
    }
  };

  const applyFix = (fieldError: FieldError, value: string) => {
    setCredentials(prev => ({ ...prev, [fieldError.field]: value }));
  };

  const primary = (() => {
    if (stepName === "What this is") return { label: "Continue", action: () => goTo("Prepare"), disabled: false };
    if (stepName === "Prepare") return { label: "I have these — continue", action: () => goTo("Credentials"), disabled: false };
    if (stepName === "Credentials") {
      const next = type.setup?.settingsNote ? "Settings" : "Test & finish";
      return { label: missing.length ? `Still needed: ${missing.length}` : "Continue", action: () => goTo(next), disabled: missing.length > 0 };
    }
    if (stepName === "Settings") return { label: "Continue", action: () => goTo("Test & finish"), disabled: false };
    if (!testResult?.ok) return { label: "Save and test the connection", action: () => void saveAndTest(), disabled: busy === "test" };
    if (!enabled) return { label: "Switch it on and sync now", action: () => void enableAndSync(), disabled: busy === "sync" };
    return { label: "Done", action: () => { onDone(connectionId ?? undefined); onClose(); }, disabled: false };
  })();

  return (
    <WizardShell
      icon={<Wand2 size={18} />}
      title={`${existing ? "Finish setting up" : "Set up"} ${type.name}`}
      subtitle={existing
        ? "Walk the same steps with what is already stored, then prove it and switch it on."
        : "Sixteen of these integrations fail in the vendor's own product before they fail here. This walks the order that works."}
      steps={steps}
      step={step}
      onClose={onClose}
      error={error}
      footer={
        <>
          <div className="flex items-center gap-2">
            {step > 0 ? (
              <button className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => setStep(s => Math.max(0, s - 1))}>
                <ArrowLeft size={13} /> Back
              </button>
            ) : null}
            {existing ? <span className="text-[11px] text-gray-500">Editing “{existing.name}”</span> : null}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary text-xs" onClick={onClose}>Cancel</button>
            <button
              className="btn-primary text-xs inline-flex items-center gap-1.5"
              onClick={() => primary.action()}
              disabled={primary.disabled || missing.length > 0 && stepName === "Credentials"}
            >
              {primary.disabled ? <Loader2 size={13} className="animate-spin" /> : stepName === "Test & finish" && testResult?.ok ? <Check size={13} /> : <ArrowRight size={13} />}
              {primary.label}
            </button>
          </div>
        </>
      }
    >
      {/* ── 1. What this is ── */}
      {stepName === "What this is" ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-200 leading-relaxed">{type.setup?.overview ?? type.description}</p>

          {type.guidance ? (
            <div className={`flex items-start gap-2 rounded-lg border p-3 ${type.guidance.tone === "warn" ? "border-amber-500/20 bg-amber-500/5" : "border-cyber-500/20 bg-cyber-500/5"}`}>
              {type.guidance.tone === "warn" ? <CircleAlert size={14} className="text-amber-400 mt-0.5 shrink-0" /> : <ShieldCheck size={14} className="text-cyber-400 mt-0.5 shrink-0" />}
              <p className="text-xs text-gray-300 leading-relaxed">{type.guidance.text}</p>
            </div>
          ) : null}

          <FactPanel title="What happens when it runs">
            <p className="text-xs text-gray-300">{type.setup?.firstSync.title ?? "The first sync reads the vendor's records."}</p>
            <p className="text-[11px] text-gray-500 leading-relaxed">{type.setup?.firstSync.detail ?? "Everything read is stored against this connection and reported in the sync log."}</p>
            {type.requiredScopes?.length ? (
              <p className="text-[11px] text-gray-500">Ask for exactly these: <span className="font-mono text-gray-400">{type.requiredScopes.join(", ")}</span></p>
            ) : null}
          </FactPanel>

          {type.docsUrl ? (
            <a href={type.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-cyber-400 hover:text-cyber-300">
              {type.docsLabel ?? "The vendor's API reference"} <ExternalLink size={11} />
            </a>
          ) : null}

          <div className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-wide text-gray-500">Where this will live</h3>
            <Label htmlFor="wiz-conn-name">Connection name</Label>
            <input id="wiz-conn-name" className="input-field max-w-sm" value={name} onChange={e => setName(e.target.value)} />
            <Hint>
              A name for your own benefit — every connection of this kind needs one, and two tenants of the same
              product need two connections.
            </Hint>
          </div>
        </div>
      ) : null}

      {/* ── 2. Prepare ── */}
      {stepName === "Prepare" ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-400 leading-relaxed">
            Do these first, in the vendor's own product. Each one is why the next step either works or
            fails with something that looks like a wrong credential.
          </p>
          {(type.setup?.prerequisites ?? []).map((item, index) => (
            <div key={item.title} className="rounded-lg border border-surface-border p-3">
              <p className="text-sm text-white inline-flex items-start gap-2">
                <span className="text-[11px] font-mono text-gray-500 mt-0.5">{index + 1}</span>
                {item.title}
              </p>
              <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">{item.detail}</p>
              {item.link ? (
                <a href={item.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-cyber-400 hover:text-cyber-300 mt-1.5">
                  {new URL(item.link).hostname.replace(/^www\./, "")} <ExternalLink size={10} />
                </a>
              ) : null}
            </div>
          ))}
          {!type.setup?.prerequisites?.length ? (
            <p className="text-xs text-gray-500">
              Nothing to prepare: this connection needs only what the next step asks for.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ── 3. Credentials ── */}
      {stepName === "Credentials" ? (
        <div className="space-y-4">
          <p className="text-xs text-gray-400 leading-relaxed">
            Grouped by where they come from, in the order to collect them — so a value from one screen is not
            typed into a box that belongs to another.
          </p>
          {(type.setup?.credentialGroups ?? []).map(group => {
            const groupFields = group.fields.map(fieldOf).filter(Boolean) as CredentialField[];
            if (!groupFields.length) return null;
            return (
              <div key={group.title} className="rounded-lg border border-surface-border p-3 space-y-3">
                <div>
                  <p className="text-sm text-white">{group.title}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{group.note}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {groupFields.map(field => {
                    const stored = existing?.credentials?.[field.key];
                    const isSecret = SECRET(field.key);
                    return (
                      <div key={field.key}>
                        <Label htmlFor={`wiz-${field.key}`}>
                          {fieldLabel(field)}{field.required ? <span className="text-cyber-400"> *</span> : null}
                        </Label>
                        {field.type === "select" ? (
                          <select
                            id={`wiz-${field.key}`}
                            className="input-field"
                            value={credentials[field.key] ?? ""}
                            onChange={e => setCredentials(prev => ({ ...prev, [field.key]: e.target.value }))}
                          >
                            <option value="">{field.required ? "Choose…" : "Default"}</option>
                            {(field.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}
                          </select>
                        ) : (
                          <input
                            id={`wiz-${field.key}`}
                            className="input-field"
                            type={isSecret ? "password" : "text"}
                            autoComplete={isSecret ? "new-password" : "off"}
                            placeholder={isSecret && stored ? "a value is stored — type to replace it" : field.placeholder}
                            value={credentials[field.key] ?? ""}
                            onChange={e => setCredentials(prev => ({ ...prev, [field.key]: e.target.value }))}
                          />
                        )}
                        {field.hint ? <Hint>{field.hint}</Hint> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* A credential the form has but the plan does not mention is still reachable, so the
              wizard cannot trap somebody in a connection the plain form could have finished. */}
          {fields.filter(f => !(type.setup?.credentialGroups ?? []).some(g => g.fields.includes(f.key))).length ? (
            <details className="rounded-lg border border-surface-border p-3">
              <summary className="text-xs text-gray-400 cursor-pointer">
                Other fields this connector has ({fields.filter(f => !(type.setup?.credentialGroups ?? []).some(g => g.fields.includes(f.key))).length})
              </summary>
              <div className="grid gap-3 sm:grid-cols-2 mt-3">
                {fields.filter(f => !(type.setup?.credentialGroups ?? []).some(g => g.fields.includes(f.key))).map(field => (
                  <div key={field.key}>
                    <Label htmlFor={`wiz-extra-${field.key}`}>{fieldLabel(field)}</Label>
                    <input
                      id={`wiz-extra-${field.key}`}
                      className="input-field"
                      type={SECRET(field.key) ? "password" : "text"}
                      value={credentials[field.key] ?? ""}
                      onChange={e => setCredentials(prev => ({ ...prev, [field.key]: e.target.value }))}
                    />
                    {field.hint ? <Hint>{field.hint}</Hint> : null}
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          {missing.length ? (
            <p className="text-[11px] text-amber-300">
              Still needed: {missing.map(f => f.label).join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ── 4. Settings ── */}
      {stepName === "Settings" ? (
        <div className="space-y-4">
          <p className="text-xs text-gray-400 leading-relaxed">{type.setup?.settingsNote}</p>
          <div className="space-y-3">
            {(type.settings ?? []).map(field => (
              <div key={field.key} className="rounded-lg border border-surface-border p-3">
                {field.type === "boolean" ? (
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={settings[field.key] === true}
                      onChange={e => setSettings(prev => ({ ...prev, [field.key]: e.target.checked }))}
                    />
                    <span>
                      <span className="text-sm text-gray-200">{field.label}</span>
                      {field.hint ? <span className="block text-[11px] text-gray-500 mt-0.5 leading-relaxed">{field.hint}</span> : null}
                    </span>
                  </label>
                ) : (
                  <>
                    <Label htmlFor={`wiz-set-${field.key}`}>{field.label}</Label>
                    {field.type === "select" ? (
                      <select
                        id={`wiz-set-${field.key}`}
                        className="input-field"
                        value={String(settings[field.key] ?? "")}
                        onChange={e => setSettings(prev => ({ ...prev, [field.key]: e.target.value }))}
                      >
                        {(field.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}
                      </select>
                    ) : field.type === "json" ? (
                      <textarea
                        id={`wiz-set-${field.key}`}
                        className="input-field font-mono text-[11px] h-24"
                        value={typeof settings[field.key] === "string" ? String(settings[field.key]) : JSON.stringify(settings[field.key] ?? {}, null, 2)}
                        onChange={e => setSettings(prev => ({ ...prev, [field.key]: e.target.value }))}
                      />
                    ) : (
                      <input
                        id={`wiz-set-${field.key}`}
                        className="input-field max-w-[12rem]"
                        type={field.type === "number" ? "number" : "text"}
                        value={String(settings[field.key] ?? "")}
                        onChange={e => setSettings(prev => ({ ...prev, [field.key]: field.type === "number" ? Number(e.target.value) : e.target.value }))}
                      />
                    )}
                    {field.hint ? <Hint>{field.hint}</Hint> : null}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── 5. Test & finish ── */}
      {stepName === "Test & finish" ? (
        <div className="space-y-4">
          {!testResult ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-400 leading-relaxed">
                This saves the connection and then asks the vendor, so "saved" and "working" are not the same
                screen. Nothing is switched on and nothing is read until it answers.
              </p>
              <FactPanel title="What the vendor is asked">
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  {type.name} is called with the credentials you entered. A refusal carries the vendor's own words,
                  which is the only useful part of it.
                </p>
              </FactPanel>
            </div>
          ) : testResult.ok ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-emerald-600/40 bg-emerald-500/5 p-3 flex items-start gap-2">
                <CheckCircle2 size={14} className="text-emerald-300 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm text-emerald-200">{type.name} answered</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    The credentials are accepted{testResult.detail ? ` — ${testResult.detail}` : ""}.
                    {enabled ? "" : " It is still switched off: the next button enables it and runs the first sync."}
                  </p>
                </div>
              </div>

              {syncResult ? (
                <div className="rounded-lg border border-surface-border p-3 space-y-1">
                  <p className="text-sm text-white inline-flex items-center gap-2">
                    <RefreshCw size={13} className="text-cyber-400" /> {syncResult.records} record{syncResult.records === 1 ? "" : "s"} read
                  </p>
                  {syncResult.errors.length ? (
                    syncResult.errors.slice(0, 3).map(error => (
                      <p key={error} className="text-[11px] text-amber-300 leading-relaxed">{error}</p>
                    ))
                  ) : (
                    <p className="text-[11px] text-gray-500">
                      They are stored against this connection and visible on Configuration. Later syncs read what has changed since.
                    </p>
                  )}
                </div>
              ) : null}

              {syncResult && (type.setup?.nextSteps?.length ?? 0) > 0 ? (
                <FactPanel title="Worth doing next">
                  <ul className="space-y-1.5">
                    {type.setup!.nextSteps.map(step => (
                      <li key={step} className="text-[11px] text-gray-400 leading-relaxed inline-flex items-start gap-1.5">
                        <Info size={11} className="mt-0.5 shrink-0 text-gray-500" /> {step}
                      </li>
                    ))}
                  </ul>
                </FactPanel>
              ) : null}

              {existing ? (
                <div className="rounded-lg border border-surface-border divide-y divide-surface-border">
                  <Row label="Connection" value={name} />
                  <Row label="Kind" value={type.name} />
                  <Row label="Enabled" value={enabled ? "yes" : "not yet"} />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 flex items-start gap-2">
                <CircleAlert size={14} className="text-rose-300 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm text-rose-200">The vendor refused the connection</p>
                  <p className="text-[11px] text-gray-300 mt-0.5 leading-relaxed">
                    {testResult.detail ?? "No reason was given, which usually means the request never arrived — check the address first."}
                  </p>
                </div>
              </div>

              {fieldErrors.length ? (
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Fix these and try again</p>
                  {fieldErrors.map(fieldError => {
                    const field = fieldOf(fieldError.field);
                    return (
                      <div key={fieldError.field} className="rounded-lg border border-surface-border p-3 space-y-2">
                        <p className="text-xs text-gray-300">
                          <span className="text-white">{field?.label ?? fieldError.field}</span> — {fieldError.message}
                        </p>
                        <p className="text-[11px] text-gray-500 leading-relaxed">{fieldError.fix}</p>
                        <input
                          className="input-field"
                          type={SECRET(fieldError.field) ? "password" : "text"}
                          placeholder={fieldError.example || field?.placeholder}
                          value={credentials[fieldError.field] ?? ""}
                          onChange={e => applyFix(fieldError, e.target.value)}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  Nothing missing was found among the fields, so the vendor rejected a value rather than an absence.
                  Go back to Credentials and check the pair that belongs together — the address and the key, or the
                  account and its secret.
                </p>
              )}

              <div className="flex items-center gap-2">
                <button className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => goTo("Credentials")}>
                  <ArrowLeft size={13} /> Back to the credentials
                </button>
                <button className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => void saveAndTest()} disabled={busy === "test"}>
                  <PlugZap size={13} /> Test again
                </button>
              </div>
            </div>
          )}

          {existing?.errorMessage ? (
            <p className="text-[11px] text-gray-500 leading-relaxed inline-flex items-start gap-1.5">
              <Link2 size={11} className="mt-0.5 shrink-0" /> The last recorded error on this connection was: {existing.errorMessage}
            </p>
          ) : null}

          {connectionId ? (
            <p className="text-[11px] text-gray-600">Connection id {connectionId.slice(0, 8)} — visible on Configuration while this wizard is open.</p>
          ) : null}
        </div>
      ) : null}
    </WizardShell>
  );
}
