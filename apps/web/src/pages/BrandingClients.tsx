/**
 * `/admin/branding/clients` — **Case by case**: the clients that are their own legal entity and are
 * invoiced under their own name.
 *
 * This is the second half of the owner's request — "change the branding globally **or** on a case by case
 * basis" — and it is deliberately the *narrow* half. A client's brand is a **patch over the instance's**
 * (`BrandOverride`), not a second brand: a field left empty means "inherit the instance's", and the two
 * can therefore never disagree about the parts nobody overrode. That is why the form is a list of boxes
 * whose empty state is a *stated* one rather than a blank, and why clearing a box is a way of saying
 * "inherit" rather than a way of deleting something.
 *
 * **What a client's override reaches.** The documents addressed to that client: its invoices, quotes and
 * statements, and the documents produced for it. Everything the form does not contain — the interface,
 * every other client's paper — is untouched, and the specimen invoice beside the form is there to make
 * that visible rather than to be taken on trust.
 *
 * Two facts about the API shape the screen, and both are said on it rather than left to be discovered:
 * a client with no logo of its own **wears its portal logo** (`inheritedLogo: "portal"`), which is why
 * that client's file picker starts empty with the reason beside it; and the portal's accent colour is
 * resolved the same way but with no flag to say so (see `ownOverrideKeys`).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Loader2, Search, Users, X } from "lucide-react";
import type { BrandKit, BrandOverride, DocumentPresentation } from "@C7NTAX/shared";
import { Permission } from "@C7NTAX/shared";
import { PageHeader } from "../components/ui";
import { Band, LoadingBlock, StateChip, UnavailablePanel } from "../components/email/emailChrome";
import { useAuth } from "../hooks/useAuth";
import { useRedesign } from "../hooks/useNavigationStyle";
import {
  UPLOAD_ACCEPT,
  UPLOAD_TYPES_SENTENCE,
  clientDiffers,
  ownOverrideKeys,
  saveClientOverride,
  uploadLimitSentence,
  useBrand,
  useBrandClients,
  useLastGood,
  type BrandResponse,
  type ClientBrandRow,
} from "../components/brand/brandApi";
import { useBrandUpload } from "../components/brand/BrandAssetField";
import { BrandLinks, BrandWriteError, PreviewPanel, useBrandWrite } from "../components/brand/brandChrome";
import {
  previewBrand,
  specimenBlocks,
  specimenFooterLeft,
  specimenMetaLine,
} from "../components/brand/brandPreview";

const SCREEN = "/admin/branding/clients";

/** The same sentence `Layout.tsx`'s `SECTION_DESCRIPTIONS` carries for this route. */
export const BRAND_CLIENTS_SUBTITLE =
  "The clients invoiced under their own name — a patch over the instance's brand, nothing else about the document changed.";

const INHERIT_RULE =
  "An empty box means this client inherits the instance's value, and the chip beside the field says so. Clearing a box is how a value goes back to being inherited; nothing is deleted, because nothing was copied.";

/** The ten fields a client may override, in the order the form reads them. */
interface OverrideField {
  key: keyof BrandOverride;
  label: string;
  help: string;
  kind: "text" | "lines" | "colour" | "image";
}

const OVERRIDE_FIELDS: OverrideField[] = [
  { key: "companyName", label: "Company name", help: "The legal entity this client is invoiced as.", kind: "text" },
  { key: "tagline", label: "Tagline", help: "One line under the name, where this client has one.", kind: "text" },
  { key: "logoUrl", label: "Logo", help: "This client's lockup, for the documents addressed to it.", kind: "image" },
  { key: "iconUrl", label: "Icon", help: "This client's square mark, where a document asks for one.", kind: "image" },
  { key: "contactLine", label: "Contact line", help: "The phone number and address as they should read on this client's paper.", kind: "text" },
  { key: "addressLines", label: "Postal address", help: "One line each, printed in the footer of a document that is posted.", kind: "lines" },
  { key: "primaryColor", label: "Primary colour", help: "The accent on this client's documents. It has to be readable on white.", kind: "colour" },
  { key: "accentColor", label: "Accent colour", help: "The interface and email secondary colour. Not printed on paper.", kind: "colour" },
  { key: "documentFooter", label: "Document footer", help: "The sentence at the foot of this client's documents — payment terms, a confidentiality line.", kind: "text" },
  { key: "legalText", label: "Legal text", help: "This client's small print.", kind: "text" },
];

type ClientDraft = Record<string, string>;

/** The draft, seeded only from the keys that are genuinely this client's own. */
function draftFromClient(row: ClientBrandRow): ClientDraft {
  const own = new Set(ownOverrideKeys(row.override, row.inheritedLogo));
  const draft: ClientDraft = {};
  for (const field of OVERRIDE_FIELDS) {
    const value = row.override?.[field.key as keyof BrandOverride];
    if (!own.has(field.key)) {
      draft[field.key] = "";
      continue;
    }
    if (field.key === "addressLines") {
      draft[field.key] = Array.isArray(value) ? (value as string[]).join("\n") : "";
    } else {
      draft[field.key] = value === null || value === undefined ? "" : String(value);
    }
  }
  return draft;
}

/** The draft as the patch the API expects: only the boxes with something in them. */
function overrideFromDraft(draft: ClientDraft): BrandOverride {
  const patch: BrandOverride = {};
  for (const field of OVERRIDE_FIELDS) {
    const raw = (draft[field.key] ?? "").trim();
    if (field.key === "addressLines") {
      const lines = (draft.addressLines ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length) patch.addressLines = lines;
    } else if (raw) {
      Object.assign(patch, { [field.key]: raw });
    }
  }
  return patch;
}

/** The instance's own value for a field, so an empty box can say what it is inheriting. */
function instanceValue(kit: BrandKit, field: OverrideField): string {
  const value = kit[field.key as keyof BrandKit];
  if (field.key === "addressLines") return Array.isArray(value) ? (value as string[]).join(", ") : "";
  return value === null || value === undefined ? "" : String(value);
}

export function BrandingClientsPage() {
  const redesign = useRedesign();
  const brand = useBrand();
  const clients = useBrandClients();
  const { permissions } = useAuth();
  const canManage = permissions.includes(Permission.BrandingManage);
  const { saving, error, run } = useBrandWrite();

  const [query, setQuery] = useState("");
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ClientDraft | null>(null);

  const kit: BrandResponse | null = useLastGood(brand);
  const rows: ClientBrandRow[] = useLastGood(clients)?.clients ?? [];
  const chosen = rows.find((row) => row.id === chosenId) ?? null;
  const rereadFailed = brand.status === "unavailable" || clients.status === "unavailable";

  const closeEditor = useCallback(() => {
    setChosenId(null);
    setDraft(null);
  }, []);

  const openClient = useCallback((row: ClientBrandRow) => {
    setChosenId(row.id);
    setDraft(draftFromClient(row));
  }, []);

  const save = async () => {
    if (!canManage || !chosen || !draft) return;
    const patch = overrideFromDraft(draft);
    const count = Object.keys(patch).length;
    const result = await run(
      count ? `${chosen.name}'s brand saved` : `${chosen.name} goes back to inheriting`,
      () => saveClientOverride(chosen.id, patch),
    );
    if (result) {
      closeEditor();
      clients.reload();
    }
  };

  const remove = async () => {
    if (!canManage || !chosen) return;
    const result = await run(`${chosen.name} goes back to the instance's brand`, () =>
      saveClientOverride(chosen.id, {}),
    );
    if (result) {
      closeEditor();
      clients.reload();
    }
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.name.toLowerCase().includes(needle) ||
        (row.legalName ?? "").toLowerCase().includes(needle),
    );
  }, [rows, query]);

  const at = useMemo(() => new Date(), []);
  const blocks = useMemo(() => specimenBlocks("invoice"), []);

  /**
   * The invoice family's presentation, which a client's override does **not** change: a client's brand is
   * about whose name is on the paper, not about which paper or letterhead. The preview passes it so the
   * specimen is the document this client actually receives.
   */
  const invoicePresentation: Partial<DocumentPresentation> | null =
    kit?.documents.find((row) => row.family === "invoice")?.presentation ?? null;

  const previewOverride: BrandOverride | null = useMemo(
    () => (draft ? overrideFromDraft(draft) : chosen?.override ?? null),
    [draft, chosen],
  );
  const preview = useMemo(
    () =>
      kit
        ? previewBrand({
            kit,
            family: "invoice",
            override: previewOverride,
            presentation: invoicePresentation ?? undefined,
          })
        : null,
    [kit, previewOverride, invoicePresentation],
  );

  const differing = rows.filter(clientDiffers).length;

  if (clients.status === "loading" && !rows.length) {
    return (
      <div className="space-y-4">
        <PageHeader title="Branding — Clients" icon={<Users size={16} className="text-cyber-400" />} subtitle={BRAND_CLIENTS_SUBTITLE} />
        <LoadingBlock label="the client list" />
      </div>
    );
  }

  if (clients.status === "unavailable" || !kit) {
    return (
      <div className="space-y-4">
        <PageHeader title="Branding — Clients" icon={<Users size={16} className="text-cyber-400" />} subtitle={BRAND_CLIENTS_SUBTITLE} />
        <UnavailablePanel
          message={clients.message ?? brand.message ?? "The client list could not be read."}
          onRetry={() => {
            clients.reload();
            brand.reload();
          }}
          what="A client's brand is a patch over the instance's, so both reads are needed before this screen can show what any client is inheriting."
        />
      </div>
    );
  }

  const editorFor = (row: ClientBrandRow) => (
    <div className="space-y-3">
      <p className="rounded-lg border border-surface-border bg-surface-light px-3 py-2 text-[11.5px] text-gray-400">{INHERIT_RULE}</p>
      {row.inheritedLogo === "portal" ? (
        <Band tone="warn" title="This client is wearing its portal logo">
          Its client portal has a logo of its own and no document logo was set here, so the portal logo is what
          its documents and messages currently wear. The picker below starts empty on purpose: choosing a file
          here replaces the portal logo on documents only.
        </Band>
      ) : null}
      <div className="space-y-2.5">
        {OVERRIDE_FIELDS.map((field) => {
          const value = draft?.[field.key] ?? "";
          const set = value.trim().length > 0;
          return (
            <div key={field.key} className="rounded-xl border border-surface-border bg-surface-light px-3.5 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <label className="text-xs font-semibold text-white" htmlFor={`client-${field.key}`}>
                  {field.label}
                </label>
                {set ? <StateChip tone="on">set for this client</StateChip> : <StateChip tone="neutral">the instance's</StateChip>}
              </div>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">{field.help}</p>
              <div className="mt-2">
                {field.kind === "image" ? (
                  <ClientImageField
                    kind={field.key === "iconUrl" ? "icon" : "logo"}
                    value={value}
                    disabled={!canManage || saving}
                    onChange={(url) => setDraft((now) => ({ ...(now ?? {}), [field.key]: url ?? "" }))}
                  />
                ) : field.kind === "lines" ? (
                  <textarea
                    id={`client-${field.key}`}
                    rows={3}
                    className="input-field"
                    value={value}
                    disabled={!canManage || saving}
                    placeholder={`Inherited — ${instanceValue(kit, field) || "nothing is set on the instance either"}`}
                    onChange={(event) => setDraft((now) => ({ ...(now ?? {}), [field.key]: event.target.value }))}
                  />
                ) : field.kind === "colour" ? (
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-8 w-8 shrink-0 rounded-lg border border-surface-border" style={{ background: value || "transparent" }} />
                    <input
                      id={`client-${field.key}`}
                      className="input-field font-mono"
                      value={value}
                      disabled={!canManage || saving}
                      placeholder={instanceValue(kit, field)}
                      spellCheck={false}
                      onChange={(event) => setDraft((now) => ({ ...(now ?? {}), [field.key]: event.target.value }))}
                    />
                  </div>
                ) : (
                  <input
                    id={`client-${field.key}`}
                    className="input-field"
                    value={value}
                    disabled={!canManage || saving}
                    placeholder={`Inherited — ${instanceValue(kit, field) || "nothing is set on the instance either"}`}
                    onChange={(event) => setDraft((now) => ({ ...(now ?? {}), [field.key]: event.target.value }))}
                  />
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <p className="text-[11px] text-gray-600">
                  {set ? "This client's own value." : `Inherited from the instance: ${instanceValue(kit, field) || "nothing is set on the instance either"}`}
                </p>
                {set ? (
                  <button
                    type="button"
                    className="chip"
                    disabled={!canManage || saving}
                    onClick={() => setDraft((now) => ({ ...(now ?? {}), [field.key]: "" }))}
                  >
                    <X size={11} />
                    Inherit instead
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {!canManage ? <Band tone="warn" title="Read only">Changing a client's brand is branding:manage, which this account does not hold.</Band> : null}
      <BrandWriteError message={error} />
    </div>
  );

  if (redesign) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Branding — Clients"
          icon={<Users size={16} className="text-cyber-400" />}
          subtitle={BRAND_CLIENTS_SUBTITLE}
          actions={<BrandLinks current={SCREEN} />}
        />

        <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] xl:items-start">
          <div className="min-w-0 space-y-3.5">
            <PageHeader
              variant="section"
              title="Who is invoiced under their own name"
              subtitle={`${differing} of ${rows.length} clients differ from the instance. Every one of them inherits the rest.`}
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-0 flex-1 sm:max-w-xs">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  className="input-field pl-8"
                  placeholder="Find a client"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <p className="text-[11px] text-gray-500">{filtered.length} shown</p>
            </div>
            {rereadFailed ? (
              <Band tone="warn" title="One of the reads did not answer">
                {clients.message ?? brand.message} What is shown is the last answer that arrived, so it may be a
                moment out of date.
              </Band>
            ) : null}

            <div className="space-y-2.5">
              {filtered.map((row) => (
                <div key={row.id} className={`card ${row.id === chosenId ? "border-cyber-500/40" : ""}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h3 className="text-sm font-semibold text-white">{row.name}</h3>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {clientDiffers(row) ? <StateChip tone="on">its own brand</StateChip> : <StateChip tone="neutral">the instance's</StateChip>}
                      {row.inheritedLogo === "portal" ? <StateChip tone="warn">wearing its portal logo</StateChip> : null}
                    </div>
                  </div>
                  {row.legalName && row.legalName !== row.name ? (
                    <p className="mt-0.5 text-[11.5px] text-gray-500">Legal name: {row.legalName}</p>
                  ) : null}
                  <p className="mt-1.5 text-[11.5px] text-gray-400">
                    {clientDiffers(row)
                      ? `Its documents are issued by ${String(row.override?.companyName ?? row.name)} and inherit everything else from the instance.`
                      : "Its documents are issued by the instance, under the instance's name and mark."}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <button type="button" className="chip" onClick={() => openClient(row)}>
                      {clientDiffers(row) ? "Edit its brand" : "Give it its own brand"}
                    </button>
                    {clientDiffers(row) ? (
                      <button
                        type="button"
                        className="chip"
                        disabled={!canManage || saving}
                        onClick={() =>
                          void (async () => {
                            const result = await run(`${row.name} goes back to the instance's brand`, () =>
                              saveClientOverride(row.id, {}),
                            );
                            if (result) clients.reload();
                          })()
                        }
                      >
                        <X size={11} />
                        Remove this client's branding
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
              {filtered.length ? null : (
                <p className="px-1 py-3 text-xs text-gray-500">
                  {rows.length
                    ? `No active client matches “${query}”.`
                    : "There are no active clients to brand."}
                </p>
              )}
            </div>
          </div>

          <aside className="space-y-3.5 xl:sticky xl:top-4">
            {preview ? (
              <PreviewPanel
                caption={chosen ? `Preview — an invoice to ${chosen.name}` : "Preview — an invoice, with the instance's brand"}
                brand={preview}
                title="A specimen invoice"
                metaLine={specimenMetaLine(chosen ? `Billed to ${chosen.name}` : "Billed to a specimen client", at)}
                blocks={blocks}
                footerLeft={specimenFooterLeft(preview, at)}
                note={
                  chosen
                    ? "The figures are a specimen. The name, the mark and the colours are the ones this client's documents would wear."
                    : "The figures are a specimen. Choose a client to see its brand instead of the instance's."
                }
              />
            ) : null}
          </aside>
        </div>

        {chosen && draft ? (
          <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[8vh]" onClick={closeEditor}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`${chosen.name}'s own brand`}
              className="w-full max-w-2xl space-y-3 rounded-xl border border-surface-border bg-surface p-5"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">{chosen.name}&rsquo;s own brand</h2>
                  <p className="mt-0.5 text-xs text-gray-500">Its invoices, quotes and statements — nothing about the document changes but whose it is.</p>
                </div>
                <button type="button" onClick={closeEditor} className="chip p-1.5" aria-label="Close">
                  <X size={13} />
                </button>
              </div>
              {editorFor(chosen)}
              <div className="flex flex-wrap items-center gap-2 border-t border-surface-border pt-3">
                <button type="button" className="btn-primary" disabled={!canManage || saving} onClick={() => void save()}>
                  {saving ? <Loader2 size={13} className="animate-spin" /> : null}
                  <span className={saving ? "ml-1.5" : ""}>Save this client's brand</span>
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!canManage || saving || !clientDiffers(chosen)}
                  onClick={() => void remove()}
                >
                  Remove this client's branding
                </button>
                <button type="button" className="btn-secondary" onClick={closeEditor}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // ── Classic: a table, a dialog and the sheet ────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Branding — Clients"
        subtitle={BRAND_CLIENTS_SUBTITLE}
        actions={<BrandLinks current={SCREEN} />}
      />
      <Band tone="info" title="How a client's brand works">{INHERIT_RULE}</Band>
      {rereadFailed ? (
        <Band tone="warn" title="One of the reads did not answer">
          {clients.message ?? brand.message} What is shown is the last answer that arrived, so it may be a moment
          out of date.
        </Band>
      ) : null}

      <section className="card space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Clients</h2>
            <p className="text-sm text-gray-400">
              {differing} of {rows.length} differ from the instance; every one of them inherits the rest.
            </p>
          </div>
          <label className="block text-sm sm:w-64">
            <span className="text-xs font-medium text-gray-400">Find a client</span>
            <input className="input-field mt-1" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>

        <table className="ptable w-full text-xs">
          <caption className="sr-only">Every active client, and whether it has a brand of its own</caption>
          <thead>
            <tr>
              <th className="px-2 py-2 text-left">Client</th>
              <th className="px-2 py-2 text-left">Legal name</th>
              <th className="px-2 py-2 text-left">Brand</th>
              <th className="px-2 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className={row.id === chosenId ? "bg-surface-lighter" : undefined}>
                <td className="px-2 py-1.5">
                  <span className="block font-medium text-white">{row.name}</span>
                  {row.inheritedLogo === "portal" ? <span className="block text-gray-500">wearing its portal logo</span> : null}
                </td>
                <td className="px-2 py-1.5">{row.legalName ?? "—"}</td>
                <td className="px-2 py-1.5">{clientDiffers(row) ? "its own brand" : "the instance's"}</td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => openClient(row)}>
                      Edit
                    </button>
                    {clientDiffers(row) ? (
                      <button
                        type="button"
                        className="btn-secondary !px-2.5 !py-1 text-xs"
                        disabled={!canManage || saving}
                        onClick={() =>
                          void (async () => {
                            const result = await run(`${row.name} goes back to the instance's brand`, () =>
                              saveClientOverride(row.id, {}),
                            );
                            if (result) clients.reload();
                          })()
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {preview ? (
        <PreviewPanel
          caption={chosen ? `Preview — an invoice to ${chosen.name}` : "Preview — an invoice, with the instance's brand"}
          brand={preview}
          title="A specimen invoice"
          metaLine={specimenMetaLine(chosen ? `Billed to ${chosen.name}` : "Billed to a specimen client", at)}
          blocks={blocks}
          footerLeft={specimenFooterLeft(preview, at)}
          note="The figures are a specimen. The name, the mark and the colours are the ones this client's documents would wear."
        />
      ) : null}

      {chosen && draft ? (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[6vh]" onClick={closeEditor}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${chosen.name}'s own brand`}
            className="w-full max-w-3xl rounded-xl border border-surface-border bg-surface p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-white">{chosen.name}&rsquo;s own brand</h2>
            <p className="mb-3 mt-0.5 text-xs text-gray-500">
              Its invoices, quotes and statements — nothing about the document changes but whose it is.
            </p>
            {editorFor(chosen)}
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-surface-border pt-3">
              <button
                type="button"
                className="btn-secondary mr-auto"
                disabled={!canManage || saving || !clientDiffers(chosen)}
                onClick={() => void remove()}
              >
                Remove this client's branding
              </button>
              <button type="button" className="btn-secondary" onClick={closeEditor}>
                Cancel
              </button>
              <button type="button" className="btn-primary" disabled={!canManage || saving} onClick={() => void save()}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : null}
                <span className={saving ? "ml-1.5" : ""}>Save</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A client's logo or icon.
 *
 * It shares `useBrandUpload` with the Identity screen's control rather than re-implementing the three
 * steps — a picked file, its validation and the URL it comes back as — because a second copy of "which
 * types, how large, and why an SVG is refused" is a second set of rules that can drift. What differs is
 * the shape: this is a small row inside a form of ten fields, not the tile the Identity screen builds its
 * page around.
 */
function ClientImageField({
  kind,
  value,
  disabled,
  onChange,
}: {
  kind: "logo" | "icon";
  value: string;
  disabled: boolean;
  onChange: (url: string | null) => void;
}) {
  const { busy, problem, clear, choose } = useBrandUpload(kind, onChange);
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded-lg border border-surface-border bg-white">
          {value ? (
            <img src={value} alt="This client's mark, as it is set now" className="max-h-12 max-w-[5.5rem]" />
          ) : (
            <span className="text-[10.5px] text-gray-500">none</span>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="input-field max-w-xs"
          disabled={disabled || busy}
          aria-label={`Choose a file for this client's ${kind}`}
          onChange={(event) => {
            void (async () => {
              await choose(event.target.files?.[0] ?? null);
              if (inputRef.current) inputRef.current.value = "";
            })();
          }}
        />
        {value ? (
          <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" disabled={disabled || busy} onClick={() => { clear(); onChange(null); }}>
            Remove
          </button>
        ) : null}
        {busy ? <Loader2 size={13} className="animate-spin text-gray-500" /> : null}
      </div>
      <p className="text-[11px] text-gray-500">{UPLOAD_TYPES_SENTENCE} · {uploadLimitSentence()} An SVG is refused: it is a script with an image's extension.</p>
      {problem ? (
        <p role="alert" className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-2.5 py-1.5 text-[11px] text-gray-300">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
