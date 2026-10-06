import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Mail, Search, X } from "lucide-react";

/** One addressed person — either a stored client contact or a typed-in address. */
export interface Recipient {
  key: string;
  contactId?: string;
  name?: string;
  email: string;
}

export interface RecipientSuggestion {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export const recipientFromContact = (contact: RecipientSuggestion): Recipient => ({
  key: contact.id,
  contactId: contact.id,
  name: [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim(),
  email: contact.email,
});

export const recipientFromEmail = (email: string): Recipient => ({ key: email.toLowerCase(), email });

export const isEmailLike = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/**
 * Address row used by the ticket email dialog and by the note composer.
 *
 * Chips for the people already addressed, with an input that searches the
 * client's contacts as you type and also accepts a bare address, the way OWA
 * and Gmail do. Enter, Tab, comma or blur commits what has been typed;
 * Backspace on an empty input removes the last chip.
 */
export function RecipientField({
  label,
  value,
  onChange,
  suggestions = [],
  placeholder = "Name or email address",
  allowFreeform = true,
  disabled = false,
  action,
  hint,
  excludeEmails = [],
  autoFocus = false,
}: {
  label: string;
  value: Recipient[];
  onChange: (next: Recipient[]) => void;
  suggestions?: RecipientSuggestion[];
  placeholder?: string;
  allowFreeform?: boolean;
  disabled?: boolean;
  action?: ReactNode;
  hint?: ReactNode;
  /** Addresses to keep out of the list (e.g. the primary contact already in To). */
  excludeEmails?: string[];
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const taken = useMemo(() => new Set(value.map((r) => r.email.toLowerCase())), [value]);
  const excluded = useMemo(() => new Set(excludeEmails.map((e) => e.toLowerCase())), [excludeEmails]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return suggestions
      .filter((c) => c.email && !taken.has(c.email.toLowerCase()) && !excluded.has(c.email.toLowerCase()))
      .filter((c) => {
        if (!needle) return true;
        const name = `${c.firstName} ${c.lastName}`.toLowerCase();
        return name.includes(needle) || c.email.toLowerCase().includes(needle);
      })
      .slice(0, 8);
  }, [suggestions, query, taken, excluded]);

  useEffect(() => setHighlight(0), [query]);

  // Clicking anywhere else closes the suggestion list without losing what was typed.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const add = (recipient: Recipient) => {
    if (!recipient.email.trim()) return;
    if (taken.has(recipient.email.toLowerCase())) {
      setQuery("");
      return;
    }
    onChange([...value, recipient]);
    setQuery("");
    setInvalid(false);
    setOpen(false);
  };

  const commitTyped = (raw: string) => {
    const text = raw.trim().replace(/[,;]+$/, "");
    if (!text) return;
    if (!isEmailLike(text)) {
      if (allowFreeform) setInvalid(true);
      return;
    }
    const match = suggestions.find((c) => c.email.toLowerCase() === text.toLowerCase());
    add(match ? recipientFromContact(match) : recipientFromEmail(text));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "Tab" || event.key === ",") {
      if (open && matches[highlight] && event.key !== ",") {
        event.preventDefault();
        add(recipientFromContact(matches[highlight]));
        return;
      }
      if (query.trim()) {
        event.preventDefault();
        commitTyped(query);
      }
      return;
    }
    if (event.key === "ArrowDown" && matches.length) {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => (h + 1) % matches.length);
      return;
    }
    if (event.key === "ArrowUp" && matches.length) {
      event.preventDefault();
      setHighlight((h) => (h - 1 + matches.length) % matches.length);
      return;
    }
    if (event.key === "Backspace" && !query && value.length) {
      onChange(value.slice(0, -1));
      return;
    }
    if (event.key === "Escape") setOpen(false);
  };

  return (
    <div className="flex items-start gap-2">
      <span className="w-14 shrink-0 pt-2 text-xs text-gray-500">{label}</span>
      <div ref={boxRef} className="relative min-w-0 flex-1">
        <div
          className={`flex flex-wrap items-center gap-1.5 rounded-lg border bg-surface-input px-2 py-1.5 ${
            invalid ? "border-amber-500/60" : "border-surface-border"
          } ${disabled ? "opacity-60" : ""}`}
        >
          {value.map((recipient) => (
            <span key={recipient.key} className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-lighter px-2 py-0.5 text-xs text-gray-200">
              {recipient.name ? <span className="truncate font-medium">{recipient.name}</span> : null}
              <span className="truncate text-gray-400">{recipient.email}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((r) => r.key !== recipient.key))}
                  title={`Remove ${recipient.email}`}
                  aria-label={`Remove ${recipient.email}`}
                  className="ml-0.5 rounded-full p-0.5 text-gray-500 hover:bg-surface hover:text-white"
                >
                  <X size={10} />
                </button>
              )}
            </span>
          ))}
          <div className="flex min-w-[8rem] flex-1 items-center gap-1">
            <Search size={12} className="shrink-0 text-gray-600" />
            <input
              className="w-full bg-transparent py-0.5 text-xs text-white outline-none placeholder:text-gray-600"
              value={query}
              placeholder={value.length ? "" : placeholder}
              disabled={disabled}
              autoFocus={autoFocus}
              onChange={(e) => {
                const next = e.target.value;
                // Committing on a separator keeps paste-from-Outlook style lists working.
                if (/[,;]$/.test(next)) {
                  setQuery("");
                  commitTyped(next);
                  return;
                }
                setQuery(next);
                setInvalid(false);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => {
                if (query.trim()) commitTyped(query);
              }}
              onKeyDown={onKeyDown}
              aria-label={label}
            />
          </div>
          {action}
        </div>
        {open && allowFreeform && query.trim() && !isEmailLike(query) && !matches.length && (
          <p className="mt-1 text-[11px] text-amber-400">Keep typing a full address, or pick a contact below.</p>
        )}
        {invalid && isEmailLike(query) === false && (
          <p className="mt-1 text-[11px] text-amber-400">That does not look like an email address.</p>
        )}
        {open && matches.length > 0 && (
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-surface-border bg-surface shadow-xl">
            {matches.map((contact, index) => (
              <button
                key={contact.id}
                type="button"
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(recipientFromContact(contact))}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  index === highlight ? "bg-surface-lighter text-white" : "text-gray-300 hover:bg-surface-lighter"
                }`}
              >
                <Mail size={12} className="shrink-0 text-cyber-400" />
                <span className="truncate font-medium">{[contact.firstName, contact.lastName].filter(Boolean).join(" ")}</span>
                <span className="truncate text-gray-500">{contact.email}</span>
              </button>
            ))}
          </div>
        )}
        {hint ? <p className="mt-1 text-[11px] text-gray-600">{hint}</p> : null}
      </div>
    </div>
  );
}
