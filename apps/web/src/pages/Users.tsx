import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Users as UsersIcon, Shield } from "lucide-react";
import { SystemRole } from "@c7-overwatch/shared";

interface UserRow { id: string; email: string; firstName: string | null; lastName: string | null; role: string; status: string; mfaEnabled: boolean; company?: { name: string } | null; }

export function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", firstName: "", lastName: "", role: "technician" });

  const fetch = async () => {
    try { const r = await api.get("/users"); setUsers(r.data.data); }
    catch { toast.error("Failed to load users"); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/users", form);
      toast.success("User created");
      setShowCreate(false);
      setForm({ email: "", password: "", firstName: "", lastName: "", role: "technician" });
      fetch();
    } catch { toast.error("Failed to create user"); }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading users...</div>;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold text-white">Users</h2><p className="text-sm text-gray-400">{users.length} users</p></div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} />Add User</button>
      </div>

      {showCreate && (
        <div className="card">
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input className="input-field" placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
              <input className="input-field" placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            </div>
            <input className="input-field" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <input className="input-field" placeholder="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            <select className="input-field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.values(SystemRole).map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
            </select>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary text-sm">Create</button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-gray-500 text-xs uppercase tracking-wider">
                <th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Company</th><th className="p-3">MFA</th><th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-surface-border/50 hover:bg-surface-lighter/30 transition-colors">
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-cyber-600/30 text-cyber-400 flex items-center justify-center text-xs font-bold">
                        {u.firstName?.[0]}{u.lastName?.[0]}
                      </div>
                      <div>
                        <p className="font-medium text-white">{u.firstName} {u.lastName}</p>
                        <p className="text-xs text-gray-500">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-3">
                    <span className="badge bg-cyber-600/15 text-cyber-400 capitalize">{u.role.replace(/_/g, " ")}</span>
                  </td>
                  <td className="p-3 text-gray-400">{u.company?.name || "—"}</td>
                  <td className="p-3">{u.mfaEnabled ? <Shield size={15} className="text-green-400" /> : <span className="text-gray-600">—</span>}</td>
                  <td className="p-3"><span className={`badge ${u.status === "active" ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}>{u.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
