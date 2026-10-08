import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { PasskeyManager } from "../components/PasskeyManager";
import { Cpu, LayoutDashboard, Ticket, Columns3, Building2, DollarSign, Cloud, Users, Target, FolderKanban, Monitor, BookOpen } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { Permission, LANDING_PAGES, resolveLandingPagePath } from "@C7NTAX/shared";

const LANDING_OPTIONS = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/tickets", label: "Tickets", icon: Ticket },
  { path: "/boards", label: "Service Boards", icon: Columns3 },
  { path: "/opportunities", label: "Sales Pipeline", icon: Target },
  { path: "/projects", label: "Projects", icon: FolderKanban },
  { path: "/assets", label: "Asset Inventory", icon: Monitor },
  { path: "/kb", label: "Knowledge Base", icon: BookOpen },
  { path: "/clients", label: "Clients", icon: Building2 },
  { path: "/billing", label: "Billing", icon: DollarSign },
  { path: "/c7nc", label: "C7NC", icon: Cloud },
  { path: "/users", label: "Users", icon: Users },
];

export function SettingsPage() {
  const { user, landingPage, setLandingPage, permissions } = useAuth();
  /*
   * A landing page is stored as a path, and one of the stored paths moved when CloudConnect became
   * C7NC. The shared resolver applies the alias so somebody who chose that page sees it still
   * chosen, rather than being silently reset to the Dashboard.
   */
  const landingFor = (path: string) => resolveLandingPagePath(path) ?? "/";
  const [selectedPath, setSelectedPath] = useState(() => landingFor(landingPage.path));
  const [sessionTimeout, setSessionTimeout] = useState(30);
  const [savingTimeout, setSavingTimeout] = useState(false);
  const canConfigureSystem = (permissions ?? []).includes(Permission.SystemConfig);

  useEffect(() => { setSelectedPath(landingFor(landingPage.path)); }, [landingPage.path]);

  // Deep links such as /settings#security come from the My Account menu; the
  // browser can't scroll to the anchor before React has rendered it.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Load the idle timeout so an administrator can see and change it here as well.
  useEffect(() => {
    if (!canConfigureSystem) return;
    api.get("/system/config/session_timeout").then(r => {
      setSessionTimeout(r.data?.value || 30);
    }).catch(() => {});
  }, [canConfigureSystem]);

  const saveSessionTimeout = async () => {
    setSavingTimeout(true);
    try {
      // Through the configuration API, so the same range check applies here as on the
      // configuration screen: 5–480 minutes.
      await api.patch("/configuration/sessions/sessionTimeout", { value: sessionTimeout });
      toast.success(`Idle timeout set to ${sessionTimeout} minutes for everyone`);
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { error?: { message?: string } | string } } })?.response?.data?.error;
      toast.error(typeof message === "string" ? message : (message?.message || "Failed to save"));
    }
    finally { setSavingTimeout(false); }
  };

  const handleChange = async (path: string) => {
    const option = LANDING_OPTIONS.find(o => o.path === path);
    if (!option) return;
    const previous = selectedPath;
    setSelectedPath(path);
    try {
      // Personal: stored against the signed-in account, not the instance.
      await api.patch("/auth/me/landing-page", { path: option.path, label: option.label });
      setLandingPage({ path: option.path, label: option.label });
      toast.success(`You will now land on ${option.label}`);
    } catch {
      setSelectedPath(previous);
      toast.error("Failed to save your landing page");
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div><h2 className="text-lg font-semibold text-white">Settings</h2><p className="text-sm text-gray-400 mt-0.5">Account and system configuration</p></div>

      <div className="card scroll-mt-6" id="profile">
        <h3 className="font-semibold text-white mb-4">Profile</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Name</label>
            <input className="input-field" defaultValue={`${user?.firstName || ""} ${user?.lastName || ""}`} readOnly />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Email</label>
            <input className="input-field" defaultValue={user?.email} readOnly />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Role</label>
            <input className="input-field" defaultValue={typeof user?.role === 'object' ? (user?.role as any)?.systemRole?.replace(/_/g, " ") : user?.role} readOnly />
          </div>
        </div>
      </div>

      <div className="card scroll-mt-6" id="landing">
        <h3 className="font-semibold text-white mb-4">My Default Landing Page</h3>
        <p className="text-xs text-gray-500 mb-3">
          Which section opens for you after signing in. This is your own preference — it does not
          affect anyone else. The instance-wide default is set under Administration → Configuration → Workspace.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {LANDING_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.path}
                onClick={() => handleChange(opt.path)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors border ${
                  selectedPath === opt.path
                    ? "bg-cyber-600/15 border-cyber-500/40 text-cyber-400"
                    : "border-surface-border text-gray-400 hover:text-white hover:bg-surface-lighter"
                }`}
              >
                <Icon size={15} />
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card scroll-mt-6" id="security">
        <h3 className="font-semibold text-white mb-4">Security</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white">Multi-Factor Authentication</p>
              <p className="text-xs text-gray-500">Add an extra layer of security</p>
            </div>
            <span className={`badge ${user?.mfaEnabled ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}>
              {user?.mfaEnabled ? "Enabled" : "Disabled"}
            </span>
          </div>
        </div>
      </div>

      <PasskeyManager />

      <div className="card scroll-mt-6" id="session">
        <h3 className="font-semibold text-white mb-4">Session Timeout</h3>
        <p className="text-xs text-gray-500 mb-3">
          Inactivity timeout in minutes before users are signed out. This applies to everyone in the
          organisation, so it is an administrative setting rather than a personal one — it lives in
          Administration → Configuration → Sessions &amp; Security.
        </p>
        {canConfigureSystem ? (
          <div className="flex items-center gap-3">
            <input
              type="number"
              className="input-field w-24"
              min={5} max={480}
              value={sessionTimeout}
              onChange={e => setSessionTimeout(Number(e.target.value))}
            />
            <span className="text-sm text-gray-400">minutes</span>
            <button
              onClick={saveSessionTimeout}
              disabled={savingTimeout}
              className="btn-primary text-xs py-1.5 px-3"
            >
              {savingTimeout ? "Saving..." : "Save for everyone"}
            </button>
            <Link to="/admin/configuration/sessions" className="text-xs text-cyber-300 hover:text-cyber-200">
              All session settings
            </Link>
          </div>
        ) : (
          <p className="text-sm text-gray-400">
            Currently <span className="text-white font-medium">{sessionTimeout} minutes</span> of inactivity.
            Administrators and Super Admins are never timed out.
          </p>
        )}
        <p className="text-[10px] text-gray-600 mt-2">Default: 30 minutes. Range: 5–480 minutes (8 hours).</p>
      </div>

      <Link to="/settings/ai" className="card block hover:border-cyber-500/30 transition-colors group">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyber-600/10"><Cpu size={18} className="text-cyber-400" /></div>
            <div>
              <p className="text-sm font-medium text-white">AI Inference Engine</p>
              <p className="text-xs text-gray-500">Configure AI provider for ticket analysis and pattern detection</p>
            </div>
          </div>
          <span className="text-cyber-400 text-sm">Configure →</span>
        </div>
      </Link>

      <div className="card scroll-mt-6" id="system">
        <h3 className="font-semibold text-white mb-4">System</h3>
        <div className="space-y-3 text-sm text-gray-400">
          <div className="flex justify-between"><span>Version</span><span className="text-white">1.0.0</span></div>
          <div className="flex justify-between"><span>API Endpoint</span><span className="text-white font-mono text-xs">/api</span></div>
          <div className="flex justify-between"><span>Database</span><span className="text-white">PostgreSQL 16</span></div>
        </div>
      </div>
    </div>
  );
}
