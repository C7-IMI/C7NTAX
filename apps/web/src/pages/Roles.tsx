import { useState, useEffect, useCallback } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Shield, Edit3, Trash2, Save, X, AlertTriangle, ChevronDown, ChevronRight, Users, CheckSquare, Copy, UserPlus, UserMinus, Search } from "lucide-react";
import { SystemRole, Permission, PERMISSION_CATEGORIES, ROLE_PERMISSIONS } from "@C7NTAX/shared";

interface RoleRow {
  id: string; name: string; systemRole: string; permissions: string[];
  isDefault: boolean; _count?: { users: number };
}

function formatPermLabel(perm: Permission): string {
  return perm.split(":")[1]!.replace(/_/g, " ");
}

export function RolesPage() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RoleRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [editPerms, setEditPerms] = useState<Set<string>>(new Set());
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

  const fetch = useCallback(async () => {
    try { const r = await api.get("/roles"); setRoles(r.data.data); }
    catch { toast.error("Failed to load roles"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const selectRole = (r: RoleRow) => {
    setSelected(r);
    setEditPerms(new Set(r.permissions));
    setEditName(r.name);
    setEditSystemRole(r.systemRole);
    setEditIsDefault(r.isDefault);
    setEditing(false);
  };

  const startEdit = () => {
    if (!selected) return;
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
    } catch { toast.error("Failed to save"); setSaving(false); }
  };

  const handleCreateRole = async () => {
    if (!newRole.name.trim()) { toast.error("Role name required"); return; }
    try {
      await api.post("/roles", newRole);
      toast.success("Role created");
      setShowCreate(false);
      setNewRole({ name: "", systemRole: "technician", permissions: undefined });
      fetch();
    } catch { toast.error("Failed to create"); }
  };

  const handleDeleteRole = async (id: string) => {
    try {
      await api.delete(`/roles/${id}`);
      toast.success("Role deleted");
      setShowDeleteConfirm(null);
      if (selected?.id === id) setSelected(null);
      fetch();
    } catch { toast.error("Failed to delete"); }
  };

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

  if (loading) return <div className="text-center py-12 text-gray-500">Loading roles...</div>;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Manage Roles</h2>
          <p className="text-sm text-gray-400">{roles.length} roles</p>
        </div>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Role list */}
        <div className="lg:col-span-1 space-y-2">
          <div className="card p-0 overflow-hidden">
            {roles.length === 0 ? (
              <div className="p-6 text-center text-gray-500 text-sm">No roles found</div>
            ) : (
              roles.map(r => (
                <button
                  key={r.id}
                  onClick={() => selectRole(r)}
                  className={`w-full text-left px-4 py-3 border-b border-surface-border/50 last:border-0 transition-colors hover:bg-surface-lighter/50 ${
                    selected?.id === r.id ? "bg-cyber-600/10 border-l-2 border-l-cyber-500" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded ${r.isDefault ? "bg-cyber-600/20" : "bg-surface-lighter"}`}>
                      <Shield size={16} className={r.isDefault ? "text-cyber-400" : "text-gray-400"} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{r.name}</p>
                      <p className="text-xs text-gray-500 capitalize">{r.systemRole.replace(/_/g, " ")}</p>
                    </div>
                    {r._count?.users !== undefined && (
                      <button
                        onClick={(e) => { e.stopPropagation(); selectRole(r); setTimeout(openMembers, 50); }}
                        className="flex items-center gap-1 text-xs font-medium bg-cyber-600/10 text-cyber-400 hover:bg-cyber-600/25 hover:text-cyber-300 px-2 py-0.5 rounded-full transition-colors cursor-pointer"
                        title="Manage role members"
                      >
                        <Users size={10} />
                        {r._count.users}
                      </button>
                    )}
                  </div>
                </button>
              ))
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
                          {Object.values(SystemRole).map(sr => <option key={sr} value={sr}>{sr.replace(/_/g, " ")}</option>)}
                        </select>
                      </div>
                    ) : (
                      <>
                        <h3 className="text-white font-semibold">{selected.name}</h3>
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

              {/* User count banner */}
              {selected._count?.users ? (
                <button
                  onClick={openMembers}
                  className="flex items-center gap-2 text-xs bg-cyber-600/10 hover:bg-cyber-600/20 rounded-lg px-3 py-2 transition-colors cursor-pointer w-full text-left group"
                  title="Manage role members"
                >
                  <Users size={14} className="text-cyber-400" />
                  <span className="text-gray-400"><span className="text-white font-medium">{selected._count.users}</span> user{selected._count.users !== 1 ? "s" : ""} assigned to this role</span>
                  <span className="ml-auto text-gray-600 group-hover:text-cyber-400 transition-colors">Manage →</span>
                </button>
              ) : null}

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
                      <button onClick={() => setEditPerms(new Set(Object.values(Permission)))} className="text-xs text-gray-500 hover:text-white">Select All</button>
                      <button onClick={resetToDefaults} className="text-xs text-cyber-400 hover:text-cyber-300 flex items-center gap-1"><Copy size={10} /> Reset Defaults</button>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  {PERMISSION_CATEGORIES.map(cat => {
                    const allChecked = catAllChecked(cat.permissions);
                    const partial = catPartial(cat.permissions);
                    const expanded = expandedCats.has(cat.key);
                    const hasSensitive = cat.key === "admin" || cat.key === "security";
                    const isEditingSensitive = editing && hasSensitive && allChecked;

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
                          <span className={`text-xs font-medium flex-1 ${hasSensitive && editing ? "text-red-400" : "text-gray-300"}`}>
                            {cat.label}
                            {hasSensitive && editing && <AlertTriangle size={11} className="inline ml-1 text-red-400" />}
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
              {Object.values(SystemRole).map(sr => <option key={sr} value={sr}>{sr.replace(/_/g, " ")}</option>)}
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
              <div className="text-center py-8 text-gray-500">Loading...</div>
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
