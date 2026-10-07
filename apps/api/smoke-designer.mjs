import { createBlankDocument, createDataSource, createStarter, validateTemplate, layoutReport } from "../../packages/shared/src/index.ts";
const catalog = { sources: [{ key: "tickets", label: "Tickets", fields: [
  { key: "ticketNumber", label: "Ticket Number", type: "text" },
  { key: "title", label: "Title", type: "text" },
  { key: "status", label: "Status", type: "text" },
  { key: "client", label: "Client", type: "text" },
  { key: "createdAt", label: "Created", type: "date" },
] }] };
const doc = createStarter("clientSummary", catalog.sources[0], "Smoke");
const issues = validateTemplate(doc, { catalog });
console.log("issues:", issues.length, JSON.stringify(issues.slice(0, 4)));
const measure = (text) => text.length * 1.6;
const result = layoutReport({ document: doc, rows: [], measure });
console.log("pages:", result.pages.length, "refused:", result.refused);
