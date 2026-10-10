/**
 * `/admin/email/brand` — the shell: what every message inherits, where it is sent from, when it may go,
 * who may receive it, and which client differs.
 *
 * This file owns the reads and the writes; the two arrangements own their layouts. That split is the
 * rule in `DESIGN.md` §3 — one component, one set of handlers, two returns — with the arrangements in
 * their own files only because each is large, exactly as `pages/DeveloperDeployment.tsx` does it:
 *
 *   · `components/email/EmailBrandModern.tsx` — a rail, rows-as-cards, chips, a track, a sheet;
 *   · `components/email/EmailBrandClassic.tsx` — a table with an Action column, labelled fields in a
 *     grid, a `<select>`, a dialog with a heading and Save/Cancel.
 *
 * **The reads, and what happens when one fails.** Six calls, each resolving to a *status* rather than to
 * data, so a panel that could not be read says what could not be read instead of showing an empty table
 * or a zero:
 *
 *   · `GET /api/email/messages` — the trigger matrix (the endpoint is being written; the fallback is the
 *     catalogue read from the sender code, and the screen says which of the two it is drawing);
 *   · `GET /api/email/brand` — the kit (fallback: `lib/documentBrand.ts`, the constants the PDFs wear);
 *   · `GET /api/email/settings` — the delivery rules (fallback: the proposed defaults, shown disabled);
 *   · `GET /api/system/deployment` — the relay's six fields, which is what makes the honesty on the
 *     identity screen a reading rather than a claim;
 *   · `GET /api/clients` and `GET /api/boards` — the two figures the override screen can ground without
 *     inventing an endpoint, and the one board exception that is real (`notifyCustomerOnClose`).
 *
 * The chosen subject is the page's state and lives in the URL, so a screen can be linked to, survives a
 * reload, and cannot be disagreed about by the two arrangements.
 */
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { Permission } from "@C7NTAX/shared";
import { useAuth } from "../hooks/useAuth";
import { useModernInterface } from "../hooks/useNavigationStyle";
import { EmailBrandModern } from "../components/email/EmailBrandModern";
import { EmailBrandClassic } from "../components/email/EmailBrandClassic";
import {
  saveBrand as putBrand, useClientsForOverrides, useEmailBrand, useEmailMessages, useEmailRead,
  type ApiBrand,
} from "../components/email/emailApi";
import { proposedSettings, resolveBrand } from "../components/email/brandView";
import { resolveMatrix } from "../components/email/matrixView";
import {
  BRAND_SUBJECTS,
  type BoardRow, type BoardsResponse, type BrandSubject, type DeploymentResponse,
  type EmailBrandProps, type OverrideSummary,
} from "../components/email/brandScreen";

export function EmailBrandPage() {
  const modern = useModernInterface();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("view");
  const subject: BrandSubject = BRAND_SUBJECTS.find((entry) => entry.id === requested)?.id ?? "kit";
  const onSubject = useCallback(
    (next: BrandSubject) => {
      const params = new URLSearchParams(searchParams);
      if (next === "kit") params.delete("view");
      else params.set("view", next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const messages = useEmailMessages();
  const brand = useEmailBrand();
  const relay = useEmailRead<DeploymentResponse>("/system/deployment", "The relay configuration");
  const clients = useClientsForOverrides();
  const boards = useEmailRead<BoardsResponse>("/boards", "The board list");

  const { permissions } = useAuth();
  const canManage = permissions.includes(Permission.EmailManage);

  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  const brandView = useMemo(() => resolveBrand(brand.status === "ok" ? brand.data : null), [brand.status, brand.data]);
  const delivery = useMemo(() => proposedSettings(), []);
  const matrix = useMemo(() => resolveMatrix(messages), [messages]);

  const overrides: OverrideSummary = useMemo(() => {
    const clientRows = clients.status === "ok" ? clients.data?.data ?? [] : [];
    const total = clients.status === "ok" ? clients.data?.total ?? clientRows.length : null;
    const overridden = clients.status === "ok"
      ? clientRows.filter((row) => Boolean(row.portalLogoUrl || row.portalAccentColor)).length
      : null;

    const boardsPayload = boards.status === "ok" ? boards.data : null;
    const boardRows: BoardRow[] = boardsPayload === null
      ? []
      : Array.isArray(boardsPayload)
        ? boardsPayload
        : boardsPayload.data ?? [];
    const differing = boardRows.filter((row) => row.notifyCustomerOnClose === false);

    return {
      clients: total,
      brandOverridden: overridden,
      clientsMessage:
        clients.status === "ok" ? null : clients.status === "loading" ? "Reading the client list…" : clients.message,
      boards: boards.status === "ok" ? boardRows.length : null,
      boardsDiffering: boards.status === "ok" ? differing.length : null,
      boardNamesDiffering: differing.map((row) => row.name ?? row.id),
      boardsMessage:
        boards.status === "ok" ? null : boards.status === "loading" ? "Reading the boards…" : boards.message,
    };
  }, [clients, boards]);

  const write = useCallback(
    async (run: () => Promise<{ ok: boolean; message: string | null }>, reload: () => void, label: string) => {
      setSaving(true);
      setWriteError(null);
      const result = await run();
      setSaving(false);
      if (!result.ok) {
        setWriteError(result.message);
        return;
      }
      toast.success(label);
      reload();
    },
    [],
  );

  const props: EmailBrandProps = {
    messages,
    brand,
    relay,
    clientsRead: clients,
    boardsRead: boards,
    brandView,
    delivery,
    matrix,
    overrides,
    canManage,
    subject,
    onSubject,
    saving,
    writeError,
    onSaveBrand: (patch) => {
      void write(() => putBrand(patch as Partial<ApiBrand>), brand.reload, "Brand kit saved");
    },
  };

  return modern ? <EmailBrandModern {...props} /> : <EmailBrandClassic {...props} />;
}
