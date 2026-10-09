import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Shield, Edit3, Trash2, Save, X, AlertTriangle, ChevronDown, ChevronRight, Users, CheckSquare, Copy, UserPlus, UserMinus, Search, ExternalLink, Download, RotateCw } from "lucide-react";
import {
  SystemRole, Permission, PERMISSION_CATEGORIES, ROLE_PERMISSIONS,
  DEVELOPER_PERMISSION_KEYS, DEVELOPER_ROLE_REFUSAL, isDeveloperRole, withoutDeveloperPermissions,
} from "@C7NTAX/shared";
import { ContextMenu, useContextMenu, isTextEntryTarget, type MenuEntry } from "../components/ContextMenu";
import { copyText, viewMenuEntries } from "../lib/menuActions";
import { toCsv, downloadCsv, fileStamp, type CsvColumn } from "../lib/csv";
import { TableSkeleton } from "../components/ui/Skeleton";
import { PageHeader, ListViews, ListFooter, StatCard } from "../components/ui";
import { useRedesign } from "../hooks/useNavigationStyle";
import { useSuperAdmin } from "../hooks/useSuperAdmin";

interface RoleRow {
  id: string; name: string; systemRole: string; permissions: string[];
  isDefault: boolean; _count?: { users: number };
}

function formatPermLabel(perm: Permission): string {
  return perm.split(":")[1]!.replace(/_/g, " ");
}

/**
 * Why the Developer category is on its own, shown to a Super Admin — the only person who sees it.
 *
 * The two permissions it holds are the only ones whose worst case is removing this instance's
 * contents, and the Developer Admin role exists so that being senior is not the same as being trusted
 * with them: the category is deliberately **not** inherited by Super Admin, which is why this says
 * "grant it on purpose" rather than "already yours". It closes with the sentence the API refuses with,
 * so the interface and the refusal say the same thing.
 */
const DEVELOPER_CATEGORY_REASON =
  "This category stands alone, and is not inherited by Super Admin, because it holds the only two permissions whose worst case is removing this instance's contents: developer:view opens the Developer section and developer:purge empties it. The Developer Admin role exists so that being senior is not the same as being trusted with them. " +
  DEVELOPER_ROLE_REFUSAL;

export function RolesPage() {
  const redesign = useRedesign();
  const superAdmin = useSuperAdmin();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [view, setView] = useState("all");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RoleRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [editPerms, setEditPerms] = useState<Set<string>>(new Set());
  const [originalPerms, setOriginalPerms] = useState<Set<string>>(new Set());
  const [editName, setEditName] = useState("");
  const [editSystemRole, setEditSystemRole] = useState("");
  const [editIsDefault, setEditIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showCopyRole, setShowCopyRole] = useState(false);
  const [createDropdown, setCreateDropdown] = useState(false);
  const [newRole, setNewRole] = useState<{ name: string; systemRole: string; permissions?: string[] }>({ name: "", systemRole: "technician" });
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set(["tickets", "clients", "admin"]));
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [roleMembers, setRoleMembers] = useState<Array<{id:string;email:string;firstName:string|null;lastName:string|null}>>([]);
  const [allUsers, setAllUsers] = useState<Array<{id:string;email:string;firstName:string|null;lastName:string|null;roleId:string;role?:{systemRole?:string}}>>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [membersLoading, setMembersLoading] = useState(false);
  const menu = useContextMenu();

  /*
   * What a Super Admin sees that nobody else does: the Developer category, the Developer Admin system
   * role in the two pickers, and the two permissions themselves in "Select all" and in the full-access
   * count. `PERMISSION_CATEGORIES` and `SystemRole` are compiled into the bundle, so without these the
   * screen would offer a role and two keys the API refuses — and the API *is* the gate: it omits the
   * role from the list entirely and strips the keys from every role it returns, which is why this page
   * needs no filter over the role rows themselves.
   */
  const visibleCategories = useMemo(
    () => (superAdmin ? PERMISSION_CATEGORIES : PERMISSION_CATEGORIES.filter(cat => !cat.permissions.some(p => DEVELOPER_PERMISSION_KEYS.includes(p)))),
    [superAdmin],
  );
  const roleTypes = useMemo(
    () => Object.values(SystemRole).filter(sr => superAdmin || !isDeveloperRole(sr)),
    [superAdmin],
  );
  const selectablePermissions = useMemo(
    () => (superAdmin ? Object.values(Permission) : withoutDeveloperPermissions(Object.values(Permission))),
    [superAdmin],
  );

  const fetch = useCallback(async () => {
    try { const r = await api.get("/roles"); setRoles(r.data.data); }
    catch { toast.error("Failed to load roles"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const selectRole = (r: RoleRow) => {
    setSelected(r);
    const perms = new Set(r.permissions);
    setEditPerms(perms);
    setOriginalPerms(perms);
    setEditName(r.name);
    setEditSystemRole(r.systemRole);
    setEditIsDefault(r.isDefault);
    setEditing(false);
  };

  const startEdit = () => {
    if (!selected) return;
    setOriginalPerms(new Set(editPerms));
    setEditing(true);
  };

  const togglePerm = (perm: Permission) => {
    setEditPerms(prev => {
      const next = new Set(prev);
      next.has(perm) ? next.delete(perm) : next.add(perm);
      return next;
    });
  };

  const toggleCategory = (perms: Permission[], checked: boolean) => {
    setEditPerms(prev => {
      const next = new Set(prev);
      for (const p of perms) checked ? next.add(p) : next.delete(p);
      return next;
    });
  };

  const catAllChecked = (perms: Permission[]): boolean => perms.every(p => editPerms.has(p));
  const catPartial = (perms: Permission[]): boolean => perms.some(p => editPerms.has(p)) && !catAllChecked(perms);

  const handleSaveRole = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.patch(`/roles/${selected.id}`, {
        name: editName,
        permissions: [...editPerms],
        systemRole: editSystemRole,
        isDefault: editIsDefault,
      });
      toast.success("Role updated");
      setSaving(false);
      setEditing(false);
      fetch();
    } catch (e: any) {
      // The API's own wording, because its refusals name the permission or the role they refused —
      // "Failed to save" would hide the one sentence that explains why.
      toast.error(e?.response?.data?.error?.message || "Failed to save");
      setSaving(false);
    }
  };

  const handleCreateRole = async () => {
    if (!newRole.name.trim()) { toast.error("Role name required"); return; }
    try {
      await api.post("/roles", newRole);
      toast.success("Role created");
      setShowCreate(false);
      setNewRole({ name: "", systemRole: "technician", permissions: undefined });
      fetch();
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || "Failed to create");
    }
  };

  const handleDeleteRole = async (id: string) => {
    try {
      await api.delete(`/roles/${id}`);
      toast.success("Role deleted");
      setShowDeleteConfirm(null);
      if (selected?.id === id) setSelected(null);
      fetch();
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || "Failed to delete");
    }
  };

  // ── Right-click menu: Manage Roles ──
  const csvColumns: CsvColumn<RoleRow>[] = [
    { key: "name", label: "Role", value: r => r.name },
    { key: "systemRole", label: "System Role", value: r => r.systemRole },
    { key: "users", label: "Users", value: r => r._count?.users ?? 0 },
    { key: "permissions", label: "Permissions", value: r => r.permissions.length },
    { key: "default", label: "Default", value: r => (r.isDefault ? "Yes" : "No") },
    { key: "permissionList", label: "Permission List", value: r => r.permissions.join(" ") },
  ];

  const exportCsv = () => {
    if (roles.length === 0) { toast.error("Nothing to export"); return; }
    downloadCsv(`c7ntax-roles-${fileStamp()}.csv`, toCsv(roles, csvColumns));
    toast.success(`Exported ${roles.length} role${roles.length === 1 ? "" : "s"}`);
  };

  const roleMenuHeader = (r: RoleRow) => ({
    title: r.name,
    subtitle: [r.systemRole.replace(/_/g, " "), `${r.permissions.length} permissions`, `${r._count?.users ?? 0} users`, r.isDefault ? "Default" : null].filter(Boolean).join(" · "),
  });

  const roleMenuEntries = (r: RoleRow): MenuEntry[] => {
    const assigned = r._count?.users ?? 0;
    return [
      { label: "Show permissions", icon: ExternalLink, hint: "⏎", onSelect: () => selectRole(r) },
      { label: "Edit role", icon: Edit3, onSelect: () => { selectRole(r); setEditing(true); } },
      { label: `Manage members${assigned ? ` (${assigned})` : ""}`, icon: Users, onSelect: () => { selectRole(r); setTimeout(openMembers, 50); } },
      "separator",
      { label: "Copy role name", icon: Copy, onSelect: () => void copyText(r.name, "Role name") },
      { label: "Copy permission list", icon: Copy, hint: `${r.permissions.length}`, onSelect: () => void copyText(r.permissions.join("\n"), "Permission list") },
      "separator",
      {
        label: "Delete role…", icon: Trash2, danger: true, disabled: assigned > 0,
        hint: assigned > 0 ? "reassign users first" : undefined,
        onSelect: () => { selectRole(r); setShowDeleteConfirm(r.id); },
      },
    ];
  };

  const sectionMenuEntries = (): MenuEntry[] => [
    { label: "Create role", icon: Plus, onSelect: () => { setNewRole({ name: "", systemRole: "technician", permissions: undefined }); setShowCreate(true); } },
    { label: "Create from existing role…", icon: Copy, onSelect: () => setShowCopyRole(true) },
    { label: "Refresh list", icon: RotateCw, onSelect: () => void fetch() },
    "separator",
    { label: "Export as CSV", icon: Download, hint: `${roles.length} row${roles.length === 1 ? "" : "s"}`, disabled: roles.length === 0, onSelect: exportCsv },
    "separator",
    ...viewMenuEntries(),
  ];

  // ── Member management ──
  const openMembers = async () => {
    if (!selected) return;
    setShowMembers(true);
    setMemberSearch("");
    setMembersLoading(true);
    try {
      const [roleRes, usersRes] = await Promise.all([
        api.get(`/roles/${selected.id}`),
        api.get("/users?limit=500"),
      ]);
      setRoleMembers(roleRes.data.users || []);
      setAllUsers(usersRes.data.data || []);
    } catch { toast.error("Failed to load members"); }
    finally { setMembersLoading(false); }
  };

  const addUserToRole = async (userId: string) => {
    try {
      await api.patch(`/users/${userId}`, { role: selected!.systemRole });
      toast.success("User assigned to role");
      // Refresh member list
      const roleRes = await api.get(`/roles/${selected!.id}`);
      setRoleMembers(roleRes.data.users || []);
      fetch();
    } catch { toast.error("Failed to assign user"); }
  };

  const removeUserFromRole = async (userId: string) => {
    // Reassign to "Read Only" or the most basic role
    try {
      const roRole = roles.find(r => r.systemRole === "read_only");
      await api.patch(`/users/${userId}`, { role: roRole?.systemRole || "read_only" });
      toast.success("User removed from role");
      const roleRes = await api.get(`/roles/${selected!.id}`);
      setRoleMembers(roleRes.data.users || []);
      fetch();
    } catch { toast.error("Failed to remove user"); }
  };

  const unassignedUsers = allUsers.filter(u => !roleMembers.some(m => m.id === u.id));
  const filteredUnassigned = memberSearch
    ? unassignedUsers.filter(u =>
        `${u.firstName||""} ${u.lastName||""} ${u.email}`.toLowerCase().includes(memberSearch.toLowerCase())
      )
    : unassignedUsers;

  const resetToDefaults = () => {
    if (!selected) return;
    const defaults = ROLE_PERMISSIONS[editSystemRole as SystemRole] || [];
    setEditPerms(new Set(defaults));
    toast.success("Reset to system defaults for this role type");
  };

  // ── Render ──
  /*
   * The role inventory, counted from the rows already in hand: a role that grants everything, one
   * nobody holds, and one that grants nothing at all. Those are the three an administrator audits,
   * and each is a fact about the row rather than a second request.
   */
  const ALL_PERMISSIONS = selectablePermissions.length;
  const fullAccess = (r: RoleRow) => ALL_PERMISSIONS > 0 && r.permissions.length >= ALL_PERMISSIONS;
  const noMembers = (r: RoleRow) => (r._count?.users ?? 0) === 0;
  const emptyRoles = roles.filter(noMembers).length;
  const roleViews = [
    { id: "all", label: "All", count: roles.length },
    { id: "default", label: "Default", count: roles.filter(r => r.isDefault).length },
    { id: "full", label: "Full access", count: roles.filter(fullAccess).length },
    { id: "empty", label: "No members", count: emptyRoles },
    { id: "none", label: "No permissions", count: roles.filter(r => r.permissions.length === 0).length },
  ];
  const inView = (r: RoleRow) =>
    view === "default" ? r.isDefault
    : view === "full" ? fullAccess(r)
    : view === "empty" ? noMembers(r)
    : view === "none" ? r.permissions.length === 0
    : true;
  const shownRoles = redesign ? roles.filter(inView) : roles;
  const assignedUsers = roles.reduce((n, r) => n + (r._count?.users ?? 0), 0);
  const permissionGrants = roles.reduce((n, r) => n + r.permissions.length, 0);
  if (loading) return <div className="text-center py-12 text-gray-500">Loading roles...</div>;

  return (
    <div
      className="space-y-4 animate-fade-in"
      onContextMenu={(e) => { if (isTextEntryTarget(e.target)) return; menu.open(e, sectionMenuEntries()); }}
    >
      <ContextMenu state={menu.menuState} onClose={menu.close} />
      <div className="flex items-center justify-between">
        <PageHeader variant="section" title="Manage Roles" subtitle={<>{roles.length} roles</>} />
        <div className="relative">
          <button
            onClick={() => setCreateDropdown(!createDropdown)}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Plus size={16} /> Create Role <ChevronDown size={14} className={`transition-transform ${createDropdown ? "rotate-180" : ""}`} />
          </button>
          {createDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setCreateDropdown(false)} />
              <div className="absolute right-0 z-50 mt-1.5 w-52 bg-surface border border-surface-border rounded-lg shadow-lg overflow-hidden">
                <button
                  onClick={() => { setCreateDropdown(false); setNewRole({ name: "", systemRole: "technician", permissions: undefined }); setShowCreate(true); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-surface-lighter flex items-center gap-2 transition-colors"
                >
                  <Plus size={14} className="text-cyber-400" /> Create New
                </button>
                <button
                  onClick={() => { setCreateDropdown(false); setShowCopyRole(true); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-surface-lighter flex items-center gap-2 transition-colors border-t border-surface-border/50"
                >
                  <Copy size={14} className="text-cyber-400" /> Create from Existing
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {redesign && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Roles" value={roles.length} icon={<Shield size={14} />} tone="cyber" />
          <StatCard label="Users assigned" value={assignedUsers} icon={<Users size={14} />} tone="green" />
          <StatCard label="Permission grants" value={permissionGrants} icon={<CheckSquare size={14} />} tone="neutral" />
          <StatCard label="Roles with no members" value={emptyRoles} icon={<UserMinus size={14} />} tone="amber" />
        </div>
      )}

      {redesign && (
        <div className="flex flex-wrap items-center gap-2">
          <ListViews views={roleViews} value={view} onChange={setView} label="Role views" />
          <span className="text-xs text-gray-500">
            {shownRoles.length} role{shownRoles.length === 1 ? "" : "s"}
            {view === "all" ? ` · ${assignedUsers} user${assignedUsers === 1 ? "" : "s"} assigned` : ` · ${roles.length} in total`}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Role list */}
        <div className="lg:col-span-1 space-y-2">
          <div className="card p-0 overflow-hidden">
            {shownRoles.length === 0 ? (
              <div className="p-6 text-center text-gray-500 text-sm">{roles.length === 0 ? "No roles found" : "Nothing in this view"}</div>
            ) : (
              shownRoles.map(r => (
                <div
                  key={r.id}
                  onContextMenu={(e) => menu.open(e, roleMenuEntries(r), roleMenuHeader(r))}
                  className={`relative border-b border-surface-border/50 last:border-0 ${
                    selected?.id === r.id ? "bg-cyber-600/10 border-l-2 border-l-cyber-500" : ""
                  }`}
                >
                  <button
                    onClick={() => selectRole(r)}
                    onContextMenu={(e) => menu.open(e, roleMenuEntries(r), roleMenuHeader(r))}
                    onKeyDown={(e) => menu.onKeyDown(e, e.currentTarget, roleMenuEntries(r), roleMenuHeader(r))}
                    className="w-full text-left px-4 py-3 pr-16 transition-colors hover:bg-surface-lighter/50"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-1.5 rounded ${r.isDefault ? "bg-cyber-600/20" : "bg-surface-lighter"}`}>
                        <Shield size={16} className={r.isDefault ? "text-cyber-400" : "text-gray-400"} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{r.name}</p>
                        <p className="text-xs text-gray-500 capitalize">
                          {r.systemRole.replace(/_/g, " ")}
                          {redesign && r.isDefault && <span className="chip chip--good text-[10px] ml-2">Default</span>}
                        </p>
                      </div>
                    </div>
                  </button>
                  {r._count?.users !== undefined && (
                    <button
                      onClick={() => { selectRole(r); setTimeout(openMembers, 50); }}
                      className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs font-medium bg-cyber-600/10 text-cyber-400 hover:bg-cyber-600/25 hover:text-cyber-300 px-2 py-0.5 rounded-full transition-colors cursor-pointer"
                      title="Manage role members"
                    >
                      <Users size={10} />
                      {r._count.users}
                    </button>
                  )}
                </div>
              ))
            )}
            {redesign && shownRoles.length > 0 && (
              <ListFooter
                from={1}
                to={shownRoles.length}
                total={shownRoles.length}
                page={1}
                pages={1}
                onPage={() => {}}
                note={`${roles.length} role${roles.length === 1 ? "" : "s"} in total`}
              />
            )}
          </div>
        </div>

        {/* Role detail */}
        <div className="lg:col-span-2">
          {!selected ? (
            <div className="card flex items-center justify-center py-16 text-gray-500 text-sm">
              <div className="text-center">
                <Shield size={40} className="text-gray-600 mx-auto mb-3" />
                <p>Select a role to view and edit its permissions</p>
              </div>
            </div>
          ) : (
            <div className="card space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${selected.isDefault ? "bg-cyber-600/20" : "bg-surface-lighter"}`}>
                    <Shield size={20} className={selected.isDefault ? "text-cyber-400" : "text-gray-400"} />
                  </div>
                  <div>
                    {editing ? (
                      <div className="space-y-1.5">
                        <input className="input-field text-sm py-1" value={editName} onChange={e => setEditName(e.target.value)} placeholder="Role name" />
                        <select className="input-field text-sm py-1 w-auto" value={editSystemRole} onChange={e => { setEditSystemRole(e.target.value); setEditPerms(new Set(ROLE_PERMISSIONS[e.target.value as SystemRole] || [])); }}>
                        {roleTypes.map(sr => <option key={sr} value={sr}>{sr.replace(/_/g, " ")}</option>)}
                        </select>
                      </div>
                    ) : (
                      <>
                        <h3 className="text-white font-semibold">
                          {selected.name}
                          {redesign && selected.isDefault && <span className="chip chip--good text-[10px] ml-2 align-middle">Default</span>}
                        </h3>
                        <p className="text-xs text-gray-400 capitalize">{selected.systemRole.replace(/_/g, " ")} · {selected.permissions.length} permissions</p>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {editing ? (
                    <>
                      <button onClick={() => setEditing(false)} className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"><X size={12} /> Cancel</button>
                      <button onClick={handleSaveRole} disabled={saving} className="btn-primary text-xs py-1 px-2 flex items-center gap-1"><Save size={12} /> {saving ? "Saving..." : "Save"}</button>
                      {(() => {
                        const changed = editPerms.size !== originalPerms.size || [...editPerms].some(p => !originalPerms.has(p));
                        return changed ? (redesign ? <span className="chip chip--warn text-[10px]">Changed</span> : <span className="badge bg-amber-600/20 text-amber-400 text-[10px] px-1.5 py-0.5">Changed</span>) : null;
                      })()}
                    </>
                  ) : (
                    <>
                      <button onClick={startEdit} className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"><Edit3 size={12} /> Edit</button>
                      <button
                        onClick={() => setShowDeleteConfirm(selected.id)}
                        className="btn-secondary text-xs py-1 px-2 flex items-center gap-1 text-red-400 hover:text-red-300"
                        disabled={!!(selected._count?.users && selected._count.users > 0)}
                        title={selected._count?.users && selected._count.users > 0 ? "Reassign users before deleting" : "Delete role"}
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* User count banner — always shown */}
              <button
                onClick={openMembers}
                className="flex items-center gap-2 text-xs bg-cyber-600/10 hover:bg-cyber-600/20 rounded-lg px-3 py-2 transition-colors cursor-pointer w-full text-left group"
                title="Manage role members"
              >
                <Users size={14} className="text-cyber-400" />
                {(selected._count?.users ?? 0) > 0 ? (
                  <span className="text-gray-400"><span className="text-white font-medium">{selected._count?.users}</span> user{(selected._count?.users ?? 0) !== 1 ? "s" : ""} assigned to this role</span>
                ) : (
                  <span className="text-gray-400"><span className="text-white font-medium">0</span> users assigned to this role</span>
                )}
                <span className="ml-auto text-gray-600 group-hover:text-cyber-400 transition-colors">Manage →</span>
              </button>

              {/* Delete confirmation */}
              {showDeleteConfirm && (
                <div className="rounded-lg border border-red-600/30 bg-red-600/5 p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-red-400">Delete this role?</p>
                      <p className="text-xs text-gray-500 mt-1">This action cannot be undone. Any users with this role must be reassigned first.</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleDeleteRole(showDeleteConfirm)} className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700">Delete</button>
                    <button onClick={() => setShowDeleteConfirm(null)} className="px-3 py-1.5 text-xs bg-surface-lighter text-gray-400 rounded-lg hover:text-white">Cancel</button>
                  </div>
                </div>
              )}

              {/* Permission editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Permissions</h4>
                  {editing && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => setEditPerms(new Set())} className="text-xs text-gray-500 hover:text-white">Clear All</button>
                      <button onClick={() => setEditPerms(new Set(selectablePermissions))} className="text-xs text-gray-500 hover:text-white">Select All</button>
                      <button onClick={resetToDefaults} className="text-xs text-cyber-400 hover:text-cyber-300 flex items-center gap-1"><Copy size={10} /> Reset Defaults</button>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  {visibleCategories.map(cat => {
                    const allChecked = catAllChecked(cat.permissions);
                    const partial = catPartial(cat.permissions);
                    const expanded = expandedCats.has(cat.key);
                    const hasSensitive = cat.key === "admin" || cat.key === "security";
                    const isEditingSensitive = editing && hasSensitive && allChecked;
                    // The category the Developer section is gated on. Only a Super Admin reaches it —
                    // `visibleCategories` above is what removes it for everybody else.
                    const isDeveloperCategory = cat.permissions.some(p => DEVELOPER_PERMISSION_KEYS.includes(p));

                    return (
                      <div key={cat.key} className="rounded-lg border border-surface-border/50 overflow-hidden">
                        <button
                          onClick={() => setExpandedCats(prev => {
                            const next = new Set(prev);
                            next.has(cat.key) ? next.delete(cat.key) : next.add(cat.key);
                            return next;
                          })}
                          className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-surface-lighter/30 transition-colors text-left"
                        >
                          {expanded ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
                          <span className={`text-xs font-medium flex-1 ${(hasSensitive || isDeveloperCategory) && editing ? "text-red-400" : "text-gray-300"}`}>
                            {cat.label}
                            {(hasSensitive || isDeveloperCategory) && editing && <AlertTriangle size={11} className="inline ml-1 text-red-400" />}
                          </span>
                          {editing && (
                            <input
                              type="checkbox"
                              checked={allChecked}
                              ref={el => { if (el) el.indeterminate = partial; }}
                              onChange={() => toggleCategory(cat.permissions, !allChecked)}
                              className="w-3.5 h-3.5 rounded border-gray-600 accent-cyber-500"
                              onClick={e => e.stopPropagation()}
                            />
                          )}
                          <span className={`text-[10px] font-mono ${allChecked ? "text-green-400" : partial ? "text-amber-400" : "text-gray-600"}`}>
                            {cat.permissions.filter(p => editPerms.has(p)).length}/{cat.permissions.length}
                          </span>
                        </button>

                        {/*
                          * The one category that is different in kind, so it is explained where it is
                          * read rather than in a tooltip. Modern draws it as a sentence beside the
                          * control it describes; classic draws it as a form note under the label. The
                          * words are shared — only the arrangement differs.
                        */}
                        {isDeveloperCategory && (redesign ? (
                          <p className="flex items-start gap-1.5 px-3 pb-2 text-[11px] leading-relaxed text-gray-500">
                            <Shield size={12} className="text-red-400 shrink-0 mt-0.5" />
                            <span>{DEVELOPER_CATEGORY_REASON}</span>
                          </p>
                        ) : (
                          <div className="mx-3 mb-2 border-l-2 border-red-600/40 pl-3 text-[11px] leading-relaxed text-gray-500">
                            <span className="block font-medium text-red-400">Separate on purpose</span>
                            {DEVELOPER_CATEGORY_REASON}
                          </div>
                        ))}

                        {expanded && (
                          <div className="border-t border-surface-border/30 px-3 py-2 bg-surface/30">
                            {isEditingSensitive && (
                              <div className="flex items-start gap-2 mb-2 text-xs bg-red-600/10 border border-red-600/20 rounded-lg px-3 py-2">
                                <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                                <div>
                                  <p className="text-red-400 font-medium">Sensitive permission category</p>
                                  <p className="text-gray-500 mt-0.5">Granting all "{cat.label}" permissions gives full administrative control. Review carefully.</p>
                                </div>
                              </div>
                            )}
                            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5`}>
                              {cat.permissions.map(perm => (
                                <label
                                  key={perm}
                                  className={`flex items-center gap-2 py-1 px-1.5 rounded text-xs cursor-pointer transition-colors ${
                                    editing ? "hover:bg-surface-lighter/50" : ""
                                  } ${editPerms.has(perm) ? "text-white" : "text-gray-600"}`}
                                >
                                  {editing ? (
                                    <input
                                      type="checkbox"
                                      checked={editPerms.has(perm)}
                                      onChange={() => togglePerm(perm)}
                                      className="w-3.5 h-3.5 rounded border-gray-600 accent-cyber-500"
                                    />
                                  ) : (
                                    <CheckSquare size={14} className={editPerms.has(perm) ? "text-green-400" : "text-gray-700"} />
                                  )}
                                  <span className="capitalize">{formatPermLabel(perm as Permission)}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Copy from Existing Role Modal */}
      {showCopyRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCopyRole(false)}>
          <div className="card w-full max-w-md mx-4 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Create from Existing Role</h3>
              <button onClick={() => setShowCopyRole(false)} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </div>
            <p className="text-xs text-gray-500">Select a role to copy permissions from, then enter a name for the new role.</p>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {roles.map(r => (
                <button
                  key={r.id}
                  onClick={() => {
                    setNewRole({ name: `${r.name} (Copy)`, systemRole: r.systemRole, permissions: [...r.permissions] });
                    setShowCopyRole(false);
                    setShowCreate(true);
                  }}
                  className="w-full text-left px-4 py-3 rounded-lg hover:bg-surface-lighter/50 transition-colors flex items-center gap-3"
                >
                  <div className={`p-1.5 rounded ${r.isDefault ? "bg-cyber-600/20" : "bg-surface-lighter"}`}>
                    <Shield size={16} className={r.isDefault ? "text-cyber-400" : "text-gray-400"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{r.name}</p>
                    <p className="text-xs text-gray-500">{r.systemRole.replace(/_/g, " ")} · {r.permissions.length} permissions</p>
                  </div>
                  <span className="text-xs text-gray-600">{r._count?.users || 0} users</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2 pt-2 border-t border-surface-border">
              <button onClick={() => setShowCopyRole(false)} className="btn-secondary text-sm flex-1">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Role Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <div className="card w-full max-w-sm mx-4 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Create Role</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </div>
            <input
              className="input-field"
              placeholder="Role name (e.g. Project Manager)"
              value={newRole.name}
              onChange={e => setNewRole({ ...newRole, name: e.target.value })}
              autoFocus
            />
            <select className="input-field" value={newRole.systemRole} onChange={e => setNewRole({ ...newRole, systemRole: e.target.value })}>
              {roleTypes.map(sr => <option key={sr} value={sr}>{sr.replace(/_/g, " ")}</option>)}
            </select>
            <p className="text-xs text-gray-500">The system role type determines the default permission set. You can customize permissions after creation.</p>
            <div className="flex gap-2 pt-2 border-t border-surface-border">
              <button onClick={handleCreateRole} className="btn-primary text-sm flex-1">Create</button>
              <button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Members Modal */}
      {showMembers && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowMembers(false)}>
          <div className="card w-full max-w-lg mx-4 space-y-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-white">Manage Members</h3>
                <p className="text-xs text-gray-500">Assign users to "{selected.name}"</p>
              </div>
              <button onClick={() => setShowMembers(false)} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </div>

            {membersLoading ? (
              <TableSkeleton />
            ) : (
              <>
                {/* Current members */}
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Current Members ({roleMembers.length})
                  </h4>
                  {roleMembers.length === 0 ? (
                    <p className="text-xs text-gray-600 py-2">No users assigned to this role</p>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {roleMembers.map(u => (
                        <div key={u.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-lighter/50">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-full bg-cyber-600/30 text-cyber-400 flex items-center justify-center text-xs font-bold shrink-0">
                              {u.firstName?.[0]}{u.lastName?.[0]}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm text-white truncate">{u.firstName} {u.lastName}</p>
                              <p className="text-xs text-gray-500 truncate">{u.email}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => removeUserFromRole(u.id)}
                            className="text-gray-500 hover:text-red-400 transition-colors p-1 shrink-0"
                            title="Remove from role"
                          >
                            <UserMinus size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add members */}
                <div className="space-y-2 border-t border-surface-border pt-3">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Add Members</h4>
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      className="input-field text-sm pl-8"
                      placeholder="Search users..."
                      value={memberSearch}
                      onChange={e => setMemberSearch(e.target.value)}
                    />
                  </div>
                  {filteredUnassigned.length === 0 ? (
                    <p className="text-xs text-gray-600 py-1">
                      {memberSearch ? "No matching users found" : "All users are already assigned to this role"}
                    </p>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {filteredUnassigned.slice(0, 30).map(u => (
                        <div key={u.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-lighter/50 transition-colors">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-full bg-surface-lighter text-gray-400 flex items-center justify-center text-xs font-bold shrink-0">
                              {u.firstName?.[0]}{u.lastName?.[0]}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm text-white truncate">{u.firstName} {u.lastName}</p>
                              <p className="text-xs text-gray-500 truncate">{u.email}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => addUserToRole(u.id)}
                            className="text-gray-500 hover:text-cyber-400 transition-colors p-1 shrink-0"
                            title="Add to role"
                          >
                            <UserPlus size={16} />
                          </button>
                        </div>
                      ))}
                      {filteredUnassigned.length > 30 && (
                        <p className="text-xs text-gray-600 text-center py-1">Showing 30 of {filteredUnassigned.length} — use search to narrow</p>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="flex gap-2 pt-2 border-t border-surface-border shrink-0">
              <button onClick={() => setShowMembers(false)} className="btn-secondary text-sm flex-1">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
