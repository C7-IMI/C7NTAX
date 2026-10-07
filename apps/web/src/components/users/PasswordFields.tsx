import { useMemo, useState } from "react";
import { Eye, EyeOff, Key, Check, X } from "lucide-react";
import { passwordPolicyChecks, passwordStrengthLevel } from "@C7NTAX/shared";
import { generatePassword } from "../../lib/generatePassword";

/** Strength label → colours and how many segments to light up. */
const STRENGTH_STYLES: Record<string, { bar: string; text: string; bars: number }> = {
  "Very Weak": { bar: "bg-red-600", text: "text-red-400", bars: 1 },
  Weak: { bar: "bg-red-500", text: "text-red-400", bars: 1 },
  Fair: { bar: "bg-amber-500", text: "text-amber-400", bars: 2 },
  Good: { bar: "bg-cyan-500", text: "text-cyan-400", bars: 3 },
  Strong: { bar: "bg-green-500", text: "text-green-400", bars: 4 },
  "Very Strong": { bar: "bg-green-500", text: "text-green-400", bars: 4 },
};

/** Four-segment strength bar plus the label, shared by every password surface. */
export function PasswordStrengthMeter({ password, rules }: { password: string; rules?: { label: string; ok: boolean }[] }) {
  if (!password) return null;
  const style = STRENGTH_STYLES[passwordStrengthLevel(password)] ?? STRENGTH_STYLES["Very Weak"]!;
  const failing = (rules ?? []).filter(r => !r.ok).length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="flex gap-1 flex-1" aria-hidden="true">
          {[0, 1, 2, 3].map(i => (
            <span key={i} className={`h-1 flex-1 rounded-full ${i < style.bars ? style.bar : "bg-surface-lighter"}`} />
          ))}
        </div>
        <span className={`text-xs font-medium ${style.text}`}>{passwordStrengthLevel(password)}</span>
      </div>
      {failing > 0 && (
        <p className="text-xs text-gray-500">
          {failing === 1 ? "1 requirement still to meet" : `${failing} requirements still to meet`}
        </p>
      )}
    </div>
  );
}

/** Live checklist of the rules the API enforces in `validatePassword`. */
export function PasswordPolicyChecklist({ password }: { password: string }) {
  const rules = useMemo(() => passwordPolicyChecks(password), [password]);
  return (
    <ul className="space-y-1">
      {rules.map(rule => (
        <li key={rule.label} className={`flex items-center gap-1.5 text-xs ${rule.ok ? "text-green-400" : "text-gray-500"}`}>
          {rule.ok ? <Check size={12} className="shrink-0" /> : <X size={12} className="shrink-0" />}
          <span>{rule.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** A password box with reveal, generate, strength and the policy checklist. */
export function PasswordInput({
  label,
  value,
  onChange,
  placeholder = "Password",
  autoFocus,
  onEnter,
  allowGenerate = true,
  showRules = true,
  hint,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
  allowGenerate?: boolean;
  showRules?: boolean;
  hint?: string;
}) {
  const [visible, setVisible] = useState(false);
  const rules = useMemo(() => passwordPolicyChecks(value), [value]);

  return (
    <div className="space-y-1.5">
      {label && <label className="block text-xs font-medium text-gray-400">{label}</label>}
      <div className="flex gap-1">
        <input
          className="input-field flex-1"
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          autoFocus={autoFocus}
          autoComplete="new-password"
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); } }}
        />
        <button type="button" onClick={() => setVisible(v => !v)} title={visible ? "Hide password" : "Show password"}
          className="btn-secondary text-xs py-1 px-1.5 flex items-center shrink-0">
          {visible ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
        {allowGenerate && (
          <button type="button" onClick={() => onChange(generatePassword())} title="Generate a strong password"
            className="btn-secondary text-xs py-1 px-2 flex items-center gap-1 shrink-0">
            <Key size={12} /> Generate
          </button>
        )}
      </div>
      {value.length > 0 && <PasswordStrengthMeter password={value} rules={rules} />}
      {showRules && value.length > 0 && <PasswordPolicyChecklist password={value} />}
      {hint && value.length === 0 && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
