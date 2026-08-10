import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Cpu, LayoutDashboard, Ticket, Columns3, Building2, DollarSign, Cloud, Users, Target, FolderKanban, Monitor, BookOpen } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";

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
  { path: "/cloudconnect", label: "CloudConnect", icon: Cloud },
  { path: "/users", label: "Users", icon: Users },
];

export function SettingsPage() {
  const { user, landingPage, setLandingPage } = useAuth();
  const [selectedPath, setSelectedPath] = useState(landingPage.path);

  useEffect(() => { setSelectedPath(landingPage.path); }, [landingPage.path]);

  const handleChange = async (path: string) => {
    const option = LANDING_OPTIONS.find(o => o.path === path);
    if (!option) return;
    setSelectedPath(path);
    try {
      await api.patch("/system/config/default_landing_page", { value: { path: option.path, label: option.label } });
      setLandingPage({ path: option.path, label: option.label });
      toast.success(`Default landing page set to ${option.label}`);
    } catch { toast.error("Failed to save setting"); }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div><h2 className="text-lg font-semibold text-white">Settings</h2><p className="text-sm text-gray-400 mt-0.5">Account and system configuration</p></div>

      <div className="card">
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

      <div className="card">
        <h3 className="font-semibold text-white mb-4">Default Landing Page</h3>
        <p className="text-xs text-gray-500 mb-3">Choose which section opens after login</p>
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

      <div className="card">
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

      <div className="card">
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
