/**
 * The custom report designer (PLAN-020).
 *
 * What is under test:
 *   1. **The expression language**, which is the part a user's template is made of: arithmetic, text,
 *      dates, comparisons, `IN`, `LIKE`, aggregates, and the error messages that name what went wrong.
 *   2. **That the language is not a door into the process.** `Math.max(...)`, `globalThis`,
 *      `constructor(...)` and `;` are all refused or inert, no function reaches the filesystem or the
 *      network, and neither engine source contains `eval` or `new Function`. A template is user input,
 *      so this is asserted rather than assumed.
 *   3. **Validation on write and again on render.** A document that cannot render cannot be saved, and a
 *      document that was saved and then damaged still refuses to lay out.
 *   4. **The layout engine**: pagination, repeated page bands, grouping, group and report totals, page
 *      totals resolved *after* pagination, text wrapping and clipping, and the row limit.
 *   5. **The API's own whitelist** — the catalog the designer reads is the runner's, so a field cannot
 *      be offered unless a report can read it.
 *   6. **The endpoints**: starter, validate, preview, and a template as a saved report that runs,
 *      refuses invalid documents, and stays inside a client-scoped account's data.
 *
 * Run from apps/api with tsx, because it imports the shared TypeScript modules directly and they use
 * extensionless imports:
 *
 *     npx tsx probe-report-designer.mjs
 *
 * Requires the API with sample data.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  createBand, createBlankDocument, createElement, createStarter, normaliseDocument, validateTemplate, errorsOf,
  BAND_KINDS, DOCUMENT_VERSION,
} from "../../packages/shared/src/reportTemplate.ts";
import { layoutReport } from "../../packages/shared/src/reportLayout.ts";
import { evaluateExpression, parseExpression, FUNCTIONS } from "../../packages/shared/src/reportExpression.ts";
import { formatValue } from "../../packages/shared/src/reportFormat.ts";

const BASE = "http://127.0.0.1:4000";
const PW = "Persona-Dev-Only-2026!";
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
const check = (ok, label) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};
const section = title => console.log(`\n${title}`);

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function signIn(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, token: data.token };
}

/** The same deterministic estimate the browser falls back to when it has no canvas. */
const measure = (text, style) => text.length * style.fontSize * 0.5 * (25.4 / 72);
const context = (fields, extra = {}) => ({ fields, parameters: {}, report: {}, page: {}, group: null, ...extra });

/** The administrator's row count for the ticket starter, so a scoped account can be compared to it. */
let adminPreviewRows = 0;

const text = (value, x, y, w, h, style) => createElement("text", { x, y, w, h, text: value, ...(style ? { style: { ...createElement("text").style, ...style } } : {}) });
const field = (expression, x, y, w, h, format) => createElement("field", { x, y, w, h, expression, format: format ?? "text" });
const total = (fn, expression, scope, x, y, w, h, format) => createElement("aggregate", { fn, expression, scope, x, y, w, h, format: format ?? "number" });

/** A document with a header, a column caption, a data band and a page footer, at A4 with 10mm margins. */
function harnessDocument({ detailHeight = 5, extraBand = null, groups = [], summary = null, rows = 1 } = {}) {
  const document = createBlankDocument("Harness", "tickets");
  document.page = { size: "a4", orientation: "portrait", width: 210, height: 297, margins: { top: 10, right: 10, bottom: 10, left: 10 } };
  const header = createBand("pageHeader", { height: 10 });
  header.elements = [text("Client report", 0, 0, 80, 5, { fontSize: 12, bold: true })];
  const columnHeader = createBand("columnHeader", { height: 6 });
  columnHeader.elements = [text("Ticket", 0, 0, 60, 5), text("Amount", 120, 0, 40, 5, { align: "right" })];
  const detail = createBand("detail", { height: detailHeight });
  detail.elements = [field("Fields.ticketNumber", 0, 0, 60, detailHeight), field("Fields.amount", 120, 0, 40, detailHeight, "money")];
  const pageFooter = createBand("pageFooter", { height: 6 });
  pageFooter.elements = [text("Page {{Page.number}} of {{Page.totalPages}}", 0, 0, 60, 5)];
  document.bands = [header, columnHeader, detail, ...(extraBand ? [extraBand] : []), ...(summary ? [summary] : []), pageFooter];
  document.groups = groups;
  void rows;
  return document;
}

async function main() {
  section("the expression language");
  {
    check(evaluateExpression("1 + 2 * 3", context({})) === 7, "multiplication binds tighter than addition");
    check(evaluateExpression("(1 + 2) * 3", context({})) === 9, "and brackets override it");
    check(evaluateExpression("10 / 4", context({})) === 2.5, "division is real division, not integer");
    check(evaluateExpression("7 % 4", context({})) === 3, "modulo works");
    check(evaluateExpression("-Fields.amount", context({ amount: 4 })) === -4, "a field can be negated");
    check(evaluateExpression("'a' + 'b'", context({})) === "ab", "plus concatenates text");
    check(evaluateExpression("'n=' + Fields.n", context({ n: 3 })) === "n=3", "and coerces a number into the string");
    check(evaluateExpression("Fields.a = 1 AND Fields.b = 2", context({ a: 1, b: 2 })) === true, "AND holds");
    check(evaluateExpression("Fields.a = 1 AND Fields.b = 3", context({ a: 1, b: 2 })) === false, "and fails when one side does");
    check(evaluateExpression("Fields.a = 9 OR Fields.b = 2", context({ a: 1, b: 2 })) === true, "OR holds");
    check(evaluateExpression("NOT Fields.a = 9", context({ a: 1 })) === true, "NOT negates");
    check(evaluateExpression("Fields.status IN ('new', 'open')", context({ status: "open" })) === true, "IN matches a list");
    check(evaluateExpression("Fields.status IN ('new', 'closed')", context({ status: "open" })) === false, "and misses one it should");
    check(evaluateExpression("Fields.title LIKE '%urgent%'", context({ title: "A very URGENT thing" })) === true, "LIKE is case-insensitive");
    check(evaluateExpression("Fields.title LIKE 'urgent%'", context({ title: "A very urgent thing" })) === false, "and anchored where the pattern is");
    check(evaluateExpression("Fields.missing = NULL", context({})) === true, "an absent value is null");
    check(evaluateExpression("IF(Fields.n > 2, 'high', 'low')", context({ n: 5 })) === "high", "IF chooses");
    check(evaluateExpression("IF(Fields.n > 2, 'high', 'low')", context({ n: 1 })) === "low", "and chooses the other way");
    check(evaluateExpression("COALESCE(Fields.missing, Fields.fallback)", context({ fallback: "used" })) === "used", "COALESCE skips an empty value");
    check(evaluateExpression("UPPER(LEFT(Fields.name, 3))", context({ name: "acme corp" })) === "ACM", "text functions compose");
    check(evaluateExpression("LEN(TRIM('  ab  '))", context({})) === 2, "TRIM works before LEN");
    check(evaluateExpression("REPLACE(Fields.name, ' ', '-')", context({ name: "acme corp" })) === "acme-corp", "REPLACE replaces every occurrence");
    check(evaluateExpression("ROUND(Fields.price * 1.15, 2)", context({ price: 10.005 })) === 11.51, "ROUND to two places");
    check(evaluateExpression("ABS(-3) + CEIL(1.2) + FLOOR(1.8)", context({})) === 6, "ABS, CEIL and FLOOR agree");
    check(evaluateExpression("PERCENT(25, 200)", context({})) === 12.5, "PERCENT is a share of a total");
    check(evaluateExpression("SQRT(16)", context({})) === 4, "SQRT works");
    check(evaluateExpression("SQRT(-1)", context({})) === null, "and a negative root is null rather than NaN");
    check(evaluateExpression("1 / 0", context({})) === null, "dividing by zero is null rather than Infinity");
    check(evaluateExpression("YEAR(Fields.when) = 2026", context({ when: "2026-08-01" })) === true, "a date can be compared by year");
    check(evaluateExpression("MONTH(Fields.when)", context({ when: "2026-08-01" })) === 8, "MONTH is 1-based");
    check(evaluateExpression("DAYNAME(Fields.when)", context({ when: "2026-08-01" })) === "Saturday", "DAYNAME names the weekday");
    check(evaluateExpression("FORMATDATE(Fields.when, 'dd MMM yyyy')", context({ when: "2026-08-01" })) === "01 Aug 2026", "FORMATDATE writes a date out");
    check(evaluateExpression("FORMATNUMBER(1234.5, '#,##0.00')", context({})) === "1,234.50", "FORMATNUMBER writes a number out");
    check(evaluateExpression("DATEDIFF(Fields.a, Fields.b)", context({ a: "2026-08-01", b: "2026-08-06" })) === 5, "DATEDIFF counts days");
    check(evaluateExpression("DATEADD(Fields.a, 1, 'month') > Fields.a", context({ a: "2026-08-01" })) === true, "DATEADD moves a date forward");
    check(evaluateExpression("ISEMPTY(Fields.blank)", context({ blank: "" })) === true, "ISEMPTY spots a blank");
    check(evaluateExpression("IFEMPTY(Fields.blank, 'none')", context({ blank: "" })) === "none", "and IFEMPTY substitutes for it");
    check(evaluateExpression("fields.client", context({ client: "Acme" })) === "Acme", "a namespace is not case-sensitive");
    check(evaluateExpression("client", context({ client: "Acme" })) === "Acme", "and a bare name is a field");
    check(evaluateExpression("Parameters.region", { fields: {}, parameters: { region: "EMEA" } }) === "EMEA", "parameters are readable");
    check(evaluateExpression("Fields.ticket.company.name", context({ ticket: { company: { name: "Acme" } } })) === "Acme", "a path walks a relation");
    check(formatValue(1234.5, "money") === "$1,234.50", "money formats with two places");
    check(formatValue("2026-08-01", "date") === "2026-08-01", "a date prints as the day it is, not a UTC-shifted one");
    check(formatValue("in_progress", "text") === "In Progress", "a code prints as a label");
  }

  section("the language is not a door into the process");
  {
    const throws = (source) => {
      try { evaluateExpression(source, context({})); return null; } catch (e) { return e.message; }
    };
    check(/no function called/i.test(throws("Math.max(1, 2)") ?? ""), "Math is not reachable — it is not in the function list");
    check(/no function called|Unexpected/i.test(throws("constructor('return process')()") ?? ""), "constructor is not callable");
    check(/no function called/i.test(throws("FETCH('http://example.com')") ?? ""), "and neither is anything else that is not declared");
    check(evaluateExpression("globalThis", context({})) === undefined, "globalThis is read as a field name and finds nothing");
    check(evaluateExpression("process", context({})) === undefined, "so is process");
    check(parseExpression("1; process.exit(1)").error !== null, "a semicolon is a syntax error, so statements cannot be chained");
    check(parseExpression("function () {}").error !== null, "and a function literal cannot be written");
    check(parseExpression("Fields.a = ;").error !== null, "a dangling operator is refused");
    check(parseExpression("UPPER(Fields.a").error !== null, "an unclosed call is refused by name");
    check(parseExpression("SUM(Fields.a)").ast !== null, "a valid aggregate parses");
    check(/field name/i.test(throws("SUM(1 + 2)") ?? ""), "an aggregate over a calculation is refused, not silently summed");
    check(/no function called/i.test(throws("EVAL('1')") ?? ""), "there is no EVAL");
    check(!FUNCTIONS.some(fn => /eval|exec|require|import/i.test(fn.name)), `no function in the list is named like an escape (${FUNCTIONS.length} functions)`);

    const here = dirname(fileURLToPath(import.meta.url));
    const engineSources = ["reportExpression.ts", "reportLayout.ts", "reportTemplate.ts"]
      .map(file => readFileSync(resolve(here, "../../packages/shared/src", file), "utf8"));
    check(engineSources.every(source => !/\beval\s*\(/.test(source)), "no engine source calls eval(");
    check(engineSources.every(source => !/new\s+Function\s*\(/.test(source)), "and none calls new Function(");
  }

  section("a document is validated, not trusted");
  {
    const catalog = { sources: [{ key: "tickets", label: "Tickets", fields: [
      { key: "ticketNumber", label: "Ticket Number", type: "text" },
      { key: "amount", label: "Amount", type: "money" },
      { key: "status", label: "Status", type: "text" },
      { key: "createdAt", label: "Created", type: "date" },
    ] }] };

    const clean = harnessDocument();
    check(errorsOf(validateTemplate(clean, { catalog })).length === 0, "a hand-built document validates cleanly");
    check(validateTemplate(clean, { catalog }).length === 0, "and has nothing to warn about either");

    // A band shorter than the element in it would clip the value the moment the report ran.
    const shortBand = harnessDocument({ detailHeight: 2 });
    shortBand.bands.find(band => band.kind === "detail").elements[1].h = 6;
    const shortIssues = validateTemplate(shortBand, { catalog });
    check(errorsOf(shortIssues).some(issue => issue.code === "element.overflow"), "an element taller than its band is an error");
    check(shortIssues.some(issue => issue.elementId && issue.bandId), "and the error names the element and its band, so the designer can select it");

    const unknownField = harnessDocument();
    unknownField.bands[2].elements[0].expression = "Fields.nothing";
    check(errorsOf(validateTemplate(unknownField, { catalog })).some(issue => issue.code === "expression.field"), "a field this source does not have is an error");

    const badSyntax = harnessDocument();
    badSyntax.bands[2].elements[0].expression = "Fields.amount >";
    check(errorsOf(validateTemplate(badSyntax, { catalog })).some(issue => issue.code === "expression.syntax"), "an expression that cannot be parsed is an error");

    const badFunction = harnessDocument();
    badFunction.bands[2].elements[0].expression = "TOTAL(Fields.amount)";
    check(errorsOf(validateTemplate(badFunction, { catalog })).some(issue => issue.code === "expression.function"), "an unknown function is an error");

    const badArity = harnessDocument();
    badArity.bands[2].elements[0].expression = "ROUND(Fields.amount, 2, 3)";
    check(errorsOf(validateTemplate(badArity, { catalog })).some(issue => issue.code === "expression.arity"), "the wrong number of arguments is an error");

    const aggregateOverText = harnessDocument();
    aggregateOverText.bands[2].elements[1] = total("SUM", "Fields.ticketNumber", "report", 120, 0, 40, 5);
    check(errorsOf(validateTemplate(aggregateOverText, { catalog })).some(issue => issue.code === "element.aggregateType"), "totalling a text field is an error");

    const groupScopeOutsideGroup = harnessDocument();
    groupScopeOutsideGroup.bands[2].elements[1] = total("SUM", "Fields.amount", "group", 120, 0, 40, 5);
    check(errorsOf(validateTemplate(groupScopeOutsideGroup, { catalog })).some(issue => issue.code === "element.scope"), "a group total outside a group is an error");

    const duplicateBands = harnessDocument();
    duplicateBands.bands = [...duplicateBands.bands, createBand("detail", { height: 5 })];
    check(errorsOf(validateTemplate(duplicateBands, { catalog })).some(issue => issue.code === "band.duplicate"), "a second data band is an error");

    const orphanGroupBand = harnessDocument({ extraBand: createBand("groupHeader", { groupKey: "nope", height: 6 }) });
    check(errorsOf(validateTemplate(orphanGroupBand, { catalog })).some(issue => issue.code === "band.groupKey"), "a group band naming a group that does not exist is an error");

    const noBands = harnessDocument();
    noBands.bands = [];
    check(errorsOf(validateTemplate(noBands, { catalog })).some(issue => issue.code === "bands.empty"), "a report with no bands is an error");

    const noMargins = harnessDocument();
    noMargins.page.margins = { top: 10, right: 100, bottom: 10, left: 200 };
    check(errorsOf(validateTemplate(noMargins, { catalog })).some(issue => issue.code === "page.margins"), "margins that leave no width are an error");

    const noSource = harnessDocument();
    noSource.dataSources = [];
    check(errorsOf(validateTemplate(noSource, { catalog })).some(issue => issue.code === "dataSource.missing"), "a report with no data source is an error");

    const badFilter = harnessDocument();
    badFilter.dataSources[0].filters = [{ field: "notAField", op: "equals", value: "x" }];
    check(errorsOf(validateTemplate(badFilter, { catalog })).some(issue => issue.code === "filter.field"), "filtering on a field that does not exist is an error");

    const badLimit = harnessDocument();
    badLimit.dataSources[0].limit = 99999;
    check(errorsOf(validateTemplate(badLimit, { catalog })).some(issue => issue.code === "dataSource.limit"), "a row limit beyond 2,000 is an error");

    const duplicateIds = harnessDocument();
    duplicateIds.bands[2].elements[1].id = duplicateIds.bands[2].elements[0].id;
    check(errorsOf(validateTemplate(duplicateIds, { catalog })).some(issue => issue.code === "element.id"), "two elements sharing an id is an error");

    const emptyImage = harnessDocument();
    emptyImage.bands[0].elements.push(createElement("image", { src: "", x: 0, y: 0, w: 10, h: 5 }));
    check(errorsOf(validateTemplate(emptyImage, { catalog })).some(issue => issue.code === "element.image"), "an image with no source is an error");

    const futureVersion = harnessDocument();
    futureVersion.version = 99;
    check(errorsOf(validateTemplate(futureVersion, { catalog })).some(issue => issue.code === "version"), "a document from a newer designer is refused rather than guessed at");

    const tooWide = harnessDocument();
    tooWide.bands[2].elements[1].w = 200;
    const wideIssues = validateTemplate(tooWide, { catalog });
    check(wideIssues.some(issue => issue.code === "element.wide" && issue.severity === "warning"), "an element past the printable width is a warning, not an error");

    const unusedGroup = harnessDocument({ groups: [{ key: "g1", label: "Client", expression: "Fields.status", sort: "asc", keepTogether: true }] });
    check(validateTemplate(unusedGroup, { catalog }).some(issue => issue.code === "group.unused" && issue.severity === "warning"), "a group with no bands warns rather than fails");

    const twoSources = harnessDocument();
    twoSources.dataSources.push({ ...twoSources.dataSources[0], key: "second" });
    check(validateTemplate(twoSources, { catalog }).some(issue => issue.code === "dataSource.extra"), "a second data source is noted as unbounded in this version");

    const junk = normaliseDocument({ page: { margins: "nonsense" }, bands: [{ kind: "detail", elements: [{ type: "field" }] }] });
    check(junk.version === DOCUMENT_VERSION && junk.bands.length === 1 && typeof junk.bands[0].height === "number", "a document with missing fields is filled in rather than crashing");
    check(junk.bands[0].elements[0].expression === "" && junk.bands[0].elements[0].format === "text", "and its elements get defaults");
    check(BAND_KINDS.length === 9, `the nine band kinds are declared (${BAND_KINDS.length})`);
  }

  section("the starter documents are valid for the source they name");
  {
    const catalog = {
      sources: [
        { key: "tickets", label: "Tickets", fields: [
          { key: "ticketNumber", label: "Ticket Number", type: "text" }, { key: "title", label: "Title", type: "text" },
          { key: "status", label: "Status", type: "text" }, { key: "client", label: "Client", type: "text" },
          { key: "createdAt", label: "Created", type: "date" },
        ] },
        { key: "invoices", label: "Invoices", fields: [
          { key: "invoiceNumber", label: "Invoice Number", type: "text" }, { key: "client", label: "Client", type: "text" },
          { key: "total", label: "Total", type: "money" }, { key: "issueDate", label: "Issue Date", type: "date" },
        ] },
        { key: "time_entries", label: "Time entries", fields: [
          { key: "date", label: "Date", type: "date" }, { key: "minutes", label: "Minutes", type: "minutes" },
          { key: "technician", label: "Technician", type: "text" }, { key: "workType", label: "Work Type", type: "text" },
        ] },
      ],
    };
    for (const source of catalog.sources) {
      for (const kind of ["blank", "list", "groupedTotals", "clientSummary"]) {
        const document = createStarter(kind, source, `${source.label} ${kind}`);
        const issues = validateTemplate(document, { catalog });
        check(errorsOf(issues).length === 0, `the "${kind}" starter for ${source.key} has no errors (${describeIssuesBrief(issues)})`);
      }
    }
    const grouped = createStarter("groupedTotals", catalog.sources[1], "Invoices grouped");
    check(grouped.groups.length === 1 && grouped.bands.some(band => band.kind === "groupHeader"), "a grouped starter declares its group and the band that names it");
    const invoices = createStarter("clientSummary", catalog.sources[1], "Invoice summary");
    check(invoices.bands.some(band => band.kind === "reportSummary"), "and a summary starter has a report summary");
    const summaryTotals = invoices.bands.find(band => band.kind === "reportSummary").elements.some(element => element.type === "aggregate" && element.scope === "report");
    check(summaryTotals, "whose grand total is scoped to the report");
    const ticketStarter = createStarter("groupedTotals", catalog.sources[0], "Tickets grouped");
    check(!JSON.stringify(ticketStarter).includes("Fields.total"), "a starter written for one source does not name another source's fields");
  }

  section("the engine paginates, groups and totals");
  {
    const rows = Array.from({ length: 200 }, (_, index) => ({
      ticketNumber: `T-${String(index + 1).padStart(4, "0")}`,
      amount: index + 1,
      status: index % 3 === 0 ? "new" : "closed",
    }));
    const document = harnessDocument();
    const laid = layoutReport({ document, rows, measure });
    check(!laid.refused, "a valid document lays out");
    check(laid.pages.length > 1, `200 rows over 4 ${laid.pages.length} pages (${laid.pages.length})`);
    check(laid.rowCount === 200, "every row is accounted for");
    const printedRows = laid.pages.flatMap(page => page.rowIndexes);
    check(printedRows.length === 200, "and every row was printed exactly once");
    check(new Set(printedRows).size === 200, "with no row printed twice");
    check(laid.pages.every(page => page.bands.some(band => band.kind === "pageHeader")), "the page header repeats on every page");
    check(laid.pages.every(page => page.bands.some(band => band.kind === "columnHeader")), "and so does the column caption");
    check(laid.pages.every(page => page.bands.filter(band => band.kind === "detail").length === page.rowIndexes.length), "each page's data bands match its rows");

    const footerText = page => page.bands
      .filter(band => band.kind === "pageFooter")
      .flatMap(band => band.elements)
      .flatMap(element => (element.payload.kind === "text" ? element.payload.lines.map(line => line.text) : []))
      .join(" ");
    check(footerText(laid.pages[0]).includes(`of ${laid.pages.length}`), `the page footer says the real page count, not the count at the time it was drawn (${footerText(laid.pages[0])})`);
    check(footerText(laid.pages[1]).includes("Page 2 of"), "and the second page numbers itself correctly");

    // Nothing may be placed outside the printable area, or the footer would collide with the rows.
    const contentHeight = laid.content.height;
    const beyond = laid.pages.flatMap(page => page.bands.filter(band => band.kind === "detail" && band.y + band.height > contentHeight + 0.01));
    check(beyond.length === 0, "no data band runs past the printable area");

    // Text that does not fit is wrapped and then clipped to its box, never drawn outside it.
    const wrapped = harnessDocument({ detailHeight: 12 });
    wrapped.bands.find(band => band.kind === "detail").elements[0].w = 25;
    wrapped.bands.find(band => band.kind === "detail").elements[0].h = 10;
    const longText = "T-0001-a-very-long-ticket-number-that-will-not-fit-in-twenty-five-millimetres";
    const wrappedLaid = layoutReport({ document: wrapped, rows: [{ ticketNumber: longText, amount: 1 }], measure });
    const placedText = wrappedLaid.pages[0].bands.find(band => band.kind === "detail").elements[0];
    check(placedText.payload.lines.length > 1, `a long value wraps onto more than one line (${placedText.payload.lines.length})`);
    const innerWidth = 25 - placedText.payload.style.padding * 2;
    const innerHeight = 10 - placedText.payload.style.padding * 2;
    check(placedText.payload.lines.every(line => line.width <= innerWidth + 0.01), "and no line is wider than the box it sits in");
    const lineHeight = placedText.payload.lines[1].y - placedText.payload.lines[0].y;
    check(placedText.payload.lines.length * lineHeight <= innerHeight + 0.01, "and the lines stay inside the element's height");
    check(!wrappedLaid.refused && wrappedLaid.issues.length === 0, "with nothing to warn about");

    // A failing expression warns and leaves a blank, rather than taking the page down with it. This is
    // validation's blind spot by design: the source is declared, so it passes, and the run supplies no
    // rows for it — which is exactly the case the layout engine has to survive.
    const broken = harnessDocument();
    broken.dataSources.push({ key: "second", label: "Second", source: "companies", filters: [], sortDir: "asc", limit: 10 });
    broken.bands.find(band => band.kind === "detail").elements[0].expression = "DataSources.second.name";
    const brokenLaid = layoutReport({ document: broken, rows: [{ ticketNumber: "T-1", amount: 1 }], measure });
    check(!brokenLaid.refused, "a declared but unbound data source does not stop the report");
    check(brokenLaid.issues.some(issue => issue.code === "expression.runtime" && issue.severity === "warning"), "the element that reads it warns instead");
    check(brokenLaid.pages[0].bands.some(band => band.kind === "detail"), "and the rest of the page is still drawn");

    // Damaged after it was saved: the render path refuses it again.
    const damaged = harnessDocument();
    damaged.bands[2].elements[0].h = 40;
    const damagedLaid = layoutReport({ document: damaged, rows: [{ ticketNumber: "T-1", amount: 1 }], measure });
    check(damagedLaid.refused && damagedLaid.pages.length === 0, "a document that is invalid at render time is refused, not drawn");
    check(damagedLaid.issues.some(issue => issue.code === "render.refused"), "and says why");
  }

  section("grouping and totals");
  {
    const rows = [
      { ticketNumber: "A-1", amount: 10, status: "Acme" },
      { ticketNumber: "A-2", amount: 20, status: "Acme" },
      { ticketNumber: "A-3", amount: 30, status: "Acme" },
      { ticketNumber: "B-1", amount: 5, status: "Globex" },
      { ticketNumber: "B-2", amount: 7, status: "Globex" },
    ];
    const groupHeader = createBand("groupHeader", { groupKey: "g1", height: 7 });
    groupHeader.elements = [text("{{Fields.status}}", 0, 0, 60, 6, { bold: true }), text("{{COUNT(Fields.ticketNumber, 'group')}} rows", 120, 0, 40, 6)];
    const groupFooter = createBand("groupFooter", { groupKey: "g1", height: 7 });
    groupFooter.elements = [text("Group total", 80, 0, 40, 6, { align: "right" }), total("SUM", "Fields.amount", "group", 120, 0, 40, 6, "money")];
    const summary = createBand("reportSummary", { height: 8 });
    summary.elements = [text("Report total", 80, 0, 40, 6, { bold: true, align: "right" }), total("SUM", "Fields.amount", "report", 120, 0, 40, 6, "money")];

    const document = harnessDocument({ extraBand: groupFooter, summary, groups: [{ key: "g1", label: "Client", expression: "Fields.status", sort: "asc", keepTogether: true }] });
    document.bands = [document.bands[0], document.bands[1], groupHeader, ...document.bands.slice(2)];
    const laid = layoutReport({ document, rows, measure });
    check(!laid.refused, "a grouped document lays out");
    check(laid.groupCount === 2, `two groups are counted (${laid.groupCount})`);

    const bandText = (page, kind) => page.bands
      .filter(band => band.kind === kind)
      .map(band => band.elements.flatMap(element => (element.payload.kind === "text" ? element.payload.lines.map(line => line.text) : [])).join(" "));
    const headers = laid.pages.flatMap(page => bandText(page, "groupHeader"));
    check(headers[0]?.startsWith("Acme") && headers[1]?.startsWith("Globex"), `groups print in order with their own value as the heading (${headers.join(" | ")})`);
    check(headers[0]?.includes("3 rows") && headers[1]?.includes("2 rows"), "and the group count is the group's own, not the report's");

    const footers = laid.pages.flatMap(page => bandText(page, "groupFooter"));
    check(footers[0]?.includes("$60.00"), `the first group totals its own rows (${footers[0]})`);
    check(footers[1]?.includes("$12.00"), `and the second totals its own, not the first's (${footers[1]})`);

    const summaries = laid.pages.flatMap(page => bandText(page, "reportSummary"));
    check(summaries[0]?.includes("$72.00"), `the report summary totals every row (${summaries[0]})`);

    // A group that fits on a page of its own is not split across two.
    const tall = harnessDocument({ detailHeight: 20, extraBand: createBand("groupFooter", { groupKey: "g1", height: 7 }), groups: [{ key: "g1", label: "Client", expression: "Fields.status", sort: "asc", keepTogether: true }] });
    const rowsTall = Array.from({ length: 24 }, (_, index) => ({ ticketNumber: `T-${index}`, amount: 1, status: index < 12 ? "Acme" : "Globex" }));
    const tallLaid = layoutReport({ document: tall, rows: rowsTall, measure });
    const firstPageDetailRows = tallLaid.pages[0].rowIndexes;
    check(firstPageDetailRows.length === 0 || firstPageDetailRows.length >= 12 || firstPageDetailRows.length === 24, `a kept-together group starts on a page with room for it (${firstPageDetailRows.length} rows on page 1)`);

    // Aggregates, checked against arithmetic done by hand.
    const checks = [
      ["SUM", "$72.00", "money"], ["AVG", "$14.40", "money"], ["MIN", "$5.00", "money"], ["MAX", "$30.00", "money"],
      ["COUNT", "5", "number"], ["COUNTD", "5", "number"],
    ];
    for (const [fn, expected, format] of checks) {
      const band = createBand("reportSummary", { height: 8 });
      band.elements = [total(fn, "Fields.amount", "report", 0, 0, 40, 6, format)];
      const withTotal = harnessDocument({ summary: band });
      const walked = layoutReport({ document: withTotal, rows, measure });
      const value = bandText(walked.pages[0], "reportSummary")[0] ?? "";
      check(value === expected, `${fn} over the report is ${expected} (${value})`);
    }

    const countAll = createBand("reportSummary", { height: 8 });
    countAll.elements = [total("COUNT", "", "report", 0, 0, 40, 6, "number")];
    const counted = layoutReport({ document: harnessDocument({ summary: countAll }), rows, measure });
    check(bandText(counted.pages[0], "reportSummary")[0] === "5", "COUNT with no field counts rows");
    const countedDistinct = createBand("reportSummary", { height: 8 });
    countedDistinct.elements = [total("COUNTD", "Fields.status", "report", 0, 0, 40, 6, "number")];
    const distinct = layoutReport({ document: harnessDocument({ summary: countedDistinct }), rows, measure });
    check(bandText(distinct.pages[0], "reportSummary")[0] === "2", "and COUNTD counts the values a field actually has");
  }

  section("page totals are resolved after pagination");
  {
    const rows = Array.from({ length: 120 }, (_, index) => ({ ticketNumber: `T-${index}`, amount: 1, status: "x" }));
    const pageFooter = createBand("pageFooter", { height: 7 });
    pageFooter.elements = [
      text("Page {{Page.number}} of {{Page.totalPages}}", 0, 0, 60, 5),
      total("SUM", "Fields.amount", "page", 100, 0, 40, 5),
    ];
    const document = harnessDocument();
    document.bands = [...document.bands.filter(band => band.kind !== "pageFooter"), pageFooter];
    const laid = layoutReport({ document, rows, measure });
    check(laid.pages.length > 1, `the report runs to more than one page (${laid.pages.length})`);
    const totals = laid.pages.map(page => {
      const band = page.bands.find(candidate => candidate.kind === "pageFooter");
      const element = band.elements.find(candidate => candidate.type === "aggregate");
      return { printed: element.payload.lines.map(line => line.text).join(""), rows: page.rowIndexes.length };
    });
    check(totals.every(entry => entry.printed === String(entry.rows)), `each page's total is the sum of the rows on that page (${totals.map(entry => `${entry.printed}/${entry.rows}`).join(", ")})`);
    check(totals.every(entry => entry.rows > 0), "and no page was left with a total but no rows");
    const sumOfPages = totals.reduce((sum, entry) => sum + Number(entry.printed), 0);
    check(sumOfPages === 120, `which adds up to the whole report (${sumOfPages})`);
    check(!laid.pages.some(page => page.bands.some(band => band.elements.some(element => element.deferred))), "and no element is left waiting for a second pass");
  }

  section("parameters and the row limit");
  {
    const document = harnessDocument();
    document.parameters = [{ key: "region", label: "Region", type: "text", required: true }];
    check(layoutReport({ document, rows: [], measure }).refused, "a required parameter with no value stops the report");
    check(layoutReport({ document, rows: [], measure }).issues.some(issue => issue.code === "parameter.required"), "and says which one is missing");
    const supplied = layoutReport({ document, rows: [], parameters: { region: "EMEA" }, measure });
    check(!supplied.refused && supplied.parameters.region === "EMEA", "and a supplied value runs it");

    const withDefault = harnessDocument();
    withDefault.parameters = [{ key: "region", label: "Region", type: "text", required: true, defaultValue: "EMEA" }];
    check(!layoutReport({ document: withDefault, rows: [], measure }).refused, "a default satisfies a required parameter");

    const limited = layoutReport({ document: harnessDocument(), rows: [{ ticketNumber: "T-1", amount: 1 }], measure, limit: 1 });
    check(limited.truncated && limited.issues.some(issue => issue.code === "render.limit"), "a run that reached its row limit says so");
  }

  section("the API publishes its own whitelist");
  const admin = await signIn("persona.admin@c7ntax.local");
  const scoped = await signIn("persona.tech.scoped@c7ntax.local");
  const readonly = await signIn("persona.readonly@c7ntax.local");
  check(!!admin.token && !!scoped.token && !!readonly.token, "an administrator, a client-scoped technician and a read-only user signed in");

  const catalogResponse = await call("GET", "/api/reports/designer/catalog", { token: admin.token });
  const remoteCatalog = catalogResponse.data;
  check(catalogResponse.status === 200, `the designer catalog answers (${catalogResponse.status})`);
  check(Array.isArray(remoteCatalog.sources) && remoteCatalog.sources.length >= 7, `it lists the sources the runner will query (${remoteCatalog.sources?.length})`);
  check(remoteCatalog.sources.every(source => source.fields.every(field => field.key && field.label && field.type)), "every field has a key, a label and a type");
  check(remoteCatalog.sources.find(source => source.key === "tickets").fields.some(field => field.key === "ticketNumber"), "tickets offers its ticket number");
  check(remoteCatalog.sources.find(source => source.key === "tickets").fields.some(field => field.key === "assignee"), "and the technician it is assigned to");
  check(remoteCatalog.operators.length === 10 && remoteCatalog.operators.every(operator => operator.valueKind), "the ten filter operators are published with the kind of value each wants");
  check(remoteCatalog.functions.length === FUNCTIONS.length, `every function the language implements is published (${remoteCatalog.functions.length})`);
  check(remoteCatalog.functions.every(fn => fn.signature && fn.description && fn.category), "each with a signature, a category and a description");
  check(remoteCatalog.bandKinds.length === 9, "the nine band kinds are published");
  check(remoteCatalog.pageSizes.length >= 5 && remoteCatalog.formats.length === 8, "so are the page sizes and the eight value formats");
  check(remoteCatalog.starters.length === 4, "and the four starter layouts");
  check(Array.isArray(remoteCatalog.branding) && remoteCatalog.branding.length >= 1, "with the built-in images a template may use");
  check(remoteCatalog.documentVersion === DOCUMENT_VERSION, `the document version is published (${remoteCatalog.documentVersion})`);

  const catalogForValidation = { sources: remoteCatalog.sources.map(source => ({ key: source.key, label: source.label, fields: source.fields })) };

  section("starter, validate and preview over HTTP");
  {
    for (const kind of ["blank", "list", "groupedTotals", "clientSummary"]) {
      const starter = await call("GET", `/api/reports/designer/starter?source=tickets&kind=${kind}`, { token: admin.token });
      const document = starter.data?.document;
      check(starter.status === 200 && !!document, `the ${kind} starter is served (${starter.status})`);
      check(errorsOf(validateTemplate(document, { catalog: catalogForValidation })).length === 0, `and the ${kind} starter passes the same validation the API applies`);
    }
    const badSource = await call("GET", "/api/reports/designer/starter?source=secrets", { token: admin.token });
    check(badSource.status === 400, `an unknown source is refused rather than guessed (${badSource.status})`);
    const badKind = await call("GET", "/api/reports/designer/starter?kind=whatever", { token: admin.token });
    check(badKind.status === 400, `and so is an unknown starter (${badKind.status})`);

    const starter = (await call("GET", "/api/reports/designer/starter?source=tickets&kind=list", { token: admin.token })).data.document;

    const good = await call("POST", "/api/reports/designer/validate", { token: admin.token, body: { name: "Validate me", document: starter } });
    check(good.status === 200 && good.data.issues.filter(issue => issue.severity === "error").length === 0, "a good document validates with no errors");
    check(!!good.data.document && !!good.data.catalog, "and comes back normalised, with the catalog it was checked against");

    const damaged = JSON.parse(JSON.stringify(starter));
    damaged.bands.find(band => band.kind === "detail").elements[0].expression = "Fields.nope";
    const bad = await call("POST", "/api/reports/designer/validate", { token: admin.token, body: { name: "Validate me", document: damaged } });
    const badErrors = (bad.data.issues ?? []).filter(issue => issue.severity === "error");
    check(badErrors.length > 0 && badErrors.some(issue => /nope/.test(issue.message)), `a field that does not exist is reported by name (${badErrors[0]?.message})`);
    check(badErrors.every(issue => issue.path), "and every error says where it is");

    const preview = await call("POST", "/api/reports/designer/preview", { token: admin.token, body: { name: "Preview me", document: starter } });
    check(preview.status === 200, `a preview runs the document's data source (${preview.status})`);
    check(Array.isArray(preview.data.rows) && preview.data.rows.length > 0, `and returns rows (${preview.data.rows?.length})`);
    adminPreviewRows = (preview.data.rows ?? []).length;
    check(preview.data.rows[0].ticketNumber !== undefined, "with the fields the document can reference");
    check(preview.data.document && preview.data.parameters !== undefined, "and echoes the normalised document and its parameters");
    check(preview.data.period?.label !== undefined, `stating the period it applied (${preview.data.period?.label})`);
    check(preview.data.limit > 0, `and the row ceiling it used (${preview.data.limit})`);

    const previewBroken = await call("POST", "/api/reports/designer/preview", { token: admin.token, body: { name: "Preview me", document: damaged } });
    check(previewBroken.status === 422, `an invalid document cannot be previewed (${previewBroken.status})`);
    check(typeof previewBroken.data?.error?.message === "string" && /problem/i.test(previewBroken.data.error.message), "and the refusal names the first problem");

    // A filter, and a filter whose value comes from a parameter.
    const filtered = JSON.parse(JSON.stringify(starter));
    const sample = preview.data.rows[0];
    filtered.dataSources[0].filters = [{ field: "status", op: "equals", value: sample.status }];
    filtered.dataSources[0].limit = 2000;
    const filteredPreview = await call("POST", "/api/reports/designer/preview", { token: admin.token, body: { name: "Filtered", document: filtered } });
    const filteredRows = filteredPreview.data.rows ?? [];
    check(filteredPreview.status === 200 && filteredRows.length > 0, `a filter narrows the rows (${filteredRows.length} of ${preview.data.rows.length})`);
    check(filteredRows.every(row => row.status === sample.status), "and every returned row matches it");
    check(filteredRows.length < preview.data.rows.length, "and the filter actually removed something");

    const viaParameter = JSON.parse(JSON.stringify(filtered));
    viaParameter.dataSources[0].filters = [{ field: "status", op: "equals", parameterKey: "wanted" }];
    viaParameter.parameters = [{ key: "wanted", label: "Status", type: "text", required: true }];
    const missingParameter = await call("POST", "/api/reports/designer/preview", { token: admin.token, body: { name: "Parameterised", document: viaParameter } });
    check(missingParameter.status === 422, `a required parameter with no value stops the preview (${missingParameter.status})`);
    const withParameter = await call("POST", "/api/reports/designer/preview", { token: admin.token, body: { name: "Parameterised", document: viaParameter, parameters: { wanted: sample.status } } });
    check(withParameter.status === 200 && (withParameter.data.rows ?? []).every(row => row.status === sample.status), "and supplying it filters the same way a typed value does");
    check(withParameter.data.parameters.wanted === sample.status, "the resolved parameter travels with the rows");

    // "is empty" and "is not empty" used to be sent to Prisma as a null comparison whatever the column
    // was, which is a 500 on a column that cannot be null — and most of them cannot.
    const emptyFilter = JSON.parse(JSON.stringify(starter));
    emptyFilter.dataSources[0].filters = [{ field: "resolvedAt", op: "isNull" }];
    emptyFilter.dataSources[0].limit = 2000;
    const emptyResult = await call("POST", "/api/reports/designer/preview", { token: admin.token, body: { name: "Empty", document: emptyFilter } });
    check(emptyResult.status === 200, `"is empty" on a column that can be empty answers (${emptyResult.status})`);
    const emptyRows = emptyResult.data.rows ?? [];
    check(emptyRows.length > 0 && emptyRows.every(row => row.resolvedAt === null), `and returns only rows with no value there (${emptyRows.length})`);

    const notEmptyFilter = JSON.parse(JSON.stringify(emptyFilter));
    notEmptyFilter.dataSources[0].filters = [{ field: "resolvedAt", op: "isNotNull" }];
    const notEmptyResult = await call("POST", "/api/reports/designer/preview", { token: admin.token, body: { name: "Not empty", document: notEmptyFilter } });
    check(notEmptyResult.status === 200 && (notEmptyResult.data.rows ?? []).every(row => row.resolvedAt !== null), `"is not empty" answers too (${notEmptyResult.status})`);
    check((notEmptyResult.data.rows ?? []).length + emptyRows.length === preview.data.rows.length, "and the two halves add up to every row");

    const requiredColumnFilter = JSON.parse(JSON.stringify(starter));
    requiredColumnFilter.dataSources[0].filters = [{ field: "status", op: "isNotNull" }];
    const requiredResult = await call("POST", "/api/reports/designer/preview", { token: admin.token, body: { name: "Required column", document: requiredColumnFilter } });
    check(requiredResult.status === 200, `"is not empty" on a required column does not fail (${requiredResult.status})`);
    check((requiredResult.data.rows ?? []).length === preview.data.rows.length, "it matches every row, because every row satisfies it");
    check((requiredResult.data.notes ?? []).some(note => /cannot be empty/.test(note)), "and says it was simplified rather than pretending to filter");

    const impossibleFilter = JSON.parse(JSON.stringify(starter));
    impossibleFilter.dataSources[0].filters = [{ field: "status", op: "isNull" }];
    const impossibleResult = await call("POST", "/api/reports/designer/preview", { token: admin.token, body: { name: "Impossible", document: impossibleFilter } });
    check(impossibleResult.status === 200 && (impossibleResult.data.rows ?? []).length === 0, `"is empty" on a required column returns nothing rather than failing (${impossibleResult.status})`);
    check((impossibleResult.data.notes ?? []).some(note => /cannot be empty/.test(note)), "and explains itself");
  }

  section("a template is a saved report");
  const stamp = Date.now();
  let createdId = null;
  {
    const starter = (await call("GET", "/api/reports/designer/starter?source=invoices&kind=clientSummary&name=Probe design", { token: admin.token })).data.document;

    const created = await call("POST", "/api/reports", { token: admin.token, body: { name: `Probe template ${stamp}`, description: "Probe", type: "template", config: { document: starter } } });
    createdId = created.data?.id;
    check(created.status === 201 && !!createdId, `a template is stored as a report (${created.status})`);

    const listed = await call("GET", "/api/reports", { token: admin.token });
    const stored = (listed.data ?? []).find(report => report.id === createdId);
    check(stored?.type === "template", "and is listed with the type the designer reads");
    check(stored?.config?.document?.bands?.length > 0, "carrying its document");

    const run = await call("GET", `/api/reports/${createdId}/run`, { token: admin.token });
    check(run.status === 200, `running it runs its own data source (${run.status})`);
    check(Array.isArray(run.data.rows) && run.data.rows.length > 0, `returning rows (${run.data.rows?.length})`);
    check(run.data.document?.bands?.length > 0 && run.data.parameters !== undefined, "with the document and the resolved parameters, so the layout can be produced");
    check(run.data.limit > 0 && run.data.period?.label !== undefined, "and the limit and period it applied");

    const laid = layoutReport({
      document: run.data.document, rows: run.data.rows, parameters: run.data.parameters,
      measure, limit: run.data.limit, catalog: catalogForValidation,
    });
    check(!laid.refused && laid.pages.length > 0, `a stored template lays out into ${laid.pages.length} page(s)`);
    check(laid.rowCount === run.data.rows.length, "with every row it returned placed on a page");

    const renamed = await call("PATCH", `/api/reports/${createdId}`, { token: admin.token, body: { name: `Probe template renamed ${stamp}` } });
    check(renamed.status === 200 && renamed.data.name === `Probe template renamed ${stamp}`, "it can be renamed like any other report");

    const invalidDocument = JSON.parse(JSON.stringify(starter));
    invalidDocument.bands[0].elements[0].x = -5;
    const refusedCreate = await call("POST", "/api/reports", { token: admin.token, body: { name: `Probe invalid ${stamp}`, type: "template", config: { document: invalidDocument } } });
    check(refusedCreate.status === 422, `an invalid document cannot be stored (${refusedCreate.status})`);
    check(typeof refusedCreate.data?.error?.message === "string", "with a message that names the problem");
    check(Array.isArray(refusedCreate.data?.error?.details) && refusedCreate.data.error.details.length > 0, "and the full list alongside it, for the designer to highlight");
    const refusedPatch = await call("PATCH", `/api/reports/${createdId}`, { token: admin.token, body: { config: { document: invalidDocument } } });
    check(refusedPatch.status === 422, `nor can a stored one be damaged (${refusedPatch.status})`);

    const stillGood = await call("GET", `/api/reports/${createdId}/run`, { token: admin.token });
    check(stillGood.status === 200 && (stillGood.data.rows ?? []).length > 0, "and the report that refused the edit is untouched");

    const duplicate = await call("POST", `/api/reports/${createdId}/duplicate`, { token: admin.token });
    check(duplicate.status === 201 && duplicate.data.type === "template", "a template duplicates with its document");
    check(duplicate.data.config?.document?.bands?.length > 0, "so a variation starts from the design, not from nothing");
    if (duplicate.data?.id) await call("DELETE", `/api/reports/${duplicate.data.id}`, { token: admin.token });
  }

  section("who may design, and what they can see");
  {
    const withoutToken = await call("GET", "/api/reports/designer/catalog");
    check(withoutToken.status === 401, `the catalog is not public (${withoutToken.status})`);

    const starter = (await call("GET", "/api/reports/designer/starter?source=tickets&kind=list", { token: admin.token })).data.document;
    const readOnlyPreview = await call("POST", "/api/reports/designer/preview", { token: readonly.token, body: { name: "Read only", document: starter } });
    check(readOnlyPreview.status === 200, `a read-only account may preview a designed report (${readOnlyPreview.status})`);
    const readOnlyCreate = await call("POST", "/api/reports", { token: readonly.token, body: { name: `Probe readonly ${stamp}`, type: "template", config: { document: starter } } });
    check(readOnlyCreate.status === 403 || readOnlyCreate.status === 401, `but may not save one (${readOnlyCreate.status})`);
    const readOnlyValidate = await call("POST", "/api/reports/designer/validate", { token: readonly.token, body: { name: "Read only", document: starter } });
    check(readOnlyValidate.status === 403 || readOnlyValidate.status === 401, `and may not use the designer's write path (${readOnlyValidate.status})`);

    // A client-scoped account sees its own client's rows, whatever a template asks for.
    const scopedPreview = await call("POST", "/api/reports/designer/preview", { token: scoped.token, body: { name: "Scoped", document: starter } });
    check(scopedPreview.status === 200, `a client-scoped account can preview (${scopedPreview.status})`);
    const scopedRows = scopedPreview.data.rows ?? [];
    const companyId = (await prisma.user.findFirst({ where: { email: "persona.tech.scoped@c7ntax.local" }, select: { companyId: true } }))?.companyId;
    const ownClientName = companyId
      ? (await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }))?.name
      : null;
    // A relation column arrives as its selected value, which for a client is `{ name }`.
    const clientName = value => (value && typeof value === "object" ? value.name : value);
    const foreignRows = rows => rows.filter(row => ownClientName && clientName(row.client) !== ownClientName);
    check(scopedRows.length > 0, `a client-scoped account's preview returns its own rows (${scopedRows.length})`);
    check(foreignRows(scopedRows).length === 0, `every row belongs to the scoped account's own client (${scopedRows.length} rows, ${foreignRows(scopedRows).length} foreign)`);
    check(scopedRows.length < adminPreviewRows, `and it is a subset of what the administrator sees (${scopedRows.length} of ${adminPreviewRows})`);

    // A template that tries to widen its own scope cannot: the restriction is applied after its filters.
    const widening = JSON.parse(JSON.stringify(starter));
    widening.dataSources[0].filters = [{ field: "status", op: "isNotNull" }];
    widening.dataSources[0].limit = 2000;
    const wideningPreview = await call("POST", "/api/reports/designer/preview", { token: scoped.token, body: { name: "Widening", document: widening } });
    const wideningRows = wideningPreview.data.rows ?? [];
    check(foreignRows(wideningRows).length === 0, `a template cannot widen a scoped account's data (${wideningRows.length} rows, ${foreignRows(wideningRows).length} foreign)`);
  }

  // ── Phase 6: charts, running totals and sub-reports ───────────────
  // Expense-shaped rows, because `tickets` has no number to fold and a chart needs one. The fields are
  // the runner's own: description, amount, category and status.
  const phaseRows = [
    { id: "1", description: "E-1", amount: 100, category: "Hardware", status: "Approved" },
    { id: "2", description: "E-2", amount: 50, category: "Hardware", status: "Approved" },
    { id: "3", description: "E-3", amount: 25, category: "Software", status: "Submitted" },
    { id: "4", description: "E-4", amount: 25, category: "Software", status: "Submitted" },
  ];
  const amountTotal = phaseRows.reduce((sum, row) => sum + row.amount, 0);

  /** The tickets harness with the bands replaced, for the sub-report tests. */
  const parentDocument = (summary = null, detailHeight = 6) => {
    const document = createBlankDocument("Sub-report parent", "tickets");
    document.page = { size: "a4", orientation: "portrait", width: 210, height: 297, margins: { top: 10, right: 10, bottom: 10, left: 10 } };
    const detail = createBand("detail", { height: detailHeight });
    detail.elements = [field("Fields.ticketNumber", 0, 0, 40, detailHeight)];
    const pageFooter = createBand("pageFooter", { height: 6 });
    pageFooter.elements = [text("Page {{Page.number}} of {{Page.totalPages}}", 0, 0, 60, 5)];
    document.bands = [detail, ...(summary ? [summary] : []), pageFooter];
    return document;
  };

  const chartElement = overrides => createElement("chart", {
    x: 0, y: 0, w: 120, h: 50, kind: "column",
    categoryExpression: "Fields.category", valueExpression: "Fields.amount", fn: "SUM", scope: "report",
    ...overrides,
  });
  const phaseDocument = element => {
    const document = createBlankDocument("Chart harness", "expenses");
    document.page = { size: "a4", orientation: "portrait", width: 210, height: 297, margins: { top: 10, right: 10, bottom: 10, left: 10 } };
    const summary = createBand("reportSummary", { height: element.h + 2 });
    summary.elements = [element];
    document.bands = [summary];
    return document;
  };
  const placeChart = (element, rows = phaseRows) => {
    const laid = layoutReport({
      document: phaseDocument(element),
      rows,
      measure,
      catalog: catalogForValidation,
    });
    const placed = laid.pages.flatMap(page => page.bands).flatMap(band => band.elements).find(candidate => candidate.id === element.id);
    return { laid, placed, chart: placed?.payload.kind === "chart" ? placed.payload.chart : null };
  };

  section("a chart folds the rows and draws inside its box");
  {
    const { laid, placed, chart } = placeChart(chartElement());
    check(laid.refused === false, "a chart does not stop the report from laying out");
    check(placed?.type === "chart", "a chart element lays out into a chart element");
    check(placed?.payload.kind === "chart", "carrying a drawn chart");
    check(chart.data.length === 2, `one bar per category (${chart.data?.length})`);
    check(chart.data[0]?.label === "Hardware" && chart.data[1]?.label === "Software", "in the order the rows sorted into");
    check(chart.bars.length === 2, "and one bar drawn for each");
    check(
      Math.abs(chart.data.reduce((sum, datum) => sum + datum.value, 0) - amountTotal) < 0.001,
      `the bars add up to the total of the rows (${chart.data.reduce((sum, datum) => sum + datum.value, 0)} of ${amountTotal})`,
    );
    check(Math.abs(chart.data[0].value - 150) < 0.001, "summing the rows of each category (Hardware = 150)");
    check(
      chart.bars.every(bar => bar.x >= chart.box.x - 0.001 && bar.x + bar.w <= chart.box.x + chart.box.w + 0.001),
      "every bar is inside the chart's box horizontally",
    );
    check(
      chart.bars.every(bar => bar.y >= chart.box.y - 0.001 && bar.y + bar.h <= chart.box.y + chart.box.h + 0.001),
      "and vertically, so nothing is clipped",
    );
    check(chart.gridLines.length === 5 && chart.axis.length === 2, "the axis and its grid lines are placed");
    check(chart.labels.some(label => label.role === "category" && label.text === "Hardware"), "the categories are labelled");
    check(chart.labels.some(label => label.role === "axis"), "and so are the values");
    check(chart.labels.every(label => label.baselineY > label.y), "every label knows where its baseline is, so the PDF can place it");

    check(placeChart(chartElement({ fn: "COUNT", valueExpression: "" })).chart.data.every(datum => datum.value === 2), "COUNT with no field counts the rows of each category");
    check(placeChart(chartElement({ fn: "COUNTD", valueExpression: "Fields.description" })).chart.data.every(datum => datum.value === 2), "COUNTD counts the distinct values");
    check(Math.abs(placeChart(chartElement({ fn: "AVG" })).chart.data[0].value - 75) < 0.001, "AVG averages the numbers of each category");
    check(Math.abs(placeChart(chartElement({ fn: "MAX" })).chart.data[0].value - 100) < 0.001, "MAX takes the highest");

    // A long tail is folded so the axis stays readable, and the fold is named for what it holds.
    const many = Array.from({ length: 15 }, (_, index) => ({ description: `E-${index}`, category: `S${index}`, amount: index + 1 }));
    const folded = placeChart(chartElement({ maxCategories: 5 }), many).chart;
    check(folded.data.length === 5, `a chart folds its tail into one category (${folded.data.length} of 15)`);
    check(folded.data[4].label.startsWith("Other (11)"), `and says how many it folded (${folded.data[4]?.label})`);
    check(
      Math.abs(folded.data[4].value - many.slice(4).reduce((sum, row) => sum + row.amount, 0)) < 0.001,
      "keeping the folded values rather than dropping them",
    );
    check(placeChart(chartElement({ maxCategories: 5, showLegend: false, showValues: true }), many).chart.labels.some(label => label.role === "value"), "values on the bars are labelled when asked for");
  }

  section("a pie is measured in turns, a line in points");
  {
    const { chart } = placeChart(chartElement({ kind: "pie" }));
    check(chart.slices.length === 2, "a pie has one slice per category");
    const turn = chart.slices.reduce((sum, slice) => sum + (slice.endAngle - slice.startAngle), 0);
    check(Math.abs(turn - Math.PI * 2) < 1e-6, `the slices add up to exactly one turn (${turn.toFixed(6)})`);
    check(chart.slices[0].startAngle === 0, "the first slice starts at twelve o'clock");
    check(chart.slices[0].endAngle === chart.slices[1].startAngle, "and the slices are contiguous");
    check(
      chart.slices[0].endAngle - chart.slices[0].startAngle > chart.slices[1].endAngle - chart.slices[1].startAngle,
      "the larger share sweeps a larger angle",
    );
    check(chart.centre.r > 0 && chart.centre.innerR === 0, "a pie has a radius and no hole");
    check(chart.legendSwatches.length === 2, "and a key to its colours");

    const donut = placeChart(chartElement({ kind: "donut" })).chart;
    check(donut.centre.innerR > 0 && donut.centre.innerR < donut.centre.r, "a donut leaves the middle open");
    check(donut.slices.length === donut.data.length, "and is otherwise a pie");

    const line = placeChart(chartElement({ kind: "line" })).chart;
    check(line.points.length === 2 && line.bars.length === 0, "a line is drawn as points, not bars");
    check(line.points[0].y < line.points[1].y, "a larger value is drawn higher up the page");
    check(line.points.every(point => point.y >= line.box.y && point.y <= line.box.y + line.box.h), "and the points stay inside the box");

    const bars = placeChart(chartElement({ kind: "bar" })).chart;
    check(bars.bars[0].w > bars.bars[1].w, "a horizontal bar is as long as its value");

    const nothing = placeChart(chartElement(), []).chart;
    check(nothing.empty === true, "a chart with no rows says it has nothing to draw");
    check(nothing.bars.length === 0, "rather than drawing an axis around nothing");
    check(nothing.labels.some(label => label.role === "note" && /no data/i.test(label.text)), "and prints a note where the chart would be");

    // Negative values must not be drawn as positive bars, or a credit reads as a charge.
    const mixed = placeChart(chartElement(), [{ category: "Up", amount: 30 }, { category: "Down", amount: -10 }]).chart;
    check(mixed.bars[0].y < mixed.bars[1].y, "a negative value is drawn below the baseline and a positive one above it");
    check(mixed.bars[0].y + mixed.bars[0].h < mixed.bars[1].y + 0.001, "with both bars growing away from nought");
  }

  section("a chart is validated like the rest of the document");
  {
    const codes = element => errorsOf(validateTemplate(phaseDocument(element), { catalog: catalogForValidation })).map(issue => issue.code);

    check(!codes(chartElement()).length, "a well-formed chart validates");
    check(codes(chartElement({ categoryExpression: "" })).includes("element.chartCategory"), "a chart with no category field is refused");
    check(codes(chartElement({ valueExpression: "" })).includes("element.chartValue"), "and one with no value field");
    check(codes(chartElement({ valueExpression: "Fields.nope" })).includes("element.field"), "and one naming a field that does not exist");
    check(codes(chartElement({ valueExpression: "Fields.status" })).includes("element.chartType"), "SUM needs a number, and a status is not one");
    check(!codes(chartElement({ valueExpression: "Fields.status", fn: "COUNT" })).length, "but COUNT is happy with anything countable");
    check(!codes(chartElement({ categoryExpression: "Fields.amount + 1" })).length, "a chart's categories may be any per-row expression, including a calculation");
    check(
      errorsOf(validateTemplate(phaseDocument(chartElement({ w: 20, h: 12 })), { catalog: catalogForValidation })).length === 0,
      "a small chart is not an error",
    );
    check(
      validateTemplate(phaseDocument(chartElement({ w: 20, h: 12 })), { catalog: catalogForValidation }).some(issue => issue.severity === "warning" && issue.code === "element.chartSmall"),
      "but it warns while it is still being designed, because an axis needs room",
    );
    check(codes(chartElement({ categoryExpression: "SUM(Fields.amount)" })).includes("element.chartExpression"), "a chart's categories are read row by row, so an aggregate in one is refused");
    check(codes(chartElement({ valueExpression: "RUNNINGSUM(Fields.amount)" })).includes("element.chartExpression"), "and so is a running total");
    check(codes(chartElement({ scope: "group" })).includes("element.scope"), "a group-scoped chart outside a group is refused");
  }

  section("a running total keeps adding up, and carries over a page break");
  {
    const runningDocument = (expression, extraBand = null, groups = []) => {
      const document = createBlankDocument("Running totals", "expenses");
      document.page = { size: "a4", orientation: "portrait", width: 210, height: 297, margins: { top: 10, right: 10, bottom: 10, left: 10 } };
      const detail = createBand("detail", { height: 6 });
      detail.elements = [field("Fields.description", 0, 0, 40, 6), field(expression, 100, 0, 50, 6, "money")];
      document.bands = [detail, ...(extraBand ? [extraBand] : [])];
      document.groups = groups;
      return document;
    };
    const runningValues = laid => laid.pages
      .flatMap(page => page.bands)
      .filter(band => band.kind === "detail")
      .map(band => Number(band.elements[1].payload.lines.map(line => line.text).join("").replace(/[^0-9.-]/g, "")));

    const laid = layoutReport({ document: runningDocument("RUNNINGSUM(Fields.amount)"), rows: phaseRows, measure, catalog: catalogForValidation });
    const values = runningValues(laid);
    check(laid.refused === false, "a running total does not stop the report from laying out");
    check(values.length === 4, `every row prints a running total (${values.length})`);
    check(values[0] === 100 && values[1] === 150 && values[2] === 175, `each row adds its own amount to the one before (${values.join(", ")})`);
    check(Math.abs(values[3] - amountTotal) < 0.001, "and the last row's total is the report's total");

    check(runningValues(layoutReport({ document: runningDocument("RUNNINGCOUNT()"), rows: phaseRows, measure, catalog: catalogForValidation })).join(",") === "1,2,3,4", "a running count counts the rows printed so far");
    check(runningValues(layoutReport({ document: runningDocument("RUNNINGCOUNT(Fields.description)"), rows: phaseRows, measure, catalog: catalogForValidation })).join(",") === "1,2,3,4", "or the rows where a field has a value");
    check(
      runningValues(layoutReport({ document: runningDocument("RUNNINGAVG(Fields.amount)"), rows: phaseRows, measure, catalog: catalogForValidation })).join(",") === "100,75,58.33,50",
      "a running mean is the mean of the rows so far",
    );

    // Enough rows to need more than one page: the total must not restart at the top of page two.
    const many = Array.from({ length: 90 }, (_, index) => ({ description: `E-${index}`, amount: 10 }));
    const spilled = layoutReport({ document: runningDocument("RUNNINGSUM(Fields.amount)"), rows: many, measure, catalog: catalogForValidation });
    check(spilled.pages.length > 1, `90 rows need more than one page (${spilled.pages.length})`);
    const secondPage = spilled.pages[1].bands.find(band => band.kind === "detail");
    const carried = Number(secondPage.elements[1].payload.lines.map(line => line.text).join("").replace(/[^0-9.-]/g, ""));
    check(carried > 400, `the total carries over the break rather than restarting (${carried} on the first row of page 2)`);
    const across = runningValues(spilled);
    check(Math.abs(across[across.length - 1] - 900) < 0.001, "and still reaches the report's total at the last row");

    // Scoped to a group, the total starts again when that group opens.
    const groups = [{ key: "status", label: "Status", expression: "Fields.status", sort: "asc", keepTogether: true }];
    const groupHeader = createBand("groupHeader", { height: 6, groupKey: "status" });
    groupHeader.elements = [field("Fields.status", 0, 0, 40, 6)];
    const scoped = layoutReport({
      document: runningDocument("RUNNINGSUM(Fields.amount, 'status')", groupHeader, groups),
      rows: phaseRows,
      measure,
      catalog: catalogForValidation,
    });
    check(runningValues(scoped).join(",") === "100,150,25,50", `a group-scoped running total restarts at each group (${runningValues(scoped).join(", ")})`);

    const footers = createBand("groupFooter", { height: 6, groupKey: "status" });
    footers.elements = [field("RUNNINGSUM(Fields.amount, 'status')", 100, 0, 50, 6, "money")];
    const withFooter = layoutReport({
      document: runningDocument("RUNNINGSUM(Fields.amount, 'status')", footers, groups),
      rows: phaseRows,
      measure,
      catalog: catalogForValidation,
    });
    const groupTotals = withFooter.pages
      .flatMap(page => page.bands)
      .filter(band => band.kind === "groupFooter")
      .map(band => Number(band.elements[0].payload.lines.map(line => line.text).join("").replace(/[^0-9.-]/g, "")));
    check(groupTotals.join(",") === "150,50", `a group footer reads its group's total through its last row (${groupTotals.join(", ")})`);
    check(!scoped.issues.some(issue => issue.severity === "warning"), "and nothing about it needs a warning");

    // The scope is checked before anything runs, so a total that cannot mean anything is refused.
    const validateRunning = expression => errorsOf(validateTemplate(runningDocument(expression), { catalog: catalogForValidation })).map(issue => issue.code);
    check(validateRunning("RUNNINGSUM(Fields.amount, 'page')").includes("expression.scope"), 'a running total cannot be scoped to "page"');
    check(validateRunning("RUNNINGSUM(Fields.amount, 'nowhere')").includes("expression.scope"), "nor to a group the report does not have");
    check(!errorsOf(validateTemplate(runningDocument("RUNNINGSUM(Fields.amount, 'group')"), { catalog: catalogForValidation })).length, 'and "group" is shorthand for the innermost declared group');
    const headerDocument = runningDocument("RUNNINGSUM(Fields.amount)");
    const columnHeader = createBand("columnHeader", { height: 6 });
    columnHeader.elements = [field("RUNNINGSUM(Fields.amount)", 0, 0, 40, 6, "money")];
    headerDocument.bands.push(columnHeader);
    check(
      validateTemplate(headerDocument, { catalog: catalogForValidation }).some(issue => /before any rows/.test(issue.message)),
      "a running total printed before the rows warns that it will read as nothing",
    );
    check(
      errorsOf(validateTemplate(runningDocument("RUNNINGCOUNT(Fields.nope)"), { catalog: catalogForValidation })).some(issue => issue.code === "expression.field"),
      "and its field is checked like any other",
    );
  }

  section("a sub-report flows onto its parent's pages");
  {
    const childId = "probe-child-report";
    const childParameter = { key: "clientId", label: "Client", type: "text", required: true, defaultValue: "" };
    const childDocument = () => {
      const document = createBlankDocument("Sub report", "tickets");
      document.page = { size: "a4", orientation: "portrait", width: 210, height: 297, margins: { top: 10, right: 10, bottom: 10, left: 10 } };
      document.parameters = [{ ...childParameter }];
      const title = createBand("reportTitle", { height: 8 });
      title.elements = [text("Sub-report title", 0, 0, 80, 8)];
      const detail = createBand("detail", { height: 6 });
      detail.elements = [field("Fields.ticketNumber", 0, 0, 40, 6), text("{{Parameters.clientId}}", 60, 0, 40, 6)];
      document.bands = [title, detail];
      return document;
    };
    const childRows = count => Array.from({ length: count }, (_, index) => ({ ticketNumber: `C-${index}` }));
    const subreportElement = overrides => createElement("subreport", {
      x: 0, y: 0, w: 160, h: 8, templateId: childId, templateName: "Sub report",
      parameterBindings: { clientId: "'Acme'" }, ...overrides,
    });
    const layoutWithChild = (element, parentRows = 3, childRowCount = 2, extra = {}) => {
      const summary = createBand("reportSummary", { height: element.h + 2 });
      summary.elements = [element];
      return layoutReport({
        document: parentDocument(summary),
        rows: childRows(parentRows).map(row => ({ ticketNumber: row.ticketNumber.replace("C-", "P-") })),
        parameters: { clientId: "Acme" },
        measure,
        catalog: catalogForValidation,
        templates: [{ id: childId, name: "Sub report", parameters: [childParameter] }],
        subreports: { [childId]: { document: childDocument(), rows: childRows(childRowCount), parameters: { clientId: "Acme" }, name: "Sub report" } },
        ...extra,
      });
    };

    const element = subreportElement();
    const laid = layoutWithChild(element);
    const bands = laid.pages.flatMap(page => page.bands);
    const printed = bands.flatMap(band => band.elements)
      .filter(candidate => candidate.payload.kind === "text" && /^C-\d/.test(candidate.payload.lines.map(line => line.text).join("")));
    check(laid.refused === false, "a sub-report does not stop the parent from laying out");
    check(printed.length === 2, `the sub-report's rows are printed once each (${printed.length})`);
    check(bands.some(band => band.section), "and they carry the section they came from, so they are not mistaken for the parent's rows");
    check(laid.pages.length === 1, `a child that fits does not add a page (${laid.pages.length})`);
    check(laid.rowCount === 3, `and the parent's own row count is unchanged (${laid.rowCount})`);

    // The parent's own page footer still knows the truth, however many pages the child pulls in.
    const footerOf = page => page.bands.find(band => band.kind === "pageFooter");
    const footerText = page => footerOf(page).elements[0].payload.lines.map(line => line.text).join("");
    check(footerText(laid.pages[0]) === "Page 1 of 1", `the parent's page footer reports the parent's page count (${footerText(laid.pages[0])})`);

    const spilled = layoutWithChild(element, 3, 80);
    check(spilled.pages.length > 1, `a child longer than the page adds pages (${spilled.pages.length})`);
    check(
      spilled.pages.every((page, index) => footerText(page) === `Page ${index + 1} of ${spilled.pages.length}`),
      "and the parent's footer counts every one of them, in the right order",
    );
    check(spilled.rowCount === 3, "without the child's rows becoming the parent's rows");
    check(spilled.pages.flatMap(page => page.bands).filter(band => band.kind === "detail" && !band.section).length === 3, "and the parent still prints its own three rows");
    check(spilled.pages.flatMap(page => page.bands).filter(band => band.kind === "reportTitle" && band.section).length === 1, `the child's title prints once, inline (${spilled.pages.flatMap(page => page.bands).filter(band => band.kind === "reportTitle" && band.section).length})`);
    check(
      spilled.pages.flatMap(page => page.bands).flatMap(band => band.elements).filter(candidate => candidate.payload.kind === "text" && candidate.payload.lines.some(line => line.text === "Acme")).length > 0,
      "and the sub-report's parameters are the ones its parent bound",
    );

    // A child printed from a band that repeats prints once per parent row — that is what the design asked.
    const detail = createBand("detail", { height: 6 });
    detail.elements = [field("Fields.ticketNumber", 0, 0, 40, 6), createElement("subreport", {
      x: 0, y: 0, w: 60, h: 6, templateId: childId, templateName: "Sub report", parameterBindings: {},
    })];
    const perRowDocument = parentDocument();
    perRowDocument.bands = perRowDocument.bands.map(band => (band.kind === "detail" ? detail : band));
    const perRow = layoutReport({
      document: perRowDocument,
      rows: [{ ticketNumber: "P-1" }, { ticketNumber: "P-2" }, { ticketNumber: "P-3" }],
      measure,
      catalog: catalogForValidation,
      templates: [{ id: childId, name: "Sub report", parameters: [childParameter] }],
      // No parameters bound at all: the child's required parameter is unset, which must not stop the parent.
      subreports: { [childId]: { document: childDocument(), rows: childRows(1), parameters: {}, name: "Sub report" } },
    });
    check(
      perRow.pages.flatMap(page => page.bands).flatMap(band => band.elements).filter(candidate => candidate.payload.kind === "text" && /^C-0/.test(candidate.payload.lines.map(line => line.text).join(""))).length === 3,
      "a sub-report in a repeating band prints once for each of the parent's rows",
    );
    check(perRow.pages.length === 1 && !perRow.refused, "and the parent is still produced when the child is missing what it needs");

    // A sub-report that cannot be found is a note and a placeholder, never a refusal: the rest of the
    // report is still worth printing.
    const missing = layoutReport({
      document: parentDocument((() => { const band = createBand("reportSummary", { height: 10 }); band.elements = [subreportElement({ templateId: "gone", templateName: "Deleted report" })]; return band; })()),
      rows: [{ ticketNumber: "P-1" }, { ticketNumber: "P-2" }],
      measure,
      catalog: catalogForValidation,
    });
    check(!missing.refused && missing.pages.length > 0, "a sub-report that is no longer available does not stop the report");
    check(missing.issues.some(issue => issue.code === "render.subreport" && /not available/.test(issue.message)), "it is reported as a warning that says so");
    check(
      missing.pages.flatMap(page => page.bands).flatMap(band => band.elements).some(candidate => candidate.payload.kind === "text" && /not available/.test(candidate.payload.lines.map(line => line.text).join(""))),
      "and a placeholder is printed where it would have been",
    );

    // Validation refuses a reference that cannot resolve before the report is ever run.
    const withChild = overrides => {
      const band = createBand("reportSummary", { height: 10 });
      band.elements = [subreportElement(overrides)];
      return parentDocument(band);
    };
    const options = { catalog: catalogForValidation, templates: [{ id: childId, name: "Sub report", parameters: [childParameter] }] };
    check(errorsOf(validateTemplate(withChild({ templateId: "gone" }), options)).some(issue => issue.code === "element.subreportMissing"), "a reference to a report that is not there is an error on save");
    check(errorsOf(validateTemplate(withChild({ templateId: "" }), { catalog: catalogForValidation })).some(issue => issue.code === "element.subreport"), "and so is a sub-report with no report chosen");
    check(!errorsOf(validateTemplate(withChild({}), options)).length, "a reference that is there validates");
    check(errorsOf(validateTemplate(withChild({ parameterBindings: { clientId: "Fields.ticketNumber" } }), options)).some(issue => issue.code === "element.subreportBinding"), "a binding that reads a row is refused, because it is worked out before there are any rows");
    check(errorsOf(validateTemplate(withChild({ parameterBindings: { clientId: "SUM(Fields.amount)" } }), options)).some(issue => issue.code === "element.subreportBinding"), "and so is one that totals anything");
    check(validateTemplate(withChild({ parameterBindings: {} }), options).some(issue => issue.code === "element.subreportParameter"), "and an unbound required parameter is pointed out");
    check(!errorsOf(validateTemplate(withChild({ parameterBindings: { clientId: "Parameters.clientId" } }), options)).length, "binding it to the parent's parameter validates");
    check(validateTemplate(withChild({ parameterBindings: { "not a name": "1" } }), options).some(issue => issue.code === "element.subreportParameter"), "and a binding whose key is not a parameter name is pointed out");
  }

  section("the API resolves sub-reports, and refuses a loop");
  {
    const stampChild = Date.now().toString(36);
    const created = [];
    const makeTemplate = async (name, document) => {
      const response = await call("POST", "/api/reports", { token: admin.token, body: { name, type: "template", config: { document } } });
      if (response.data?.id) created.push(response.data.id);
      return response;
    };

    const childDoc = () => {
      const document = createBlankDocument("Probe child", "tickets");
      document.page = { size: "a4", orientation: "portrait", width: 210, height: 297, margins: { top: 10, right: 10, bottom: 10, left: 10 } };
      document.parameters = [{ key: "status", label: "Status", type: "text", required: true, defaultValue: "" }];
      document.dataSources[0].filters = [{ field: "status", op: "equals", parameterKey: "status" }];
      document.dataSources[0].limit = 200;
      const detail = createBand("detail", { height: 6 });
      detail.elements = [field("Fields.ticketNumber", 0, 0, 60, 6)];
      document.bands = [detail];
      return document;
    };
    // A child with nothing to ask for, for the templates that only exist to be pointed at.
    const bareChildDoc = () => {
      const document = childDoc();
      document.parameters = [];
      document.dataSources[0].filters = [];
      return document;
    };

    const parentDoc = templateId => {
      const document = createBlankDocument("Probe parent", "tickets");
      document.page = { size: "a4", orientation: "portrait", width: 210, height: 297, margins: { top: 10, right: 10, bottom: 10, left: 10 } };
      document.parameters = [{ key: "status", label: "Status", type: "text", required: true, defaultValue: "new" }];
      const summary = createBand("reportSummary", { height: 40 });
      summary.elements = [createElement("subreport", {
        x: 0, y: 0, w: 160, h: 20, templateId, templateName: "Probe child",
        parameterBindings: { status: "Parameters.status" },
      })];
      const detail = createBand("detail", { height: 6 });
      detail.elements = [field("Fields.ticketNumber", 0, 0, 60, 6)];
      document.bands = [detail, summary];
      return document;
    };

    const child = await makeTemplate(`Probe template child ${stampChild}`, childDoc());
    check(child.status === 201, `a child template is stored (${child.status})`);
    const childId = child.data?.id;

    const parent = await makeTemplate(`Probe template parent ${stampChild}`, parentDoc(childId));
    check(parent.status === 201, `and a parent that prints it (${parent.status})`);

    const run = await call("GET", `/api/reports/${parent.data?.id}/run`, { token: admin.token });
    check(run.status === 200, `the parent runs (${run.status})`);
    const resolved = run.data?.subreports?.[childId];
    check(!!resolved, "and its sub-report came back resolved for the run");
    check(resolved?.parameters?.status === "new", `with the parent's parameter value inherited (${resolved?.parameters?.status})`);
    check(Array.isArray(resolved?.rows) && resolved.rows.length > 0, `and the child's own rows fetched once (${resolved?.rows?.length})`);
    check((resolved?.rows ?? []).every(row => row.status === "new"), "every one of which satisfies the parameter the parent bound");
    check(resolved?.document?.bands?.length > 0, "with the child's own document, so the layout can print it");

    // The same binding, a different parent parameter: the child follows it rather than caching a value.
    const closed = await call("GET", `/api/reports/${parent.data?.id}/run?status=closed`, { token: admin.token });
    const closedResolved = closed.data?.subreports?.[childId];
    check(closed.status === 200, `the parent runs again with another parameter (${closed.status})`);
    check(closedResolved?.parameters?.status === "closed", "and the child inherits the new value");
    check((closedResolved?.rows ?? []).length > 0 && (closedResolved?.rows ?? []).every(row => row.status === "closed"), "so it fetches the rows that value asks for");
    check(closedResolved?.rows?.length !== resolved?.rows?.length, "which are not the same rows as before");
    check(run.data?.parameters?.status === "new", "and the parent's own parameters are unchanged by the child");

    // A report that prints itself is refused rather than looped.
    const selfDoc = bareChildDoc();
    const selfie = await makeTemplate(`Probe template self ${stampChild}`, selfDoc);
    const summary = createBand("reportSummary", { height: 20 });
    summary.elements = [createElement("subreport", { x: 0, y: 0, w: 120, h: 15, templateId: selfie.data.id, templateName: "itself" })];
    const patched = await call("PATCH", `/api/reports/${selfie.data.id}`, {
      token: admin.token,
      body: { config: { document: { ...selfDoc, bands: [...selfDoc.bands, summary] } } },
    });
    check(patched.status === 200, `a template may point at itself once it exists (${patched.status})`);
    const selfRun = await call("GET", `/api/reports/${selfie.data.id}/run`, { token: admin.token });
    check(selfRun.status === 200, `and running it still answers rather than hanging (${selfRun.status})`);
    check((selfRun.data?.notes ?? []).some(note => /would print itself/i.test(note)), "with a note saying it was skipped");
    check(!selfRun.data?.subreports?.[selfie.data.id], "and nothing resolved for it");

    // Nesting is bounded: a chain longer than the cap stops at the cap and says so.
    const chain = [];
    for (let level = 0; level < 5; level++) {
      const document = bareChildDoc();
      if (level > 0) {
        const nested = createBand("reportSummary", { height: 20 });
        nested.elements = [createElement("subreport", { x: 0, y: 0, w: 120, h: 15, templateId: chain[level - 1], templateName: `level ${level - 1}` })];
        document.bands = [...document.bands, nested];
      }
      const response = await makeTemplate(`Probe template chain ${stampChild} ${level}`, document);
      chain.push(response.data?.id);
      if (response.status !== 201) break;
    }
    check(chain.filter(Boolean).length === 5, `a five-deep chain of templates is stored (${chain.filter(Boolean).length})`);
    const deep = await call("GET", `/api/reports/${chain[4]}/run`, { token: admin.token });
    check(deep.status === 200, `the deepest of them runs (${deep.status})`);
    check((deep.data?.notes ?? []).some(note => /nest at most 3 deep/i.test(note)), "and the level past the cap is skipped with a note rather than followed");
    check(Object.keys(deep.data?.subreports ?? {}).length <= 3, `so at most three levels resolved (${Object.keys(deep.data?.subreports ?? {}).length})`);

    // A sub-report whose target stops being a designed report is skipped at run time with a note, and the
    // engine prints a placeholder — the parent is still worth printing.
    const retired = await makeTemplate(`Probe template retired ${stampChild}`, bareChildDoc());
    const retiredId = retired.data?.id;
    const pointing = await makeTemplate(`Probe template pointing ${stampChild}`, parentDoc(retiredId));
    check(pointing.status === 201, `a parent may point at a report that is still a template (${pointing.status})`);
    const firstRun = await call("GET", `/api/reports/${pointing.data?.id}/run`, { token: admin.token });
    check(!!firstRun.data?.subreports?.[retiredId], "and it resolves while it is one");
    const demoted = await call("PATCH", `/api/reports/${retiredId}`, {
      token: admin.token,
      body: { type: "custom", config: { source: "tickets", columns: [], filters: [], limit: 5 } },
    });
    check(demoted.status === 200 && demoted.data.type === "custom", `a template can be turned back into a plain report (${demoted.status})`);
    const afterDemotion = await call("GET", `/api/reports/${pointing.data?.id}/run`, { token: admin.token });
    check(afterDemotion.status === 422, `and the parent then refuses to run rather than printing nothing (${afterDemotion.status})`);
    check(/no longer available/.test(JSON.stringify(afterDemotion.data)), "naming the report that went missing, so the fix is obvious");

    // The engine still has the last word: handed the parent's document without a resolution — which is what
    // the designer's own preview does while a child is being fixed — it prints a placeholder, not a refusal.
    const previewLayout = layoutReport({
      document: parentDoc(retiredId),
      rows: [{ ticketNumber: "P-1" }],
      measure,
      catalog: catalogForValidation,
      subreports: {},
    });
    check(previewLayout.pages.length > 0 && !previewLayout.refused, "and a layout made without a resolution is still produced");
    check(
      previewLayout.pages.flatMap(page => page.bands).flatMap(band => band.elements).some(candidate => candidate.payload.kind === "text" && /not available/i.test(candidate.payload.lines.map(line => line.text).join(""))),
      "with a placeholder where the sub-report would have been",
    );

    for (const id of created.filter(Boolean)) await call("DELETE", `/api/reports/${id}`, { token: admin.token });
    check(created.filter(Boolean).length > 0, `the sub-report probe's ${created.filter(Boolean).length} templates are cleaned up`);
  }


  if (createdId) {
    const removed = await call("DELETE", `/api/reports/${createdId}`, { token: admin.token });
    check(removed.status === 200, `the probe's template is cleaned up (${removed.status})`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

function describeIssuesBrief(issues) {
  const errors = issues.filter(issue => issue.severity === "error");
  return errors.length ? errors.map(issue => issue.message).join("; ") : "clean";
}

main().catch(async error => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
