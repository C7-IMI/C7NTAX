import { useMemo, useState } from "react";
import { Plus, Save, X } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { templateIcon } from "../lib/kumoIcons";

/** One field of a Kumo asset template, as the API returns it. */
export interface AssetTemplateField {
  id: string;
  key: string;
  label: string;
  fieldType: string;
  required: boolean;
  options?: unknown;
  placeholder?: string | null;
  helpText?: string | null;
  defaultValue?: unknown;
}

/** The asset type a configuration belongs to. */
export interface AssetTemplate {
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  fields?: AssetTemplateField[];
}

/** An existing configuration, when the dialog is editing rather than adding. */
export interface AssetRecord {
  id: string;
  name: string;
  status?: string;
  companyId?: string | null;
  values?: Record<string, unknown>;
}

interface Props {
  template: AssetTemplate;
  /** Present when editing, absent when adding. */
  asset?: AssetRecord | null;
  companies: Array<{ id: string; name: string }>;
  /** The client the dialog was opened from — locked so a record cannot land on the wrong one. */
  clientId?: string;
  onSaved: (asset: AssetRecord) => void;
  onClose: () => void;
}

/** Statuses the rest of the app already understands for a documented asset. */
const STATUSES = ["active", "inactive", "maintenance", "retired"];

/** Free text worth a textarea rather than a single line. */
const MULTILINE = /notes|steps|description|summary|findings|permissions|targets|vlans|static_ips|supported/i;

const optionsOf = (field: AssetTemplateField): string[] => (Array.isArray(field.options) ? field.options as string[] : []);

/** The empty shape each field kind is stored in, so a cleared control sends the right type. */
function emptyFor(fieldType: string): unknown {
  if (fieldType === "boolean") return false;
  if (fieldType === "multi_select") return [];
  return "";
}

/** `1`–`31`/`…` etc. — a date input needs yyyy-mm-dd, the API hands back ISO. */
function dateInputValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString().slice(0, 10);
}

function inputTypeFor(field: AssetTemplateField): string {
  const key = `${field.key} ${field.label}`.toLowerCase();
  if (/url|website|portal|link/.test(key)) return "url";
  if (/email|mail/.test(key)) return "email";
  return "text";
}

function FieldControl({ field, value, onChange }: { field: AssetTemplateField; value: unknown; onChange: (value: unknown) => void }) {
  // Properly associated labels, so the control is announced by name and can be
  // reached by label rather than by position.
  const controlId = `kumo-field-${field.key}`;
  const required = field.required ? <span className="text-red-400">*</span> : null;

  if (field.fieldType === "boolean") {
    return (
      <div className="sm:col-span-2">
        <label className="flex items-center gap-2 cursor-pointer py-1" htmlFor={controlId}>
          <input id={controlId} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span className="text-sm text-gray-300">{field.label} {required}</span>
        </label>
        {field.helpText && <p className="text-[10px] text-gray-600">{field.helpText}</p>}
      </div>
    );
  }

  const label = (
    <label className="text-xs text-gray-500 block mb-1" htmlFor={field.fieldType === "multi_select" ? undefined : controlId}>
      {field.label} {required}
    </label>
  );
  const help = field.helpText ? <p className="text-[10px] text-gray-600 mt-0.5">{field.helpText}</p> : null;
  const options = optionsOf(field);

  if (field.fieldType === "multi_select") {
    const selected = Array.isArray(value) ? value as string[] : [];
    return (
      <div className="sm:col-span-2">
        {label}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {options.map((option) => (
            <label key={option} className="flex items-center gap-1.5 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={(e) => onChange(e.target.checked ? [...selected, option] : selected.filter((v) => v !== option))}
              />
              {option}
            </label>
          ))}
        </div>
        {help}
      </div>
    );
  }

  if (field.fieldType === "select") {
    return (
      <div>
        {label}
        <select id={controlId} className="input-field text-sm" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        {help}
      </div>
    );
  }

  if (field.fieldType === "date") {
    return (
      <div>
        {label}
        <input id={controlId} className="input-field text-sm" type="date" value={dateInputValue(value)} onChange={(e) => onChange(e.target.value)} />
        {help}
      </div>
    );
  }

  if (field.fieldType === "number") {
    return (
      <div>
        {label}
        <input
          id={controlId}
          className="input-field text-sm"
          type="number"
          min={0}
          placeholder={field.placeholder ?? ""}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        />
        {help}
      </div>
    );
  }

  if (MULTILINE.test(`${field.key} ${field.label}`)) {
    return (
      <div className="sm:col-span-2">
        {label}
        <textarea
          id={controlId}
          className="input-field text-sm"
          rows={3}
          placeholder={field.placeholder ?? ""}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
        {help}
      </div>
    );
  }

  return (
    <div>
      {label}
      <input
        className="input-field text-sm"
        id={controlId}
        type={inputTypeFor(field)}
        placeholder={field.placeholder ?? ""}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
      {help}
    </div>
  );
}

/**
 * One configuration dialog for every asset type: the same name/client/status
 * header, then the type's own fields rendered by kind. Adding and editing share
 * it, so a type only ever has to be described once — in its template.
 */
export function KumoAssetDialog({ template, asset, companies, clientId, onSaved, onClose }: Props) {
  const fields = useMemo(() => template.fields ?? [], [template]);
  const Icon = templateIcon(template.icon);
  const lockedClient = clientId || asset?.companyId || "";
  const [name, setName] = useState(asset?.name ?? "");
  const [companyId, setCompanyId] = useState(lockedClient);
  const [status, setStatus] = useState(asset?.status || "active");
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const field of fields) {
      const existing = asset?.values?.[field.key];
      if (existing !== undefined && existing !== null && existing !== "") initial[field.key] = existing;
      else if (field.defaultValue !== undefined && field.defaultValue !== null) initial[field.key] = field.defaultValue;
      else initial[field.key] = emptyFor(field.fieldType);
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const missing = fields.filter((f) => f.required && String(values[f.key] ?? "").trim() === "").map((f) => f.label);
  const clientName = companies.find((c) => c.id === clientId)?.name;
  const scopedToClient = Boolean(clientId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!name.trim() || missing.length > 0) return;
    setSaving(true);
    try {
      const payload = { name: name.trim(), status, companyId: companyId || null, values };
      const res = asset
        ? await api.patch(`/kumo/assets/${asset.id}`, payload)
        : await api.post("/kumo/assets", { ...payload, templateId: template.id });
      toast.success(asset ? "Configuration saved" : `${name.trim()} added`);
      onSaved(res.data as AssetRecord);
      onClose();
    } catch {
      toast.error(asset ? "Could not save the configuration" : "Could not add the configuration");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form className="card w-full max-w-2xl max-h-[88vh] overflow-y-auto space-y-4" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-lg grid place-items-center bg-surface-lighter shrink-0">
            <Icon size={17} style={template.color ? { color: template.color } : undefined} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-white truncate">
              {asset ? `Edit ${template.name}` : `New ${template.name}`}
            </h3>
            <p className="text-xs text-gray-500">
              {[clientName, template.description, `${fields.length} field${fields.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-white shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-1">
            <label className="text-xs text-gray-500 block mb-1" htmlFor="kumo-asset-name">Name <span className="text-red-400">*</span></label>
            <input
              id="kumo-asset-name"
              className="input-field text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${template.name} name`}
              autoFocus
            />
            {submitted && !name.trim() && <p className="text-[10px] text-amber-400 mt-0.5">A name is required.</p>}
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1" htmlFor="kumo-asset-client">Client</label>
            {scopedToClient ? (
              <>
                <input id="kumo-asset-client" className="input-field text-sm opacity-70" value={clientName || "This client"} readOnly disabled />
                <p className="text-[10px] text-gray-600 mt-0.5">Belongs to the organization this type was opened from.</p>
              </>
            ) : (
              <select id="kumo-asset-client" className="input-field text-sm" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">No client</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1" htmlFor="kumo-asset-status">Status</label>
            <select id="kumo-asset-status" className="input-field text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
        </div>

        {fields.length > 0 && (
          <div className="border-t border-surface-border pt-3 space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-600">{template.name} fields</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fields.map((field) => (
                <FieldControl
                  key={field.id}
                  field={field}
                  value={values[field.key]}
                  onChange={(value) => setValues((prev) => ({ ...prev, [field.key]: value }))}
                />
              ))}
            </div>
          </div>
        )}

        {submitted && missing.length > 0 && (
          <p className="text-xs text-amber-400">
            {missing.join(", ")} {missing.length === 1 ? "is" : "are"} required.
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-surface-border pt-3">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary text-sm flex items-center gap-1.5">
            {asset ? <Save size={14} /> : <Plus size={14} />}
            {saving ? "Saving…" : asset ? "Save changes" : `Add ${template.name.replace(/s$/, "")}`}
          </button>
        </div>
      </form>
    </div>
  );
}
