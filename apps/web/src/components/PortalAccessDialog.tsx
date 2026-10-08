/**
 * What one customer's portal lets them see and do.
 *
 * The instance's own portal settings are the answer for every client that has not been thought
 * about individually, which is most of them. This dialog is for the ones that have: the client who
 * must not have their three hundred staff reading each other's tickets, the one who should go
 * through the phone, the one whose tickets belong on a different queue. Each control can be left on
 * the deployment's answer, so a field only carries a value where somebody actually decided.
 *
 * The people list is the same idea one level down, and it is what the reference platforms do: the
 * office manager who runs the account is given the client's whole ticket list while their
 * colleagues see only their own, and a contractor can be refused the portal without switching the
 * client off. A contact is a person, not a role — portal visitors are not Users here, so there is no
 * role to attach the decision to.
 */
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ExternalLink, Eye, Loader2, MonitorSmartphone, ShieldCheck, UserRound, X } from "lucide-react";
import api from "../api";
import { Chip } from "../pages/Configuration";

type Visibility = "contact" | "company";
type Source = "contact" | "client" | "instance" | "default";

interface Policy {
  visibility: Visibility;
  allowTicketCreation: boolean;
  allowReplies: boolean;
  boardId: string | null;
  boardName?: string | null;
  sources: { visibility: Source; allowTicketCreation: Source; allowReplies: Source; boardId: Source };
}

interface ClientOverrides {
  visibility: Visibility | null;
  allowTicketCreation: boolean | null;
  allowReplies: boolean | null;
  boardId: string | null;
}

interface ContactRow {
  id: string;
  name: string;
  email: string;
  title: string | null;
  isActive: boolean;
  isPrimary: boolean;
  signIns: number;
  overrides: { access: boolean | null; visibility: Visibility | null };
  effective: Visibility;
  allowed: boolean;
}

export interface PortalAccessDialogClient {
  id: string;
  name: string;
  portalEnabled: boolean;
  overrides: ClientOverrides;
  policy: Policy;
}

const SOURCE_LABEL: Record<Source, string> = {
  contact: "this person's own setting",
  client: "this client's setting",
  instance: "the deployment's setting",
  default: "the default, with nothing set",
};

const visibilityLabel = (value: Visibility) =>
  value === "company" ? "Every ticket at their client" : "Only their own tickets";

const yesNo = (value: boolean) => (value ? "Allowed" : "Not allowed");

/**
 * A row of choices where one of them is "whatever the level above says". A plain checkbox cannot
 * express that third state, and without it clearing an override back to the client's default would
 * be impossible from the screen.
 */
function Choice<T extends string | boolean | null>({
  value, options, onChange, disabled, label,
}: {
  value: T;
  options: Array<{ value: T; label: string; hint?: string }>;
  onChange: (next: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={active}
            title={option.hint}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`px-3 py-1.5 rounded-lg border text-xs transition-colors disabled:opacity-40 ${
              active
                ? "border-cyber-500/60 text-cyber-300 bg-cyber-600/10"
                : "border-surface-border text-gray-400 hover:text-gray-200 hover:border-gray-600"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function PortalAccessDialog({
  client, boards, instancePolicy, canEdit, onClose, onSaved, onPreview, portalUrl,
}: {
  client: PortalAccessDialogClient;
  boards: Array<{ id: string; name: string }>;
  instancePolicy: Policy;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onPreview?: () => void;
  /** Where the portal actually is, when the screen that opened this dialog knows. */
  portalUrl?: string;
}) {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingContact, setSavingContact] = useState<string | null>(null);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/configuration/portal/clients/${client.id}/contacts`);
      setContacts(res.data?.contacts ?? []);
    } catch {
      setContacts([]);
      toast.error("Could not read this client's contacts");
    } finally {
      setLoading(false);
    }
  }, [client.id]);

  useEffect(() => { void loadContacts(); }, [loadContacts]);

  const describeFailure = (e: unknown) => {
    const error = (e as { response?: { data?: { error?: { message?: string } | string } } })?.response?.data?.error;
    return typeof error === "string" ? error : error?.message || "That change was refused";
  };

  const patchClient = async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      await api.patch(`/configuration/portal/clients/${client.id}`, body);
      await onSaved();
      toast.success(`${client.name} updated`);
    } catch (e) {
      toast.error(describeFailure(e));
    } finally {
      setSaving(false);
    }
  };

  const patchContact = async (contact: ContactRow, body: Record<string, unknown>) => {
    setSavingContact(contact.id);
    try {
      await api.patch(`/configuration/portal/contacts/${contact.id}`, body);
      await loadContacts();
      toast.success(`${contact.name} updated`);
    } catch (e) {
      toast.error(describeFailure(e));
    } finally {
      setSavingContact(null);
    }
  };

  const instanceVisibility = instancePolicy.visibility;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="card w-full max-w-3xl my-8 space-y-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${client.name} portal access`}
      >
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-lg grid place-items-center bg-surface-lighter shrink-0">
            <ShieldCheck size={17} className="text-cyber-400" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-white truncate">{client.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              What this customer's people see and do in the portal. Anything left alone follows the
              deployment's own portal settings.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-white shrink-0">
            <X size={18} />
          </button>
        </div>

        {!client.portalEnabled && (
          <p className="text-xs text-amber-200 border border-amber-500/30 rounded-lg px-3 py-2">
            This client cannot use the portal at all — portal access is switched off for them. These
            settings take effect when it is switched on.
          </p>
        )}

        {/* ── The client's own policy ── */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-white">This client</h4>
            {saving && <Loader2 size={13} className="animate-spin text-gray-500" />}
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-gray-300">Which tickets they see</span>
              <Chip tone={client.policy.sources.visibility === "client" ? "info" : "muted"}>
                {SOURCE_LABEL[client.policy.sources.visibility]}
              </Chip>
            </div>
            <Choice<Visibility | null>
              label="Which tickets this client sees"
              value={client.overrides.visibility}
              disabled={!canEdit || saving}
              onChange={(next) => void patchClient({ visibility: next })}
              options={[
                { value: null, label: `Deployment default — ${visibilityLabel(instanceVisibility)}`, hint: "Whatever the Portal settings say, now and if they change later" },
                { value: "contact", label: "Only their own tickets", hint: "A ticket they raised, are the contact on, or were added to" },
                { value: "company", label: "Every ticket at this client", hint: "What a one-mailbox small business usually wants" },
              ]}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <span className="text-xs font-medium text-gray-300">Raising tickets</span>
                <Chip tone={client.policy.sources.allowTicketCreation === "client" ? "info" : "muted"}>
                  {SOURCE_LABEL[client.policy.sources.allowTicketCreation]}
                </Chip>
              </div>
              <Choice<boolean | null>
                label="Whether this client may raise tickets"
                value={client.overrides.allowTicketCreation}
                disabled={!canEdit || saving}
                onChange={(next) => void patchClient({ allowTicketCreation: next })}
                options={[
                  { value: null, label: `Default — ${yesNo(instancePolicy.allowTicketCreation)}` },
                  { value: true, label: "Allowed" },
                  { value: false, label: "Not allowed" },
                ]}
              />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <span className="text-xs font-medium text-gray-300">Replying to tickets</span>
                <Chip tone={client.policy.sources.allowReplies === "client" ? "info" : "muted"}>
                  {SOURCE_LABEL[client.policy.sources.allowReplies]}
                </Chip>
              </div>
              <Choice<boolean | null>
                label="Whether this client may reply"
                value={client.overrides.allowReplies}
                disabled={!canEdit || saving}
                onChange={(next) => void patchClient({ allowReplies: next })}
                options={[
                  { value: null, label: `Default — ${yesNo(instancePolicy.allowReplies)}` },
                  { value: true, label: "Allowed" },
                  { value: false, label: "Not allowed" },
                ]}
              />
            </div>
          </div>

          <div className="max-w-sm">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-gray-300">Where their tickets land</span>
              <Chip tone={client.policy.sources.boardId === "client" ? "info" : "muted"}>
                {SOURCE_LABEL[client.policy.sources.boardId]}
              </Chip>
            </div>
            <select
              className="input-field text-sm"
              aria-label="Board for this client's portal tickets"
              disabled={!canEdit || saving}
              value={client.overrides.boardId ?? ""}
              onChange={(e) => void patchClient({ boardId: e.target.value || null })}
            >
              <option value="">
                {instancePolicy.boardName ? `Deployment default — ${instancePolicy.boardName}` : "Deployment default"}
              </option>
              {boards.map((board) => (
                <option key={board.id} value={board.id}>{board.name}</option>
              ))}
            </select>
          </div>

          <p className="text-[11px] text-gray-500">
            A ticket raised here is created by the portal's own system user on{" "}
            <span className="text-gray-400">{client.policy.boardName ?? "the oldest active board"}</span>.
            Visibility decides the ticket list and the ticket detail together: widening it shows every
            ticket belonging to the client, internal notes included never.
          </p>
        </div>

        {/* ── The people ── */}
        <div className="border-t border-surface-border pt-4">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h4 className="text-sm font-semibold text-white">People at this client</h4>
            <Chip tone="muted">{contacts.length}</Chip>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Portal visitors are contacts, not staff accounts, so there is no role to put this on: each
            person either follows the client's settings above or is overruled here.
          </p>

          {loading ? (
            <p className="text-sm text-gray-500 py-4 flex items-center gap-2">
              <Loader2 size={13} className="animate-spin" /> Reading contacts…
            </p>
          ) : contacts.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">This client has no contacts.</p>
          ) : (
            <div className="space-y-2">
              {contacts.map((contact) => (
                <div key={contact.id} className="rounded-lg border border-surface-border p-3 space-y-2.5">
                  <div className="flex flex-wrap items-start gap-2">
                    <UserRound size={14} className="text-gray-500 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white truncate">
                        {contact.name}
                        {contact.isPrimary && <span className="text-[11px] text-gray-500"> · primary</span>}
                      </p>
                      <p className="text-[11px] text-gray-500 truncate">
                        {contact.title ? `${contact.title} · ` : ""}{contact.email}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!contact.isActive && <Chip tone="warn">inactive</Chip>}
                      {contact.signIns > 0 && (
                        <span className="text-[11px] text-gray-500 inline-flex items-center gap-1">
                          <MonitorSmartphone size={11} /> {contact.signIns}
                        </span>
                      )}
                      {savingContact === contact.id && <Loader2 size={13} className="animate-spin text-gray-500" />}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <span className="block text-[11px] text-gray-500 mb-1">May use the portal</span>
                      <Choice<boolean | null>
                        label={`Portal access for ${contact.name}`}
                        value={contact.overrides.access}
                        disabled={!canEdit || savingContact === contact.id}
                        onChange={(next) => void patchContact(contact, { access: next })}
                        options={[
                          { value: null, label: "Follows the client" },
                          { value: true, label: "Allowed" },
                          { value: false, label: "No portal" },
                        ]}
                      />
                    </div>
                    <div>
                      <span className="block text-[11px] text-gray-500 mb-1">
                        Which tickets they see{contact.overrides.visibility === null ? ` — ${visibilityLabel(contact.effective)}` : ""}
                      </span>
                      <Choice<Visibility | null>
                        label={`Ticket visibility for ${contact.name}`}
                        value={contact.overrides.visibility}
                        disabled={!canEdit || savingContact === contact.id}
                        onChange={(next) => void patchContact(contact, { visibility: next })}
                        options={[
                          { value: null, label: "Follows the client" },
                          { value: "contact", label: "Their own" },
                          { value: "company", label: "Everyone's" },
                        ]}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-border pt-4">
          <div className="flex flex-wrap items-center gap-3">
            {onPreview && (
              <button
                type="button"
                className="btn-secondary text-xs inline-flex items-center gap-1.5"
                onClick={onPreview}
              >
                <Eye size={12} /> Preview what they see
              </button>
            )}
            <a
              href={portalUrl || "/portal"}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-cyber-400 hover:text-cyber-300 inline-flex items-center gap-1.5"
            >
              Open the live portal <ExternalLink size={12} />
            </a>
          </div>
          <button type="button" className="btn-secondary text-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
