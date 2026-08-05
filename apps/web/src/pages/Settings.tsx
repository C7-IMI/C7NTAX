import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Cpu } from "lucide-react";

export function SettingsPage() {
  const { user } = useAuth();

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
            <input className="input-field" defaultValue={user?.role} readOnly />
          </div>
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
