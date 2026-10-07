import { useEffect, useMemo, useState } from "react";
import api from "../../api";
import toast from "react-hot-toast";
import { AlertTriangle, Check, Copy, KeyRound, Mail, UserPlus, X } from "lucide-react";
import { validatePassword } from "@C7NTAX/shared";
import { copyText } from "../../lib/menuActions";
import { localTimezone, timezoneOptions } from "../../lib/timezones";
import { PasswordInput } from "./PasswordFields";

export interface RoleOption { id: string; name: string; systemRole: string; permissions: string[] }
export interface ClientOption { id: string; name: string }
export interface UserOption {
  id: string; email: string; firstName: string | null; lastName: string | null;
  department?: string | null; timezone?: string | null; companyId?: string | null;
  role?: { id: string; name: string; systemRole: string; permissions: string[] };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  roles: RoleOption[];
  clients: ClientOption[];
  users: UserOption[];
  /** Prefill, e.g. when the list menu was used to copy an existing user. */
  defaults?: { roleId?: string; companyId?: string; department?: string; timezone?: string; fromName?: string };
}

type CredentialMode = "generate" | "set" | "invite";

interface Values {
  firstName: string; lastName: string; email: string; username: string;
  title: string; phone: string; mobile: string;
  companyId: string; department: string; timezone: string; reportsToId: string;
  roleId: string; isActive: boolean;
  credentialMode: CredentialMode; password: string; requireChange: boolean; sendEmail: boolean;
}

const EMPTY: Values = {
  firstName: "", lastName: "", email: "", username: "",
  title: "", phone: "", mobile: "",
  companyId: "", department: "", timezone: "", reportsToId: "",
  roleId: "", isActive: true,
  credentialMode: "generate", password: "", requireChange: true, sendEmail: false,
};

/** Short list used only if the browser cannot enumerate time zones. */
const TABS = ["Profile", "Access", "Credentials"] as const;

/**
 * New User — the Autotask "Resource" / Asio "Member" equivalent: identity,
 * placement and role on separate tabs, and an explicit choice about how the
 * first password reaches the person.
 */
export function NewUserDialog({ open, onClose, onCreated, roles, clients, users, defaults }: Props) {
  const [tab, setTab] = useState<number>(0);
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ temporaryPassword?: string; mustChangePassword: boolean; emailed: boolean; emailError?: string; email: string } | null>(null);

  const timezones = useMemo(() => timezoneOptions(), []);

  useEffect(() => {
    if (!open) return;
    setTab(0);
    setErrors({});
    setResult(null);
    setValues({
      ...EMPTY,
      timezone: localTimezone(),
      roleId: defaults?.roleId ?? roles.find(r => r.systemRole === "technician")?.id ?? roles[0]?.id ?? "",
      companyId: defaults?.companyId ?? "",
      department: defaults?.department ?? "",
    });
    // `roles` and `defaults` are stable for a given open; re-running on them would clear typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues(v => ({ ...v, [key]: value }));
    if (errors[key as string]) setErrors(e => { const next = { ...e }; delete next[key as string]; return next; });
  };

  const selectedRole = roles.find(r => r.id === values.roleId);

  const applyTemplate = (userId: string) => {
    const source = users.find(u => u.id === userId);
    if (!source) return;
    setValues(v => ({
      ...v,
      roleId: source.role?.id ?? v.roleId,
      companyId: source.companyId ?? v.companyId,
      department: source.department ?? v.department,
      timezone: source.timezone ?? v.timezone,
    }));
    toast.success(`Copied access settings from ${source.firstName ?? source.email}`);
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!values.firstName.trim()) next.firstName = "First name is required";
    if (!values.lastName.trim()) next.lastName = "Last name is required";
    if (!values.email.trim()) next.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) next.email = "Enter a valid email address";
    if (!values.roleId) next.roleId = "Choose a role";
    if (values.credentialMode === "set") {
      const problem = validatePassword(values.password, { email: values.email, firstName: values.firstName, lastName: values.lastName });
      if (problem) next.password = problem;
    }
    setErrors(next);
    const keys = Object.keys(next);
    if (keys.length === 0) return true;
    setTab(keys.some(k => k === "roleId") ? 1 : keys.some(k => k === "password") ? 2 : 0);
    return false;
  };

  const submit = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      const res = await api.post("/users", {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        email: values.email.trim(),
        username: values.username.trim() || undefined,
        title: values.title || undefined,
        phone: values.phone || undefined,
        mobile: values.mobile || undefined,
        department: values.department || undefined,
        timezone: values.timezone || undefined,
        reportsToId: values.reportsToId || undefined,
        companyId: values.companyId || undefined,
        roleId: values.roleId,
        isActive: values.isActive,
        credentialMode: values.credentialMode,
        password: values.credentialMode === "set" ? values.password : undefined,
        requireChange: values.requireChange,
        sendEmail: values.sendEmail,
      });
      onCreated();
      setResult({
        temporaryPassword: res.data.temporaryPassword,
        mustChangePassword: !!res.data.mustChangePassword,
        emailed: !!res.data.emailed,
        emailError: res.data.emailError,
        email: res.data.email,
      });
    } catch (e: any) {
      const message = e?.response?.data?.error?.message || "Could not create the user";
      if (/already in use/i.test(message)) {
        setErrors({ [message.toLowerCase().includes("username") ? "username" : "email"]: message });
        setTab(0);
      }
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const close = () => { setValues(EMPTY); setErrors({}); setResult(null); onClose(); };
  const addAnother = () => {
    setResult(null);
    setErrors({});
    setTab(0);
    // Keep the role, client and placement so a batch of similar users is quick to enter.
    setValues(v => ({ ...EMPTY, roleId: v.roleId, companyId: v.companyId, department: v.department, timezone: v.timezone, credentialMode: v.credentialMode, requireChange: v.requireChange }));
  };

  const name = `${values.firstName} ${values.lastName}`.trim();
  const selectedClient = clients.find(c => c.id === values.companyId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={close}>
      <div role="dialog" aria-modal="true" aria-label="New user" onClick={e => e.stopPropagation()}
        className="card w-full max-w-3xl space-y-4 max-h-[92vh] overflow-y-auto">

        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <UserPlus size={20} className="text-cyber-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-lg font-semibold text-white">New User</h3>
              <p className="text-xs text-gray-400">
                {result ? "Account created" : "Give someone sign-in access, then set their role and first password."}
              </p>
            </div>
          </div>
          <button onClick={close} className="text-gray-500 hover:text-white"><X size={18} /></button>
        </div>

        {result ? (
          <div className="space-y-3">
            <div className="bg-green-600/10 border border-green-500/30 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                <Check size={15} /> User created
              </div>
              {result.temporaryPassword ? (
                <>
                  <p className="text-xs text-gray-400">
                    Give this temporary password to {name}. It is shown once and cannot be retrieved later.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-black/40 border border-surface-border rounded px-3 py-2 text-sm text-cyber-300 font-mono break-all">{result.temporaryPassword}</code>
                    <button onClick={() => void copyText(result.temporaryPassword!, "Password")}
                      className="btn-secondary text-xs py-1.5 px-2 flex items-center gap-1 shrink-0">
                      <Copy size={12} /> Copy
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-gray-400">
                  The password was emailed to {result.email} and is not shown here.
                </p>
              )}
            </div>
            <ul className="text-xs text-gray-400 space-y-1">
              {result.emailed && <li className="flex items-center gap-1.5"><Mail size={12} className="text-green-400" /> Emailed to {result.email}</li>}
              {result.emailError && <li className="flex items-start gap-1.5 text-amber-300"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> Email not sent ({result.emailError}) — hand over the password{result.temporaryPassword ? " above" : " from a reset"}</li>}
              {result.mustChangePassword && <li className="flex items-center gap-1.5"><KeyRound size={12} className="text-green-400" /> Asked to choose their own password at the first sign-in</li>}
            </ul>
            <div className="flex items-center justify-between pt-1">
              <button onClick={addAnother} className="btn-secondary text-sm">Create another</button>
              <button onClick={close} className="btn-primary text-sm">Done</button>
            </div>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex gap-1 border-b border-surface-border">
              {TABS.map((label, i) => (
                <button key={label} type="button" onClick={() => setTab(i)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === i ? "border-cyber-400 text-cyber-400" : "border-transparent text-gray-500 hover:text-white"}`}>
                  {label}
                  {(label === "Profile" && (errors.firstName || errors.lastName || errors.email)) ||
                   (label === "Access" && errors.roleId) ||
                   (label === "Credentials" && errors.password)
                    ? <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-red-500 align-middle" /> : null}
                </button>
              ))}
            </div>

            {/* ── Profile ── */}
            {tab === 0 && (
              <div className="space-y-4">
                {defaults?.fromName && (
                  <p className="text-xs text-gray-400 bg-cyber-600/10 border border-cyber-500/30 rounded-lg px-3 py-2">
                    Access settings copied from {defaults.fromName}. Enter the new person's own details below.
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="First name" required value={values.firstName} error={errors.firstName} autoFocus
                    onChange={v => set("firstName", v)} />
                  <Field label="Last name" required value={values.lastName} error={errors.lastName}
                    onChange={v => set("lastName", v)} />
                  <Field label="Email" required type="email" value={values.email} error={errors.email}
                    placeholder="name@company.com" onChange={v => set("email", v)} />
                  <Field label="Username" value={values.username} error={errors.username}
                    hint="Alternative to signing in with the email address" onChange={v => set("username", v)} />
                  <Field label="Job title" value={values.title} onChange={v => set("title", v)} />
                  <Field label="Department" value={values.department} placeholder="Service Desk"
                    onChange={v => set("department", v)} />
                  <Field label="Phone" value={values.phone} onChange={v => set("phone", v)} />
                  <Field label="Mobile" value={values.mobile} onChange={v => set("mobile", v)} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-400">Client</label>
                    <select className="input-field text-sm" value={values.companyId} onChange={e => set("companyId", e.target.value)}>
                      <option value="">Internal staff — no client</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <p className="text-xs text-gray-500">
                      {selectedClient ? `Client contact at ${selectedClient.name}` : "An employee of your own organisation"}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-400">Time zone</label>
                    <select className="input-field text-sm" value={values.timezone} onChange={e => set("timezone", e.target.value)}>
                      {values.timezone && !timezones.includes(values.timezone) && <option value={values.timezone}>{values.timezone}</option>}
                      {timezones.map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-400">Reports to</label>
                    <select className="input-field text-sm" value={values.reportsToId} onChange={e => set("reportsToId", e.target.value)}>
                      <option value="">Nobody</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* ── Access ── */}
            {tab === 1 && (
              <div className="space-y-4">
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-1.5">
                    <label className="block text-xs font-medium text-gray-400">Start from an existing user</label>
                    <select className="input-field text-sm" value="" onChange={e => e.target.value && applyTemplate(e.target.value)}>
                      <option value="">— Copy access settings from… —</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>
                          {`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email} — {u.role?.name ?? "no role"}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-gray-400">Role <span className="text-red-400">*</span></label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {roles.map(r => {
                      const selected = values.roleId === r.id;
                      return (
                        <button key={r.id} type="button" onClick={() => set("roleId", r.id)}
                          className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${selected ? "border-cyber-500/60 bg-cyber-600/15" : "border-surface-border hover:border-cyber-500/30"}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-sm font-medium ${selected ? "text-white" : "text-gray-300"}`}>{r.name}</span>
                            {selected && <Check size={14} className="text-cyber-400 shrink-0" />}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5 capitalize">
                            {r.systemRole.replace(/_/g, " ")} · {(r.permissions?.length ?? 0)} permissions
                          </p>
                        </button>
                      );
                    })}
                  </div>
                  {errors.roleId && <p className="text-xs text-red-400">{errors.roleId}</p>}
                  {selectedRole && (
                    <p className="text-xs text-gray-500 pt-0.5">
                      {name || "This user"} will have the {selectedRole.permissions.length} permissions of the{" "}
                      {selectedRole.name} role. Individual permissions can be fine-tuned on the Permissions tab after creating.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-400">Account status</p>
                  <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
                    <input type="radio" checked={values.isActive} onChange={() => set("isActive", true)} className="mt-0.5 accent-cyber-500" />
                    <span>Active — can sign in as soon as the password is set</span>
                  </label>
                  <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
                    <input type="radio" checked={!values.isActive} onChange={() => set("isActive", false)} className="mt-0.5 accent-cyber-500" />
                    <span>Inactive — record created but sign-in blocked until activated</span>
                  </label>
                </div>
              </div>
            )}

            {/* ── Credentials ── */}
            {tab === 2 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                  {([
                    ["generate", "Generate a password", "You see it once and hand it over"],
                    ["set", "Set a password", "Type the password yourself"],
                    ["invite", "Email it to them", "They get it in their inbox, you don't see it"],
                  ] as const).map(([mode, label, hint]) => (
                    <button key={mode} type="button" onClick={() => set("credentialMode", mode)}
                      className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${values.credentialMode === mode ? "border-cyber-500/60 bg-cyber-600/15" : "border-surface-border hover:border-cyber-500/30"}`}>
                      <span className={`block text-sm font-medium ${values.credentialMode === mode ? "text-white" : "text-gray-300"}`}>{label}</span>
                      <span className="block text-xs text-gray-500 mt-0.5">{hint}</span>
                    </button>
                  ))}
                </div>

                {values.credentialMode === "set" && (
                  <PasswordInput label="Password" value={values.password} onChange={v => set("password", v)} showRules />
                )}
                {values.credentialMode === "generate" && (
                  <p className="text-xs text-gray-500">
                    A 20-character password is created when you press Create User and shown to you once.
                  </p>
                )}
                {values.credentialMode === "invite" && (
                  <p className="text-xs text-gray-500">
                    A 20-character password is created and emailed to {values.email || "the address above"}. Requires SMTP
                    to be configured; if the email fails, the password is shown here instead.
                  </p>
                )}
                {errors.password && <p className="text-xs text-red-400">{errors.password}</p>}

                <div className="space-y-2 pt-1">
                  <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={values.credentialMode === "invite" ? true : values.requireChange}
                      disabled={values.credentialMode === "invite"}
                      onChange={e => set("requireChange", e.target.checked)} className="mt-0.5 rounded accent-cyber-500 disabled:opacity-50" />
                    <span>Require a new password at the first sign-in{values.credentialMode === "invite" && <span className="text-gray-500"> — always on for email invitations</span>}</span>
                  </label>
                  {values.credentialMode !== "invite" && (
                    <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={values.sendEmail} onChange={e => set("sendEmail", e.target.checked)} className="mt-0.5 rounded accent-cyber-500" />
                      <span>Also email these sign-in details to the user</span>
                    </label>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-surface-border">
              <p className="text-xs text-gray-500">
                {tab < TABS.length - 1 && (
                  <button type="button" onClick={() => setTab(tab + 1)} className="text-cyber-400 hover:underline">
                    Next: {TABS[tab + 1]} →
                  </button>
                )}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={close} className="btn-secondary text-sm">Cancel</button>
                <button type="button" onClick={submit} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
                  {busy ? "Creating…" : "Create User"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Labelled input with room underneath for an error or a hint. */
function Field({ label, value, onChange, error, hint, type = "text", required, placeholder, autoFocus }: {
  label: string; value: string; onChange: (value: string) => void;
  error?: string; hint?: string; type?: string; required?: boolean; placeholder?: string; autoFocus?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-gray-400">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <input className={`input-field ${error ? "border-red-500/60" : ""}`} type={type} value={value} placeholder={placeholder}
        autoFocus={autoFocus} onChange={e => onChange(e.target.value)} />
      {error ? <p className="text-xs text-red-400">{error}</p> : hint ? <p className="text-xs text-gray-500">{hint}</p> : null}
    </div>
  );
}
