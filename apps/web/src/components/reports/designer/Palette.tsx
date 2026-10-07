/**
 * The palette (PLAN-020): the data and the language the report may use.
 *
 * A click inserts into **the expression you were last typing in** — the field and function lists are the
 * expression builder, which is why they write through `insertIntoActiveExpression` rather than a menu of
 * pre-set values. When no expression has focus, a click does the next most useful thing: it appends to
 * the selected element's own expression, or adds a new element to the selected band. The line at the top
 * always says which of those will happen, so the palette is never a guess.
 */
import { useMemo, useState } from "react";
import {
  createElement, type ReportTemplateDocument, type TemplateElement,
} from "@C7NTAX/shared";
import type { CatalogField, CatalogFunction, DesignerCatalog } from "../../../lib/designerTypes";
import { activeExpressionKey, insertIntoActiveExpression } from "./ExpressionInput";
import type { Selection } from "./Inspector";

interface PaletteProps {
  document: ReportTemplateDocument;
  catalog: DesignerCatalog | null;
  selection: Selection;
  onAddElement: (bandId: string, element: TemplateElement) => void;
  onEditElement: (bandId: string, elementId: string, patch: Partial<TemplateElement>) => void;
  onSelect: (selection: Selection) => void;
}

const FIELD_TYPE_ORDER = ["text", "number", "money", "minutes", "date", "boolean"];

const TYPE_LABELS: Record<string, string> = {
  text: "Text", number: "Number", money: "Money", minutes: "Minutes", date: "Date", boolean: "Yes / no",
};

export function Palette({ document, catalog, selection, onAddElement, onEditElement, onSelect }: PaletteProps) {
  const [search, setSearch] = useState("");
  const [openCategory, setOpenCategory] = useState<string | null>("Aggregate");

  const source = document.dataSources[0];
  const sourceCatalog = catalog?.sources.find(candidate => candidate.key === source?.source);
  const fields = useMemo(() => sourceCatalog?.fields ?? [], [sourceCatalog]);

  const visibleFields = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return fields;
    return fields.filter(field => field.key.toLowerCase().includes(needle) || field.label.toLowerCase().includes(needle));
  }, [fields, search]);

  const groupedFields = useMemo(() => {
    const groups = new Map<string, CatalogField[]>();
    for (const field of visibleFields) {
      const type = FIELD_TYPE_ORDER.includes(field.type) ? field.type : "text";
      groups.set(type, [...(groups.get(type) ?? []), field]);
    }
    return [...groups.entries()].sort((a, b) => FIELD_TYPE_ORDER.indexOf(a[0]) - FIELD_TYPE_ORDER.indexOf(b[0]));
  }, [visibleFields]);

  const functionGroups = useMemo(() => {
    const groups = new Map<string, CatalogFunction[]>();
    for (const fn of catalog?.functions ?? []) groups.set(fn.category, [...(groups.get(fn.category) ?? []), fn]);
    return [...groups.entries()];
  }, [catalog]);

  const targetBandId = selection.kind === "element" ? selection.bandId : selection.kind === "band" ? selection.bandId : document.bands.find(band => band.kind === "detail")?.id ?? document.bands[0]?.id;
  const targetBand = document.bands.find(band => band.id === targetBandId);
  const selectedElement = selection.kind === "element"
    ? document.bands.find(band => band.id === selection.bandId)?.elements.find(element => element.id === selection.elementId)
    : undefined;

  /** Where a click will land, said plainly — otherwise the palette is a guess. */
  const targetDescription = (() => {
    if (activeExpressionKey()) return "Inserting into the expression you are editing";
    if (selectedElement) return `Appending to the selected ${selectedElement.type} element`;
    if (targetBand) return `Adding a new element to the ${targetBand.kind} band`;
    return "Select a band first";
  })();

  /** Appends to the selected element's own expression — a document edit rather than a keystroke. */
  const appendToSelected = (text: string, wrapInTextHole = false): boolean => {
    if (selection.kind !== "element" || !selectedElement) return false;
    if (selectedElement.type === "field" || selectedElement.type === "aggregate") {
      const expression = `${selectedElement.expression}${selectedElement.expression ? " " : ""}${text}`;
      onEditElement(selection.bandId, selectedElement.id, { expression } as Partial<TemplateElement>);
      return true;
    }
    if (selectedElement.type === "text") {
      const addition = wrapInTextHole ? `{{${text}}}` : text;
      onEditElement(selection.bandId, selectedElement.id, { text: `${selectedElement.text}${addition}` } as Partial<TemplateElement>);
      return true;
    }
    return false;
  };

  const addFieldElement = (expression: string, field: CatalogField | null) => {
    if (!targetBand) return;
    const format = field
      ? field.type === "money" ? "money" : field.type === "date" ? "date" : field.type === "number" ? "number" : field.type === "minutes" ? "minutes" : "text"
      : "text";
    const element = createElement("field", {
      x: 0,
      y: Math.max(0, Math.min(targetBand.height - 5, targetBand.elements.length * 5.5)),
      w: field?.type === "date" ? 30 : format === "money" || format === "number" || format === "minutes" ? 26 : 60,
      h: Math.max(4, Math.min(7, targetBand.height - 0.5)),
      expression,
      format,
      style: {
        ...createElement("field").style,
        fontSize: 8.5,
        align: format === "money" || format === "number" || format === "minutes" ? "right" : "left",
        valign: targetBand.height > 8 ? "top" : "middle",
      },
    });
    onAddElement(targetBand.id, element);
    onSelect({ kind: "element", bandId: targetBand.id, elementId: element.id });
  };

  /** A field: into the expression being edited, else into the selected element, else a new element. */
  const placeField = (field: CatalogField) => {
    const reference = `Fields.${field.key}`;
    if (insertIntoActiveExpression(reference)) return;
    if (appendToSelected(reference, true)) return;
    addFieldElement(reference, field);
  };

  /** A function or a built-in: same three destinations, with the caret placed inside the brackets. */
  const placeSnippet = (text: string, caretOffset?: number) => {
    if (insertIntoActiveExpression(text, caretOffset)) return;
    if (appendToSelected(text)) return;
    addFieldElement(text, null);
  };

  const insertFunction = (fn: CatalogFunction) => {
    if (fn.minArgs === 0) { placeSnippet(`${fn.name}()`); return; }
    placeSnippet(`${fn.name}()`, fn.name.length + 1);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-surface-lighter">
        <p className="text-[10px] text-cyber-300">{targetDescription}</p>
        <p className="text-[10px] text-gray-500 mt-0.5">Source: {sourceCatalog?.label ?? source?.source ?? "—"}</p>
      </div>

      <div className="px-3 py-2 border-b border-surface-lighter">
        <input
          className="w-full bg-surface-light border border-surface-lighter rounded px-2 py-1 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-cyber-500"
          placeholder="Search fields…"
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <section className="px-3 py-2">
          <h4 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">Fields</h4>
          {!fields.length ? <p className="text-[10px] text-gray-500">The catalog is loading…</p> : null}
          {groupedFields.map(([type, group]) => (
            <div key={type} className="mb-2">
              <p className="text-[10px] text-gray-500 mb-1">{TYPE_LABELS[type] ?? type}</p>
              <div className="flex flex-wrap gap-1">
                {group.map(field => (
                  <button
                    key={field.key}
                    type="button"
                    draggable
                    title={`Fields.${field.key}`}
                    onDragStart={event => event.dataTransfer.setData("text/plain", `field:${field.key}`)}
                    onClick={() => placeField(field)}
                    className="px-2 py-1 rounded text-[10px] bg-surface-light border border-surface-lighter text-gray-300 hover:border-cyber-500 hover:text-cyber-200"
                  >
                    {field.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>

        {document.parameters.length ? (
          <section className="px-3 py-2 border-t border-surface-lighter">
            <h4 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">Parameters</h4>
            <div className="flex flex-wrap gap-1">
              {document.parameters.map(parameter => (
                <button
                  key={parameter.key}
                  type="button"
                  onClick={() => placeSnippet(`Parameters.${parameter.key}`)}
                  className="px-2 py-1 rounded text-[10px] bg-surface-light border border-surface-lighter text-gray-300 hover:border-cyber-500 hover:text-cyber-200"
                >
                  {parameter.label || parameter.key}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="px-3 py-2 border-t border-surface-lighter">
          <h4 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">Built-ins</h4>
          <div className="flex flex-wrap gap-1">
            {[
              { label: "Page number", text: "Page.number" },
              { label: "Total pages", text: "Page.totalPages" },
              { label: "Report name", text: "Report.name" },
              { label: "Row count", text: "Report.rowCount" },
              { label: "Group value", text: "Group.value" },
              { label: "Group count", text: "Group.count" },
            ].map(builtin => (
              <button
                key={builtin.text}
                type="button"
                onClick={() => placeSnippet(builtin.text)}
                className="px-2 py-1 rounded text-[10px] bg-surface-light border border-surface-lighter text-gray-300 hover:border-cyber-500 hover:text-cyber-200"
              >
                {builtin.label}
              </button>
            ))}
          </div>
        </section>

        <section className="px-3 py-2 border-t border-surface-lighter">
          <h4 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">Functions</h4>
          {functionGroups.map(([category, group]) => (
            <div key={category} className="mb-1">
              <button
                type="button"
                className="w-full text-left text-[11px] text-gray-300 hover:text-white flex items-center gap-1"
                onClick={() => setOpenCategory(openCategory === category ? null : category)}
              >
                <span className="text-gray-500">{openCategory === category ? "▾" : "▸"}</span>
                {category} <span className="text-gray-600">({group.length})</span>
              </button>
              {openCategory === category ? (
                <div className="mt-1 space-y-1">
                  {group.map(fn => (
                    <button
                      key={fn.name}
                      type="button"
                      onClick={() => insertFunction(fn)}
                      className="w-full text-left px-2 py-1 rounded text-[10px] bg-surface-light border border-surface-lighter hover:border-cyber-500"
                    >
                      <span className="font-mono text-cyber-200">{fn.signature}</span>
                      <span className="block text-gray-500">{fn.description}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </section>

        <section className="px-3 py-2 border-t border-surface-lighter">
          <h4 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">Elements</h4>
          <div className="flex flex-wrap gap-1">
            {(catalog?.elementTypes ?? []).filter(spec => spec.type !== "field").map(spec => (
              <button
                key={spec.type}
                type="button"
                title={spec.help}
                disabled={!targetBand}
                onClick={() => {
                  if (!targetBand) return;
                  const element = createElement(spec.type as TemplateElement["type"], {
                    x: 0,
                    y: Math.max(0, Math.min(targetBand.height - 5, targetBand.elements.length * 5.5)),
                    w: spec.type === "text" ? 50 : spec.type === "aggregate" ? 30 : spec.type === "image" ? 25 : 60,
                    h: Math.max(4, Math.min(7, targetBand.height - 0.5)),
                  });
                  onAddElement(targetBand.id, element);
                  onSelect({ kind: "element", bandId: targetBand.id, elementId: element.id });
                }}
                className={`px-2 py-1 rounded text-[10px] border ${targetBand ? "bg-surface-light border-surface-lighter text-gray-300 hover:border-cyber-500" : "text-gray-600 border-surface-lighter"}`}
              >
                {spec.label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
