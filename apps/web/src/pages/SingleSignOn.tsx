import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { CheckCircle2, Copy, ExternalLink, Globe, KeyRound, RefreshCw, ShieldCheck, Users, XCircle } from "lucide-react";
import api from "../api";
import { ListViews, PageHeader, Section, StatCard } from "../components/ui";
import { useRedesign } from "../hooks/useNavigationStyle";
import { Chip } from "./Configuration";

interface OidcSettingsView {
  source: "stored" | "environment" | "none";
  issuer: string;
  clientId: string;
  scopes: string;
  redirectUri: string;
  domains: string[];
  jitProvisioning: boolean;
  autoActivate: boolean;
  defaultRoleId: string | null;
  toggleOn: boolean;
  complete: boolean;
  enabled: boolean;
  problem: string | null;
  hasSecret: boolean;
}

interface RoleChoice {
  id: string;
  name: string;
  systemRole: string;
  privileged: boolean;
}

interface Discovered {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  userinfoEndpoint: string | null;
  scopesSupported: string[];
}

interface CheckResult {
  enabled: boolean;
  problem: string | null;
  checks: Array<{ check: string; ok: boolean; detail: string }>;
}

const SOURCE_LABEL: Record<OidcSettingsView["source"], string> = {
  stored: "configured here",
  environment: "from the deployment's environment",
  none: "not configured yet",
};

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-gray-300 mb-1">{children}</label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-500 mt-1 leading-relaxed">{children}</p>;
}

export function SingleSignOnPage() {
  const redesign = useRedesign();
  const [settings, setSettings] = useState<OidcSettingsView | null>(null);
  const [checkView, setCheckView] = useState("all");
  const [roles, setRoles] = useState<RoleChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // The editable draft. The secret is write-only, so it starts empty and only travels when typed.
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [scopes, setScopes] = useState("openid email profile");
  const [redirectUri, setRedirectUri] = useState("");
  const [domainText, setDomainText] = useState("");
  const [jit, setJit] = useState(true);
  const [autoActivate, setAutoActivate] = useState(false);
  const [defaultRoleId, setDefaultRoleId] = useState("");
  const [enabled, setEnabled] = useState(false);

  const [discovered, setDiscovered] = useState<Discovered | null>(null);
  const [checking, setChecking] = useState(false);
  const [test, setTest] = useState<CheckResult | null>(null);

  const apply = useCallback((view: OidcSettingsView, choices: RoleChoice[]) => {
    setSettings(view);
    setRoles(choices);
    setIssuer(view.issuer);
    setClientId(view.clientId);
    setScopes(view.scopes || "openid email profile");
    setRedirectUri(view.redirectUri);
    setDomainText(view.domains.join(", "));
    setJit(view.jitProvisioning);
    setAutoActivate(view.autoActivate);
    setDefaultRoleId(view.defaultRoleId ?? "");
    setEnabled(view.toggleOn);
    setClientSecret("");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/sso/oidc");
      apply(data.settings, data.roles || []);
      if (data.redirectUri && !data.settings?.redirectUri) setRedirectUri(data.redirectUri);
    } catch {
      toast.error("Could not read the identity-provider configuration");
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await api.put("/sso/oidc", {
        issuer: issuer.trim(),
        clientId: clientId.trim(),
        ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
        scopes: scopes.trim(),
        redirectUri: redirectUri.trim(),
        domains: domainText.split(",").map((d) => d.trim()).filter(Boolean),
        jitProvisioning: jit,
        autoActivate,
        defaultRoleId: defaultRoleId || null,
        enabled,
      });
      apply(data.settings, data.roles || []);
      toast.success("Identity provider saved");
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { error?: string | { message?: string } } } })?.response?.data?.error;
      toast.error(typeof message === "string" ? message : message?.message || "That configuration was refused");
    } finally {
      setBusy(false);
    }
  };

  const discover = async () => {
    if (!issuer.trim()) { toast.error("Enter an issuer URL first"); return; }
    setChecking(true);
    try {
      const { data } = await api.post<Discovered>("/sso/oidc/discover", { issuer: issuer.trim() });
      setDiscovered(data);
      if (data.scopesSupported?.includes("openid")) {
        const wanted = ["openid", "email", "profile"].filter((s) => data.scopesSupported.includes(s));
        if (wanted.length) setScopes(wanted.join(" "));
      }
      toast.success("The provider answered");
    } catch (e: unknown) {
      setDiscovered(null);
      const message = (e as { response?: { data?: { error?: string | { message?: string } } } })?.response?.data?.error;
      toast.error(typeof message === "string" ? message : message?.message || "The issuer did not answer with a discovery document");
    } finally {
      setChecking(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    try {
      const { data } = await api.post<CheckResult>("/sso/oidc/test");
      setTest(data);
      toast[data.checks.every((c) => c.ok) ? "success" : "error"]("See the check results below");
    } catch {
      toast.error("The check could not run");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Copy failed — select the text and copy it by hand");
    }
  };

  const incomplete = !issuer.trim() || !clientId.trim();

  const domainCount = domainText.split(",").map((d) => d.trim()).filter(Boolean).length;
  const roleChoices = roles.filter((role) => !role.privileged).length;
  const checkPassed = test ? test.checks.filter((c) => c.ok).length : 0;
  const shownChecks = test
    ? test.checks.filter((c) => checkView === "all" || (checkView === "passed" ? c.ok : !c.ok))
    : [];

  /** The switch and its two buttons; the same controls in both interfaces. */
  const saveControls = (
    <>
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" className="accent-cyber-500" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span className="text-sm text-white">
          Offer single sign-on on the sign-in page
          {enabled && incomplete ? <span className="block text-xs text-amber-300 mt-0.5">An issuer and a client id are needed first.</span> : null}
        </span>
      </label>
      <div className="flex items-center gap-2 ml-auto">
        <button className="btn-secondary text-sm inline-flex items-center gap-1.5" onClick={() => void runTest()} disabled={busy}>
          <ShieldCheck size={14} /> Check
        </button>
        <button className="btn-primary text-sm inline-flex items-center gap-1.5" onClick={() => void save()} disabled={busy}>
          <KeyRound size={14} /> {busy ? "Saving…" : "Save the provider"}
        </button>
      </div>
    </>
  );

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <PageHeader
        title="Single Sign-On"
        subtitle="Point sign-in at an identity provider, and decide who it may sign in."
      />

      {/* ── The figures the page already holds ── */}
      {redesign ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Single sign-on"
            value={settings?.enabled ? "On" : "Off"}
            icon={<ShieldCheck size={14} />}
            tone={settings?.enabled ? "green" : "neutral"}
          />
          <StatCard
            label="Email domains allowed"
            value={domainCount === 0 ? "Any" : domainCount}
            icon={<Globe size={14} />}
            tone="cyber"
          />
          <StatCard label="Roles offered" value={roleChoices} icon={<Users size={14} />} tone="neutral" />
          <StatCard
            label="Client secret"
            value={settings?.hasSecret ? "Saved" : "Not set"}
            icon={<KeyRound size={14} />}
            tone={settings?.hasSecret ? "green" : "amber"}
          />
        </div>
      ) : null}

      {/* ── Status ── */}
      <div className="card">
        {redesign ? (
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-white">Where sign-in stands</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Whether the provider is offered, and where these settings come from.
            </p>
          </div>
        ) : null}
        {loading ? (
          <p className="text-sm text-gray-500">Reading the configuration…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {redesign ? (
                <>
                  {settings?.enabled ? <span className="chip chip--good">Sign-in offered</span> : <span className="chip">Sign-in not offered</span>}
                  <span className={`chip ${settings?.source === "stored" ? "chip--on" : ""}`}>
                    {settings ? SOURCE_LABEL[settings.source] : ""}
                  </span>
                  {settings?.hasSecret ? <span className="chip chip--on">client secret saved</span> : null}
                </>
              ) : (
                <>
                  {settings?.enabled ? <Chip tone="good">Sign-in offered</Chip> : <Chip tone="muted">Sign-in not offered</Chip>}
                  <Chip tone={settings?.source === "stored" ? "info" : "muted"}>
                    {settings ? SOURCE_LABEL[settings.source] : ""}
                  </Chip>
                  {settings?.hasSecret ? <Chip tone="muted">client secret saved</Chip> : null}
                </>
              )}
            </div>
            <p className="text-sm text-gray-400 leading-relaxed mt-3">
              Password sign-in keeps working either way — this is additive, not a replacement. The
              switch is the same one as <span className="text-gray-300">Sessions &amp; Security</span>:
              what lives here is the provider it points at.
            </p>
            {settings?.problem ? (
              <p className="text-xs text-amber-300 mt-3 flex items-start gap-2">
                <XCircle size={13} className="mt-0.5 shrink-0" />
                {settings.problem}
              </p>
            ) : null}
            {settings?.source === "environment" ? (
              <p className="text-xs text-gray-500 mt-3 leading-relaxed">
                The deployment supplies the issuer through its environment. Saving here stores a
                provider of your own, which then takes precedence.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <Link to="/admin/configuration/sessions" className="text-xs text-cyber-400 hover:text-cyber-300 inline-flex items-center gap-1">
                Open Sessions &amp; Security <ExternalLink size={12} />
              </Link>
              <button className="text-xs text-cyber-400 hover:text-cyber-300 inline-flex items-center gap-1" onClick={() => void runTest()} disabled={busy}>
                <ShieldCheck size={12} /> Check the saved provider
              </button>
            </div>
            {redesign && test ? (
              <div className="flex flex-wrap items-center gap-2 mt-4">
                <ListViews
                  views={[
                    { id: "all", label: "All", count: test.checks.length },
                    { id: "passed", label: "Passed", count: checkPassed },
                    { id: "failed", label: "Failing", count: test.checks.length - checkPassed },
                  ]}
                  value={checkView}
                  onChange={setCheckView}
                  label="Check views"
                />
                <span className="text-xs text-gray-500">
                  {shownChecks.length} of {test.checks.length} checks shown
                </span>
              </div>
            ) : null}
            {test ? (
              <ul className="mt-3 space-y-1">
                {(redesign ? shownChecks : test.checks).map((check) => (
                  <li key={check.check} className="text-xs flex items-start gap-2">
                    {check.ok
                      ? <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-400" />
                      : <XCircle size={12} className="mt-0.5 shrink-0 text-amber-400" />}
                    <span className={check.ok ? "text-gray-400" : "text-amber-300"}>
                      <span className="text-gray-300">{check.check}:</span> {check.detail}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {redesign && test && shownChecks.length === 0 ? (
              <p className="text-xs text-gray-500 mt-2">Nothing in this view.</p>
            ) : null}
          </>
        )}
      </div>

      {/* ── The provider ── */}
      <Section title="The provider">
        {redesign ? (
          <p className="text-xs text-gray-500">
            The identity provider this instance trusts, and the client it signs in as.
          </p>
        ) : null}
        <div className="card space-y-5">
          <div>
            <Label htmlFor="oidc-issuer">Issuer URL</Label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="oidc-issuer"
                className="input-field flex-1 min-w-[16rem]"
                placeholder="https://login.example.com/realms/clients"
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
              />
              <button className="btn-secondary text-sm inline-flex items-center gap-1.5" onClick={() => void discover()} disabled={checking}>
                <RefreshCw size={13} className={checking ? "animate-spin" : ""} /> Check the provider
              </button>
            </div>
            <Hint>
              The base URL that publishes the provider&rsquo;s discovery document. Its
              <code className="text-gray-400"> /.well-known/openid-configuration</code> is read to find
              every other endpoint, so nothing else here has to be spelled out by hand.
            </Hint>
            {discovered ? (
              <div className="mt-3 rounded-lg border border-surface-border bg-surface-light p-3">
                <p className="text-xs text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 size={12} /> Discovery answered for {discovered.issuer}
                </p>
                <dl className="mt-2 space-y-1 text-[11px] font-mono text-gray-400 break-all">
                  <div><dt className="inline text-gray-500">authorization </dt><dd className="inline">{discovered.authorizationEndpoint}</dd></div>
                  <div><dt className="inline text-gray-500">token </dt><dd className="inline">{discovered.tokenEndpoint}</dd></div>
                  <div><dt className="inline text-gray-500">jwks </dt><dd className="inline">{discovered.jwksUri}</dd></div>
                </dl>
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="oidc-client">Client ID</Label>
              <input id="oidc-client" className="input-field" value={clientId} onChange={(e) => setClientId(e.target.value)} />
              <Hint>The application&rsquo;s identifier at the provider, from the client you registered there.</Hint>
            </div>
            <div>
              <Label htmlFor="oidc-secret">Client secret</Label>
              <input
                id="oidc-secret"
                className="input-field"
                type="password"
                placeholder={settings?.hasSecret ? "•••••• saved — type to replace" : "Paste the secret"}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
              <Hint>
                Never shown again once saved. A public client that uses PKCE can be configured without
                one; a confidential client cannot.
              </Hint>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="oidc-scopes">Scopes</Label>
              <input id="oidc-scopes" className="input-field" value={scopes} onChange={(e) => setScopes(e.target.value)} />
              <Hint>
                Must include <code className="text-gray-400">openid</code>, which is what makes the
                response an identity token. <code className="text-gray-400">email</code> is what gives
                us the address to match a person to.
              </Hint>
            </div>
            <div>
              <Label htmlFor="oidc-redirect">Redirect URI</Label>
              <div className="flex items-center gap-2">
                <input id="oidc-redirect" className="input-field flex-1" value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} />
                <button className="btn-secondary text-xs shrink-0 inline-flex items-center gap-1.5" onClick={() => void copy(redirectUri, "Redirect URI")}>
                  <Copy size={13} /> Copy
                </button>
              </div>
              <Hint>
                Register this exact address at the provider as an allowed redirect. It is where the
                provider sends the browser back, and a mismatch is the most common reason a handshake
                is refused.
              </Hint>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Who may sign in ── */}
      <Section title="Who may sign in">
        {redesign ? (
          <p className="text-xs text-gray-500">
            Which addresses the provider may vouch for, and what a newly created account gets.
          </p>
        ) : null}
        <div className="card space-y-5">
          <div>
            <Label htmlFor="oidc-domains">Email domains</Label>
            <input
              id="oidc-domains"
              className="input-field"
              placeholder="clienta.com, clientb.com"
              value={domainText}
              onChange={(e) => setDomainText(e.target.value)}
            />
            <Hint>
              Comma-separated. Only addresses in these domains may sign in this way, whatever the
              provider vouches for. Leave it empty to accept every domain the provider knows about —
              which, for a provider shared with a client, is usually not what you want.
            </Hint>
          </div>

          <div className="space-y-3 pt-1 border-t border-surface-border">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-0.5 accent-cyber-500" checked={jit} onChange={(e) => {
                setJit(e.target.checked);
                if (!e.target.checked) setAutoActivate(false);
              }} />
              <span>
                <span className="text-sm text-white">Create an account on first sign-in</span>
                <span className="block text-xs text-gray-500 mt-0.5 leading-relaxed">
                  Off means only people who already have an account can sign in this way. On means an
                  identity the provider vouches for gets an account, and the role below.
                </span>
              </span>
            </label>

            <label className={`flex items-start gap-3 ${jit ? "cursor-pointer" : "opacity-50"}`}>
              <input
                type="checkbox"
                className="mt-0.5 accent-cyber-500"
                checked={autoActivate}
                disabled={!jit}
                onChange={(e) => setAutoActivate(e.target.checked)}
              />
              <span>
                <span className="text-sm text-white">Use it straight away</span>
                <span className="block text-xs text-gray-500 mt-0.5 leading-relaxed">
                  Off means the account waits for an administrator to enable it, which is the safer
                  default: nothing signs in until a person has approved it.
                </span>
              </span>
            </label>

            <div>
              <Label htmlFor="oidc-role">Role for a new account</Label>
              <select
                id="oidc-role"
                className="input-field"
                value={defaultRoleId}
                disabled={!jit}
                onChange={(e) => setDefaultRoleId(e.target.value)}
              >
                <option value="">The least privilege available (read-only)</option>
                {roles.filter((role) => !role.privileged).map((role) => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
              <Hint>
                What a provisioned account may do before anybody has looked at it. Assigning a role
                here does not take effect until the account is enabled, unless it is used
                automatically above. Administrator roles are not offered: a new account is never
                created as one — grant that afterwards, once you have looked at the account.
              </Hint>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Save ── */}
      {redesign ? (
        <div className="card">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-white">Offer it to staff</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              The switch that puts a single sign-on button on the sign-in page, and the one save for
              everything above.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">{saveControls}</div>
        </div>
      ) : (
        <div className="card flex flex-wrap items-center gap-4">{saveControls}</div>
      )}

      <p className="text-xs text-gray-500 leading-relaxed">
        Saving writes the provider to this application, and the switch above to the same stored
        setting the Sessions &amp; Security card shows, so the two can never disagree. Password sign-in
        stays available as a fallback either way, which is also the way back in if the provider
        becomes unreachable.
      </p>
    </div>
  );
}
