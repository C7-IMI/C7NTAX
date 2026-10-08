import { useMemo, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";
import {
  Wand2, ArrowLeft, ArrowRight, Check, Loader2, ExternalLink, KeyRound, PlugZap, Sparkles,
  CircleAlert, CheckCircle2, Info, Power,
} from "lucide-react";
import { FactPanel, Hint, Label, Row, WizardShell } from "./wizard/WizardShell";
import { apiErrorMessage } from "../lib/apiError";

/**
 * The setup wizard for a model connection.
 *
 * Same journey as the connector wizard, and the same reason for existing: a provider is not
 * configured by pasting a key into a box. The key has to be created on the vendor's own screen, the
 * account usually needs credit before it works, the model has to be one this key can actually see,
 * and the whole thing has to be proved against the vendor before anything is asked of it.
 *
 * The closing screen is the point of it: the vendor's answer, the models it listed, one button that
 * makes this the model the application uses, and what to do next.
 */

interface AiCredentialField {
  key: string;
  label: string;
  type?: "text" | "password" | "url" | "select";
  required?: boolean;
  hint?: string;
  placeholder?: string;
  options?: string[];
}

interface RuntimeField {
  key: string;
  label: string;
  type: "text" | "number" | "boolean";
  default?: unknown;
  hint: string;
}

export interface ModelSetupType {
  id: string;
  label: string;
  vendor: string;
  summary: string;
  credentials: AiCredentialField[];
  shortlist: string[];
  defaultModel: string;
  keyUrl: string;
  docs: { url: string; label: string };
  guidance: { tone?: "info" | "warn"; text: string };
  toolCalling: boolean | "model-dependent";
  setup: {
    overview: string;
    steps: Array<{ title: string; detail: string; link?: string }>;
    afterSaving: string;
  } | null;
}

export interface ModelConnection {
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
  config?: { credentials?: Record<string, string>; appFunctions?: boolean };
}

const STEPS = ["What this is", "Get a key", "Connect", "Model & permissions", "Test & finish"];

export function ModelSetupWizard({
  type,
  runtimeFields,
  existing,
  onClose,
  onDone,
}: {
  type: ModelSetupType;
  runtimeFields: RuntimeField[];
  existing?: ModelConnection;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const stepName = STEPS[step] ?? STEPS[0]!;

  const [name, setName] = useState(existing?.name ?? type.label);
  const [apiKey, setApiKey] = useState("");
  const [credentials, setCredentials] = useState<Record<string, string>>(() => ({ ...(existing?.config?.credentials ?? {}) }));
  const [model, setModel] = useState(existing?.model ?? type.defaultModel);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [appFunctions, setAppFunctions] = useState(existing?.config?.appFunctions === true);

  const [connectionId, setConnectionId] = useState<string | null>(existing?.id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; detail: string | null; latencyMs: number; models: Array<{ id: string; label?: string }> } | null>(null);
  const [active, setActive] = useState(existing?.isActive === true && existing?.isDefault === true);

  const numericFields = useMemo(() => runtimeFields.filter(f => f.type === "number"), [runtimeFields]);

  const goTo = (target: string) => {
    const index = STEPS.indexOf(target);
    if (index >= 0) setStep(index);
  };

  const save = async (): Promise<string | null> => {
    const payload: Record<string, unknown> = {
      name: name.trim() || type.label,
      provider: type.id,
      model: model.trim(),
      credentials,
      appFunctions,
      apiEndpoint: credentials.baseUrl || credentials.endpoint || existing?.apiEndpoint || null,
    };
    if (apiKey.trim()) payload.apiKey = apiKey.trim();
    for (const field of numericFields) {
      const raw = limits[field.key];
      if (raw !== undefined && raw !== "") {
        const value = Number(raw);
        if (Number.isFinite(value)) payload[field.key] = value;
      }
    }
    if (connectionId) {
      await api.patch(`/inference/providers/${connectionId}`, payload);
      return connectionId;
    }
    const { data } = await api.post("/inference/providers", payload);
    setConnectionId(data.id);
    return data.id as string;
  };

  const saveAndTest = async () => {
    setBusy("test");
    setError(null);
    setTest(null);
    try {
      const id = await save();
      if (!id) throw new Error("The connection could not be saved");
      const { data } = await api.post(`/inference/providers/${id}/test`, {});
      setTest({ ok: data.success, detail: data.detail, latencyMs: data.latencyMs, models: data.models ?? [] });
      if (data.success) toast.success(`Answered in ${data.latencyMs}ms`);
      else toast.error("The vendor refused it — see what it said");
    } catch (e) {
      setError(apiErrorMessage(e, "Could not save and test the connection"));
    } finally {
      setBusy(null);
    }
  };

  const useForTheApplication = async () => {
    if (!connectionId) return;
    setBusy("activate");
    try {
      await api.post(`/inference/providers/${connectionId}/activate`, {});
      setActive(true);
      toast.success(`${name} is now the model the application uses`);
    } catch (e) {
      setError(apiErrorMessage(e, "Could not make this the active model"));
    } finally {
      setBusy(null);
    }
  };

  const primary = (() => {
    if (stepName === "What this is") return { label: "Continue", action: () => goTo("Get a key"), disabled: false };
    if (stepName === "Get a key") return { label: "I have a key", action: () => goTo("Connect"), disabled: false };
    if (stepName === "Connect") {
      const needsKey = !existing?.hasApiKey && type.credentials.some(c => c.key === "apiKey" && c.required);
      return { label: !apiKey.trim() && needsKey ? "A key is needed" : "Continue", action: () => goTo("Model & permissions"), disabled: !apiKey.trim() && needsKey };
    }
    if (stepName === "Model & permissions") return { label: !model.trim() ? "Name a model" : "Continue", action: () => goTo("Test & finish"), disabled: !model.trim() };
    if (!test?.ok) return { label: "Save and test the connection", action: () => void saveAndTest(), disabled: busy === "test" };
    if (!active) return { label: "Use this model for the application", action: () => void useForTheApplication(), disabled: busy === "activate" };
    return { label: "Done", action: () => { onDone(); onClose(); }, disabled: false };
  })();

  return (
    <WizardShell
      icon={<Wand2 size={18} />}
      title={`${existing ? "Finish setting up" : "Connect"} ${type.label}`}
      subtitle="Create the key on the vendor's own screen, connect it, pick a model this key can see, then prove it."
      steps={STEPS}
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
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary text-xs" onClick={onClose}>Cancel</button>
            <button
              className="btn-primary text-xs inline-flex items-center gap-1.5"
              onClick={() => primary.action()}
              disabled={primary.disabled}
            >
              {primary.disabled ? <Loader2 size={13} className="animate-spin" /> : stepName === "Test & finish" && active ? <Check size={13} /> : <ArrowRight size={13} />}
              {primary.label}
            </button>
          </div>
        </>
      }
    >
      {/* ── 1. What this is ── */}
      {stepName === "What this is" ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-200 leading-relaxed">{type.setup?.overview ?? type.summary}</p>

          {type.guidance ? (
            <div className={`flex items-start gap-2 rounded-lg border p-3 ${type.guidance.tone === "warn" ? "border-amber-500/20 bg-amber-500/5" : "border-cyber-500/20 bg-cyber-500/5"}`}>
              {type.guidance.tone === "warn" ? <CircleAlert size={14} className="text-amber-400 mt-0.5 shrink-0" /> : <Sparkles size={14} className="text-cyber-400 mt-0.5 shrink-0" />}
              <p className="text-xs text-gray-300 leading-relaxed">{type.guidance.text}</p>
            </div>
          ) : null}

          <FactPanel title="What connecting it does">
            <p className="text-[11px] text-gray-400 leading-relaxed">
              The key is stored on this server and attached to every call from it — it is never sent to a browser.
              Prompts leave your network for {type.vendor}, under their terms, so anything the model is asked to read
              goes to them.
            </p>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              {type.toolCalling === true
                ? "This provider supports tool calling, so a model from it can look things up in C7NTAX when you allow that on the connection."
                : type.toolCalling === "model-dependent"
                  ? "Whether a model from this provider can look things up in C7NTAX depends on the model you pick."
                  : "This provider cannot call application functions; it answers questions only."}
            </p>
          </FactPanel>

          <div className="space-y-2">
            <Label htmlFor="wiz-model-name">Connection name</Label>
            <input id="wiz-model-name" className="input-field max-w-sm" value={name} onChange={e => setName(e.target.value)} />
            <Hint>For your own benefit. Two keys for the same provider need two names.</Hint>
          </div>

          <a href={type.docs.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-cyber-400 hover:text-cyber-300">
            {type.docs.label} <ExternalLink size={11} />
          </a>
        </div>
      ) : null}

      {/* ── 2. Get a key ── */}
      {stepName === "Get a key" ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-400 leading-relaxed">
            Do these on {type.vendor}'s own site. The next step is where the values go.
          </p>
          {(type.setup?.steps ?? [{ title: "Create a key", detail: `Create an API key in the ${type.vendor} console.`, link: type.keyUrl || undefined }]).map((item, index) => (
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
          {type.keyUrl ? (
            <a href={type.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-cyber-400 hover:text-cyber-300">
              <KeyRound size={12} /> Where to create a key <ExternalLink size={11} />
            </a>
          ) : null}
        </div>
      ) : null}

      {/* ── 3. Connect ── */}
      {stepName === "Connect" ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-400 leading-relaxed">
            Paste what the last step produced. Anything a key cannot guess — an address, a deployment, an API
            version — is asked for here, and only where this provider needs it.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {type.credentials.map(field => {
              const isKey = field.key === "apiKey";
              const stored = existing?.hasApiKey;
              return (
                <div key={field.key}>
                  <Label htmlFor={`wiz-cred-${field.key}`}>
                    {field.label}{field.required ? <span className="text-cyber-400"> *</span> : null}
                  </Label>
                  {field.type === "select" ? (
                    <select
                      id={`wiz-cred-${field.key}`}
                      className="input-field"
                      value={credentials[field.key] ?? ""}
                      onChange={e => setCredentials(prev => ({ ...prev, [field.key]: e.target.value }))}
                    >
                      <option value="">{field.required ? "Choose…" : "Default"}</option>
                      {(field.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input
                      id={`wiz-cred-${field.key}`}
                      className="input-field"
                      type={field.type === "password" || isKey ? "password" : "text"}
                      autoComplete={isKey ? "new-password" : "off"}
                      placeholder={isKey && stored ? "a key is stored — type to replace it" : field.placeholder}
                      value={isKey ? apiKey : credentials[field.key] ?? ""}
                      onChange={e => (isKey ? setApiKey(e.target.value) : setCredentials(prev => ({ ...prev, [field.key]: e.target.value })))}
                    />
                  )}
                  <Hint>{field.hint}</Hint>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ── 4. Model & permissions ── */}
      {stepName === "Model & permissions" ? (
        <div className="space-y-4">
          <div>
            <Label htmlFor="wiz-model">Model</Label>
            <input
              id="wiz-model"
              className="input-field font-mono max-w-md"
              list="wiz-model-options"
              placeholder={type.defaultModel || "the model name, as the vendor spells it"}
              value={model}
              onChange={e => setModel(e.target.value)}
            />
            <datalist id="wiz-model-options">
              {type.shortlist.map(id => <option key={id} value={id} />)}
            </datalist>
            <Hint>
              {type.shortlist.length
                ? `Suggestions: ${type.shortlist.join(", ")}. The last step asks the vendor for its own list — that one is the authority.`
                : "This provider does not publish a model list, so the name is whatever you were given."}
            </Hint>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {numericFields.map(field => (
              <div key={field.key}>
                <Label htmlFor={`wiz-lim-${field.key}`}>{field.label}</Label>
                <input
                  id={`wiz-lim-${field.key}`}
                  className="input-field max-w-[10rem]"
                  type="number"
                  placeholder={String(field.default ?? "")}
                  value={limits[field.key] ?? ""}
                  onChange={e => setLimits(prev => ({ ...prev, [field.key]: e.target.value }))}
                />
                <Hint>{field.hint}</Hint>
              </div>
            ))}
          </div>

          <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-surface-border p-3">
            <input type="checkbox" className="mt-0.5" checked={appFunctions} onChange={e => setAppFunctions(e.target.checked)} />
            <span>
              <span className="text-sm text-gray-200">May perform app functions</span>
              <span className="block text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                Lets the model call this application's own functions when you ask it something. Reads run as you, so it
                can only see what you can see; anything that would change data is proposed for your approval instead of
                being done.
              </span>
            </span>
          </label>
        </div>
      ) : null}

      {/* ── 5. Test & finish ── */}
      {stepName === "Test & finish" ? (
        <div className="space-y-4">
          {!test ? (
            <p className="text-xs text-gray-400 leading-relaxed">
              This saves the connection and then asks {type.vendor} what this key can see. It is the only way to know
              the key works and which model to name, and it costs one call.
            </p>
          ) : test.ok ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-emerald-600/40 bg-emerald-500/5 p-3 flex items-start gap-2">
                <CheckCircle2 size={14} className="text-emerald-300 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm text-emerald-200">{type.vendor} answered in {test.latencyMs}ms</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{test.detail ?? "The key was accepted."}</p>
                </div>
              </div>

              {test.models.length ? (
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Models this key can see</p>
                  <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                    {test.models.slice(0, 60).map(entry => (
                      <button
                        key={entry.id}
                        onClick={() => { setModel(entry.id); toast.success(`Model set to ${entry.id}`); }}
                        title={`Use ${entry.id}`}
                        className={`text-[11px] font-mono px-2 py-1 rounded border transition-colors ${
                          entry.id === model ? "border-cyber-500 text-white bg-surface-lighter" : "border-surface-border text-gray-400 hover:text-white hover:border-cyber-500/40"
                        }`}
                      >
                        {entry.id}{entry.label ? <span className="text-gray-500"> · {entry.label}</span> : null}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-500">
                    Picking one here changes the connection; nothing is re-tested until you save the change.
                  </p>
                </div>
              ) : null}

              {active ? (
                <div className="rounded-lg border border-cyber-500/20 bg-cyber-500/5 p-3">
                  <p className="text-sm text-white inline-flex items-center gap-2"><Power size={13} className="text-cyber-400" /> This is the model the application uses</p>
                  <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{type.setup?.afterSaving}</p>
                </div>
              ) : (
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  Nothing is using it yet. The next button makes it the model the application and the assistant answer with.
                </p>
              )}

              <div className="rounded-lg border border-surface-border divide-y divide-surface-border">
                <Row label="Connection" value={name} />
                <Row label="Provider" value={type.label} />
                <Row label="Model" value={model} mono />
                <Row label="App functions" value={appFunctions ? "allowed" : "not allowed"} />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 flex items-start gap-2">
                <CircleAlert size={14} className="text-rose-300 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm text-rose-200">{type.vendor} refused it</p>
                  <p className="text-[11px] text-gray-300 mt-0.5 leading-relaxed">{test.detail ?? "No reason was given."}</p>
                </div>
              </div>
              <FactPanel title="What this usually means">
                <ul className="space-y-1.5">
                  <li className="text-[11px] text-gray-400 leading-relaxed inline-flex items-start gap-1.5"><Info size={11} className="mt-0.5 shrink-0 text-gray-500" /> A rejected key: it was copied incompletely, or it belongs to a different workspace or team.</li>
                  <li className="text-[11px] text-gray-400 leading-relaxed inline-flex items-start gap-1.5"><Info size={11} className="mt-0.5 shrink-0 text-gray-500" /> No credit on the account: several providers answer with an error that reads like a key problem.</li>
                  <li className="text-[11px] text-gray-400 leading-relaxed inline-flex items-start gap-1.5"><Info size={11} className="mt-0.5 shrink-0 text-gray-500" /> A wrong address, for the providers that ask for one — a resource endpoint or a base URL that has the chat path in it.</li>
                </ul>
              </FactPanel>
              <div className="flex items-center gap-2">
                <button className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => goTo("Connect")}>
                  <ArrowLeft size={13} /> Back to the key
                </button>
                <button className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => void saveAndTest()} disabled={busy === "test"}>
                  <PlugZap size={13} /> Test again
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </WizardShell>
  );
}
