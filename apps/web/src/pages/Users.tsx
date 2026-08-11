import { useState, useEffect, useCallback } from "react";
import api from "../api";
import toast from "react-hot-toast";
import {
  Plus, Search, Shield, X, Save, Edit3, Check, AlertTriangle,
  Mail, Phone, Building2, Clock, KeyRound, UserCheck, UserX, ShieldAlert,
  ChevronLeft, ChevronDown, Copy, Key,
} from "lucide-react";
import { SystemRole, Permission, PERMISSION_CATEGORIES, ROLE_PERMISSIONS } from "@C7NTAX/shared";
import { SortableHeader, sortData, nextSort, type SortState } from "../components/SortableHeader";
import { generatePassword } from "../lib/generatePassword";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-600/20 text-green-400",
  inactive: "bg-gray-600/20 text-gray-400",
};

interface UserFull {
  id: string; email: string; username?: string | null;
  firstName: string | null; lastName: string | null;
  phone?: string | null; mobile?: string | null; title?: string | null;
  role: { id: string; name: string; systemRole: string; permissions: string[] };
  permissions: string[];
  company?: { id: string; name: string } | null;
  companyId?: string | null;
  isActive: boolean; isLocked: boolean;
  mfaEnabled: boolean;
  lastLoginAt?: string | null; createdAt: string;
}

interface RoleOption { id: string; name: string; systemRole: string; permissions: string[]; }

export function UsersPage() {
  const [users, setUsers] = useState<UserFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [roles, setRoles] = useState<RoleOption[]>([]);

  // Detail panel
  const [selected, setSelected] = useState<UserFull | null>(null);
  const [tab, setTab] = useState<"profile" | "permissions" | "security">("profile");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [permSet, setPermSet] = useState<Set<string>>(new Set());
  const [roleTemplate, setRoleTemplate] = useState<string | null>(null); // the role whose defaults we compare against
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showCopyUser, setShowCopyUser] = useState(false);
  const [userDropdown, setUserDropdown] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);
  const [createForm, setCreateForm] = useState({ email: "", password: "", firstName: "", lastName: "", role: "technician" });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (search) params.set("search", search);
      if (roleFilter) params.set("role", roleFilter);
      const r = await api.get(`/users?${params}`);
      setUsers(r.data.data || []);
    } catch { toast.error("Failed to load users"); }
    finally { setLoading(false); }
  }, [search, roleFilter]);

  const fetchRoles = useCallback(async () => {
    try {
      const r = await api.get("/roles?limit=100");
      setRoles(r.data.data || []);
    } catch { /* silently fail */ }
  }, []);

  useEffect(() => { fetchUsers(); fetchRoles(); }, [fetchUsers, fetchRoles]);

  const refreshUser = async (id: string) => {
    try {
      const r = await api.get(`/users/${id}`);
      setSelected(r.data);
      setForm(r.data);
      const rolePerms = r.data.role?.permissions || [];
      const userOverrides = r.data.permissions || [];
      setPermSet(new Set([...rolePerms, ...userOverrides]));
      setRoleTemplate(r.data.role?.systemRole || null);
    } catch { /* ignore */ }
  };

  const openDetail = (user: UserFull) => {
    setSelected(user);
    setForm(user);
    const rolePerms = user.role?.permissions || [];
    const userOverrides = user.permissions || [];
    setPermSet(new Set([...rolePerms, ...userOverrides]));
    setRoleTemplate(user.role?.systemRole || null);
    setEditing(false);
    setTab("profile");
  };

  const closeDetail = () => { setSelected(null); setEditing(false); };

  // ── Permission toggle ──
  const togglePerm = (p: Permission) => {
    setPermSet(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  };

  const toggleCategory = (permissions: Permission[]) => {
    setPermSet(prev => {
      const next = new Set(prev);
      const allOn = permissions.every(p => next.has(p));
      for (const p of permissions) {
        if (allOn) next.delete(p); else next.add(p);
      }
      return next;
    });
  };

  const allPermsSelected = (permissions: Permission[]) =>
    permissions.every(p => permSet.has(p));

  const somePermsSelected = (permissions: Permission[]) =>
    permissions.some(p => permSet.has(p)) && !allPermsSelected(permissions);

  // ── Save user (profile or permissions) ──
  const handleSaveUser = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const payload: Record<string, any> = { ...form };
      if (tab === "permissions") {
        payload.permissions = [...permSet];
      }
      await api.patch(`/users/${selected.id}`, payload);
      toast.success("User updated");
      setSaving(false);
      setEditing(false);
      await fetchUsers();
      await refreshUser(selected.id);
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || "Failed to save");
      setSaving(false);
    }
  };

  // ── Create user ──
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/users", createForm);
      toast.success("User created");
      setShowCreate(false);
      setCreateForm({ email: "", password: "", firstName: "", lastName: "", role: "technician" });
      await fetchUsers();
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || "Failed to create user");
    }
  };

  // ── Delete / deactivate user ──
  const handleDelete = async () => {
    if (!selected) return;
    try {
      await api.delete(`/users/${selected.id}`);
      toast.success("User deactivated");
      setShowDeleteConfirm(false);
      setSelected(null);
      await fetchUsers();
    } catch { toast.error("Failed to deactivate user"); }
  };

  const handleToggleActive = async () => {
    if (!selected) return;
    try {
      const newStatus = !selected.isActive;
      await api.patch(`/users/${selected.id}`, { isActive: newStatus });
      toast.success(`User ${newStatus ? "activated" : "deactivated"}`);
      await fetchUsers();
      await refreshUser(selected.id);
    } catch { toast.error("Failed to update status"); }
  };

  // ── Render ──
  if (loading) return <div className="text-center py-12 text-gray-500">Loading users...</div>;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Manage Users</h2>
          <p className="text-sm text-gray-400">{users.length} users</p>
        </div>
        <div className="relative">
          <button
            onClick={() => setUserDropdown(!userDropdown)}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Plus size={16} /> Add User <ChevronDown size={14} className={`transition-transform ${userDropdown ? "rotate-180" : ""}`} />
          </button>
          {userDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserDropdown(false)} />
              <div className="absolute right-0 z-50 mt-1.5 w-52 bg-surface border border-surface-border rounded-lg shadow-lg overflow-hidden">
                <button
                  onClick={() => { setUserDropdown(false); setCreateForm({ email: "", password: "", firstName: "", lastName: "", role: "technician" }); setShowCreate(true); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-surface-lighter flex items-center gap-2 transition-colors"
                >
                  <Plus size={14} className="text-cyber-400" /> Create New
                </button>
                <button
                  onClick={() => { setUserDropdown(false); setShowCopyUser(true); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-surface-lighter flex items-center gap-2 transition-colors border-t border-surface-border/50"
                >
                  <Copy size={14} className="text-cyber-400" /> Create from Existing
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input className="input-field pl-9" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input-field text-sm py-1.5 w-auto" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="">All Roles</option>
          {roles.map(r => <option key={r.id} value={r.systemRole}>{r.name}</option>)}
        </select>
      </div>

      {/* ── User Table ── */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="group">
              <tr className="border-b border-surface-border text-left text-gray-500 text-xs uppercase tracking-wider">
                <SortableHeader field="firstName" label="User" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3" />
                <SortableHeader field="role.name" label="Role" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3 hidden md:table-cell" />
                <SortableHeader field="company.name" label="Company" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3 hidden lg:table-cell" />
                <SortableHeader field="mfaEnabled" label="MFA" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3 w-16" />
                <SortableHeader field="isActive" label="Status" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3 w-24" />
              </tr>
            </thead>
            <tbody>
              {sortData(users, sort?.field || "firstName", sort?.direction || "asc").map(u => (
                <tr key={u.id}
                  className={`border-b border-surface-border/50 hover:bg-surface-lighter/30 transition-colors cursor-pointer ${selected?.id === u.id ? "bg-cyber-600/10 border-l-2 border-l-cyber-400" : ""}`}
                  onClick={() => openDetail(u)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-cyber-600/30 text-cyber-400 flex items-center justify-center text-xs font-bold shrink-0">
                        {u.firstName?.[0]}{u.lastName?.[0]}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-white text-sm">{u.firstName} {u.lastName}</p>
                        <p className="text-xs text-gray-500 truncate">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="badge bg-cyber-600/15 text-cyber-400 capitalize text-xs">{u.role?.systemRole.replace(/_/g, " ") || "—"}</span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-gray-400 text-xs">{u.company?.name || "—"}</td>
                  <td className="px-4 py-3 text-center">
                    {u.mfaEnabled ? <Shield size={15} className="text-green-400 mx-auto" /> : <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge text-xs ${STATUS_COLORS[u.isActive ? "active" : "inactive"]}`}>
                      {u.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Copy from Existing User Modal */}
      {showCopyUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCopyUser(false)}>
          <div className="card w-full max-w-md mx-4 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Create from Existing User</h3>
              <button onClick={() => setShowCopyUser(false)} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </div>
            <p className="text-xs text-gray-500">Select a user to copy role and settings from. You will still need to enter personal information.</p>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {users.map(u => (
                <button
                  key={u.id}
                  onClick={() => {
                    setCreateForm({
                      email: "",
                      password: "",
                      firstName: "",
                      lastName: "",
                      role: u.role?.systemRole || "technician",
                    });
                    setShowCopyUser(false);
                    setShowCreate(true);
                  }}
                  className="w-full text-left px-4 py-3 rounded-lg hover:bg-surface-lighter/50 transition-colors flex items-center gap-3"
                >
                  <div className="w-8 h-8 rounded-full bg-cyber-600/30 text-cyber-400 flex items-center justify-center text-xs font-bold shrink-0">
                    {u.firstName?.[0]}{u.lastName?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{u.firstName} {u.lastName}</p>
                    <p className="text-xs text-gray-500">{u.email} · {u.role?.systemRole?.replace(/_/g, " ") || "—"}</p>
                  </div>
                  <span className="text-xs text-cyber-400">Copy role</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2 pt-2 border-t border-surface-border">
              <button onClick={() => setShowCopyUser(false)} className="btn-secondary text-sm flex-1">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create User Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <form className="card w-full max-w-md mx-4 space-y-3" onClick={e => e.stopPropagation()} onSubmit={handleCreate}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">New User</h3>
              <button type="button" onClick={() => setShowCreate(false)} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input className="input-field" placeholder="First name" value={createForm.firstName} onChange={e => setCreateForm({ ...createForm, firstName: e.target.value })} />
              <input className="input-field" placeholder="Last name" value={createForm.lastName} onChange={e => setCreateForm({ ...createForm, lastName: e.target.value })} />
            </div>
            <input className="input-field" placeholder="Email" type="email" value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} required />
            <div className="flex gap-1">
              <input className="input-field flex-1" placeholder="Password" type="password" value={createForm.password} onChange={e => setCreateForm({ ...createForm, password: e.target.value })} required minLength={8} />
              <button type="button" onClick={() => setCreateForm({ ...createForm, password: generatePassword() })}
                className="btn-secondary text-xs py-1 px-2 flex items-center gap-1 shrink-0" title="Generate password">
                <Key size={12} /> Gen
              </button>
            </div>
            <select className="input-field" value={createForm.role} onChange={e => setCreateForm({ ...createForm, role: e.target.value })}>
              {Object.values(SystemRole).map(r => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
            </select>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button>
              <button type="submit" className="btn-primary text-sm">Create User</button>
            </div>
          </form>
        </div>
      )}

      {/* ── User Detail Slide-over ── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={closeDetail} />
          <div className="relative w-full max-w-2xl bg-surface border-l border-surface-border h-full overflow-y-auto animate-slide-left">
            {/* Header */}
            <div className="sticky top-0 bg-surface border-b border-surface-border px-6 py-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <button onClick={closeDetail} className="text-gray-500 hover:text-white p-1">
                  <ChevronLeft size={20} />
                </button>
                <div className="w-10 h-10 rounded-full bg-cyber-600/30 text-cyber-400 flex items-center justify-center text-lg font-bold">
                  {selected.firstName?.[0]}{selected.lastName?.[0]}
                </div>
                <div>
                  <h3 className="font-semibold text-white">{selected.firstName} {selected.lastName}</h3>
                  <p className="text-xs text-gray-400">{selected.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {editing ? (
                  <>
                    <button onClick={() => { setEditing(false); setForm(selected); setPermSet(new Set(selected.permissions)); }}
                      className="btn-secondary text-sm"><X size={14} /> Cancel</button>
                    <button onClick={handleSaveUser} disabled={saving} className="btn-primary text-sm">
                      <Save size={14} /> {saving ? "Saving..." : "Save"}
                    </button>
                  </>
                ) : (
                  <button onClick={() => setEditing(true)} className="btn-primary text-sm"><Edit3 size={14} /> Edit</button>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-surface-border px-6">
              {(["profile", "permissions", "security"] as const).map(t => (
                <button key={t} onClick={() => { setTab(t); setEditing(false); }}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
                    tab === t ? "border-cyber-400 text-cyber-400" : "border-transparent text-gray-500 hover:text-white"
                  }`}>{t}</button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="p-6 space-y-6">
              {/* ── Profile Tab ── */}
              {tab === "profile" && (
                <div className="space-y-4">
                  <Section title="Personal Information">
                    <Grid cols={2}>
                      <Field label="First Name" value={selected.firstName} editing={editing} form={form} setForm={setForm} field="firstName" />
                      <Field label="Last Name" value={selected.lastName} editing={editing} form={form} setForm={setForm} field="lastName" />
                      <Field label="Email" value={selected.email} editing={editing} form={form} setForm={setForm} field="email" type="email" />
                      <Field label="Username" value={selected.username} editing={editing} form={form} setForm={setForm} field="username" />
                      <Field label="Phone" value={selected.phone} editing={editing} form={form} setForm={setForm} field="phone" />
                      <Field label="Mobile" value={selected.mobile} editing={editing} form={form} setForm={setForm} field="mobile" />
                      <Field label="Title" value={selected.title} editing={editing} form={form} setForm={setForm} field="title" />
                    </Grid>
                  </Section>
                  <Section title="Role & Company">
                    <Grid cols={2}>
                      <div>
                        <Label>Role</Label>
                        {editing ? (
                          <select className="input-field text-sm py-1.5" value={String(form.roleId || selected.role?.id || "")}
                            onChange={e => setForm({ ...form, roleId: e.target.value })}>
                            {roles.map(r => <option key={r.id} value={r.id}>{r.name} ({r.systemRole.replace(/_/g, " ")})</option>)}
                          </select>
                        ) : (
                          <p className="text-sm text-white">{selected.role?.name || selected.role?.systemRole?.replace(/_/g, " ") || "—"}</p>
                        )}
                      </div>
                      <div>
                        <Label>Company</Label>
                        <p className="text-sm text-white">{selected.company?.name || "—"}</p>
                      </div>
                    </Grid>
                  </Section>
                  {editing && (
                    <Section title="Change Password">
                      <div className="max-w-xs">
                        <Label>New Password</Label>
                        <div className="flex gap-1">
                          <input className="input-field flex-1" type="password" placeholder="Leave blank to keep current"
                            value={String(form.password || "")} onChange={e => setForm({ ...form, password: e.target.value })} />
                          <button type="button" onClick={() => setForm({ ...form, password: generatePassword() })}
                            className="btn-secondary text-xs py-1 px-2 flex items-center gap-1 shrink-0" title="Generate password">
                            <Key size={12} /> Gen
                          </button>
                        </div>
                      </div>
                    </Section>
                  )}
                </div>
              )}

              {/* ── Permissions Tab ── */}
              {tab === "permissions" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-white font-medium">Permission Configuration</p>
                      <p className="text-xs text-gray-500">
                        Role: {selected.role?.name || selected.role?.systemRole?.replace(/_/g, " ")} — 
                        {editing ? " Toggle individual overrides below" : " Click Edit to modify"}
                      </p>
                    </div>
                    {editing && (
                      <div className="flex gap-2">
                        <button onClick={() => setPermSet(new Set(selected.role?.permissions || []))}
                          className="btn-secondary text-xs py-1 px-2">Reset to Role</button>
                        <button onClick={() => setPermSet(new Set(Object.values(Permission)))}
                          className="btn-secondary text-xs py-1 px-2">Select All</button>
                      </div>
                    )}
                  </div>

                  {/* Role template dropdown */}
                  {editing && (
                    <div className="card py-2.5 px-4 flex items-center gap-3">
                      <label className="text-xs text-gray-400 font-medium shrink-0">Apply role defaults:</label>
                      <select
                        className="input-field text-sm py-1.5 flex-1"
                        value={roleTemplate || ""}
                        onChange={e => {
                          const val = e.target.value;
                          setRoleTemplate(val || null);
                          if (val) {
                            const defaults = ROLE_PERMISSIONS[val as SystemRole] || [];
                            setPermSet(new Set(defaults));
                          }
                        }}
                      >
                        <option value="">— Select a role template —</option>
                        {Object.values(SystemRole).map(sr => (
                          <option key={sr} value={sr}>
                            {sr.replace(/_/g, " ")} ({ (ROLE_PERMISSIONS[sr] || []).length } perms)
                          </option>
                        ))}
                      </select>
                      {roleTemplate && (
                        <button
                          onClick={() => { setRoleTemplate(null); }}
                          className="text-xs text-gray-500 hover:text-white shrink-0"
                          title="Clear role template"
                        >✕</button>
                      )}
                    </div>
                  )}

                  {/* Customization note */}
                  {roleTemplate && (() => {
                    const tPerms = ROLE_PERMISSIONS[roleTemplate as SystemRole] || [];
                    const tSet = new Set(tPerms);
                    const customized = tPerms.some(p => permSet.has(p) !== tSet.has(p));
                    return customized ? (
                      <div className="bg-amber-600/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
                        <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                        <div className="text-xs text-amber-300">
                          <span className="font-medium">Permissions have been customized.</span> Please verify the level of access. Compared to "{roleTemplate.replace(/_/g, " ")}" defaults.
                        </div>
                      </div>
                    ) : null;
                  })()}

                  {PERMISSION_CATEGORIES.map(cat => (
                    <div key={cat.key} className="card py-3 px-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-white">{cat.label}</h4>
                          <span className="text-xs text-gray-600">
                            {cat.permissions.filter(p => permSet.has(p)).length}/{cat.permissions.length}
                          </span>
                        </div>
                        {editing && (
                          <button
                            onClick={() => toggleCategory(cat.permissions)}
                            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                              allPermsSelected(cat.permissions) ? "bg-cyber-600/20 text-cyber-400 border-cyber-500/30" :
                              somePermsSelected(cat.permissions) ? "bg-amber-600/20 text-amber-400 border-amber-500/30" :
                              "bg-gray-600/10 text-gray-500 border-gray-600/30"
                            }`}>
                            {allPermsSelected(cat.permissions) ? "All On" : somePermsSelected(cat.permissions) ? "Some" : "All Off"}
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                        {cat.permissions.map(p => {
                          const has = permSet.has(p);
                          const isAdmin = cat.key === "admin";
                          const tPerms = roleTemplate ? (ROLE_PERMISSIONS[roleTemplate as SystemRole] || []) : [];
                          const tSet = new Set(tPerms);
                          const deviates = roleTemplate ? (has !== tSet.has(p as any)) : false;
                          return (
                            <label key={p}
                              className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                                editing ? "cursor-pointer hover:bg-surface-lighter" : "cursor-default"
                              } ${
                                deviates
                                  ? "bg-amber-600/10 border border-amber-500/40 text-amber-300"
                                  : has
                                    ? (isAdmin ? "bg-red-600/10 text-red-300" : "bg-cyber-600/10 text-cyber-300")
                                    : "text-gray-500"
                              }`}>
                              {editing ? (
                                <input type="checkbox" checked={has} onChange={() => togglePerm(p)}
                                  className="rounded accent-cyber-500" />
                              ) : (
                                <span className={`w-3 h-3 rounded border flex items-center justify-center ${
                                  deviates ? "border-amber-500 bg-amber-500/30" : has ? "border-cyber-400 bg-cyber-500/30" : "border-gray-700"
                                }`}>
                                  {has && <Check size={8} className={deviates ? "text-amber-400" : "text-cyber-400"} />}
                                </span>
                              )}
                              <span className="truncate">{formatPermLabel(p)}</span>
                              {deviates && <span className="text-[9px] text-amber-400 ml-auto font-medium">edited</span>}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {editing && !roleTemplate && (
                    <div className="bg-amber-600/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
                      <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                      <div className="text-xs text-amber-300">
                        Changes to permissions take effect at next login. Giving administrative permissions should be done with caution. Use the role dropdown above to apply a preset.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Security Tab ── */}
              {tab === "security" && (
                <div className="space-y-4">
                  <Section title="Account Status">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between py-2">
                        <div>
                          <p className="text-sm text-white font-medium">Active</p>
                          <p className="text-xs text-gray-500">User can log in and access the system</p>
                        </div>
                        <button onClick={handleToggleActive}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                            selected.isActive ? "bg-red-600/10 text-red-400 hover:bg-red-600/20" : "bg-green-600/10 text-green-400 hover:bg-green-600/20"
                          }`}>
                          {selected.isActive ? <><UserX size={13} /> Deactivate</> : <><UserCheck size={13} /> Activate</>}
                        </button>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <div>
                          <p className="text-sm text-white font-medium">MFA</p>
                          <p className="text-xs text-gray-500">{selected.mfaEnabled ? "Enabled" : "Not configured"}</p>
                        </div>
                        <span className={`badge text-xs ${selected.mfaEnabled ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}>
                          {selected.mfaEnabled ? "Secure" : "Not Set"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <div>
                          <p className="text-sm text-white font-medium">Account Locked</p>
                          <p className="text-xs text-gray-500">Locked after too many failed login attempts</p>
                        </div>
                        <span className={`badge text-xs ${selected.isLocked ? "bg-red-600/20 text-red-400" : "bg-green-600/20 text-green-400"}`}>
                          {selected.isLocked ? "Locked" : "Clear"}
                        </span>
                      </div>
                    </div>
                  </Section>
                  <Section title="Activity">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between py-1">
                        <span className="text-gray-500">Last Login</span>
                        <span className="text-white">{selected.lastLoginAt ? new Date(selected.lastLoginAt).toLocaleString() : "Never"}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-gray-500">Created</span>
                        <span className="text-white">{new Date(selected.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </Section>
                  <Section title="Danger Zone">
                    <div className="flex items-center justify-between py-2">
                      <div>
                        <p className="text-sm text-white font-medium">Deactivate User</p>
                        <p className="text-xs text-gray-500">Prevent this user from accessing the system</p>
                      </div>
                      <button onClick={() => setShowDeleteConfirm(true)}
                        className="bg-red-600/10 text-red-400 hover:bg-red-600/20 px-3 py-1.5 rounded text-xs font-medium">
                        Deactivate
                      </button>
                    </div>
                  </Section>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation ── */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={() => setShowDeleteConfirm(false)}>
          <div className="card w-full max-w-sm mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <ShieldAlert size={24} className="text-red-400 shrink-0" />
              <div>
                <h3 className="text-white font-semibold">Deactivate User?</h3>
                <p className="text-sm text-gray-400 mt-1">
                  {selected?.firstName} {selected?.lastName} will no longer be able to log in. Their data will be preserved.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowDeleteConfirm(false)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={handleDelete} className="bg-red-600/20 text-red-400 hover:bg-red-600/30 px-4 py-1.5 rounded-lg text-sm font-medium">Deactivate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──

function formatPermLabel(p: Permission): string {
  return p.split(":").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card space-y-3">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );
}

function Grid({ cols, children }: { cols: number; children: React.ReactNode }) {
  return <div className={`grid grid-cols-1 md:grid-cols-${cols} gap-4`}>{children}</div>;
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-500 mb-1.5">{children}</p>;
}

function Field({ label, value, editing, form, setForm, field, type }: {
  label: string; value: any; editing: boolean;
  form: Record<string, any>; setForm: (v: any) => void; field: string; type?: string;
}) {
  if (!editing) return (
    <div>
      <Label>{label}</Label>
      <p className="text-sm text-white">{String(value || "—")}</p>
    </div>
  );
  return (
    <div>
      <Label>{label}</Label>
      <input className="input-field text-sm py-1.5" type={type || "text"}
        value={String(form[field] ?? "")} onChange={e => setForm({ ...form, [field]: e.target.value })} />
    </div>
  );
}
