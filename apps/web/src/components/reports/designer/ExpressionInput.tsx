/**
 * The expression input, and the one thing that needs global state in the designer (PLAN-020).
 *
 * The field and function palettes insert into **the expression you were last typing in**, which is what
 * makes building `IF(Fields.priority = 'high', 'Yes', 'No')` a matter of clicking rather than retyping.
 * A caret cannot be read from React state, so the focused input registers a small inserter here and the
 * palettes call it; when nothing is focused the palettes fall back to the selected element.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

interface ActiveTarget { key: string; insert: (text: string, caretOffset?: number) => void }

let activeTarget: ActiveTarget | null = null;

export function setActiveExpression(key: string, insert: (text: string, caretOffset?: number) => void): void {
  activeTarget = { key, insert };
}
export function clearActiveExpression(key: string): void {
  if (activeTarget?.key === key) activeTarget = null;
}
export function activeExpressionKey(): string | null {
  return activeTarget?.key ?? null;
}
/** Inserts into the focused expression, and says whether it found one. */
export function insertIntoActiveExpression(text: string, caretOffset?: number): boolean {
  if (!activeTarget) return false;
  activeTarget.insert(text, caretOffset);
  return true;
}

export interface ExpressionInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Identifies this input in the registry; must be stable. */
  path: string;
  placeholder?: string;
  multiline?: boolean;
  /** The problem this value has, if any, so the input can explain itself where it is. */
  issue?: string | null;
  className?: string;
  label?: string;
}

export function ExpressionInput({ value, onChange, path, placeholder, multiline, issue, className, label }: ExpressionInputProps) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [focused, setFocused] = useState(false);

  // The registered inserter reads the caret at the moment it is called, not when the field was focused.
  const register = () => {
    const element = ref.current;
    if (!element) return;
    setActiveExpression(path, (text: string, caretOffset?: number) => {
      const start = element.selectionStart ?? element.value.length;
      const end = element.selectionEnd ?? start;
      onChange(element.value.slice(0, start) + text + element.value.slice(end));
      requestAnimationFrame(() => {
        element.focus();
        const caret = start + (caretOffset ?? text.length);
        element.setSelectionRange?.(caret, caret);
      });
    });
  };

  useEffect(() => () => clearActiveExpression(path), [path]);

  const shared = {
    placeholder,
    value,
    spellCheck: false,
    onFocus: () => { setFocused(true); register(); },
    onBlur: () => setFocused(false),
    onClick: register,
    onKeyUp: register,
    className: `w-full bg-surface-light border rounded px-2 py-1 text-xs font-mono text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 ${
      issue ? "border-red-500/60 focus:ring-red-500" : "border-surface-lighter focus:ring-cyber-500"
    } ${className ?? ""}`,
  };

  return (
    <div>
      {label ? <label className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">{label}</label> : null}
      {multiline ? (
        <textarea {...shared} ref={ref as React.RefObject<HTMLTextAreaElement>} rows={3} onChange={event => onChange(event.target.value)} />
      ) : (
        <input {...shared} ref={ref as React.RefObject<HTMLInputElement>} onChange={event => onChange(event.target.value)} />
      )}
      {focused && !issue ? (
        <p className="text-[10px] text-gray-500 mt-1">Click a field or function on the left to insert it here.</p>
      ) : null}
      {issue ? <p className="text-[10px] text-red-400 mt-1">{issue}</p> : null}
    </div>
  );
}

/** Stops the canvas keyboard shortcuts from firing while a designer is typing into a field. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export type { KeyboardEvent };
