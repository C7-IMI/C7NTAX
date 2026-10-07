import { createStarter, validateTemplate } from "../../packages/shared/src/reportTemplate.ts";
import { layoutReport } from "../../packages/shared/src/reportLayout.ts";

const catalog = { sources: [{ key: "tickets", label: "Tickets", fields: [
  { key: "ticketNumber", label: "Ticket Number", type: "text" },
  { key: "title", label: "Title", type: "text" },
  { key: "status", label: "Status", type: "text" },
  { key: "client", label: "Client", type: "text" },
  { key: "createdAt", label: "Created", type: "date" },
] }] };
const doc = createStarter("clientSummary", catalog.sources[0], "Smoke");
console.log("bands:", doc.bands.map(b => b.kind).join(","), "| groups:", doc.groups.length);
const issues = validateTemplate(doc, { catalog });
console.log("issues:", issues.length, JSON.stringify(issues.slice(0, 5), null, 0));
const measure = (text) => text.length * 1.6;
const rows = [
  { ticketNumber: "T-1", title: "Alpha", status: "new", client: "Acme", createdAt: "2026-08-01" },
  { ticketNumber: "T-2", title: "Beta", status: "new", client: "Acme", createdAt: "2026-08-02" },
  { ticketNumber: "T-3", title: "Gamma", status: "closed", client: "Globex", createdAt: "2026-08-03" },
];
const result = layoutReport({ document: doc, rows, measure });
console.log("pages:", result.pages.length, "refused:", result.refused, "groups:", result.groupCount);
for (const page of result.pages) {
  console.log("page", page.number, "rows:", page.rowIndexes.join(","), "bands:", page.bands.map(b => b.kind).join(">"));
  for (const band of page.bands) {
    const texts = band.elements.flatMap(e => e.payload.kind === "text" ? e.payload.lines.map(l => l.text) : []);
    if (texts.length) console.log("   ", band.kind, JSON.stringify(texts.join(" | ")));
  }
}
