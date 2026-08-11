import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Shield, Eye, EyeOff, Search, X, Save, Clock, Edit3, Trash2, Copy, Building2 } from "lucide-react";

export function KumoPasswordsPage() {
  const [passwords, setPasswords] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyFilter, setCompanyFilter] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ label: "", username: "", password: "", email: "", url: "", category: "", companyId: "" });
  const [revealData, setRevealData] = useState<any>(null);
  const [totpSetup, setTotpSetup] = useState<any>(null);
  const [totpCode, setTotpCode] = useState<{code:string;remaining:number} | null>(null);
  const [manualSecret, setManualSecret] = useState("");
  const [manualTotpCode, setManualTotpCode] = useState<{code:string;remaining:number} | null>(null);

  const fetch = async () => {
    try { const r = await api.get("/kumo/passwords"); setPasswords(r.data.data || []); }
    catch { toast.error("Failed to load"); } finally { setLoading(false); }
  };

  useEffect(() => {
    fetch();
    api.get("/clients?limit=100").then(r => setCompanies(r.data.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!manualTotpCode?.enabled) return;
    const timer = setInterval(refreshManualTotp, 30000);
    return () => clearInterval(timer);
  }, [manualTotpCode?.enabled, selected?.id]);

  const filtered = companyFilter ? passwords.filter(p => p.companyId === companyFilter) : passwords;

  const selectPassword = (p: any) => { 
    setSelected(p); setEditing(false); setEditForm({ ...p }); 
    api.post("/kumo/recently-viewed", { entityType: "password", entityId: p.id, entityName: p.label || p.username || p.email, entityIcon: "key" }).catch(() => {});
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post("/kumo/passwords", form); toast.success("Saved"); setShowCreate(false); setForm({ label: "", username: "", password: "", email: "", url: "", category: "", companyId: "" }); fetch(); }
    catch { toast.error("Failed"); }
  };

  const handleSave = async () => {
    try { await api.patch(`/kumo/passwords/${selected.id}`, editForm); toast.success("Updated"); setEditing(false); fetch(); if (selected) selectPassword({ ...selected, ...editForm }); }
    catch { toast.error("Save failed"); }
  };

  const handleReveal = async () => {
    if (!selected) return;
    try {
      const r = await api.post(`/kumo/passwords/${selected.id}/reveal`);
      setRevealData(r.data);
      setTimeout(() => setRevealData(null), 30000);
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || e?.response?.data?.error || e?.message || "Access denied";
      toast.error(typeof msg === "string" ? msg : "Access denied");
    }
  };

  const handleDelete = async () => {
    if (!selected || !confirm("Deactivate?")) return;
    try { await api.delete(`/kumo/passwords/${selected.id}`); toast.success("Deactivated"); setSelected(null); fetch(); }
    catch { toast.error("Failed"); }
  };

  const setupTotp = async () => { try { const r = await api.post(`/kumo/passwords/${selected.id}/totp/setup`); setTotpSetup(r.data); } catch { toast.error("Failed"); } };
  const fetchTotp = async () => { if (!selected) return; try { const r = await api.get(`/kumo/passwords/${selected.id}/totp`); if (r.data.enabled) setTotpCode(r.data); else setTotpCode(null); } catch { setTotpCode(null); } };
  const removeTotp = async () => { try { await api.delete(`/kumo/passwords/${selected.id}/totp`); toast.success("TOTP removed"); setTotpSetup(null); setTotpCode(null); setManualSecret(""); setManualTotpCode(null); fetch(); } catch { toast.error("Failed"); } };

  const saveManualSecret = async () => {
    if (!selected || !manualSecret.trim()) return;
    try {
      const r = await api.post(`/kumo/passwords/${selected.id}/totp/manual`, { secret: manualSecret.trim() });
      setManualTotpCode(r.data);
      toast.success("TOTP secret saved");
    } catch { toast.error("Invalid secret or failed"); }
  };

  const refreshManualTotp = async () => {
    if (!selected) return;
    try { const r = await api.get(`/kumo/passwords/${selected.id}/totp`); if (r.data.enabled) setManualTotpCode(r.data); } catch {}
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h2 className="text-lg font-semibold text-white">Password Vault</h2><p className="text-sm text-gray-400">{filtered.length} passwords</p></div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} /> Add Password</button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><input className="input-field pl-9" placeholder="Search..." onChange={e => {}} /></div>
        <select className="input-field text-sm py-1.5 w-auto" value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}>
          <option value="">All Clients</option>
          {companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Password list */}
        <div className="lg:col-span-1 space-y-1">
          {loading ? <div className="text-center py-8 text-gray-500">Loading...</div> :
           filtered.length === 0 ? <div className="card py-8 text-center text-gray-500 text-sm">No passwords</div> :
           filtered.map(p => (
            <button key={p.id} onClick={() => selectPassword(p)}
              className={`w-full text-left card px-4 py-3 hover:border-cyber-500/30 transition-colors ${selected?.id === p.id ? "border-cyber-500/50 bg-cyber-600/5" : ""}`}>
              <div className="flex items-center gap-2">
                <Shield size={14} className="text-cyber-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{p.label}</p>
                  <p className="text-xs text-gray-500">{p.username || "—"}</p>
                </div>
                <span className="text-xs text-gray-600">{p.category}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-2">
          {!selected ? (
            <div className="card flex items-center justify-center py-16 text-gray-500 text-sm">
              <div className="text-center"><Shield size={40} className="text-gray-600 mx-auto mb-3" /><p>Select a password to view details</p></div>
            </div>
          ) : (
            <div className="card space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-600/10"><Shield size={20} className="text-amber-400" /></div>
                  <div>
                    {editing ? (
                      <input className="input-field text-sm py-1" value={editForm.label || ""} onChange={e => setEditForm({ ...editForm, label: e.target.value })} />
                    ) : (
                      <>
                        <h3 className="text-white font-semibold">{selected.label}</h3>
                        <p className="text-xs text-gray-500">{selected.username || "—"} · {selected.category || "general"}</p>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {editing ? (<>
                    <button onClick={() => setEditing(false)} className="btn-secondary text-xs py-1 px-2"><X size={12} /> Cancel</button>
                    <button onClick={handleSave} className="btn-primary text-xs py-1 px-2"><Save size={12} /> Save</button>
                  </>) : (<>
                    <button onClick={handleReveal} className="btn-primary text-xs py-1 px-2 flex items-center gap-1"><Eye size={12} /> Reveal</button>
                    <button onClick={() => setEditing(true)} className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"><Edit3 size={12} /> Edit</button>
                    <button onClick={handleDelete} className="btn-secondary text-xs py-1 px-2 text-red-400"><Trash2 size={12} /></button>
                  </>)}
                </div>
              </div>

              {revealData && (
                <div className="bg-amber-600/10 border border-amber-500/30 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2"><span className="text-xs text-amber-400 font-medium">Credentials Revealed</span><span className="text-xs text-amber-500 flex items-center gap-1"><Clock size={11} /> Auto-clears 30s</span></div>

              {!totpSetup && !selected.totpEnabled && (
                <button onClick={setupTotp} className="btn-secondary text-xs py-1 px-2 flex items-center gap-1 w-full justify-center"><Shield size={12} /> Setup TOTP</button>
              )}
              {totpSetup && totpSetup.qrcode && (
                <div className="bg-surface-lighter rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-400 mb-2">Scan with authenticator app</p>
                  <img src={totpSetup.qrcode} alt="TOTP QR" className="w-36 h-36 mx-auto rounded-lg bg-white p-1" />
                  <p className="text-xs text-gray-500 mt-2 font-mono select-all">{totpSetup.secret}</p>
                  <button onClick={() => { setTotpSetup(null); fetchTotp(); }} className="btn-primary text-xs mt-2">Done</button>
                </div>
              )}
              {totpCode && totpCode.enabled && (
                <div className="bg-cyber-600/10 border border-cyber-500/30 rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-400">Time-based code</p>
                    <p className="text-xl font-mono font-bold text-cyber-400">{totpCode.code}</p>
                    <p className="text-xs text-gray-500">Refreshes in {totpCode.remaining}s</p>
                  </div>
                  <button onClick={removeTotp} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                </div>
              )}
                  <div className="space-y-2 text-sm">
                    <div><span className="text-xs text-gray-500">Username</span><p className="text-white">{revealData.username || "—"}</p></div>
                    <div><span className="text-xs text-gray-500">Password</span><code className="block bg-black/30 px-3 py-1.5 mt-1 rounded text-green-400 font-mono select-all">{revealData.passwordPlaintext}</code></div>
                  </div>
                </div>
              )}

              {/* Manual TOTP Section */}
              <div className="bg-surface-lighter rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">TOTP Authenticator</p>
                <div className="flex items-center gap-2">
                  <input className="input-field text-sm flex-1 font-mono" placeholder="Enter TOTP secret (base32)"
                    value={manualSecret} onChange={e => setManualSecret(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveManualSecret(); }} />
                  <button onClick={saveManualSecret} className="btn-primary text-xs py-1.5 px-3 shrink-0">Save</button>
                </div>
                {manualTotpCode && manualTotpCode.enabled && (
                  <div className="flex items-center justify-between mt-2">
                    <div>
                      <p className="text-xs text-gray-500">Generated code</p>
                      <p className="text-lg font-mono font-bold text-cyber-400">{manualTotpCode.code}</p>
                    </div>
                    <span className="text-xs text-gray-600">{manualTotpCode.remaining}s</span>
                  </div>
                )}
                <div className="flex gap-2 mt-1">
                  <button onClick={() => { setTotpSetup(null); setupTotp(); }} className="text-xs text-cyber-400 hover:text-cyber-300">Setup via QR code</button>
                  {manualTotpCode?.enabled && <button onClick={() => { setManualSecret(""); setManualTotpCode(null); removeTotp(); }} className="text-xs text-red-400 hover:text-red-300">Remove</button>}
                </div>
              </div>

              {/* Strength + Date */}
              {revealData && (() => {
                const strength = passwordStrength(revealData.passwordPlaintext || "");
                return (
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex-1">
                      <p className="text-gray-500 mb-1">Password Strength</p>
                      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div className={`h-full ${strength.color} rounded-full transition-all`} style={{ width: strength.width + "%" }} />
                      </div>
                      <p className="text-gray-400 mt-0.5">{strength.label}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 mb-1">Last Changed</p>
                      <p className="text-white">{selected.updatedAt ? new Date(selected.updatedAt).toLocaleDateString() : "�"}</p>
                    </div>
                  </div>
                );
              })()}

              <div className={`grid grid-cols-2 gap-3 ${revealData ? "opacity-40" : ""}`}>
                {editing ? (<>
                  <Field label="Username" val={editForm.username} onChange={v => setEditForm({ ...editForm, username: v })} />
                  <Field label="Email" val={editForm.email} onChange={v => setEditForm({ ...editForm, email: v })} />
                  <Field label="URL" val={editForm.url} onChange={v => setEditForm({ ...editForm, url: v })} />
                  <Field label="Category" val={editForm.category} onChange={v => setEditForm({ ...editForm, category: v })} />
                  <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Notes</label><textarea className="input-field text-sm" rows={3} value={editForm.notes || ""} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} /></div>
                </>) : (<>
                  <ReadOnlyField label="Username" value={selected.username} />
                  <ReadOnlyField label="Email" value={selected.email} />
                  <ReadOnlyField label="URL" value={selected.url} />
                  <ReadOnlyField label="Category" value={selected.category} />
                  {selected.notes && <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Notes</label><p className="text-sm text-gray-300 whitespace-pre-wrap">{selected.notes}</p></div>}
                </>)}
              </div>
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <form className="card w-full max-w-md mx-4 space-y-3 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()} onSubmit={handleCreate}>
            <h3 className="text-lg font-semibold text-white">New Password</h3>
            <input className="input-field" placeholder="Label *" value={form.label} onChange={e => setForm({...form, label: e.target.value})} required />
            <div className="grid grid-cols-2 gap-2"><input className="input-field" placeholder="Username" value={form.username} onChange={e => setForm({...form, username: e.target.value})} /><input className="input-field" placeholder="Email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} /></div>
            <input className="input-field" type="password" placeholder="Password *" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required />
            <div className="grid grid-cols-2 gap-2"><input className="input-field" placeholder="URL" value={form.url} onChange={e => setForm({...form, url: e.target.value})} /><input className="input-field" placeholder="Category" value={form.category} onChange={e => setForm({...form, category: e.target.value})} /></div>
            <select className="input-field" value={form.companyId} onChange={e => setForm({...form, companyId: e.target.value})}>
              <option value="">No client</option>
              {companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button><button type="submit" className="btn-primary text-sm">Save</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

function passwordStrength(pw: string): { label: string; color: string; width: number } {
  if (!pw) return { label: "N/A", color: "bg-gray-600", width: 0 };
  let score = 0;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ["Very Weak", "Weak", "Fair", "Good", "Strong", "Very Strong"];
  const colors = ["bg-red-500", "bg-red-400", "bg-amber-400", "bg-amber-300", "bg-green-400", "bg-green-500"];
  return { label: labels[score] || "Strong", color: colors[score] || "bg-green-500", width: Math.min(100, (score + 1) * 16.6) };
}

function ReadOnlyField({ label, value }: { label: string; value: any }) {
  return <div><label className="text-xs text-gray-500 block mb-1">{label}</label><p className="text-sm text-white">{value || "—"}</p></div>;
}
function Field({ label, val, onChange }: { label: string; val: string; onChange: (v: string) => void }) {
  return <div><label className="text-xs text-gray-500 block mb-1">{label}</label><input className="input-field text-sm py-1" value={val || ""} onChange={e => onChange(e.target.value)} /></div>;
}
