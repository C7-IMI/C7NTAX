import type { ReactNode } from "react";
import { AlertTriangle, Check, Copy, X } from "lucide-react";

/**
 * The wizard shell: one overlay, one card, a step rail, and a footer — the shape the OAuth app
 * wizard established, extracted so every other wizard is the same thing rather than a similar one.
 *
 * What is deliberately fixed here is only the frame: how a wizard looks, where its steps are named,
 * and where the error and the actions live. Everything inside a step belongs to the calling wizard,
 * because that is where the difference between connectors actually is.
 */

export function WizardShell({
  icon,
  title,
  subtitle,
  steps,
  step,
  onClose,
  error,
  footer,
  children,
  width = "max-w-3xl",
}: {
  icon: ReactNode;
  title: string;
  subtitle: ReactNode;
  /** Step names, in order. The current one is `steps[step]`. */
  steps: string[];
  step: number;
  onClose: () => void;
  error?: string | null;
  footer: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto" onClick={onClose}>
      <div className={`card w-full ${width} my-6 space-y-4`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span className="text-cyber-400 mt-0.5 shrink-0">{icon}</span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-white">{title}</h2>
              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{subtitle}</p>
            </div>
          </div>
          <button className="text-gray-500 hover:text-gray-300 shrink-0" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Which step, and how far along */}
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          {steps.map((label, index) => (
            <li key={label} className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${
                index === step ? "border-cyber-500 text-white" : index < step ? "border-emerald-600 text-emerald-300" : "border-surface-border text-gray-500"
              }`}>
                {index < step ? <Check size={10} /> : <span className="font-mono">{index + 1}</span>}
                {label}
              </span>
              {index < steps.length - 1 ? <span className="text-gray-700">→</span> : null}
            </li>
          ))}
        </ol>

        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/5 p-3">
            <AlertTriangle size={14} className="text-rose-300 mt-0.5 shrink-0" />
            <p className="text-xs text-rose-200 leading-relaxed">{error}</p>
          </div>
        ) : null}

        {children}

        <div className="flex items-center justify-between gap-3 border-t border-surface-border pt-3">{footer}</div>
      </div>
    </div>
  );
}

/** A selectable card, for a wizard step that offers a choice rather than asking for a value. */
export function Choice({ active, icon, title, onClick, children }: {
  active: boolean; icon: ReactNode; title: string; onClick: () => void; children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-3 transition-colors ${
        active ? "border-cyber-500 bg-cyber-500/5" : "border-surface-border hover:border-gray-600"
      }`}
    >
      <p className={`text-sm font-medium inline-flex items-center gap-2 ${active ? "text-white" : "text-gray-300"}`}>
        <span className={active ? "text-cyber-400" : "text-gray-500"}>{icon}</span>
        {title}
      </p>
      <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">{children}</p>
    </button>
  );
}

/** A labelled row of values, for a wizard's summary screen. */
export function Row({ label, value, onCopy, mono, extra, children }: {
  label: string; value: string; onCopy?: () => void; mono?: boolean; extra?: ReactNode; children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-500 w-44 shrink-0">{label}</p>
      <p className={`text-xs text-gray-200 flex-1 min-w-0 break-all ${mono ? "font-mono" : ""}`}>{value}</p>
      {extra}
      {onCopy ? (
        <button className="text-gray-500 hover:text-gray-300 shrink-0" onClick={onCopy} aria-label={`Copy ${label}`}>
          <Copy size={13} />
        </button>
      ) : null}
      {children}
    </div>
  );
}

export function Label({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-gray-300 mb-1.5">{children}</label>;
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">{children}</p>;
}

/** A panel of facts a step is expected to show — "what this will read", "what it will ask for". */
export function FactPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-light p-3 space-y-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{title}</p>
      {children}
    </div>
  );
}
