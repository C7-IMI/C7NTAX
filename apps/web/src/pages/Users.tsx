import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import api from "../api";
import toast from "react-hot-toast";
import {
  Plus, Search, Shield, X, Save, Edit3, Check, AlertTriangle,
  Mail, Phone, Building2, Clock, KeyRound, UserCheck, UserX, ShieldAlert,
  ChevronLeft, ChevronDown, Copy, Key,
  ExternalLink, UserCog, Lock, Unlock, Download, RotateCw, Eraser, ShieldCheck,
} from "lucide-react";
import { SystemRole, Permission, PERMISSION_CATEGORIES, ROLE_PERMISSIONS } from "@C7NTAX/shared";
import { SortableHeader, sortData, nextSort, type SortState } from "../components/SortableHeader";
import { ContextMenu, useContextMenu, isTextEntryTarget, type MenuEntry } from "../components/ContextMenu";
import { copyText, viewMenuEntries } from "../lib/menuActions";
import { toCsv, downloadCsv, fileStamp, type CsvColumn } from "../lib/csv";
import { NewUserDialog, type RoleOption, type ClientOption } from "../components/users/NewUserDialog";
import { ResetPasswordDialog } from "../components/users/ResetPasswordDialog";
import { timezoneOptions } from "../lib/timezones";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-600/20 text-green-400",
  inactive: "bg-gray-600/20 text-gray-400",
};

interface UserFull {
  id: string; email: string; username?: string | null;
  firstName: string | null; lastName: string | null;
  phone?: string | null; mobile?: string | null; title?: string | null;
  department?: string | null; timezone?: string | null; reportsToId?: string | null;
  reportsTo?: { id: string; firstName: string | null; lastName: string | null; email: string } | null;
  role: { id: string; name: string; systemRole: string; permissions: string[] };
  permissions: string[];
  company?: { id: string; name: string } | null;
  companyId?: string | null;
  isActive: boolean; isLocked: boolean;
  mfaEnabled: boolean;
  mustChangePassword?: boolean;
  passwordChangedAt?: string | null;
  lastLoginAt?: string | null; createdAt: string;
}

/** Confirmation for the destructive actions a right-click menu can start. */
function MenuConfirmDialog({ state, busy, onCancel, onConfirm }: {
  state: { title: string; body: string; confirmLabel: string } | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!state) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-label={state.title} className="card w-full max-w-sm mx-4 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <ShieldAlert size={24} className="text-red-400 shrink-0" />
          <div>
            <h3 className="text-white font-semibold">{state.title}</h3>
            <p className="text-sm text-gray-400 mt-1">{state.body}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button onClick={onConfirm} disabled={busy} className="bg-red-600/20 text-red-400 hover:bg-red-600/30 px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50">{busy ? "Working…" : state.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

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
  const [roleTemplate, setRoleTemplate] = useState<string | null>(null); // selected preset role template for applying defaults
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showCopyUser, setShowCopyUser] = useState(false);
  const [userDropdown, setUserDropdown] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);
  const [createDefaults, setCreateDefaults] = useState<{ roleId?: string; companyId?: string; department?: string; timezone?: string; fromName?: string } | undefined>();
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [resetTarget, setResetTarget] = useState<UserFull | null>(null);
  const timezones = useMemo(() => timezoneOptions(), []);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const menu = useContextMenu();
  const searchRef = useRef<HTMLInputElement>(null);

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

  const fetchClients = useCallback(async () => {
    try {
      const r = await api.get("/clients", { params: { limit: 200, sort: "name" } });
      setClients(r.data?.data || []);
    } catch { /* the client picker is optional */ }
  }, []);

  useEffect(() => { fetchUsers(); fetchRoles(); fetchClients(); }, [fetchUsers, fetchRoles, fetchClients]);

  const refreshUser = async (id: string) => {
    try {
      const r = await api.get(`/users/${id}`);
      setSelected(r.data);
      setForm(r.data);
      const rolePerms = r.data.role?.permissions || [];
      const userOverrides = r.data.permissions || [];
      setPermSet(new Set([...rolePerms, ...userOverrides]));
    } catch { /* ignore */ }
  };

  const openDetail = (user: UserFull) => {
    setSelected(user);
    setForm(user);
    const rolePerms = user.role?.permissions || [];
    const userOverrides = user.permissions || [];
    setPermSet(new Set([...rolePerms, ...userOverrides]));
    setEditing(false);
    setTab("profile");
    // The list projection leaves out placement (time zone, manager), so load the
    // full record; the row renders immediately from what the list already has.
    void refreshUser(user.id);
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
      const payload: Record<string, any> = {};
      // Only send fields the API accepts
      const allowed = [
        "firstName", "lastName", "username", "title", "phone", "mobile",
        "companyId", "department", "timezone", "reportsToId", "isActive",
      ];
      for (const k of allowed) if (form[k] !== undefined) payload[k] = form[k];
      if (form.roleId) payload.roleId = form.roleId;
      else if (form.role?.systemRole) payload.role = form.role.systemRole;
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
      toast.error(e?.response?.data?.error?.message || e?.response?.data?.error || "Failed to save");
      setSaving(false);
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

  // ── Right-click menu: Manage Users ──
  /** A destructive menu action that asks first (see MenuConfirmDialog below). */
  const [menuConfirm, setMenuConfirm] = useState<{ title: string; body: string; confirmLabel: string; run: () => Promise<void> } | null>(null);
  const [menuConfirmBusy, setMenuConfirmBusy] = useState(false);

  const runMenuConfirm = async () => {
    if (!menuConfirm) return;
    setMenuConfirmBusy(true);
    try { await menuConfirm.run(); }
    finally { setMenuConfirmBusy(false); setMenuConfirm(null); }
  };

  const csvColumns: CsvColumn<UserFull>[] = [
    { key: "name", label: "Name", value: u => `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() },
    { key: "email", label: "Email", value: u => u.email },
    { key: "role", label: "Role", value: u => u.role?.name ?? "" },
    { key: "systemRole", label: "System Role", value: u => u.role?.systemRole ?? "" },
    { key: "department", label: "Department", value: u => u.department ?? "" },
    { key: "company", label: "Company", value: u => u.company?.name ?? "" },
    { key: "mfa", label: "MFA", value: u => (u.mfaEnabled ? "Enabled" : "Disabled") },
    { key: "status", label: "Status", value: u => (u.isActive ? "Active" : "Inactive") },
    { key: "lastLogin", label: "Last Login", value: u => u.lastLoginAt ?? "" },
  ];

  const exportCsv = () => {
    const rows = sortData(users, sort?.field || "firstName", sort?.direction || "asc");
    if (rows.length === 0) { toast.error("Nothing to export"); return; }
    downloadCsv(`c7ntax-users-${fileStamp()}.csv`, toCsv(rows, csvColumns));
    toast.success(`Exported ${rows.length} user${rows.length === 1 ? "" : "s"}`);
  };

  const setUserActive = async (u: UserFull, isActive: boolean) => {
    try {
      await api.patch(`/users/${u.id}`, { isActive });
      toast.success(`User ${isActive ? "activated" : "deactivated"}`);
      await fetchUsers();
      if (selected?.id === u.id) setSelected({ ...u, isActive });
    } catch { toast.error("Failed to update status"); }
  };

  const setUserLocked = async (u: UserFull, locked: boolean) => {
    try {
      await api.post(`/users/${u.id}/lock`, { locked });
      toast.success(locked ? "Account locked" : "Account unlocked");
      await fetchUsers();
      if (selected?.id === u.id) setSelected({ ...u, isLocked: locked });
    } catch { toast.error("Failed to update the lock"); }
  };

  const userMenuHeader = (u: UserFull) => ({
    title: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email,
    subtitle: [u.email, u.role?.name, u.company?.name, u.isActive ? "Active" : "Inactive", u.isLocked ? "Locked" : null].filter(Boolean).join(" · "),
  });

  const userMenuEntries = (u: UserFull): MenuEntry[] => [
    { label: "Open user details", icon: ExternalLink, hint: "⏎", onSelect: () => openDetail(u) },
    { label: "Edit user", icon: Edit3, onSelect: () => { openDetail(u); setEditing(true); } },
    { label: "Open permissions", icon: Shield, onSelect: () => { openDetail(u); setTab("permissions"); } },
    { label: "Open security", icon: KeyRound, onSelect: () => { openDetail(u); setTab("security"); } },
    "separator",
    u.isActive
      ? { label: "Deactivate user", icon: UserX, onSelect: () => void setUserActive(u, false) }
      : { label: "Activate user", icon: UserCheck, onSelect: () => void setUserActive(u, true) },
    u.isLocked
      ? { label: "Unlock account", icon: Unlock, onSelect: () => void setUserLocked(u, false) }
      : { label: "Lock account", icon: Lock, onSelect: () => void setUserLocked(u, true) },
    {
      label: "Reset password…", icon: Key, hint: u.mustChangePassword ? "change pending" : undefined,
      onSelect: () => setResetTarget(u),
    },
    {
      label: "Reset MFA", icon: ShieldCheck, disabled: !u.mfaEnabled, hint: u.mfaEnabled ? undefined : "not enrolled",
      onSelect: () => setMenuConfirm({
        title: "Reset MFA?",
        body: `${`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email} will need to enrol an authenticator again at their next sign-in.`,
        confirmLabel: "Reset MFA",
        run: async () => {
          try {
            await api.post(`/users/${u.id}/reset-mfa`);
            toast.success("MFA reset");
            await fetchUsers();
            if (selected?.id === u.id) setSelected({ ...u, mfaEnabled: false });
          } catch (e: any) { toast.error(e?.response?.data?.error?.message || "Failed to reset MFA"); }
        },
      }),
    },
    "separator",
    { label: "Copy email", icon: Copy, onSelect: () => void copyText(u.email, "Email") },
    { label: "Copy name", icon: Copy, onSelect: () => void copyText(`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(), "Name") },
  ];

  const sectionMenuEntries = (): MenuEntry[] => [
    {
      label: "New user", icon: Plus,
      onSelect: () => { setCreateDefaults(undefined); setShowCreate(true); },
    },
    { label: "Create from existing user…", icon: UserCog, onSelect: () => setShowCopyUser(true) },
    { label: "Refresh list", icon: RotateCw, onSelect: () => void fetchUsers() },
    { label: "Focus search", icon: Search, onSelect: () => searchRef.current?.focus() },
    "separator",
    {
      label: "Clear filters", icon: Eraser, disabled: !search && !roleFilter && !sort,
      onSelect: () => { setSearch(""); setRoleFilter(""); setSort(null); },
    },
    "separator",
    { label: "Export as CSV", icon: Download, hint: `${users.length} row${users.length === 1 ? "" : "s"}`, disabled: users.length === 0, onSelect: exportCsv },
    "separator",
    ...viewMenuEntries(),
  ];

  // ── Render ──
  if (loading) return <div className="text-center py-12 text-gray-500">Loading users...</div>;

  return (
    <div
      className="space-y-4 animate-fade-in"
      onContextMenu={(e) => { if (isTextEntryTarget(e.target)) return; menu.open(e, sectionMenuEntries()); }}
    >
      <ContextMenu state={menu.menuState} onClose={menu.close} />
      <MenuConfirmDialog state={menuConfirm} busy={menuConfirmBusy} onCancel={() => setMenuConfirm(null)} onConfirm={runMenuConfirm} />
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
                  onClick={() => { setUserDropdown(false); setCreateDefaults(undefined); setShowCreate(true); }}
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
          <input ref={searchRef} className="input-field pl-9" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} />
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
                <tr key={u.id} tabIndex={0}
                  className={`border-b border-surface-border/50 hover:bg-surface-lighter/30 transition-colors cursor-pointer focus:outline-none focus:bg-surface-lighter/30 ${selected?.id === u.id ? "bg-cyber-600/10 border-l-2 border-l-cyber-400" : ""}`}
                  onClick={() => openDetail(u)}
                  onContextMenu={(e) => menu.open(e, userMenuEntries(u), userMenuHeader(u))}
                  onKeyDown={(e) => menu.onKeyDown(e, e.currentTarget, userMenuEntries(u), userMenuHeader(u))}
                >
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
                    setCreateDefaults({
                      roleId: u.role?.id,
                      companyId: u.company?.id,
                      department: u.department ?? undefined,
                      timezone: u.timezone ?? undefined,
                      fromName: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email,
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

      {/* ── Create User Dialog ── */}
      <NewUserDialog
        open={showCreate}
        onClose={() => { setShowCreate(false); setCreateDefaults(undefined); }}
        onCreated={() => { void fetchUsers(); }}
        roles={roles}
        clients={clients}
        users={users}
        defaults={createDefaults}
      />

      {/* ── Reset Password Dialog ── */}
      <ResetPasswordDialog
        user={resetTarget}
        onClose={() => setResetTarget(null)}
        onDone={() => { void fetchUsers(); if (selected) void refreshUser(selected.id); }}
      />

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
                  <Section title="Placement">
                    <Grid cols={2}>
                      <Field label="Department" value={selected.department} editing={editing} form={form} setForm={setForm} field="department" />
                      <div>
                        <Label>Time zone</Label>
                        {editing ? (
                          <select className="input-field text-sm py-1.5" value={String(form.timezone ?? selected.timezone ?? "")}
                            onChange={e => setForm({ ...form, timezone: e.target.value })}>
                            <option value="">—</option>
                            {timezones.map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>)}
                          </select>
                        ) : (
                          <p className="text-sm text-white">{selected.timezone?.replace(/_/g, " ") || "—"}</p>
                        )}
                      </div>
                      <div>
                        <Label>Reports to</Label>
                        {editing ? (
                          <select className="input-field text-sm py-1.5" value={String(form.reportsToId ?? selected.reportsToId ?? "")}
                            onChange={e => setForm({ ...form, reportsToId: e.target.value })}>
                            <option value="">Nobody</option>
                            {users.filter(x => x.id !== selected.id).map(u => (
                              <option key={u.id} value={u.id}>{`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email}</option>
                            ))}
                          </select>
                        ) : (
                          <p className="text-sm text-white">
                            {selected.reportsTo
                              ? `${selected.reportsTo.firstName ?? ""} ${selected.reportsTo.lastName ?? ""}`.trim() || selected.reportsTo.email
                              : "—"}
                          </p>
                        )}
                      </div>
                    </Grid>
                  </Section>
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

                  {/* Customization warning — compares against user's assigned role */}
                  {editing && (() => {
                    const rolePermsArr = selected?.role?.permissions || [];
                    const roleSet = new Set(rolePermsArr);
                    const hasDeviation = rolePermsArr.some(p => permSet.has(p) !== roleSet.has(p)) ||
                      [...permSet].some(p => !roleSet.has(p));
                    return hasDeviation ? (
                      <div className="bg-amber-600/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
                        <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                        <div className="text-xs text-amber-300">
                          <span className="font-medium">Permissions have been customized.</span> The current selections differ from the assigned role "{selected?.role?.name || selected?.role?.systemRole?.replace(/_/g, " ")}".
                        </div>
                      </div>
                    ) : (
                      <div className="bg-green-600/10 border border-green-500/30 rounded-lg p-3 flex items-start gap-2">
                        <Check size={16} className="text-green-400 shrink-0 mt-0.5" />
                        <div className="text-xs text-green-300">
                          <span className="font-medium">Permissions match assigned role.</span> No deviations from "{selected?.role?.name || selected?.role?.systemRole?.replace(/_/g, " ")}".
                        </div>
                      </div>
                    );
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
                          const rolePermsArr = selected?.role?.permissions || [];
                          const deviates = has !== rolePermsArr.includes(p);
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

                  {editing && (
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
                  <Section title="Password">
                    <div className="flex items-center justify-between gap-4 py-2">
                      <div>
                        <p className="text-sm text-white font-medium">Sign-in password</p>
                        <p className="text-xs text-gray-500">
                          {selected.mustChangePassword
                            ? "A reset is pending — a new password is required at the next sign-in"
                            : selected.passwordChangedAt
                              ? `Last changed ${new Date(selected.passwordChangedAt).toLocaleDateString()}`
                              : "Never changed since the account was created"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {selected.mustChangePassword && (
                          <span className="badge bg-amber-600/20 text-amber-400 text-xs">Change pending</span>
                        )}
                        <button onClick={() => setResetTarget(selected)}
                          className="bg-cyber-600/15 text-cyber-400 hover:bg-cyber-600/25 px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1.5">
                          <Key size={13} /> Reset password
                        </button>
                      </div>
                    </div>
                  </Section>
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
                        <div className="flex items-center gap-2">
                          <span className={`badge text-xs ${selected.mfaEnabled ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}>
                            {selected.mfaEnabled ? "Secure" : "Not Set"}
                          </span>
                          {selected.mfaEnabled && (
                            <button
                              onClick={() => setMenuConfirm({
                                title: "Reset MFA?",
                                body: `${`${selected.firstName ?? ""} ${selected.lastName ?? ""}`.trim() || selected.email} will need to enrol an authenticator again at their next sign-in.`,
                                confirmLabel: "Reset MFA",
                                run: async () => {
                                  try {
                                    await api.post(`/users/${selected.id}/reset-mfa`);
                                    toast.success("MFA reset");
                                    await fetchUsers();
                                    await refreshUser(selected.id);
                                  } catch (e: any) { toast.error(e?.response?.data?.error?.message || "Failed to reset MFA"); }
                                },
                              })}
                              className="bg-amber-600/10 text-amber-400 hover:bg-amber-600/20 px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1.5">
                              <ShieldCheck size={13} /> Reset MFA
                            </button>
                          )}
                        </div>
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
