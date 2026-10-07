> **Plan ID:** PLAN-020
> **Title:** Custom Report Designer — build it here, embed jsreport, or buy
> **Source:** authored in `PlanDocs/` — the decision requested with the Custom Reports landing page
> **Indexed:** 2026-10-07

# Custom Report Designer

> **Sequence:** follows the Reporting overhaul (BuildNotes **2026.10.7.025**). The Reporting section now ships **12 standard reports** with a shared filter set, **Weekly / Monthly / Quarterly Business Reviews** from one pack at three cadences, working Print/PDF/Excel/CSV, and a **Custom Reports** landing page that lists, runs, schedules and manages saved reports. The visual designer — bands, groups, totals, an expression language, a page preview — was the piece still to be written; **it shipped in BuildNotes 2026.10.7.026** (phases 1–5 below), so this document is now a record of the decision and of what each phase delivered rather than a proposal.
> **Status:** ✅ **Built here, as recommended.** The banded designer is in the product: `packages/shared/src/reportTemplate.ts`, `reportExpression.ts` and `reportLayout.ts` for the document, the language and the engine; `apps/web/src/pages/ReportDesigner.tsx` with `components/reports/designer/` for the canvas, palette and property grid; `POST /reports/designer/{validate,preview}`, `GET /reports/designer/{catalog,starter}` and a `template` branch on run. **Phase 6 — sub-reports, charts as elements and cross-page aggregates — has not been built** and is the remaining work.
> **Basis:** repository as at BuildNotes **2026.10.7.026**; external facts verified on 2026-10-07 and cited inline, with the sources listed in §9. Where a licence could not be verified it is marked **unverified** rather than guessed.
> **Next action:** none for phases 0–5. Phase 6 is a separate decision, and §10's remaining open items are the ones listed there.

---

## 1. What "a custom report" means in this product today

| Layer               | What exists now                                                                                                                                                                                                                          | Where                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Engine**          | `runReportConfig` — a whitelisted, config-driven runner over 7 sources (tickets, invoices, time entries, expenses, assets, contacts, companies) with 10 operators, `groupBy`, sorting and a row limit. No SQL, no arbitrary field names. | `apps/api/src/services/reportRunner.ts`                                  |
| **Storage**         | `Report` (name, description, type, JSON config, author, `isSystem`) and `ReportSchedule` (frequency, day, time, recipients, format, `lastSentAt`).                                                                                       | `apps/api/prisma/schema.prisma`                                          |
| **Authoring**       | A guided form (source, columns, one filter, group-by, sort, limit) plus a raw JSON box for the shapes the form does not cover.                                                                                                           | `apps/web/src/pages/CustomReports.tsx`                                   |
| **Running**         | Run, Print, PDF, Excel, CSV, duplicate, schedule, edit, delete; saved reports of a standard type are rendered by that standard report's own builder so the two cannot disagree.                                                          | `apps/web/src/pages/CustomReports.tsx`, `apps/api/src/routes/reports.ts` |
| **Rendering**       | One section model (`kpis`, `bars`, `table`, `notes`, `facts`) that the screen, the print window and every export all read.                                                                                                               | `apps/web/src/components/reports/reportKit.tsx`                          |
| **PDF**             | jsPDF + jspdf-autotable, client-side, one table per section.                                                                                                                                                                             | `apps/web/src/components/reports/reportKit.tsx`                          |
| **Excel**           | SpreadsheetML 2003 (`.xls`), one sheet per section, typed cells — written by hand, no dependency.                                                                                                                                        | same                                                                     |
| **What is missing** | Any layout the *user* designs: bands, absolute positioning, sub-reports, running totals, page breaks, an expression language, a designer canvas.                                                                                         | —                                                                        |

So the question is narrow: **what produces a user-designed layout, and what renders it to a page?**

---

## 2. Recommendation

> **Build the banded designer in this repository, on a JSON template document, and keep the existing engines. Take a three-phase route: (1) a banded *template* model with a **form-driven** builder and the current section renderers, (2) a **canvas** designer over that model, (3) an **expression language** and sub-reports. Do not embed jsreport.**

Three reasons, in order of weight:

1. **jsreport is not the licence it is usually assumed to be, and it is not banded.** The engine and the templating engines are **LGPL** (`@jsreport/jsreport-core`, `jsreport-express`, `jsreport-handlebars`, `jsreport-jsrender`, and the meta `jsreport` package all declare `"license": "LGPL"`), while the studio and the PDF/Excel recipes are MIT (`@jsreport/jsreport-studio`, `jsreport-chrome-pdf`, `jsreport-xlsx`, `jsreport-pdf-utils`). On top of the code licence there is a **commercial** licence gating production use: the free tier is capped at **5 stored templates**, and the tier that covers *"deploying as part of another product to multiple customers"* is the paid Enterprise-Scale one. ([package manifests](https://github.com/jsreport/jsreport/tree/master/packages), [jsreport pricing](https://jsreport.net/buy), [FAQ](https://jsreport.net/learn/faq).)
2. **jsreport has no banded WYSIWYG designer to adopt.** There is no band/designer package in its monorepo; "banding" is hand-authored HTML plus Handlebars/JsRender loops in the studio's **code editor**, optionally with `pdf-utils` for headers and footers. Adopting it therefore does **not** deliver the feature the brief asks for — it delivers a code editor, a second server, a Puppeteer dependency for PDF, and a licence ceiling.
3. **Our data model is already the right shape.** A report here is a *config over whitelisted sources*, and the renderer is a *section list*. Bands are a richer document, but they are the same kind of thing: JSON, validated on write, rendered from a single model by every output. Extending that is months of work; adopting jsreport is a second runtime plus a licence question for a capability we would still have to build.

**What we would borrow instead:** the *feature set* (from Crystal Reports / FastReport) and the *document shape* (from JasperReports' JRXML), neither of which is a code dependency. FastReport Open Source is **MIT but .NET-only** with **no Node binding** ([LICENSE](https://github.com/FastReports/FastReport), [README](https://github.com/FastReports/FastReport)); JasperReports **Library** is **LGPL-3.0** (Java) and **Server CE is AGPL-3.0** ([LICENSE](https://github.com/TIBCOSoftware/jasperreports), [server CE](https://github.com/suncoderus/jasperreports-server-ce)); the mature JavaScript banded designers are **commercial** (Stimulsoft, DevExpress, Bold Reports/Syncfusion, ActiveReportsJS/MESCIUS, Telerik). The only genuinely open-source *banded* JavaScript designer verified is **ReportBro**, which is **AGPL-3.0 or paid** with a **Python-only renderer** ([designer LICENSE](https://github.com/jobsta/reportbro-designer), [lib LICENSE](https://github.com/jobsta/reportbro-lib), [pricing](https://www.reportbro.com/pricing/index)) — a poor fit for a TS/Node API and a licence we cannot accept for a closed-source product.

**The honest cost of the recommendation:** a layout engine is the most expensive thing in this document. §5 names what it costs and §8 what it would take to change our mind.

---

## 3. The options, with what each actually delivers

| Option                                                                 | Licence                                                                             | Runs where                                                                                                   | Banded designer?                                     | Delivers the brief?                         | Cost                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| **jsreport (embed)**                                                   | **LGPL** engine + **MIT** studio/recipes + **commercial** cap of 5 stored templates | Node, embeddable in our Express app or headless; **Puppeteer/Chrome needed for PDF**                         | **No** — code editor, hand-written HTML + Handlebars | Partly (a template editor, not bands)       | A second service, a 280 MB Chrome image, a licence decision            |
| **ReportBro**                                                          | **AGPL-3.0 or paid**                                                                | Designer in the browser; **renderer is Python**                                                              | **Yes**                                              | Yes in principle                            | A Python sidecar, plus AGPL or a commercial licence                    |
| **FastReport Open Source**                                             | **MIT**                                                                             | **.NET only** ([no Node binding](https://github.com/FastReports/FastReport); a .NET sidecar is an inference) | Yes (its native designer is not MIT)                 | Only via a .NET sidecar                     | A second runtime and a service boundary                                |
| **JasperReports**                                                      | Library **LGPL-3.0**, Server CE **AGPL-3.0**                                        | Java                                                                                                         | Yes                                                  | Via a Java service                          | JVM sidecar; Java/JRXML skills                                         |
| **Stimulsoft / DevExpress / Bold Reports / ActiveReportsJS / Telerik** | Commercial (**terms unverified** — see §8)                                          | JS or .NET                                                                                                   | Yes                                                  | Yes                                         | Per-developer or per-deployment licence                                |
| **Build it here**                                                      | Our own code                                                                        | Our stack                                                                                                    | Yes, by definition                                   | Yes                                         | §5's estimate                                                          |
| **`@react-pdf/renderer`** (renderer only)                              | **MIT**                                                                             | Node + browser, React components                                                                             | N/A — a renderer                                     | A PDF path without Chrome                   | Small; it is a dependency, not a designer                              |
| **pdfmake** (renderer only)                                            | **MIT**                                                                             | Node + browser                                                                                               | N/A                                                  | A JSON-document PDF writer                  | Small                                                                  |
| **Headless Chrome** (Puppeteer/Playwright)                             | Apache-2.0                                                                          | Node driving Chrome                                                                                          | N/A                                                  | Highest HTML/CSS fidelity, real page breaks | **~282 MB** download on Linux (pnpm blocks install scripts by default) |

**Note on what we already have:** the current jsPDF + autotable path is the lightest and most deterministic of the PDF options — we control every coordinate — and it needs no Chrome and no second runtime. The trade is that **pagination is ours to implement**, which §5 says is the hard part either way.

---

## 4. The document model (borrowed, not copied)

FastReport's band set is the canonical one — *Report Title, Report Summary, Page Header, Page Footer, Column Header, Column Footer, Data Header, Data, Data Footer, Group Header, Group Footer, Child and Overlay* ([README](https://github.com/FastReports/FastReport)) — and JasperReports' JRXML is the best free reference for a **serialisable band schema**, because its bands are literally elements: `<title>`, `<pageHeader>`, `<columnHeader>`, `<detail>`, `<group>`, `<summary>` ([sample JRXML](https://github.com/TIBCOSoftware/jasperreports)). A JSON schema modelled on those bands is self-documenting and reviewable:

```
ReportTemplate {
  id, name, description, version,           // version lets an old template keep running
  page:    { size, orientation, margins, unit }        // unit: mm, so print and screen agree
  dataSources: [{ key, kind: standard|custom, source, filters, sort, limit }]
  parameters: [{ key, label, type, required, default }]
  bands: [
    { kind: "reportTitle" | "pageHeader" | "columnHeader" | "groupHeader" | "detail"
           | "groupFooter" | "columnFooter" | "pageFooter" | "reportSummary" | "child"
      height, repeatOnNewPage?, groupKey?, elements: [ … ] }
  ]
  groups: [{ key, expression, sort, keepTogether, pageBreakBefore? }]
}

Element =
  | { type: "text",     x, y, w, h, expression, style }
  | { type: "field",    x, y, w, h, expression, format, style }
  | { type: "image",    x, y, w, h, src }
  | { type: "line" | "box" | "rectangle", x, y, w, h, style }
  | { type: "aggregate", x, y, w, h, function: sum|min|max|avg|count, expression, scope: report|group|page }
  | { type: "chart",    x, y, w, h, kind, series, categories }
  | { type: "subreport",x, y, w, h, templateId, parameterBindings }
```

**Rules that make it safe.** A template is user input, so it gets the same treatment as every other user input in this codebase:

- **Validated on write** (bands, element types, coordinates, expressions) and **re-validated on render** — a stored document is not trusted just because it was stored once.
- **Every expression is evaluated by our own interpreter over a fixed AST**, never `eval` and never a template engine that can reach the filesystem. (jsreport sandboxes user code by default via `trustUserCode`, which is evidence that this is a real requirement.)
- **Data comes from the same whitelisted runner** (`runReportConfig`) or a standard report — a template cannot introduce a source, a column or an operator that the runner does not already allow, and it cannot widen client scoping.

---

## 5. What building it costs, honestly

| Workstream                                          | Why it is hard                                                                                                                                                                                                                    | Realistic size        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **1. Template model + storage + validation**        | A schema, a migration, an API, and validation on both write and render.                                                                                                                                                           | Small — days.         |
| **2. Banded builder over the model (form-driven)**  | Bands, elements, data binding and the six standard reports expressed as templates. No canvas yet.                                                                                                                                 | Moderate — 2–3 weeks. |
| **3. Canvas designer**                              | Drag/resize, band reordering, property grid, snapping, undo/redo, zoom, keyboard. This is a UI product in its own right.                                                                                                          | Large — 6–10 weeks.   |
| **4. Pagination and layout engine**                 | Two passes (measure, then place); break on detail overflow, group change, page-footer reservation; repeat page/column headers; keep-together rules. **This is the single biggest cost and the reason self-built designers fail.** | Large — 4–8 weeks.    |
| **5. Expression language**                          | A parser, an AST, a safe evaluator, functions and aggregates, and useful error messages pointing at the element.                                                                                                                  | Moderate — 2–3 weeks. |
| **6. Renderers**                                    | Screen (React, from the same document), PDF (jsPDF coordinates or `@react-pdf/renderer`), Excel (per-band sheet or tabular export), CSV.                                                                                          | Moderate — 2–4 weeks. |
| **7. Sub-reports, charts, aggregates across pages** | Recursion, shared page context, running totals.                                                                                                                                                                                   | Moderate — 2–4 weeks. |
| **8. Print fidelity**                               | WYSIWYG on screen ≠ PDF unless both come from one layout engine — which is why step 6 renders *from the document*, not from the DOM.                                                                                              | Included in 4 and 6.  |

**Risks, named:**

- **Text measurement and PDF text layout** — wrapping, ligatures, non-Latin scripts and keep-together rules. Borrow a real text engine (`@react-pdf/renderer`, MIT, has flexbox-like primitives and no HTML requirement) rather than hand-rolling glyph metrics.
- **Grouping and aggregation across pages** — running totals and per-page sub-totals are where a "finished" engine turns out not to be.
- **A second renderer to keep in step** — screen and PDF must read one model, which is exactly the rule the current `reportKit` enforces and must stay enforced.
- **Maintenance forever.** Once templates exist, they are a compatibility surface: `version` in the document is what lets an old template keep rendering after the engine changes.

**The pragmatic middle ground, and what I would actually ship first.** Phases 1–2 plus steps 5–6 give a **banded, form-driven template builder with an expression language and real PDF/Excel**, in weeks rather than months, and it covers most of what a PSA customer asks for (a header, a grouped detail band, totals, a footer). The canvas (step 3) and sub-reports (7) can follow behind it without changing the document format — which is the whole point of defining the document first.

---

## 6. Phases, in order, each with an exit condition

| Phase | Deliverable                                                                                        | Exit condition                                                                                                                      | Status                                                                         |
| ----- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **0** | This document accepted; the document model in §4 reviewed and frozen as the compatibility surface. | The schema is agreed before any renderer is written.                                                                                | ✅ 2026.10.7.026 — frozen as `packages/shared/src/reportTemplate.ts`            |
| **1** | `ReportTemplate` model + validation + API; the six standard reports re-expressible as templates.   | `probe-report-templates.mjs` green: an invalid template is refused on write *and* on render; a valid one round-trips.               | ✅ Shipped — `probe-report-designer.mjs` asserts both refusals, 225/225         |
| **2** | Form-driven banded builder: add/reorder bands, bind fields, preview from the document.             | A grouped report with a header, a detail band and totals renders identically on screen and in PDF for the same document.            | ✅ Shipped — the property grid builds every band the model has                  |
| **3** | Expression language: parser, AST, sandboxed evaluator, aggregates, per-element errors.             | No expression can reach the filesystem, the network or the database; a bad expression names its element and does not fail the page. | ✅ Shipped — 40 functions, three aggregate scopes, the escape attempts asserted |
| **4** | Renderers: PDF (jsPDF or `@react-pdf/renderer`), Excel, CSV — all from the document.               | The same template produces a PDF whose page breaks match the preview, and an Excel file with one row per detail row.                | ✅ Shipped on jsPDF, in millimetres from the layout's own coordinates           |
| **5** | Canvas designer (drag, resize, property grid, undo/redo).                                          | A non-developer builds a two-group report without touching JSON.                                                                    | ✅ Shipped — drag, resize, snapping, keyboard, undo/redo                        |
| **6** | Sub-reports, charts, cross-page aggregates.                                                        | A sub-report inherits the parent's parameters and does not corrupt the parent's page count.                                         | ⬜ **Not built** — the remaining work                                           |

**What stays untouched:** the standard reports, the section model in `reportKit`, the current custom reports and their schedules. A template is an **extra** type (`Report.type = "template"`), so nothing that exists today changes behaviour.

---

## 7. The two cheap steps that are worth doing regardless

1. **Make the renderers document-driven now.** `reportKit` already turns sections into tables for print, PDF, Excel and CSV. A banded template only needs a second producer of the same *document* shape, which means the export paths can be reused unchanged. Doing this as part of any future work is free; doing it later means rewriting every exporter.
2. **Give the config editor the same validation as the designer will need.** `runReportConfig` already drops unknown columns and operators and *says so* in `notes`. Surfacing those notes in the editor — as warnings on the field that caused them — is small, useful today, and is the precursor to the designer's own validation UI.

---

## 8. What would change this recommendation

- **A permissively-licensed, actively-maintained banded JavaScript designer appearing** (MIT/Apache, browser-embeddable, Node/JS renderer). The search that produced this document found **0** results for banded JS designers on GitHub, which may be a search artefact — worth re-checking with an npm search for `report designer` / `report builder` and by checking `@boldreports/react-reporting` and `@grapecity/activereports-react` directly (both commercial, **terms unverified**).
- **A decision to accept AGPL or a paid licence.** ReportBro would then be the fastest route to real bands, at the cost of a Python renderer in the image.
- **A requirement that a customer's own SQL be reportable.** That changes the data layer, not the designer, and would need a different security conversation entirely.

---

## 9. Sources

**jsreport** — [core](https://github.com/jsreport/jsreport/tree/master/packages) (LGPL), [studio](https://github.com/jsreport/jsreport/tree/master/packages) (MIT), [pricing](https://jsreport.net/buy), [FAQ](https://jsreport.net/learn/faq), [studio configuration](https://jsreport.net/learn/studio), [adapting jsreport into an existing app](https://jsreport.net/learn/adapting-jsreport), [child templates](https://jsreport.net/learn/child-templates), [pdf-utils](https://jsreport.net/learn/pdf-utils), [template stores](https://jsreport.net/learn/template-stores), [configuration and `trustUserCode`](https://jsreport.net/learn/configuration).
**Alternatives** — [FastReport OS](https://github.com/FastReports/FastReport) (MIT, .NET), [JasperReports Library](https://github.com/TIBCOSoftware/jasperreports) (LGPL-3.0) and its [JRXML sample](https://github.com/TIBCOSoftware/jasperreports), [JasperReports Server CE](https://github.com/suncoderus/jasperreports-server-ce) (AGPL-3.0), [ReportBro designer](https://github.com/jobsta/reportbro-designer) / [lib](https://github.com/jobsta/reportbro-lib) (AGPL-3.0 or paid) and [pricing](https://www.reportbro.com/pricing/index), [Carbone](https://github.com/carboneio/carbone), [pdfme](https://github.com/pdfme/pdfme) (MIT, not banded), [pdfmake](https://github.com/bpampuch/pdfmake) (MIT), [@react-pdf/renderer](https://github.com/diegomura/react-pdf) (MIT), [ReportLab](https://pypi.org/pypi/reportlab/json) (BSD), [WeasyPrint](https://github.com/Kozea/WeasyPrint) (BSD-3).
**Commercial** — [Stimulsoft licensing](https://www.stimulsoft.com/en/licensing), [DevExpress subscriptions](https://www.devexpress.com/subscriptions/reporting/) and [EULAs](https://www.devexpress.com/support/eulas/), [Bold Reports pricing](https://www.boldreports.com/pricing), [Syncfusion community licence](https://www.syncfusion.com/products/communitylicense), [ActiveReportsJS pricing](https://developer.mescius.com/activereportsjs/pricing), [Telerik Reporting](https://www.telerik.com/products/reporting.aspx). *(Crystal Reports licence could not be verified — SAP's pages return 403 or a shell.)*
**PDF engines** — [Puppeteer installation](https://pptr.dev/guides/installation) (Chrome for Testing ~282 MB on Linux; pnpm blocks install scripts by default), [Puppeteer](https://github.com/puppeteer/puppeteer) and [Playwright](https://github.com/microsoft/playwright) (Apache-2.0), [jsPDF](https://github.com/parallax/jsPDF) and [jspdf-autotable](https://registry.npmjs.org/jspdf-autotable/latest) (MIT).

---

## 10. Decisions this document is waiting on

| #   | Decision                                                                   | Owner              | Blocks                                                               |
| --- | -------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------- |
| 1   | Accept §2 (build it here) or reject it for jsreport / a commercial product | Product owner      | Phase 0                                                              |
| 2   | Freeze the §4 document model as the compatibility surface                  | Engineering        | Phases 1–6                                                           |
| 3   | PDF renderer: extend jsPDF, or add `@react-pdf/renderer` (MIT)             | Engineering        | Phase 4                                                              |
| 4   | Whether a customer may bring their own SQL source                          | Product + Security | Outside this plan; changes the data layer                            |
| 5   | Priority of the canvas (Phase 5) against the form-driven builder (Phase 2) | Product owner      | Phase ordering only — the document format does not change either way |

---

## 11. Keeping this document honest

When a phase ships, mark it here and in `PlanDocs/README.md`, and record the version in `BuildNotes.md` — a plan that quietly disagrees with the code is worse than no plan. When a licence in §3 is confirmed or found wrong, correct §3 and §9 in the same commit; **unverified** entries stay marked until they are checked.

**Phases 0–5 shipped in BuildNotes 2026.10.7.026** and are marked in §6, and §10 records what each decision became. Phase 6 has not been built. Two things are worth adding when phase 6 is taken up, both learned while building 0–5:

- **A document is read by three parties** — the API's validator, the browser's canvas and engine, and the probe suite — so anything added to it belongs in `packages/shared`, where all three see it. The engine was put there for that reason, and putting it in the web app instead would have made "re-validated on render" impossible to assert.
- **A new element must be valid where it lands.** The first version of the palette added a field to a 6mm band and produced a validation error on creation; the defaults of a designer are its instructions, so placement arithmetic belongs with the placement.

