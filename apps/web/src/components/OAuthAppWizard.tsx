/**
 * The "Deploy OAuth app" wizard in the Microsoft 365 email connector.
 *
 * Registering an Entra app, consenting to `Mail.ReadWrite` for it, minting a secret and scoping it
 * to one mailbox is four steps described in a plan document and a PowerShell script — and every one
 * of them fails silently if it is done in the wrong order or with `Mail.Read` instead of
 * `Mail.ReadWrite`. This walks through the same sequence in the dialog it configures, and puts the
 * four values it produces into the form rather than into a console buffer for somebody to retype.
 *
 * Two ways through, because the tenant decides which is possible:
 *
 *   · **Deploy it from here** — a device code the administrator approves in their own browser, then
 *     this API creates or reuses the registration and grants consent. Nothing about their tenant
 *     passes through this form, and this application never holds a credential for it.
 *   · **Run the script** — `O365/New-C7NTAXMailboxApp.ps1`, which already exists and is the
 *     reference implementation. The wizard shows the exact command and takes the JSON it writes, for
 *     a tenant where this instance cannot reach the Microsoft sign-in endpoint at all (or someone who
 *     would rather watch it happen).
 *
 * Either way the last screen is the same: the values, and one button that fills the connector.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Copy, ExternalLink, KeyRound, Loader2,
  RefreshCw, ShieldCheck, Terminal, Wand2, X,
} from "lucide-react";
import { apiErrorMessage } from "../lib/apiError";

export interface WizardValues {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailbox: string;
}

interface Facts {
  defaultDisplayName: string;
  permissions: { application: string[]; delegated: string[] };
  redirectUri: string;
  secretMonths: number;
  script: { file: string; command: string; delegatedCommand: string };
}

interface StartedSession {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  message: string;
  expiresIn: number;
  interval: number;
}

interface GraphCall { method: string; path: string; ok: boolean; detail: string }

interface DeploymentResult {
  tenantId: string;
  clientId: string;
  clientSecret: string | null;
  secretExpiry: string | null;
  displayName: string;
  mode: "AppOnly" | "Delegated" | "Both";
  reusedRegistration: boolean;
  mailbox: string;
  redirectUri: string | null;
  permissions: { application: string[]; delegated: string[] };
  scopingCommands: string | null;
  account: string | null;
  steps: GraphCall[];
  warnings: string[];
}

type Mode = "AppOnly" | "Delegated" | "Both";
type Path = "deploy" | "script";

const MODE_LABEL: Record<Mode, string> = {
  AppOnly: "App-only (client secret)",
  Delegated: "Connect to Microsoft (delegated)",
  Both: "Both on one registration",
};

const STEPS: Record<Path, string[]> = {
  deploy: ["How", "Tenant", "Sign in", "Create & consent", "Mailbox scope", "Finish"],
  script: ["How", "Tenant", "Run the script", "Finish"],
};

export function OAuthAppWizard({
  onClose,
  initialMode,
  defaultTenant = "",
  defaultMailbox = "",
  onComplete,
}: {
  onClose: () => void;
  initialMode: "clientSecret" | "delegated";
  defaultTenant?: string;
  defaultMailbox?: string;
  onComplete: (values: WizardValues, meta: { mode: Mode; displayName: string }) => void;
}) {
  const [step, setStep] = useState(0);
  const [path, setPath] = useState<Path>("deploy");
  const [facts, setFacts] = useState<Facts | null>(null);
  const [form, setForm] = useState({
    tenant: defaultTenant,
    mode: (initialMode === "delegated" ? "Delegated" : "AppOnly") as Mode,
    mailbox: defaultMailbox,
    displayName: "",
  });
  const [session, setSession] = useState<StartedSession | null>(null);
  const [authorised, setAuthorised] = useState<{ account: string | null; tenantId: string | null } | null>(null);
  const [deployed, setDeployed] = useState<DeploymentResult | null>(null);
  const [scriptJson, setScriptJson] = useState("");
  const [manual, setManual] = useState({ tenantId: "", clientId: "", clientSecret: "", mailbox: "" });
  const [imported, setImported] = useState<(WizardValues & { mode: Mode | null; warnings: string[]; source: string }) | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const copied = useRef<string | null>(null);

  const steps = STEPS[path];
  const stepName = steps[step] ?? steps[0]!;

  /**
   * Move to a step by name.
   *
   * The steps differ per path, so an index is only meaningful next to the list it belongs to —
   * `setStep(step + 1)` after starting a sign-in landed back on the screen it was already showing,
   * because "Tenant" and "Sign in" are adjacent and the intent was a jump, not a step.
   */
  const goTo = useCallback((target: string) => {
    const index = STEPS[path].indexOf(target);
    if (index >= 0) setStep(index);
  }, [path]);

  useEffect(() => {
    api.get("/oauth-app")
      .then((r) => {
        const data = r.data as Facts;
        setFacts(data);
        setForm((f) => ({ ...f, displayName: f.displayName || data.defaultDisplayName }));
      })
      .catch(() => setFacts(null));
  }, []);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      copied.current = what;
      toast.success(`${what} copied`);
    } catch {
      toast.error("Copy failed — select the text and copy it by hand");
    }
  };

  const needsMailbox = form.mode === "AppOnly" || form.mode === "Both";

  const scriptCommand = useMemo(() => {
    const tenant = form.tenant || "<tenant>";
    const mailbox = form.mailbox || "<mailbox>";
    if (form.mode === "Delegated") {
      return (facts?.script.delegatedCommand ?? "pwsh -File O365/New-C7NTAXMailboxApp.ps1 -TenantId <tenant> -Mode Delegated -RedirectUri <uri>")
        .replace("<tenant>", tenant)
        .replace("<uri>", facts?.redirectUri ?? "<redirect uri>");
    }
    const base = (facts?.script.command ?? "pwsh -File O365/New-C7NTAXMailboxApp.ps1 -TenantId <tenant> -DelegateMailbox <mailbox>")
      .replace("<tenant>", tenant)
      .replace("<mailbox>", mailbox);
    return form.mode === "Both"
      ? `${base} -Mode Both -RedirectUri ${facts?.redirectUri ?? "<redirect uri>"}`
      : base;
  }, [facts, form.mailbox, form.mode, form.tenant]);

  // ── Sign-in: poll until the administrator approves the code ────────────────
  useEffect(() => {
    if (path !== "deploy" || stepName !== "Sign in" || !session) return;
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const { data } = await api.post(`/oauth-app/${session.sessionId}/poll`);
        if (cancelled) return;
        if (data.status === "authorized") {
          setAuthorised({ account: data.account ?? null, tenantId: data.tenantId ?? null });
          goTo("Create & consent");
          return;
        }
        if (data.status === "pending") {
          timer = window.setTimeout(tick, Math.max(2, Number(data.interval) || 5) * 1000);
          return;
        }
        setError(data.error || "The sign-in did not complete. Start again.");
      } catch (e) {
        if (!cancelled) setError(apiErrorMessage(e, "Could not check the sign-in"));
      }
    };

    timer = window.setTimeout(tick, Math.max(2, session.interval || 5) * 1000);
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [path, session, stepName, goTo]);

  const start = useCallback(async () => {
    setError(null);
    if (!form.tenant.trim()) { setError("Enter the tenant id or its primary domain — Entra admin centre → Overview → Directory (tenant) ID."); return; }
    if (needsMailbox && !form.mailbox.trim()) { setError("Name the mailbox to watch. Without it the app is unscoped and can read every mailbox in the tenant until the Exchange commands are run."); return; }
    setBusy("start");
    try {
      const { data } = await api.post("/oauth-app/start", {
        tenant: form.tenant.trim(),
        mode: form.mode,
        mailbox: form.mailbox.trim(),
        displayName: form.displayName.trim(),
      });
      setSession(data as StartedSession);
      goTo("Sign in");
    } catch (e) {
      setError(apiErrorMessage(e, "Could not start the deployment"));
    } finally {
      setBusy(null);
    }
  }, [form, goTo, needsMailbox]);

  const deploy = useCallback(async () => {
    if (!session) return;
    setBusy("deploy");
    setError(null);
    try {
      const { data } = await api.post(`/oauth-app/${session.sessionId}/deploy`);
      setDeployed(data as DeploymentResult);
      goTo("Mailbox scope");
      toast.success((data as DeploymentResult).reusedRegistration ? "Registration reused and consented" : "Registration created and consented");
    } catch (e) {
      setError(apiErrorMessage(e, "Could not deploy the app registration"));
    } finally {
      setBusy(null);
    }
  }, [goTo, session]);

  const importValues = useCallback(async () => {
    setBusy("import");
    setError(null);
    try {
      const { data } = await api.post("/oauth-app/import", {
        scriptJson: scriptJson.trim() || undefined,
        tenantId: manual.tenantId.trim() || undefined,
        clientId: manual.clientId.trim() || undefined,
        clientSecret: manual.clientSecret.trim() || undefined,
        // The script's output has no mailbox in it — the mailbox was chosen two steps back, so it is
        // sent along rather than lost, which is what made the wizard warn about a mailbox it had.
        mailbox: manual.mailbox.trim() || form.mailbox.trim() || undefined,
        mode: form.mode,
      });
      setImported({
        tenantId: data.tenantId,
        clientId: data.clientId,
        clientSecret: data.clientSecret || "",
        mailbox: data.mailbox || form.mailbox,
        mode: data.mode ?? form.mode,
        warnings: data.warnings ?? [],
        source: data.source,
      });
      goTo("Finish");
      toast.success(data.source === "script" ? "Read the script's output" : "Values accepted");
    } catch (e) {
      setError(apiErrorMessage(e, "Could not read those values"));
    } finally {
      setBusy(null);
    }
  }, [form.mode, form.mailbox, goTo, manual, scriptJson]);

  // ── What the last screen will hand to the connector ───────────────────────
  const values: WizardValues | null = deployed
    ? { tenantId: deployed.tenantId, clientId: deployed.clientId, clientSecret: deployed.clientSecret ?? "", mailbox: deployed.mailbox || form.mailbox }
    : imported
      ? { tenantId: imported.tenantId, clientId: imported.clientId, clientSecret: imported.clientSecret, mailbox: imported.mailbox }
      : null;
  const warnings = deployed?.warnings ?? imported?.warnings ?? [];
  const finishMode: Mode = deployed?.mode ?? imported?.mode ?? form.mode;

  const finish = () => {
    if (!values) return;
    onComplete(values, { mode: finishMode, displayName: deployed?.displayName ?? form.displayName });
    toast.success("Connector fields filled — test the connection, then switch it on");
    onClose();
  };

  const primary = (() => {
    if (stepName === "How") return { label: "Continue", action: () => goTo("Tenant"), disabled: false };
    if (stepName === "Tenant") {
      return path === "deploy"
        ? { label: "Start sign-in", action: () => void start(), disabled: busy === "start" }
        : { label: "Show me the command", action: () => goTo("Run the script"), disabled: false };
    }
    if (stepName === "Sign in") return null;
    if (stepName === "Create & consent") return { label: "Create the app and grant consent", action: () => void deploy(), disabled: busy === "deploy" };
    if (stepName === "Mailbox scope") return { label: "Continue", action: () => goTo("Finish"), disabled: false };
    if (stepName === "Run the script") return { label: "Read these values", action: () => void importValues(), disabled: busy === "import" };
    return { label: "Fill the connector", action: finish, disabled: false };
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto" onClick={onClose}>
      <div className="card w-full max-w-3xl my-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Wand2 size={18} className="text-cyber-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-white">Deploy the Microsoft 365 OAuth app</h2>
              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                Create or reuse the Entra registration, grant it <span className="text-gray-300 font-mono">Mail.ReadWrite</span> with admin
                consent, and fill this connector with what comes back.
              </p>
            </div>
          </div>
          <button className="text-gray-500 hover:text-gray-300 shrink-0" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* ── Which step, and how far along ── */}
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          {steps.map((label, index) => (
            <li key={label} className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${
                index === step ? "border-cyber-500 text-white" : index < step ? "border-emerald-600 text-emerald-300" : "border-surface-border text-gray-500"
              }`}>
                {index < step ? <Check size={10} /> : <span className="font-mono">{index + 1}</span>}
                {label}
              </span>
              {index < steps.length - 1 ? <span className="text-gray-700">→</span> : null}
            </li>
          ))}
        </ol>

        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/5 p-3">
            <AlertTriangle size={14} className="text-rose-300 mt-0.5 shrink-0" />
            <p className="text-xs text-rose-200 leading-relaxed">{error}</p>
          </div>
        ) : null}

        {/* ── 1. How ── */}
        {stepName === "How" ? (
          <div className="space-y-3">
            <Choice
              active={path === "deploy"}
              icon={<ShieldCheck size={16} />}
              title="Deploy it from here"
              onClick={() => setPath("deploy")}
            >
              Sign in as a tenant administrator in your own browser with a code, and this instance creates
              the registration, grants the permissions and mints the secret. Nothing about the tenant is
              typed anywhere else, and no credential for it is stored here.
            </Choice>
            <Choice
              active={path === "script"}
              icon={<Terminal size={16} />}
              title="Run the script, or use an app you already have"
              onClick={() => setPath("script")}
            >
              The <span className="font-mono text-gray-300">O365/New-C7NTAXMailboxApp.ps1</span> script does the same
              thing from a terminal and writes <span className="font-mono text-gray-300">out/c7ntax-m365-app.json</span>.
              Paste that file (or the four values) and the wizard fills the connector. Use this when the
              registration already exists, or when this instance cannot reach Microsoft's sign-in endpoint.
            </Choice>
          </div>
        ) : null}

        {/* ── 2. Tenant and what to build ── */}
        {stepName === "Tenant" ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="wiz-tenant">Directory (tenant) ID or domain</Label>
                <input
                  id="wiz-tenant"
                  className="input-field"
                  placeholder="contoso.onmicrosoft.com"
                  value={form.tenant}
                  onChange={(e) => setForm({ ...form, tenant: e.target.value })}
                />
                <Hint>Entra admin centre → Overview → Directory (tenant) ID. A primary domain works too.</Hint>
              </div>
              <div>
                <Label htmlFor="wiz-name">Registration name</Label>
                <input
                  id="wiz-name"
                  className="input-field"
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                />
                <Hint>
                  The key it is matched on: an existing registration with this name is <strong>reused</strong> rather
                  than duplicated (it is still consented again, and the secret is left alone).
                </Hint>
              </div>
            </div>

            <div>
              <Label>Which identity</Label>
              <div className="flex flex-wrap gap-2">
                {(["AppOnly", "Delegated", "Both"] as Mode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setForm({ ...form, mode })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                      form.mode === mode ? "bg-cyber-500 text-white border-cyber-500" : "bg-surface-lighter border-surface-border text-gray-400 hover:text-white"
                    }`}
                  >
                    {MODE_LABEL[mode]}
                  </button>
                ))}
              </div>
              <Hint>
                App-only is what a shared <span className="font-mono text-gray-300">servicedesk@</span> mailbox needs; delegated reads the
                mailbox of whoever signs in and needs no mailbox scoping. Both can be put on one registration.
              </Hint>
            </div>

            {needsMailbox ? (
              <div>
                <Label htmlFor="wiz-mailbox">Mailbox to watch</Label>
                <input
                  id="wiz-mailbox"
                  className="input-field"
                  placeholder="servicedesk@contoso.com"
                  value={form.mailbox}
                  onChange={(e) => setForm({ ...form, mailbox: e.target.value })}
                />
                <Hint>
                  Used twice: to print the Exchange Online scoping commands, and to fill the connector's mailbox field.
                </Hint>
              </div>
            ) : null}

            <Facts facts={facts} mode={form.mode} />
          </div>
        ) : null}

        {/* ── 3a. Sign in (device code) ── */}
        {stepName === "Sign in" && session ? (
          <div className="space-y-4">
            <p className="text-xs text-gray-400 leading-relaxed">
              Open the Microsoft page, enter this code, and sign in as an account holding{" "}
              <strong className="text-gray-200">Application Administrator</strong> or{" "}
              <strong className="text-gray-200">Global Administrator</strong> — a regular user cannot register an app or consent to
              application permissions, and the failure only appears at the next step.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="flex items-center gap-2 rounded-lg border border-cyber-500/40 bg-cyber-500/5 px-4 py-3 flex-1 min-w-0">
                <span className="font-mono text-2xl tracking-[0.3em] text-white">{session.userCode}</span>
              </div>
              <button className="btn-secondary text-xs shrink-0 inline-flex items-center gap-1.5" onClick={() => void copy(session.userCode, "Code")}>
                <Copy size={13} /> Copy code
              </button>
              <button
                className="btn-primary text-xs shrink-0 inline-flex items-center gap-1.5"
                onClick={() => window.open(session.verificationUriComplete || session.verificationUri, "_blank", "noopener")}
              >
                <ExternalLink size={13} /> Open Microsoft
              </button>
            </div>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              {session.verificationUri} — the code is good for about {Math.round(session.expiresIn / 60)} minutes.
              This page checks every few seconds and moves on by itself.
            </p>
            <p className="text-xs text-gray-400 inline-flex items-center gap-2">
              <Loader2 size={13} className="animate-spin text-cyber-400" /> Waiting for the sign-in to be approved…
            </p>
            <button className="btn-secondary text-xs" onClick={() => { setSession(null); goTo("Tenant"); setError(null); }}>
              <ArrowLeft size={13} className="inline mr-1" /> Start over
            </button>
          </div>
        ) : null}

        {/* ── 4a. Create and consent ── */}
        {stepName === "Create & consent" ? (
          <div className="space-y-4">
            <p className="text-xs text-gray-400 leading-relaxed">
              {authorised?.account ? <>Signed in as <strong className="text-gray-200">{authorised.account}</strong>. </> : null}
              This creates or reuses <span className="font-mono text-gray-300">{form.displayName}</span>, asks for{" "}
              <span className="font-mono text-gray-300">{["Mail.ReadWrite", ...(form.mode === "AppOnly" ? [] : ["User.Read"])].join(", ")}</span>,
              grants admin consent, and {form.mode === "Delegated" ? "sets the redirect URI (no secret — the delegated flow uses PKCE)" : "creates a client secret"}.
            </p>
            {deployed ? (
              <div className="rounded-lg border border-emerald-600/40 bg-emerald-500/5 p-3 space-y-2">
                <p className="text-xs text-emerald-200 inline-flex items-center gap-1.5">
                  <CheckCircle2 size={13} />
                  {deployed.reusedRegistration ? "Reused the existing registration" : "Created the registration"} — {deployed.displayName}
                </p>
                <ul className="space-y-1">
                  {deployed.steps.filter((s) => s.ok).map((s, i) => (
                    <li key={`${s.method}-${s.path}-${i}`} className="text-[11px] text-gray-400 font-mono">
                      {s.method} {s.path}{s.detail ? ` — ${s.detail}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ── 5a. Mailbox scoping ── */}
        {stepName === "Mailbox scope" ? (
          <div className="space-y-4">
            <p className="text-xs text-gray-400 leading-relaxed">
              Exchange Online scoping is not Graph, so these are the last three commands and they are yours to run.
              Without them an app-only registration can read <strong className="text-gray-200">every</strong> mailbox in the tenant.
            </p>
            <pre className="rounded-lg border border-surface-border bg-surface-light p-3 text-[11px] leading-relaxed text-gray-300 overflow-x-auto whitespace-pre">
              {deployed?.scopingCommands ?? "(no commands — the delegated flow reads only the mailbox that signed in)"}
            </pre>
            {deployed?.scopingCommands ? (
              <button className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => void copy(deployed.scopingCommands!, "Commands")}>
                <Copy size={13} /> Copy the commands
              </button>
            ) : null}
          </div>
        ) : null}

        {/* ── 3b. Run the script ── */}
        {stepName === "Run the script" ? (
          <div className="space-y-4">
            <div>
              <Label>Run this</Label>
              <div className="flex items-start gap-2">
                <pre className="flex-1 min-w-0 rounded-lg border border-surface-border bg-surface-light p-3 text-[11px] leading-relaxed text-gray-300 overflow-x-auto whitespace-pre">
                  {scriptCommand}
                </pre>
                <button className="btn-secondary text-xs shrink-0 inline-flex items-center gap-1.5" onClick={() => void copy(scriptCommand, "Command")}>
                  <Copy size={13} /> Copy
                </button>
              </div>
              <Hint>
                It signs in the same way, creates or reuses the registration, grants consent, writes{" "}
                <span className="font-mono text-gray-400">O365/out/c7ntax-m365-app.json</span> and prints the commands that scope it to the mailbox.
              </Hint>
            </div>
            <div>
              <Label htmlFor="wiz-json">Paste that file</Label>
              <textarea
                id="wiz-json"
                className="input-field font-mono text-[11px] h-32"
                placeholder='{ "tenantId": "…", "clientId": "…", "secret": "…", "mode": "AppOnly" }'
                value={scriptJson}
                onChange={(e) => setScriptJson(e.target.value)}
              />
              <Hint>Everything the wizard needs is in it. Prefer to type them? Fill the fields below instead.</Hint>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ["tenantId", "Directory (tenant) ID"],
                ["clientId", "Application (client) ID"],
                ["clientSecret", "Client secret"],
                ["mailbox", "Mailbox to watch"],
              ] as const).map(([key, label]) => (
                <div key={key}>
                  <Label htmlFor={`wiz-${key}`}>{label}</Label>
                  <input
                    id={`wiz-${key}`}
                    type={key === "clientSecret" ? "password" : "text"}
                    className="input-field"
                    value={manual[key]}
                    onChange={(e) => setManual({ ...manual, [key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* ── 6. Finish ── */}
        {stepName === "Finish" && values ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-surface-border divide-y divide-surface-border">
              <Row label="Directory (tenant) ID" value={values.tenantId} onCopy={() => void copy(values.tenantId, "Tenant ID")} />
              <Row label="Application (client) ID" value={values.clientId} onCopy={() => void copy(values.clientId, "Client ID")} />
              <Row
                label="Client secret"
                value={values.clientSecret ? (showSecret ? values.clientSecret : "••••••••••••••••••••") : "(none — delegated/PKCE)"}
                mono={Boolean(values.clientSecret)}
                onCopy={values.clientSecret ? () => void copy(values.clientSecret, "Client secret") : undefined}
                extra={deployed?.secretExpiry && values.clientSecret
                  ? <span className="text-[11px] text-amber-300">expires {deployed.secretExpiry.slice(0, 10)}</span>
                  : null}
              >
                {values.clientSecret ? (
                  <button className="text-[11px] text-gray-400 hover:text-white" onClick={() => setShowSecret((s) => !s)}>
                    {showSecret ? "Hide" : "Show"}
                  </button>
                ) : null}
              </Row>
              <Row label="Mailbox to watch" value={values.mailbox || "(fill in by hand)"} onCopy={values.mailbox ? () => void copy(values.mailbox, "Mailbox") : undefined} />
              <Row label="Flow" value={MODE_LABEL[finishMode]} />
            </div>

            {warnings.length ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
                {warnings.map((warning) => (
                  <p key={warning} className="text-[11px] text-amber-200 leading-relaxed inline-flex items-start gap-1.5">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {warning}
                  </p>
                ))}
              </div>
            ) : null}

            <p className="text-xs text-gray-400 leading-relaxed">
              <strong className="text-gray-200">Fill the connector</strong> puts these into the form behind this dialog, so the only thing
              left is <strong className="text-gray-200">Test connection</strong> and switching it on. The secret is stored by this application
              only when the connector is saved, and it is never shown again after this screen.
            </p>
          </div>
        ) : null}

        {/* ── Footer ── */}
        <div className="flex items-center justify-between gap-3 border-t border-surface-border pt-3">
          <div className="flex items-center gap-2">
            {step > 0 && stepName !== "Sign in" ? (
              <button className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => setStep((s) => Math.max(0, s - 1))}>
                <ArrowLeft size={13} /> Back
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary text-xs" onClick={onClose}>Cancel</button>
            {primary ? (
              <button
                className="btn-primary text-xs inline-flex items-center gap-1.5"
                onClick={() => primary.action()}
                disabled={primary.disabled || (stepName === "Finish" ? !values : false)}
              >
                {primary.disabled ? <Loader2 size={13} className="animate-spin" /> : stepName === "Finish" ? <Check size={13} /> : <ArrowRight size={13} />}
                {primary.label}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Choice({ active, icon, title, onClick, children }: {
  active: boolean; icon: React.ReactNode; title: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-3 transition-colors ${
        active ? "border-cyber-500 bg-cyber-500/5" : "border-surface-border hover:border-gray-600"
      }`}
    >
      <p className={`text-sm font-medium inline-flex items-center gap-2 ${active ? "text-white" : "text-gray-300"}`}>
        <span className={active ? "text-cyber-400" : "text-gray-500"}>{icon}</span>
        {title}
        {active ? <CheckCircle2 size={13} className="text-cyber-400" /> : null}
      </p>
      <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">{children}</p>
    </button>
  );
}

function Row({ label, value, onCopy, mono, extra, children }: {
  label: string; value: string; onCopy?: () => void; mono?: boolean; extra?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-500 w-44 shrink-0">{label}</p>
      <p className={`text-xs text-gray-200 flex-1 min-w-0 break-all ${mono ? "font-mono" : ""}`}>{value}</p>
      {extra}
      {onCopy ? (
        <button className="text-gray-500 hover:text-gray-300 shrink-0" onClick={onCopy} aria-label={`Copy ${label}`}>
          <Copy size={13} />
        </button>
      ) : null}
      {children}
    </div>
  );
}

/** The permissions and redirect URI, so nobody has to take the wizard's word for it. */
function Facts({ facts, mode }: { facts: Facts | null; mode: Mode }) {
  if (!facts) return null;
  const wanted = [
    ...(mode === "AppOnly" || mode === "Both" ? facts.permissions.application.map((p) => `${p} (application)`) : []),
    ...(mode === "Delegated" || mode === "Both" ? facts.permissions.delegated.map((p) => `${p} (delegated)`) : []),
  ];
  return (
    <div className="rounded-lg border border-surface-border bg-surface-light p-3 space-y-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">What will be requested</p>
      <p className="text-xs text-gray-300 font-mono">{wanted.join(", ")}</p>
      {(mode === "Delegated" || mode === "Both") ? (
        <p className="text-[11px] text-gray-500 leading-relaxed">
          Redirect URI registered on the app: <span className="font-mono text-gray-400">{facts.redirectUri}</span>
        </p>
      ) : null}
      <p className="text-[11px] text-gray-500 leading-relaxed inline-flex items-start gap-1.5">
        <KeyRound size={12} className="mt-0.5 shrink-0" />
        {mode === "Delegated"
          ? "No client secret is created: the delegated flow is a public client using PKCE."
          : `A client secret is created and lasts ${facts.secretMonths} months — its expiry is shown at the end so it can be diarised.`}
      </p>
    </div>
  );
}

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-gray-300 mb-1.5">{children}</label>;
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">{children}</p>;
}

export default OAuthAppWizard;
