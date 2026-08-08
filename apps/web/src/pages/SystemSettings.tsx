import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Save, RotateCw, Shield, Mail, Database, Radio, Wrench, AlertTriangle, CheckCircle, XCircle, Clock, Activity, type LucideIcon } from "lucide-react";

const TABS = [
  { id: "general", label: "General", icon: Wrench },
  { id: "email", label: "Email", icon: Mail },
  { id: "security", label: "Security", icon: Shield },
  { id: "integration", label: "Integration", icon: Radio },
  { id: "database", label: "Database", icon: Database },
  { id: "failover", label: "Failover & Recovery", icon: Activity },
];

interface SystemSettings {
  general: { companyName: string; timezone: string; dateFormat: string; defaultLanguage: string; sessionTimeout: number; homepageDashboard: string };
  email: { smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string; fromAddress: string; emailFooter: string; alertRecipient: string };
  security: { passwordMinLength: number; requireMfa: boolean; ipWhitelist: string; auditRetentionDays: number; sessionLockoutMinutes: number };
  integration: { apiKeys: string; webhookUrl: string; webhookSecret: string };
  database: { backupSchedule: string; retentionPolicy: string; connectionString: string };
}
interface FailoverStatus { running: boolean; cycles: number; maxRetries: number; lastCheck: string; lastResult: string; history: Array<{ time: string; event: string; result: string }>; }

export function SystemSettingsPage() {
  const [activeTab, setActiveTab] = useState("general");
  const [settings, setSettings] = useState<SystemSettings>({ general: { companyName: "C7NTAX", timezone: "America/Chicago", dateFormat: "MM/DD/YYYY", defaultLanguage: "en", sessionTimeout: 30, homepageDashboard: "/" }, email: { smtpHost: "", smtpPort: 587, smtpUser: "", smtpPass: "", fromAddress: "noreply@c7ntax.com", emailFooter: "C7NTAX – Professional Services Automation", alertRecipient: "admin@c7ntax.com" }, security: { passwordMinLength: 8, requireMfa: false, ipWhitelist: "", auditRetentionDays: 90, sessionLockoutMinutes: 15 }, integration: { apiKeys: "", webhookUrl: "", webhookSecret: "" }, database: { backupSchedule: "0 2 * * *", retentionPolicy: "30d", connectionString: "postgresql://localhost:5432/c7_overwatch" } });
  const [saving, setSaving] = useState(false);
  const [failover, setFailover] = useState<FailoverStatus>({ running: true, cycles: 0, maxRetries: 10, lastCheck: new Date().toISOString(), lastResult: "healthy", history: [] });

  useEffect(() => { loadSettings(); }, []);
  const loadSettings = () => {
    api.get("/system/config/app_settings").then(r => { if (r.data && r.data.value) setSettings(prev => ({ ...prev, ...(typeof r.data.value === "string" ? JSON.parse(r.data.value) : r.data.value) })); }).catch(() => {});
    api.get("/system/failover/status").then(r => setFailover(r.data)).catch(() => {});
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch("/system/config/app_settings", { value: JSON.stringify(settings) });
      toast.success("Settings saved");
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  };

  const handleReset = () => api.post("/system/failover/reset").then(() => { toast.success("Failover counter reset"); loadSettings(); }).catch(() => toast.error("Failed"));

  const f = (section: keyof SystemSettings) => settings[section] as Record<string, unknown>;
  const s = (section: keyof SystemSettings, key: string, value: unknown) => setSettings(prev => ({ ...prev, [section]: { ...prev[section], [key]: value } }));

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold text-white">System Settings</h2><p className="text-sm text-gray-400">Configure application-wide settings and monitoring</p></div><button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2 text-sm"><Save size={14} />{saving ? "Saving..." : "Save Changes"}</button></div>

      <div className="flex items-center gap-1 border-b border-surface-border pb-0 overflow-x-auto">
        {TABS.map(tab => { const Icon = tab.icon; return (<button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${activeTab === tab.id ? "bg-surface border border-b-0 border-surface-border text-cyber-400" : "text-gray-400 hover:text-white hover:bg-surface-lighter/50"}`}><Icon size={15} />{tab.label}</button>); })}
      </div>

      <div className="card space-y-4">
        {activeTab === "general" && <GeneralTab s={s} f={f} />}
        {activeTab === "email" && <EmailTab s={s} f={f} />}
        {activeTab === "security" && <SecurityTab s={s} f={f} />}
        {activeTab === "integration" && <IntegrationTab s={s} f={f} />}
        {activeTab === "database" && <DatabaseTab s={s} f={f} />}
        {activeTab === "failover" && <FailoverTab failover={failover} onReset={handleReset} onRefresh={loadSettings} />}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div><label className="text-xs text-gray-500 block mb-1 uppercase tracking-wider">{label}</label>{children}</div>; }

function GeneralTab({ s, f }: { s: (section: "general", key: string, value: unknown) => void; f: (section: "general") => Record<string, unknown> }) {
  const g = f("general");
  return (<div className="grid grid-cols-2 gap-4">
    <Field label="Company Name"><input className="input-field" value={String(g.companyName || "")} onChange={e => s("general", "companyName", e.target.value)} /></Field>
    <Field label="Time Zone"><select className="input-field" value={String(g.timezone || "")} onChange={e => s("general", "timezone", e.target.value)}><option value="America/Chicago">America/Chicago</option><option value="America/New_York">America/New York</option><option value="America/Los_Angeles">America/Los Angeles</option><option value="Europe/London">Europe/London</option></select></Field>
    <Field label="Date Format"><select className="input-field" value={String(g.dateFormat || "")} onChange={e => s("general", "dateFormat", e.target.value)}><option value="MM/DD/YYYY">MM/DD/YYYY</option><option value="DD/MM/YYYY">DD/MM/YYYY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option></select></Field>
    <Field label="Default Language"><input className="input-field" value={String(g.defaultLanguage || "")} onChange={e => s("general", "defaultLanguage", e.target.value)} /></Field>
    <Field label="Session Timeout (minutes)"><input className="input-field" type="number" value={String(g.sessionTimeout || "")} onChange={e => s("general", "sessionTimeout", Number(e.target.value))} /></Field>
    <Field label="Homepage Dashboard"><input className="input-field" value={String(g.homepageDashboard || "/")} onChange={e => s("general", "homepageDashboard", e.target.value)} /></Field>
  </div>);
}

function EmailTab({ s, f }: { s: (section: "email", key: string, value: unknown) => void; f: (section: "email") => Record<string, unknown> }) {
  const g = f("email");
  return (<div className="grid grid-cols-2 gap-4">
    <Field label="SMTP Host"><input className="input-field" value={String(g.smtpHost || "")} onChange={e => s("email", "smtpHost", e.target.value)} /></Field>
    <Field label="SMTP Port"><input className="input-field" type="number" value={String(g.smtpPort || "")} onChange={e => s("email", "smtpPort", Number(e.target.value))} /></Field>
    <Field label="SMTP Username"><input className="input-field" value={String(g.smtpUser || "")} onChange={e => s("email", "smtpUser", e.target.value)} /></Field>
    <Field label="SMTP Password"><input className="input-field" type="password" value={String(g.smtpPass || "")} onChange={e => s("email", "smtpPass", e.target.value)} /></Field>
    <Field label="From Address"><input className="input-field" value={String(g.fromAddress || "")} onChange={e => s("email", "fromAddress", e.target.value)} /></Field>
    <Field label="Alert Recipient"><input className="input-field" value={String(g.alertRecipient || "")} onChange={e => s("email", "alertRecipient", e.target.value)} /></Field>
    <div className="col-span-2"><Field label="Email Footer"><textarea className="input-field" rows={2} value={String(g.emailFooter || "")} onChange={e => s("email", "emailFooter", e.target.value)} /></Field></div>
  </div>);
}

function SecurityTab({ s, f }: { s: (section: "security", key: string, value: unknown) => void; f: (section: "security") => Record<string, unknown> }) {
  const g = f("security");
  return (<div className="grid grid-cols-2 gap-4">
    <Field label="Min Password Length"><input className="input-field" type="number" value={String(g.passwordMinLength || "")} onChange={e => s("security", "passwordMinLength", Number(e.target.value))} /></Field>
    <Field label="Session Lockout (min)"><input className="input-field" type="number" value={String(g.sessionLockoutMinutes || "")} onChange={e => s("security", "sessionLockoutMinutes", Number(e.target.value))} /></Field>
    <Field label="Audit Retention (days)"><input className="input-field" type="number" value={String(g.auditRetentionDays || "")} onChange={e => s("security", "auditRetentionDays", Number(e.target.value))} /></Field>
    <div><Field label="Require MFA"><label className="flex items-center gap-2 text-sm text-gray-400 mt-1"><input type="checkbox" checked={Boolean(g.requireMfa)} onChange={e => s("security", "requireMfa", e.target.checked)} />Enable mandatory MFA</label></Field></div>
    <div className="col-span-2"><Field label="IP Whitelist (comma-separated)"><input className="input-field" value={String(g.ipWhitelist || "")} onChange={e => s("security", "ipWhitelist", e.target.value)} placeholder="192.168.1.0/24,10.0.0.1" /></Field></div>
  </div>);
}

function IntegrationTab({ s, f }: { s: (section: "integration", key: string, value: unknown) => void; f: (section: "integration") => Record<string, unknown> }) {
  const g = f("integration");
  return (<div className="grid grid-cols-2 gap-4">
    <div className="col-span-2"><Field label="API Keys (JSON)"><textarea className="input-field" rows={4} value={String(g.apiKeys || "")} onChange={e => s("integration", "apiKeys", e.target.value)} placeholder='{"stripe":"sk_...","azure":"..."}' /></Field></div>
    <Field label="Webhook URL"><input className="input-field" value={String(g.webhookUrl || "")} onChange={e => s("integration", "webhookUrl", e.target.value)} /></Field>
    <Field label="Webhook Secret"><input className="input-field" type="password" value={String(g.webhookSecret || "")} onChange={e => s("integration", "webhookSecret", e.target.value)} /></Field>
  </div>);
}

function DatabaseTab({ s, f }: { s: (section: "database", key: string, value: unknown) => void; f: (section: "database") => Record<string, unknown> }) {
  const g = f("database");
  return (<div className="grid grid-cols-2 gap-4">
    <div className="col-span-2"><Field label="Connection String"><input className="input-field font-mono text-xs" value={String(g.connectionString || "")} onChange={e => s("database", "connectionString", e.target.value)} /></Field></div>
    <Field label="Backup Schedule (cron)"><input className="input-field font-mono" value={String(g.backupSchedule || "")} onChange={e => s("database", "backupSchedule", e.target.value)} /></Field>
    <Field label="Retention Policy"><select className="input-field" value={String(g.retentionPolicy || "")} onChange={e => s("database", "retentionPolicy", e.target.value)}><option value="7d">7 days</option><option value="30d">30 days</option><option value="90d">90 days</option><option value="1y">1 year</option></select></Field>
  </div>);
}

function FailoverTab({ failover, onReset, onRefresh }: { failover: FailoverStatus; onReset: () => void; onRefresh: () => void }) {
  return (<div className="space-y-4">
    <div className="grid grid-cols-3 gap-3">
      <StatusCard icon={failover.running ? CheckCircle : XCircle} label="Poller Status" value={failover.running ? "Running" : "Stopped"} color={failover.running ? "text-green-400" : "text-red-400"} bg={failover.running ? "bg-green-600/10" : "bg-red-600/10"} />
      <StatusCard icon={RotateCw} label="Recovery Cycles" value={`${failover.cycles} / ${failover.maxRetries}`} color="text-cyber-400" bg="bg-cyber-600/10" />
      <StatusCard icon={failover.lastResult === "healthy" ? CheckCircle : AlertTriangle} label="Last Check" value={failover.lastResult} color={failover.lastResult === "healthy" ? "text-green-400" : "text-amber-400"} bg={failover.lastResult === "healthy" ? "bg-green-600/10" : "bg-amber-600/10"} />
    </div>

    <div className="flex items-center gap-2">
      <button onClick={onReset} className="btn-primary text-sm flex items-center gap-2"><RotateCw size={14} />Reset Retry Counter</button>
      <button onClick={onRefresh} className="btn-secondary text-sm">Refresh Status</button>
    </div>

    <div>
      <h4 className="text-sm font-semibold text-gray-400 mb-2 flex items-center gap-2"><Clock size={14} />Recovery History</h4>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {failover.history.length === 0 ? <p className="text-xs text-gray-600">No recovery events</p> : failover.history.map((h, i) => (
          <div key={i} className="flex items-center gap-3 text-xs py-1.5 px-3 bg-surface-lighter rounded">
            <span className="text-gray-500">{new Date(h.time).toLocaleTimeString()}</span>
            <span className="text-white">{h.event}</span>
            <span className={h.result === "success" ? "text-green-400" : "text-red-400"}>{h.result}</span>
          </div>
        ))}
      </div>
    </div>
  </div>);
}

function StatusCard({ icon: Icon, label, value, color, bg }: { icon: LucideIcon; label: string; value: string; color: string; bg: string }) {
  return (<div className={`${bg} rounded-xl p-3 flex items-center gap-3`}><Icon size={18} className={color} /><div><p className="text-xs text-gray-500">{label}</p><p className={`text-sm font-bold ${color}`}>{value}</p></div></div>);
}
