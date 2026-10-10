/**
 * The pieces all four Branding screens are built from.
 *
 * **Why these are shared rather than designed twice.** DESIGN.md §3's rule is that the modern and classic
 * arrangements are two designs of one screen and that the shared part is the state, the API call and the
 * words — never the layout. Everything here is one of those three, with two exceptions that are shared
 * *on purpose* and say so:
 *
 *  - `PreviewPanel` — the specimen sheet. A preview that were arranged differently per interface would
 *    be a preview of a different document, and the whole promise is that the page a person approves is
 *    the page they get. The sheet is the same object in both; only the frame around it differs, and the
 *    frame belongs to the page.
 *  - `BrandLinks` — the four screens of the section. It reads `useModernInterface()` and draws chips in the
 *    modern interface and buttons in the classic one, because navigation *is* furniture.
 *
 * `useBrandWrite` is the state machine every write in the section goes through: a write that failed says
 * which one failed and in whose words, and a write that succeeded reports the label it was given. It is
 * a hook rather than a component because the four pages put their Save button in four different places.
 */
import { useCallback, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import { FileText, Image as ImageIcon, Palette, Users } from "lucide-react";
import { WriteFailure } from "../email/emailChrome";
import { useModernInterface } from "../../hooks/useNavigationStyle";
import type { WriteResult } from "../email/emailApi";
import { DocumentPreview, PreviewNote } from "./brandPreview";
import type { DocumentBrand } from "@C7NTAX/shared";
import type { PrintBlock } from "../reports/documentLanguage";

/** The four screens of the Branding section, in the order a person meets them. */
export const BRAND_SCREENS: { path: string; label: string; blurb: string; icon: typeof Palette }[] = [
  { path: "/admin/branding", label: "Identity", blurb: "The logo, the icon, the name, the colours", icon: Palette },
  { path: "/admin/branding/documents", label: "Documents", blurb: "What each family of document wears", icon: FileText },
  { path: "/admin/branding/clients", label: "Clients", blurb: "The clients billed under their own name", icon: Users },
  { path: "/admin/branding/reports", label: "Reports", blurb: "The shipped reports that differ", icon: ImageIcon },
];

/** The way between the four screens. Chips in the modern interface, buttons in the classic one. */
export function BrandLinks({ current }: { current: string }) {
  const modern = useModernInterface();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {BRAND_SCREENS.filter((screen) => screen.path !== current).map((screen) =>
        modern ? (
          <Link key={screen.path} to={screen.path} className="chip" title={screen.blurb}>
            <screen.icon size={12} />
            {screen.label}
          </Link>
        ) : (
          <Link key={screen.path} to={screen.path} className="btn-secondary text-sm" title={screen.blurb}>
            {screen.label}
          </Link>
        ),
      )}
    </div>
  );
}

/**
 * The write every save in this section runs through.
 *
 * `run` answers with the result so the caller can decide what a refusal means for its form, and the
 * toast only reports the two facts nobody can get from the form: which write succeeded, and that a
 * write failed. What *failed* says is printed by `WriteFailure` beside the control that was pressed, in
 * the API's own words.
 */
export function useBrandWrite(): {
  saving: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  run: <T>(label: string, action: () => Promise<WriteResult<T>>) => Promise<WriteResult<T> | null>;
} {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(label: string, action: () => Promise<WriteResult<T>>): Promise<WriteResult<T> | null> => {
      setSaving(true);
      setError(null);
      const result = await action();
      setSaving(false);
      if (!result.ok) {
        setError(result.message);
        return null;
      }
      toast.success(label);
      return result;
    },
    [],
  );

  return { saving, error, setError, run };
}

/** The refusal line, in one place so all four screens word a failed write the same. */
export function BrandWriteError({ message }: { message: string | null }) {
  if (!message) return null;
  return <WriteFailure message={message} />;
}

/**
 * The specimen sheet, with its caption and its own note — the one shared piece of the four screens.
 * `caption` says what this particular sheet is (a report's shape, an invoice for one client, the family
 * page), and `specimen` says which blocks are drawn; the paper, the letterhead and the footer are the
 * brand's, which is the whole point of showing it.
 */
export function PreviewPanel({
  caption,
  brand,
  title,
  metaLine,
  blocks,
  footerLeft,
  note,
  actions,
}: {
  caption: string;
  brand: DocumentBrand;
  title: string;
  metaLine: string;
  blocks: PrintBlock[];
  footerLeft: string;
  note?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-white">{caption}</h3>
        {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
      </div>
      <DocumentPreview brand={brand} title={title} metaLine={metaLine} blocks={blocks} footerLeft={footerLeft} />
      <PreviewNote brand={brand} note={note} />
    </div>
  );
}
