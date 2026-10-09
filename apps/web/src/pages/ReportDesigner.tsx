/**
 * The report designer (PLAN-020).
 *
 * A page with three panes and one document: the palette on the left (the data and the language the
 * report may use), the canvas in the middle, the property grid on the right. It edits a **draft**
 * document, validates it against the API on every change, previews it by running its data source, and
 * lays it out with the same engine every output uses — so what the canvas shows, what Print produces
 * and what the PDF holds are all one computation.
 *
 * Two things are deliberate:
 *
 *  - **Save is blocked by errors, not by warnings.** The same validation runs in the API on write and
 *    again on render, so a document that cannot render cannot be stored either.
 *  - **The canvas is not paginated.** Editing while the engine reflowed the page would move elements
 *    under the cursor; pagination is what the Preview tab is for.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  AGGREGATE_SCOPES, BAND_BY_KIND, DOCUMENT_VERSION, contentBox, createElement, labelFor,
  layoutReport, mmToPx, normaliseDocument, pageDimensions, paperFor,
  type LaidOutChart, type ReportTemplateDocument, type TemplateElement, type TemplateIssue,
} from "@C7NTAX/shared";
import api from "../api";
import { apiErrorMessage } from "../lib/apiError";
import { downloadCsv } from "../lib/csv";
import { measureTextMm } from "../lib/reportMeasure";
import {
  exportTemplateCsv, exportTemplateExcel, exportTemplatePdf, printTemplateReport,
} from "../lib/reportOutput";
import { TableSkeleton } from "../components/ui/Skeleton";
import { DesignerCanvas } from "../components/reports/designer/DesignerCanvas";
import { Inspector, type Selection } from "../components/reports/designer/Inspector";
import { Palette } from "../components/reports/designer/Palette";
import { LaidOutPageView } from "../components/reports/designer/PageRenderer";
import { clearActiveExpressionTarget, isTypingTarget } from "../components/reports/designer/ExpressionInput";
import { ScheduleReportDialog } from "../components/reports/ScheduleReportDialog";
import type { DesignerCatalog, DesignerRun } from "../lib/designerTypes";
import { useRedesign } from "../hooks/useNavigationStyle";
import { documentBrandOf, useBrandKit } from "../hooks/useBrandKit";

interface SavedReport {
  id: string; name: string; description: string | null; type: string;
  config: Record<string, unknown> | null; createdAt: string; updatedAt: string;
}

type Tab = "design" | "preview" | "data";

/** The hairline the redesigned toolbar divides its groups with — the mockup's `.rd-sep`. */
function ToolbarDivider() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-surface-border" aria-hidden="true" />;
}

export function ReportDesignerPage() {
  const redesign = useRedesign();
  const { id = "new" } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const poppedOut = searchParams.get("popout") === "1";
  const navigate = useNavigate();
  const isNew = id === "new";

  const [catalog, setCatalog] = useState<DesignerCatalog | null>(null);
  const [name, setName] = useState("Untitled report");
  const [description, setDescription] = useState("");
  const [document, setDocument] = useState<ReportTemplateDocument | null>(null);
  const [past, setPast] = useState<ReportTemplateDocument[]>([]);
  const [future, setFuture] = useState<ReportTemplateDocument[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: "report" });
  const [zoom, setZoom] = useState(1);
  const [palettePane, setPalettePane] = useState<"bands" | "data" | "parameters" | "fields" | "expressions" | "schedule">("bands");
  const [showSchedule, setShowSchedule] = useState(false);
  /** The two views, as chips: what the sheet draws rather than what the report is. */
  const [showGrid, setShowGrid] = useState(true);
  const [showBandGuides, setShowBandGuides] = useState(true);
  /** The scrolling stage, measured for Fit width. */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<Tab>("design");
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [run, setRun] = useState<DesignerRun | null>(null);
  const [issues, setIssues] = useState<TemplateIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reportId, setReportId] = useState<string | null>(isNew ? null : id);
  const [showIssues, setShowIssues] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /*
   * Autosave, and the draft behind it.
   *
   * Two layers, on purpose. The **device draft** is written to `localStorage` a second or so after the
   * last change — no request, so nothing about typing a label waits on the network — and the **server
   * save** follows a few seconds later, silently, once the document validates and the report exists.
   * A document that has never been created has nowhere on the server to go, so it lives as a draft
   * until somebody presses Create.
   */
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [autosaving, setAutosaving] = useState(false);

  /**
   * The instance's brand, and the document settings that go with it.
   *
   * The layout is where the accent, the type floor, the sheet and the page furniture are decided, so the
   * resolved presentation and the accent are handed to the engine here — once, for the canvas, the
   * preview and every export, which is what makes them one document rather than three. `useBrandKit`
   * returns the cached record, so the memo below is recomputed when `/api/brand` answers and not on
   * every render.
   */
  const brandKit = useBrandKit();
  const ink = useMemo(() => documentBrandOf("report.designer"), [brandKit]);
  const [draftAt, setDraftAt] = useState<Date | null>(null);
  const [showDraftPrompt, setShowDraftPrompt] = useState(false);
  const [restorable, setRestorable] = useState<{ savedAt: string; name: string } | null>(null);
  const [poppedOutHere, setPoppedOutHere] = useState(false);
  const popoutWindow = useRef<Window | null>(null);
  const initialised = useRef(false);

  const applyDocument = useCallback((next: ReportTemplateDocument, options?: { push?: boolean }) => {
    setDocument(current => {
      if (options?.push && current) setPast(history => [...history.slice(-40), current]);
      if (options?.push) setFuture([]);
      return next;
    });
    setDirty(true);
  }, []);

  /**
   * Selecting something on the canvas ends the "inserting into the expression you were editing" mode.
   * Without this the palette keeps writing into the last input that had focus, which after a canvas
   * click is not where the user is looking any more.
   */
  const select = useCallback((next: Selection) => {
    clearActiveExpressionTarget();
    setSelection(next);
  }, []);

  // ── Load ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [catalogResponse, starterResponse] = await Promise.all([
          api.get("/reports/designer/catalog"),
          isNew
            ? api.get("/reports/designer/starter", { params: { source: searchParams.get("source") ?? "tickets", kind: searchParams.get("starter") ?? "list" } })
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const nextCatalog = catalogResponse.data as DesignerCatalog;
        setCatalog(nextCatalog);

        if (starterResponse) {
          const starter = starterResponse.data as { document: ReportTemplateDocument };
          setName(starter.document.name);
          setDocument(normaliseDocument(starter.document, starter.document.name));
        } else {
          const list = (await api.get("/reports")).data as SavedReport[];
          const found = list.find(report => report.id === id);
          if (!found) throw new Error("That report no longer exists.");
          if (found.type !== "template") throw new Error(`${found.name} is not a designed report — it is a ${found.type} report. Duplicate it to change its type, or design a new one.`);
          const raw = (found.config as { document?: unknown } | null)?.document;
          setName(found.name);
          setDescription(found.description ?? "");
          setDocument(normaliseDocument(raw, found.name));
          setReportId(found.id);
        }
        initialised.current = true;
      } catch (e) {
        if (!cancelled) setLoadError(apiErrorMessage(e, "Could not open the designer"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);

  // ── Validation and preview, both debounced ────────────────────────
  const errorKey = useMemo(() => JSON.stringify({ name, document, parameters, from, to }), [name, document, parameters, from, to]);

  useEffect(() => {
    if (!document) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await api.post("/reports/designer/validate", { name, document });
        if (!cancelled) setIssues((response.data?.issues ?? []) as TemplateIssue[]);
      } catch {
        // A validation call that fails is not worth interrupting the designer for; the save path reports.
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [errorKey, document, name]);

  const errorCount = issues.filter(issue => issue.severity === "error").length;
  const warningCount = issues.length - errorCount;

  /**
   * Run the report now.
   *
   * The preview also runs by itself a moment after you stop changing something, so this is not the
   * only way to see data — it is the way to *ask* for it, which is what a designer wants after changing
   * a filter rather than after every keystroke. Both paths call this, so what Run produces and what the
   * debounce produces cannot become two different things.
   */
  const runPreview = useCallback(async () => {
    if (!document) return;
    setRunning(true);
    try {
      const supplied: Record<string, unknown> = { ...parameters };
      if (from) supplied.from = from;
      if (to) supplied.to = to;
      const response = await api.post("/reports/designer/preview", { name, document, parameters: supplied, from, to });
      setRun(response.data as DesignerRun);
    } catch (e) {
      setRun(null);
      toast.error(apiErrorMessage(e, "Could not run the preview"));
    } finally {
      setRunning(false);
    }
  }, [document, name, parameters, from, to]);

  useEffect(() => {
    if (!document || errorCount) return;
    const timer = setTimeout(() => { void runPreview(); }, 600);
    return () => clearTimeout(timer);
    // Re-run on the same signal the validation is keyed on: the document, the name, the parameters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorKey, errorCount]);

  // ── Layout, from the same engine every output uses ────────────────
  const laid = useMemo(() => {
    if (!document) return null;
    return layoutReport({
      document,
      rows: run?.rows ?? [],
      parameters: run?.parameters ?? {},
      measure: measureTextMm,
      limit: run?.limit,
      catalog: catalog ? { sources: catalog.sources.map(source => ({ key: source.key, label: source.label, fields: source.fields.map(field => ({ key: field.key, label: field.label, type: field.type })) })) } : undefined,
      templates: catalog?.templates ?? run?.templates,
      // The sub-reports the API resolved for this preview, so a sub-report is laid out with the same
      // child rows the saved report would run — and the exit condition of the phase is visible here:
      // the child flows into these pages, so the page count stays the parent's.
      subreports: run?.subreports,
      ink,
    });
  }, [document, run, catalog, ink]);

  /** The sheet this design prints on, so the canvas and the preview are drawn on the same paper. */
  const paper = useMemo(() => (document ? paperFor(document, ink.presentation) : null), [document, ink]);
  /** The ruler above the canvas is measured in the sheet's own millimetres, like the canvas itself. */
  const paperWidth = paper ? pageDimensions(paper).width : 0;

  /** Element id → what it prints with the current data, so the canvas shows real content. */
  const values = useMemo(() => {
    const map = new Map<string, string>();
    if (!laid) return map;
    for (const page of laid.pages) {
      for (const band of page.bands) {
        for (const element of band.elements) {
          if (map.has(element.id)) continue;
          if (element.payload.kind !== "text") continue;
          map.set(element.id, element.payload.lines.map(line => line.text).join(" ").trim());
        }
      }
    }
    return map;
  }, [laid]);

  /** Element id → the chart the current data produced, so a chart is designed against real numbers. */
  const charts = useMemo(() => {
    const map = new Map<string, LaidOutChart>();
    if (!laid) return map;
    for (const page of laid.pages) {
      for (const band of page.bands) {
        for (const element of band.elements) {
          if (element.payload.kind === "chart" && !map.has(element.id)) map.set(element.id, element.payload.chart);
        }
      }
    }
    return map;
  }, [laid]);

  // ── Editing ───────────────────────────────────────────────────────
  const onAddElement = useCallback((bandId: string, element: TemplateElement, options?: { growBandTo?: number }) => {
    if (!document) return;
    applyDocument({
      ...document,
      bands: document.bands.map(band => (band.id === bandId
        ? { ...band, height: options?.growBandTo ? Math.max(band.height, options.growBandTo) : band.height, elements: [...band.elements, element] }
        : band)),
    }, { push: true });
    select({ kind: "element", bandId, elementId: element.id });
  }, [document, applyDocument]);

  const onEditElement = useCallback((bandId: string, elementId: string, patch: Partial<TemplateElement>) => {
    if (!document) return;
    applyDocument({
      ...document,
      bands: document.bands.map(band =>
        band.id === bandId
          ? { ...band, elements: band.elements.map(element => (element.id === elementId ? ({ ...element, ...patch } as TemplateElement) : element)) }
          : band),
    }, { push: true });
  }, [document, applyDocument]);

  const onDropField = useCallback((bandId: string, fieldKey: string, at: { x: number; y: number }) => {
    if (!document) return;
    const source = document.dataSources[0]?.source;
    const field = catalog?.sources.find(candidate => candidate.key === source)?.fields.find(candidate => candidate.key === fieldKey);
    const format = field?.type === "money" ? "money" : field?.type === "date" ? "date" : field?.type === "number" ? "number" : field?.type === "minutes" ? "minutes" : "text";
    const band = document.bands.find(candidate => candidate.id === bandId);
    if (!band) return;
    // Dropped where the pointer was, but kept inside the band and never taller than the room left.
    const y = Math.max(0, Math.min(at.y, Math.max(0, band.height - 3.5)));
    const element = createElement("field", {
      x: at.x,
      y,
      w: Math.min(contentBox(document.page).width - at.x, format === "date" ? 28 : format === "money" ? 24 : 45),
      h: Math.max(1.5, Math.min(6.5, band.height - y - 0.25)),
      expression: `Fields.${fieldKey}`,
      format,
      style: { ...createElement("field").style, fontSize: 8.5, align: format === "money" || format === "number" || format === "minutes" ? "right" : "left" },
    });
    onAddElement(bandId, element);
  }, [document, catalog, onAddElement]);

  const undo = useCallback(() => {
    setPast(history => {
      const previous = history[history.length - 1];
      if (!previous) return history;
      setDocument(current => {
        if (current) setFuture(stack => [current, ...stack].slice(0, 40));
        return previous;
      });
      setDirty(true);
      return history.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture(stack => {
      const next = stack[0];
      if (!next) return stack;
      setDocument(current => {
        if (current) setPast(history => [...history, current].slice(-40));
        return next;
      });
      setDirty(true);
      return stack.slice(1);
    });
  }, []);

  /** Moves or resizes the selected element with the keyboard, and deletes it with Delete. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if (modifier && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
      if (modifier && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); return; }
      if (event.key === "Escape") { select({ kind: "report" }); return; }
      if (selection.kind !== "element" || !document) return;

      const band = document.bands.find(candidate => candidate.id === selection.bandId);
      const element = band?.elements.find(candidate => candidate.id === selection.elementId);
      if (!band || !element) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        applyDocument({ ...document, bands: document.bands.map(candidate => (candidate.id === band.id ? { ...candidate, elements: candidate.elements.filter(el => el.id !== element.id) } : candidate)) }, { push: true });
        select({ kind: "band", bandId: band.id });
        return;
      }
      if (modifier && event.key.toLowerCase() === "d") {
        event.preventDefault();
        const copy = { ...element, id: createElement(element.type).id, y: Math.min(band.height - element.h, element.y + element.h + 1) };
        onAddElement(band.id, copy);
        return;
      }
      const step = event.shiftKey ? 5 : 1;
      const patch: Partial<TemplateElement> = {};
      if (event.key === "ArrowLeft") patch.x = Math.max(0, element.x - step);
      else if (event.key === "ArrowRight") patch.x = Math.min(contentBox(document.page).width - element.w, element.x + step);
      else if (event.key === "ArrowUp") patch.y = Math.max(0, element.y - step);
      else if (event.key === "ArrowDown") patch.y = Math.min(band.height - element.h, element.y + step);
      else return;
      event.preventDefault();
      onEditElement(band.id, element.id, patch);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, document, undo, redo, onEditElement, onAddElement, name, description, reportId]);

  // ── Saving ────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (!document) return;
    if (errorCount) {
      setShowIssues(true);
      toast.error(`Fix ${errorCount} error${errorCount === 1 ? "" : "s"} before saving`);
      return;
    }
    setSaving(true);
    try {
      const payload = { name: name.trim() || "Untitled report", description: description || null, type: "template", config: { document: { ...document, name: name.trim() || "Untitled report", description } } };
      if (reportId) {
        await api.patch(`/reports/${reportId}`, payload);
      } else {
        const created = await api.post("/reports", payload);
        const savedId = (created.data as SavedReport).id;
        setReportId(savedId);
        // The URL becomes the report's own address, so a refresh reopens it instead of starting over.
        navigate(`/reports/custom/${savedId}/design`, { replace: true });
      }
      setDirty(false);
      toast.success(reportId ? "Template saved" : "Template created");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Could not save the template"));
    } finally {
      setSaving(false);
    }
  }, [document, name, description, errorCount, reportId]);

  // ── Autosave, the device draft, and the popout ────────────────────

  /** Where this document's device draft lives. A report that exists gets its own key. */
  const draftKey = `c7_designer_draft:${reportId ?? "new"}`;

  /** The payload both the manual save and the autosave write, so the two cannot disagree. */
  const payloadFor = useCallback((doc: ReportTemplateDocument) => ({
    name: name.trim() || "Untitled report",
    description: description || null,
    type: "template",
    config: { document: { ...doc, name: name.trim() || "Untitled report", description } },
  }), [name, description]);

  /** Writes the draft to this device. No request, so it can follow every change. */
  const saveDraftLocally = useCallback((doc: ReportTemplateDocument) => {
    try {
      const at = new Date().toISOString();
      localStorage.setItem(draftKey, JSON.stringify({ savedAt: at, name: name.trim() || "Untitled report", document: doc }));
      setDraftAt(new Date(at));
    } catch {
      /* a full or unavailable localStorage is not worth an error: the server save still happens */
    }
  }, [draftKey, name]);

  /** The silent server save. Only for a report that exists, and only when it validates. */
  const autosaveToServer = useCallback(async () => {
    if (!document || !reportId || errorCount) return;
    setAutosaving(true);
    try {
      await api.patch(`/reports/${reportId}`, payloadFor(document));
      setDirty(false);
      setSavedAt(new Date());
    } catch {
      /* Autosave failures stay quiet — the draft is on the device and the toolbar says "not saved" */
    } finally {
      setAutosaving(false);
    }
  }, [document, reportId, errorCount, payloadFor]);

  // The device draft follows the change; the server save waits longer, so a burst of edits is one write.
  useEffect(() => {
    if (!document || !dirty) return;
    const local = setTimeout(() => saveDraftLocally(document), 1200);
    const server = setTimeout(() => { void autosaveToServer(); }, 5000);
    return () => { clearTimeout(local); clearTimeout(server); };
  }, [document, dirty, saveDraftLocally, autosaveToServer]);

  /** Once saved by hand, the device draft has been superseded. */
  useEffect(() => {
    if (dirty || !reportId) return;
    try { localStorage.removeItem(draftKey); } catch { /* nothing to clean */ }
    setDraftAt(null);
  }, [dirty, reportId, draftKey]);

  /** Offer a draft this device kept, when it is newer than what the server sent. */
  const draftOffered = useRef(false);
  useEffect(() => {
    // Once, and only once a document exists: the first render has none, and re-offering the draft after
    // every edit would turn a recovery into a nag.
    if (!document || draftOffered.current) return;
    draftOffered.current = true;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as { savedAt: string; name: string; document: ReportTemplateDocument };
      // Offered when it actually differs from what the server sent: a draft identical to the document
      // is not a recovery, it is a nuisance.
      if (draft.document?.bands?.length && JSON.stringify(draft.document) !== JSON.stringify(document)) {
        setRestorable({ savedAt: draft.savedAt, name: draft.name });
      }
    } catch { /* a draft we cannot read is a draft we do not offer */ }
  }, [draftKey, document]);

  /** Closing or reloading the window with unsaved changes gets the browser's own question. */
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // The string is ignored by every current browser, which show their own wording.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /*
   * Clicking away is the other half of the question. Losing focus is not leaving — a dialog, a colour
   * picker or another monitor does not mean the work is abandoned — so this asks, and asks once: the
   * draft is already on the device by the time it can appear.
   */
  useEffect(() => {
    if (!dirty) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onBlur = () => {
      timer = setTimeout(() => {
        // `document` is the template here, so the window's document is named in full.
        if (!window.document.hasFocus()) setShowDraftPrompt(true);
      }, 800);
    };
    window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("blur", onBlur); if (timer) clearTimeout(timer); };
  }, [dirty]);

  const openPopout = useCallback(() => {
    if (!document) return;
    const url = `${window.location.pathname}?popout=1`;
    const win = window.open(url, "c7-report-designer", "width=1500,height=950,menubar=no,toolbar=no,location=no,status=no");
    if (!win) {
      toast.error("The browser blocked the window — allow pop-ups for this site, then try again");
      return;
    }
    popoutWindow.current = win;
    setPoppedOutHere(true);
    win.focus();
  }, [document]);

  const bringPopoutForward = useCallback(() => {
    const win = popoutWindow.current;
    if (win && !win.closed) { win.focus(); return; }
    openPopout();
  }, [openPopout]);

  // ── Output ────────────────────────────────────────────────────────
  const output = useCallback((kind: "print" | "pdf" | "excel" | "csv" | "tables") => {
    if (!document || !laid) return;
    if (laid.refused) { toast.error("This template has errors, so there is nothing to print"); return; }
    const meta = { title: name || document.name, subtitle: description || undefined, period: run?.period?.label };
    if (kind === "print") printTemplateReport(laid, meta);
    else if (kind === "pdf") exportTemplatePdf(laid, meta);
    else if (kind === "excel") { exportTemplateExcel(laid, document, meta); toast.success("Workbook exported"); }
    else if (kind === "csv") { exportTemplateCsv(laid, document, meta, downloadCsv); toast.success("CSV exported"); }
    else toast.success("Document opened in a new tab");
  }, [document, laid, name, description, run]);

  if (loading) {
    return <div className="surface-card p-6"><TableSkeleton rows={6} /></div>;
  }

  if (loadError || !document) {
    return (
      <div className="surface-card p-6 space-y-3">
        <h2 className="text-lg font-semibold text-white">The designer could not open</h2>
        <p className="text-sm text-gray-400">{loadError ?? "No document was loaded."}</p>
        <button type="button" className="btn-secondary" onClick={() => navigate("/reports/custom")}>Back to Custom Reports</button>
      </div>
    );
  }

  const issueColour = errorCount ? "text-red-400" : warningCount ? "text-amber-400" : "text-green-400";

  /**
   * The six things a report is made of, in the order you build it — the redesigned designer's left
   * panel, taken from the report-designer mockup. The classic designer keeps its single scrolling
   * column of fields, built-ins, functions and elements; this is the arrangement the redesign uses
   * instead, and one pane is on screen at a time.
   */
  const palettePanes = [
    { id: "bands", label: "Bands" },
    { id: "data", label: "Data" },
    { id: "parameters", label: "Parameters" },
    { id: "fields", label: "Fields" },
    { id: "expressions", label: "Expressions" },
    { id: "schedule", label: "Schedule" },
  ] as const;
  type PalettePaneId = (typeof palettePanes)[number]["id"];

  /*
   * The status line the redesigned designer carries: what is selected, how tall the band is, what
   * the last run returned and how the page is set up — the four questions a designer answers with a
   * tooltip everywhere else. The mockup's argument is that a banded tool should say where you are.
   */
  const statusBand = selection.kind === "report" ? null : document.bands.find(band => band.id === selection.bandId) ?? null;
  const statusElement = selection.kind === "element" && statusBand
    ? statusBand.elements.find(element => element.id === selection.elementId) ?? null
    : null;
  const elementKinds: Record<string, string> = { text: "text", field: "field", expression: "expression", image: "image", line: "rule", box: "box", chart: "chart", pageNumber: "page number" };
  const selectionLabel = statusElement
    ? `${statusBand?.kind ?? "element"} › ${statusElement.type === "field" ? labelFor(String((statusElement as { fieldKey?: string }).fieldKey ?? "")) : elementKinds[statusElement.type] ?? statusElement.type}`
    : statusBand ? statusBand.kind : "the report";
  const bandHeightLabel = statusBand ? `${statusBand.height} mm` : `${document.bands.reduce((total, band) => total + band.height, 0)} mm total`;
  const pageSetupLabel = `${document.page.size === "custom" ? "Custom" : document.page.size.toUpperCase()} ${document.page.orientation} · grid 10 mm · snap 1 mm`;

  /**
   * Fit width: the zoom at which the sheet fills the stage. The mockup's argument for it is that a
   * designer's first act is to see the whole page, and at 100% an A4 sheet is wider than the space
   * between the two panels on a laptop.
   */
  const fitWidth = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const available = stage.clientWidth - 32; // the stage's own padding
    const pageWidthPx = mmToPx(pageDimensions(document.page).width);
    if (available <= 0 || pageWidthPx <= 0) return;
    setZoom(Math.max(0.35, Math.min(2, Math.round((available / pageWidthPx) * 100) / 100)));
  };

  return (
    <div className={`flex flex-col gap-3 ${poppedOut ? "h-screen" : "h-[calc(100vh-9rem)] min-h-[560px]"}`}>

      {/* A draft this device kept, offered rather than applied: silently replacing the document would
          be the one thing autosave must never do. */}
      {restorable ? (
        <div className="surface-card flex flex-wrap items-center gap-2 border-l-2 border-l-cyber-500 px-3 py-2 text-xs">
          <span className="text-gray-300">
            This device has a draft of <b className="text-white">{restorable.name}</b> from{" "}
            {new Date(restorable.savedAt).toLocaleString()}.
          </span>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => {
              try {
                const raw = localStorage.getItem(draftKey);
                if (raw) {
                  const draft = JSON.parse(raw) as { document: ReportTemplateDocument; name: string };
                  applyDocument(normaliseDocument(draft.document), { push: true });
                  setName(draft.name);
                  setDirty(true);
                  toast.success("Draft restored");
                }
              } catch { toast.error("That draft could not be read"); }
              setRestorable(null);
            }}
          >Restore it</button>
          <button
            type="button"
            className="text-xs text-gray-400 hover:text-gray-200"
            onClick={() => { setRestorable(null); try { localStorage.removeItem(draftKey); } catch { /* nothing to clean */ } }}
          >Discard the draft</button>
        </div>
      ) : null}
      {/* Toolbar — one arrangement for each interface. The redesigned one is the mockup's: a single
          wrapping row of pills in the order the work is done (what this is, how you are looking at it,
          how big, what is drawn, undo, and the two writes), with the report's own identity stated
          beside its name rather than in a heading. The classic one is untouched below it. */}
      {redesign ? (
        <div className="surface-card flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2">
          <button
            type="button"
            className="text-xs text-gray-400 transition-colors hover:text-gray-200"
            onClick={() => navigate("/reports/custom")}
            title="Back to the saved reports"
          >← Reports</button>
          <input
            className="w-[min(20rem,34vw)] rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-white hover:border-surface-lighter focus:border-cyber-500/50 focus:outline-none"
            value={name}
            onChange={event => { setName(event.target.value); setDirty(true); }}
            aria-label="Report name"
          />
          <span className="text-[11px] text-gray-500">
            · banded · {document.page.size === "custom" ? "Custom" : document.page.size.toUpperCase()} {document.page.orientation}
            {" · "}{document.dataSources.length} data source{document.dataSources.length === 1 ? "" : "s"}
            {" · "}{document.bands.length} bands
          </span>
          {dirty ? <span className="chip chip--warn">unsaved</span> : null}

          <ToolbarDivider />
          <div className="flex items-center gap-1" role="group" aria-label="What you are looking at">
            {(["design", "preview", "data"] as Tab[]).map(candidate => (
              <button
                key={candidate}
                type="button"
                aria-pressed={tab === candidate}
                onClick={() => setTab(candidate)}
                className={`chip capitalize ${tab === candidate ? "chip--on" : ""}`}
              >
                {candidate}
                {candidate === "data" ? <span className="chip__n">{run?.rows.length ?? 0}</span> : null}
              </button>
            ))}
          </div>

          <ToolbarDivider />
          <div className="flex items-center gap-1" role="group" aria-label="Zoom">
            <button type="button" className="chip" title="Zoom out" onClick={() => setZoom(value => Math.max(0.35, Math.round((value - 0.1) * 100) / 100))}>−</button>
            <span className="chip cursor-default tabular-nums" aria-label={`Zoom ${Math.round(zoom * 100)} percent`}>{Math.round(zoom * 100)}%</span>
            <button type="button" className="chip" title="Zoom in" onClick={() => setZoom(value => Math.min(2, Math.round((value + 0.1) * 100) / 100))}>+</button>
            <button type="button" className="chip" title="Zoom so the whole sheet fits the width of the stage" onClick={fitWidth}>Fit width</button>
          </div>

          <ToolbarDivider />
          <div className="flex items-center gap-1" role="group" aria-label="What the sheet draws">
            <button type="button" className={`chip ${showGrid ? "chip--on" : ""}`} aria-pressed={showGrid} title="The millimetre grid the snapping follows" onClick={() => setShowGrid(value => !value)}>Grid</button>
            <button type="button" className={`chip ${showBandGuides ? "chip--on" : ""}`} aria-pressed={showBandGuides} title="Band names and heights — off shows the report as the reader will see it" onClick={() => setShowBandGuides(value => !value)}>Bands</button>
          </div>

          <ToolbarDivider />
          <div className="flex items-center gap-1">
            <button type="button" className="chip" title="Undo (Ctrl+Z)" disabled={!past.length} onClick={undo}>↶ Undo</button>
            <button type="button" className="chip" title="Redo (Ctrl+Shift+Z)" disabled={!future.length} onClick={redo}>↷ Redo</button>
          </div>

          <ToolbarDivider />
          <button
            type="button"
            className="chip"
            onClick={() => void save()}
            disabled={saving || errorCount > 0}
            title={errorCount ? "A template saves when it has no errors" : "Save this report"}
          >{saving ? "Saving…" : reportId ? "Save" : "Create report"}</button>
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={() => void runPreview()}
            disabled={running || errorCount > 0}
            title="Run the report now — the preview also updates as you type"
          >{running ? "Running…" : "Run"}</button>

          <div className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <button
              type="button"
              className={`chip ${errorCount ? "chip--bad" : warningCount ? "chip--warn" : "chip--good"}`}
              onClick={() => setShowIssues(value => !value)}
              title="Validation results — click for the list"
            >
              {errorCount ? `${errorCount} error${errorCount === 1 ? "" : "s"}` : warningCount ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : "No problems"}
            </button>
            <span className="text-[11px] text-gray-500">
              {run ? `${run.rows.length} row${run.rows.length === 1 ? "" : "s"}` : "no rows"}
              {laid ? ` · ${laid.pages.length} page${laid.pages.length === 1 ? "" : "s"}` : ""}
            </span>
            <button
              type="button"
              className={`text-[11px] ${errorCount ? "text-red-400" : autosaving || saving ? "text-cyber-300" : dirty ? "text-amber-400" : "text-gray-500"}`}
              title={dirty && !errorCount ? "The draft is on this device; the report saves itself when it validates" : "Autosave"}
              onClick={() => { if (errorCount) setShowIssues(true); }}
            >
              {errorCount
                ? `Fix ${errorCount} error${errorCount === 1 ? "" : "s"} to save`
                : saving || autosaving
                  ? "Saving…"
                  : dirty
                    ? draftAt ? `Draft saved ${draftAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Unsaved changes"
                    : savedAt ? `All changes saved ${savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : reportId ? "Saved" : "Not saved yet"}
            </button>
            <ToolbarDivider />
            <div className="flex items-center gap-1" role="group" aria-label="Output">
              <button type="button" className="chip" onClick={() => output("print")} disabled={!laid?.pages.length}>Print</button>
              <button type="button" className="chip" onClick={() => output("pdf")} disabled={!laid?.pages.length}>PDF</button>
              <button type="button" className="chip" onClick={() => output("excel")} disabled={!laid?.pages.length}>Excel</button>
              <button type="button" className="chip" onClick={() => output("csv")} disabled={!laid?.pages.length}>CSV</button>
              <button
                type="button"
                className="chip"
                onClick={poppedOutHere ? bringPopoutForward : openPopout}
                title="Open the designer in its own window, so the rest of the application stays usable"
              >{poppedOutHere ? "Bring it forward" : "Pop out"}</button>
            </div>
          </div>
        </div>
      ) : (
      <div className="surface-card flex flex-wrap items-center gap-2 px-3 py-2">
        <button type="button" className="text-xs text-gray-400 hover:text-gray-200" onClick={() => navigate("/reports/custom")}>← Custom Reports</button>
        <input
          className="bg-surface-light border border-surface-lighter rounded px-2 py-1 text-sm text-white w-56"
          value={name}
          onChange={event => { setName(event.target.value); setDirty(true); }}
        />
        {dirty ? <span className="text-[10px] text-amber-400">unsaved</span> : null}

        <div className="flex items-center gap-1 ml-2">
          <button type="button" className="btn-icon" title="Undo (Ctrl+Z)" disabled={!past.length} onClick={undo}>↶</button>
          <button type="button" className="btn-icon" title="Redo (Ctrl+Shift+Z)" disabled={!future.length} onClick={redo}>↷</button>
        </div>

        <div className="flex items-center gap-1">
          <button type="button" className="btn-icon" title="Zoom out" onClick={() => setZoom(value => Math.max(0.35, Math.round((value - 0.1) * 100) / 100))}>−</button>
          <span className="text-[11px] text-gray-400 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button type="button" className="btn-icon" title="Zoom in" onClick={() => setZoom(value => Math.min(2, Math.round((value + 0.1) * 100) / 100))}>+</button>
          {redesign ? (
            <button type="button" className="btn-secondary text-xs" title="Zoom so the whole sheet fits the width of the stage" onClick={fitWidth}>
              Fit width
            </button>
          ) : (
            <button type="button" className="text-[10px] text-gray-400 hover:text-gray-200" onClick={() => setZoom(1)}>100%</button>
          )}
        </div>

        <div className="flex items-center gap-1 ml-2 rounded border border-surface-lighter overflow-hidden">
          {(["design", "preview", "data"] as Tab[]).map(candidate => (
            <button
              key={candidate}
              type="button"
              onClick={() => setTab(candidate)}
              className={`px-2 py-1 text-xs capitalize ${tab === candidate ? "bg-cyber-600/25 text-cyber-200" : "text-gray-400 hover:text-gray-200"}`}
            >
              {candidate === "data" ? `Data (${run?.rows.length ?? 0})` : candidate}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <button
          type="button"
          className={`text-xs ${issueColour}`}
          onClick={() => setShowIssues(value => !value)}
          title="Validation results — click for the list"
        >
          {errorCount ? `${errorCount} error${errorCount === 1 ? "" : "s"}` : warningCount ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : "No problems"}
        </button>

        <span className="text-[11px] text-gray-500">{running ? "running…" : run ? `${run.rows.length} row${run.rows.length === 1 ? "" : "s"}${laid ? ` · ${laid.pages.length} page${laid.pages.length === 1 ? "" : "s"}` : ""}` : ""}</span>

        {/* Autosave, stated the way a word processor states it: what happened, and when. */}
        <button
          type="button"
          className={`text-[11px] ${errorCount ? "text-red-400" : autosaving || saving ? "text-cyber-300" : dirty ? "text-amber-400" : "text-gray-500"}`}
          title={dirty && !errorCount ? "The draft is on this device; the report saves itself when it validates" : "Autosave"}
          onClick={() => { if (errorCount) setShowIssues(true); }}
        >
          {errorCount
            ? `Fix ${errorCount} error${errorCount === 1 ? "" : "s"} to save`
            : saving || autosaving
              ? "Saving…"
              : dirty
                ? draftAt ? `Draft saved ${draftAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Unsaved changes"
                : savedAt ? `All changes saved ${savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : reportId ? "Saved" : "Not saved yet"}
        </button>

        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={poppedOutHere ? bringPopoutForward : openPopout}
          title="Open the designer in its own window, so the rest of the application stays usable"
        >
          {poppedOutHere ? "Bring it forward" : "Pop out"}
        </button>
        <button type="button" className="btn-secondary text-xs" onClick={() => output("print")} disabled={!laid?.pages.length}>Print</button>
        <button type="button" className="btn-secondary text-xs" onClick={() => output("pdf")} disabled={!laid?.pages.length}>PDF</button>
        <button type="button" className="btn-secondary text-xs" onClick={() => output("excel")} disabled={!laid?.pages.length}>Excel</button>
        <button type="button" className="btn-secondary text-xs" onClick={() => output("csv")} disabled={!laid?.pages.length}>CSV</button>
        <button type="button" className="btn-primary text-xs" onClick={() => void save()} disabled={saving || errorCount > 0}>
          {saving ? "Saving…" : reportId ? "Save" : "Create report"}
        </button>
      </div>
      )}

      {/* The report is open in its own window, so this one steps back rather than letting two windows
          edit one document. */}
      {poppedOutHere && !poppedOut ? (
        <div className="surface-card flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <h2 className="text-base font-semibold text-white">{name || "This report"} is open in its own window</h2>
          <p className="max-w-md text-sm text-gray-400">
            The popped-out designer is the one editing it. Keep working here — the report saves itself as you
            type in that window — or bring it back into this one.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button type="button" className="btn-primary text-xs" onClick={bringPopoutForward}>Bring it forward</button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => { popoutWindow.current?.close(); popoutWindow.current = null; setPoppedOutHere(false); }}
            >Return it to this window</button>
          </div>
          <p className="text-[11px] text-gray-600">Closing that window returns the designer here on its own.</p>
        </div>
      ) : (
      <>
      <div className="flex-1 flex gap-3 min-h-0">
        {/* Palette */}
        <aside className="w-64 shrink-0 surface-card overflow-hidden flex flex-col">
          {redesign ? (
            /* The redesigned palette: the six things a report is made of, one at a time, in the order
               they are built. The classic column below shows every one of them at once, which is why
               it is still there. */
            <>
              <div className="flex flex-wrap gap-1 border-b border-surface-lighter px-2 py-2">
                {palettePanes.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPalettePane(item.id)}
                    aria-pressed={palettePane === item.id}
                    className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                      palettePane === item.id
                        ? "bg-cyber-600/15 text-cyber-200 border border-cyber-500/30"
                        : "border border-transparent text-gray-400 hover:bg-surface-lighter hover:text-white"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {palettePane === "bands" ? (
                <div className="flex-1 overflow-y-auto px-3 py-2">
                  <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Bands, in print order</h4>
                  <div className="space-y-1">
                    {document.bands.map(band => (
                      <button
                        key={band.id}
                        type="button"
                        onClick={() => { select({ kind: "band", bandId: band.id }); setTab("design"); }}
                        className={`w-full rounded border px-2 py-1.5 text-left text-[11px] transition-colors ${
                          selection.kind !== "report" && selection.bandId === band.id
                            ? "border-cyber-500/50 bg-cyber-600/10 text-white"
                            : "border-surface-lighter text-gray-300 hover:border-cyber-500/40"
                        }`}
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="capitalize">{band.kind.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                          <span className="tabular-nums text-gray-500">{band.height} mm</span>
                        </span>
                        <span className="text-[10px] text-gray-500">
                          {band.elements.length} element{band.elements.length === 1 ? "" : "s"}
                          {band.groupKey ? ` · grouped on ${band.groupKey}` : ""}
                          {band.pageBreakBefore ? " · starts a page" : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-[10px] leading-snug text-gray-500">
                    A band prints where it appears in this list. Selecting one makes the palette insert
                    into it.
                  </p>
                  <div className="mt-3 border-t border-surface-lighter pt-2">
                    <Palette
                      document={document}
                      catalog={catalog}
                      selection={selection}
                      onAddElement={onAddElement}
                      onEditElement={onEditElement}
                      onSelect={select}
                      pane="elements"
                    />
                  </div>
                </div>
              ) : null}

              {palettePane === "data" ? (
                <div className="flex-1 overflow-y-auto px-3 py-2">
                  <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">What this report reads</h4>
                  {document.dataSources.map(source => {
                    const label = catalog?.sources.find(candidate => candidate.key === source.source)?.label ?? source.source;
                    return (
                      <div key={source.key} className="mb-2 rounded border border-surface-lighter px-2 py-1.5 text-[11px]">
                        <p className="text-gray-200">{source.label || label}</p>
                        <p className="text-[10px] text-gray-500">
                          {label} · up to {source.limit} rows
                          {source.sortBy ? ` · sorted by ${source.sortBy} ${source.sortDir ?? "asc"}` : ""}
                          {source.filters.length ? ` · ${source.filters.length} filter${source.filters.length === 1 ? "" : "s"}` : ""}
                        </p>
                      </div>
                    );
                  })}
                  <p className="mt-2 text-[10px] leading-snug text-gray-500">
                    The Fields pane offers this source's columns, and the row limit is edited on the right
                    when the report itself is selected.
                  </p>
                  <button
                    type="button"
                    className="btn-secondary mt-3 w-full text-[11px]"
                    onClick={() => { select({ kind: "report" }); }}
                  >
                    Show the report's data settings
                  </button>
                </div>
              ) : null}

              {palettePane === "schedule" ? (
                <div className="flex-1 overflow-y-auto px-3 py-2">
                  <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Schedule</h4>
                  <p className="text-[11px] leading-snug text-gray-400">
                    A schedule runs this report on its own and mails it — once, daily, weekly or monthly,
                    as PDF, Excel or CSV.
                  </p>
                  <button
                    type="button"
                    className="btn-primary mt-3 w-full text-[11px]"
                    disabled={!reportId}
                    title={reportId ? "Choose when it runs and who receives it" : "Save the report first — a schedule needs something to run"}
                    onClick={() => setShowSchedule(true)}
                  >
                    Schedule this report…
                  </button>
                  {!reportId ? (
                    <p className="mt-2 text-[10px] leading-snug text-gray-500">
                      A report nobody has created has nothing to schedule yet. Save it, and this opens.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {palettePane === "fields" || palettePane === "expressions" || palettePane === "parameters" ? (
                <Palette
                  document={document}
                  catalog={catalog}
                  selection={selection}
                  onAddElement={onAddElement}
                  onEditElement={onEditElement}
                  onSelect={select}
                  pane={palettePane}
                />
              ) : null}
            </>
          ) : (
          <Palette
            document={document}
            catalog={catalog}
            selection={selection}
            onAddElement={onAddElement}
            onEditElement={onEditElement}
            onSelect={select}
          />
          )}
        </aside>

        {/* Canvas / preview / data */}
        <main ref={stageRef} className="flex-1 min-w-0 overflow-auto surface-card p-4">
          {tab === "design" ? (
            redesign ? (
              /* The stage, as the mockup has it: a rule along the top of the sheet, then the paper. The
                 ruler is measured in the sheet's own millimetres at the current zoom, so it says what
                 the position of an element actually is rather than decorating the space above it. */
              <div className="inline-block align-top">
                <div className="relative mb-1 h-4 select-none" style={{ width: mmToPx(paperWidth) * zoom }}>
                  <div
                    className="absolute inset-x-0 bottom-0 h-1.5"
                    style={{
                      backgroundImage: "repeating-linear-gradient(to right, rgba(148,163,184,.55) 0 1px, transparent 1px 100%)",
                      backgroundSize: `${mmToPx(10) * zoom}px 100%`,
                    }}
                  />
                  {Array.from({ length: Math.floor(paperWidth / 50) }, (_, index) => (index + 1) * 50).map(mm => (
                    <span key={mm} className="absolute bottom-1.5 -translate-x-1/2 text-[9px] tabular-nums text-gray-500" style={{ left: mmToPx(mm) * zoom }}>{mm}</span>
                  ))}
                </div>
                <DesignerCanvas
                  document={document}
                  page={paper ?? undefined}
                  accent={ink.accent}
                  selection={selection}
                  zoom={zoom}
                  issues={issues}
                  values={values}
                  charts={charts}
                  showGrid={showGrid}
                  showBandGuides={showBandGuides}
                  onSelect={select}
                  onDocument={applyDocument}
                  onDropField={onDropField}
                />
              </div>
            ) : (
              <DesignerCanvas
                document={document}
                page={paper ?? undefined}
                accent={ink.accent}
                selection={selection}
                zoom={zoom}
                issues={issues}
                values={values}
                charts={charts}
                onSelect={select}
                onDocument={applyDocument}
                onDropField={onDropField}
              />
            )
          ) : null}

          {tab === "preview" ? (
            laid && laid.pages.length ? (
              <div className="space-y-4">
                {laid.issues.filter(issue => issue.severity === "warning").length ? (
                  <div className="rounded border border-amber-600/40 bg-amber-600/10 p-2 text-[11px] text-amber-200">
                    {laid.issues.filter(issue => issue.severity === "warning").map((issue, index) => <p key={index}>{issue.message}</p>)}
                  </div>
                ) : null}
                {laid.pages.map(page => (
                  <LaidOutPageView key={page.number} page={page} laid={laid} zoom={zoom} />
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-400 p-4">
                {laid?.refused
                  ? "This template cannot generate a preview until its errors are fixed."
                  : "The preview will appear once the data source returns rows."}
              </div>
            )
          ) : null}

          {tab === "data" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                {document.parameters.map(parameter => (
                  <label key={parameter.key} className="block">
                    <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">{parameter.label || parameter.key}</span>
                    <input
                      type={parameter.type === "date" ? "date" : "text"}
                      className="bg-surface-light border border-surface-lighter rounded px-2 py-1 text-xs text-gray-100"
                      value={parameters[parameter.key] ?? parameter.defaultValue ?? ""}
                      onChange={event => setParameters(current => ({ ...current, [parameter.key]: event.target.value }))}
                    />
                  </label>
                ))}
                <label className="block">
                  <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">Period from</span>
                  <input type="date" className="bg-surface-light border border-surface-lighter rounded px-2 py-1 text-xs text-gray-100" value={from} onChange={event => setFrom(event.target.value)} />
                </label>
                <label className="block">
                  <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">Period to</span>
                  <input type="date" className="bg-surface-light border border-surface-lighter rounded px-2 py-1 text-xs text-gray-100" value={to} onChange={event => setTo(event.target.value)} />
                </label>
                <p className="text-[10px] text-gray-500 max-w-sm">
                  A designed report filters on what the template declares; the period is passed in as the
                  parameters <code>from</code> and <code>to</code> for a filter to use.
                </p>
              </div>

              {run?.notes.length ? (
                <div className="rounded border border-amber-600/40 bg-amber-600/10 p-2 text-[11px] text-amber-200 space-y-0.5">
                  {run.notes.map((note, index) => <p key={index}>{note}</p>)}
                </div>
              ) : null}

              <div className="overflow-auto max-h-[60vh] border border-surface-lighter rounded">
                <table className="w-full text-xs">
                  <thead className="bg-surface-lighter sticky top-0">
                    <tr>
                      {(run?.columns ?? []).map(column => (
                        <th key={column} className="text-left px-2 py-1 text-gray-300 whitespace-nowrap">{labelFor(column)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(run?.rows ?? []).slice(0, 200).map((row, index) => (
                      <tr key={index} className="border-t border-surface-lighter/60">
                        {(run?.columns ?? []).map(column => (
                          <td key={column} className="px-2 py-1 text-gray-400 whitespace-nowrap">
                            {row[column] === null || row[column] === undefined ? "—" : typeof row[column] === "object" ? JSON.stringify(row[column]) : String(row[column])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-gray-500">
                {run?.truncated ? `Stopped at the row limit of ${run.limit}.` : `${run?.rows.length ?? 0} rows from ${document.dataSources[0]?.source ?? "—"}.`}
              </p>
            </div>
          ) : null}

          {/* The status line the mockup carries sits *below the three panels*, across the whole width,
              so it describes the designer rather than the canvas — what is selected, how tall the band
              is, what the last run returned, and how the page is set up. The classic designer has no
              status line, and keeps none. */}
        </main>

        {/* Property grid */}
        <aside className="w-80 shrink-0 surface-card overflow-y-auto">
          <Inspector
            document={document}
            catalog={catalog}
            templates={catalog?.templates ?? []}
            selection={selection}
            issues={issues}
            onSelect={select}
            onDocument={applyDocument}
            onName={value => { setName(value); setDirty(true); }}
            onDescription={value => { setDescription(value); setDirty(true); }}
          />
          <section className="px-3 py-3">
            <h4 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">Shortcuts</h4>
            <ul className="text-[10px] text-gray-500 space-y-1">
              <li>Drag to move · Alt for fine placement · arrows nudge (Shift for 5mm)</li>
              <li>Ctrl+Z undo · Ctrl+Shift+Z redo · Ctrl+D duplicate · Delete removes</li>
              <li>Ctrl+S saves · document version {DOCUMENT_VERSION}</li>
              <li>{AGGREGATE_SCOPES.length} aggregate scopes: report, group, page</li>
            </ul>
          </section>
        </aside>
      </div>

      {/* The status bar, across the whole width and below all three panels — the mockup's arrangement,
          and the reason it moved: inside the centre column it read as a caption on the canvas, while
          what it describes is the designer as a whole. */}
      {redesign ? (
        <div className="surface-card flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[11px] text-gray-500">
          <span>Selected <b className="font-medium text-gray-300">{selectionLabel}</b></span>
          <span>· Band height <b className="font-medium text-gray-300">{bandHeightLabel}</b></span>
          <span>· <b className="font-medium text-gray-300">{run?.rows.length ?? 0}</b> row{run?.rows.length === 1 ? "" : "s"}</span>
          <span>· <b className="font-medium text-gray-300">{laid?.pages.length ?? 0}</b> page{laid?.pages.length === 1 ? "" : "s"}</span>
          <span>· {pageSetupLabel}</span>
          <span className="ml-auto">{errorCount ? "Fix the errors before this can save" : warningCount ? "Saves with warnings" : "Preview updates as you type"}</span>
        </div>
      ) : null}
      </>
      )}

      {showSchedule && reportId ? <ScheduleReportDialog reportId={reportId} onClose={() => setShowSchedule(false)} /> : null}

      {/* Clicking away with unsaved changes asks once, and the answer is already on the device. */}
      {showDraftPrompt ? (
        <div className="surface-card flex flex-wrap items-center gap-2 border-l-2 border-l-amber-500 px-3 py-2 text-xs">
          <span className="text-amber-300">You looked away with unsaved changes.</span>
          <span className="text-gray-400">
            {draftAt ? `A draft was saved on this device at ${draftAt.toLocaleTimeString()}.` : "A draft will be saved on this device."}
          </span>
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={() => { setShowDraftPrompt(false); void save(); }}
            disabled={errorCount > 0}
          >Save it now</button>
          <button type="button" className="btn-secondary text-xs" onClick={() => { if (document) saveDraftLocally(document); setShowDraftPrompt(false); }}>
            Save a draft
          </button>
          <button type="button" className="text-xs text-gray-400 hover:text-gray-200" onClick={() => setShowDraftPrompt(false)}>
            Keep editing
          </button>
        </div>
      ) : null}

      {/* Validation */}
      {showIssues ? (
        <div className="surface-card px-3 py-2 max-h-40 overflow-auto">
          {!issues.length ? <p className="text-xs text-green-400">No problems found. A template saves when it has no errors.</p> : null}
          {issues.map((issue, index) => (
            <button
              key={`${issue.path}-${index}`}
              type="button"
              className="w-full text-left text-[11px] py-0.5 hover:bg-surface-lighter/50 rounded px-1"
              onClick={() => {
                if (issue.elementId && issue.bandId) setSelection({ kind: "element", bandId: issue.bandId, elementId: issue.elementId });
                else if (issue.bandId) setSelection({ kind: "band", bandId: issue.bandId });
                else setSelection({ kind: "report" });
                setTab("design");
              }}
            >
              <span className={issue.severity === "error" ? "text-red-400" : "text-amber-400"}>{issue.severity === "error" ? "Error" : "Warning"}</span>
              <span className="text-gray-500 font-mono ml-2">{issue.path}</span>
              <span className="text-gray-300 ml-2">{issue.message}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default ReportDesignerPage;
