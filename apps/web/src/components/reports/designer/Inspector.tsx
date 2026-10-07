/**
 * The property grid (PLAN-020).
 *
 * Three panels behind one component, chosen by what is selected: nothing (the report — name, page
 * setup, data source, parameters and groups), a band (height, repeat, page break, its group) or an
 * element (what it prints, how it looks, where it sits). Every control writes straight back into the
 * document, so the canvas and the panels can never show different values.
 */
import { useMemo } from "react";
import {
  BAND_KINDS, BAND_BY_KIND, CHART_FUNCTIONS, CHART_KINDS, ELEMENT_TYPES, PAGE_SIZES, VALUE_FORMATS, FORMAT_LABELS,
  AGGREGATE_FUNCTIONS, AGGREGATE_SCOPES, createBand, createElement, newId,
  type ChartElement, type ElementStyle, type ReportTemplateDocument, type SubreportElement, type TemplateBand,
  type TemplateDataSource, type TemplateElement, type TemplateGroup, type TemplateIssue, type TemplateParameter,
  type PageSizeKey, type ValueFormat,
} from "@C7NTAX/shared";
import type { CatalogTemplate, DesignerCatalog } from "../../../lib/designerTypes";
import { ExpressionInput } from "./ExpressionInput";
import { fitInBand } from "./Palette";

const CHART_VERBS: Record<string, string> = {
  SUM: "Sum of", COUNT: "Count of", AVG: "Average of", MIN: "Lowest of", MAX: "Highest of", COUNTD: "Distinct count of",
};
const chartVerb = (fn: string): string => CHART_VERBS[fn] ?? fn;

export type Selection =
  | { kind: "report" }
  | { kind: "band"; bandId: string }
  | { kind: "element"; bandId: string; elementId: string };

interface InspectorProps {
  document: ReportTemplateDocument;
  catalog: DesignerCatalog | null;
  /** The saved designed reports a sub-report element may point at, from the catalog. */
  templates: CatalogTemplate[];
  selection: Selection;
  issues: TemplateIssue[];
  onSelect: (selection: Selection) => void;
  onDocument: (next: ReportTemplateDocument, options?: { push?: boolean }) => void;
  onName: (name: string) => void;
  onDescription: (description: string) => void;
}

/** The first issue that names a path, for an inline hint next to the control that caused it. */
function issueFor(issues: TemplateIssue[], matcher: (issue: TemplateIssue) => boolean): TemplateIssue | null {
  return issues.find(issue => issue.severity === "error" && matcher(issue)) ?? null;
}

// ── Small controls ──────────────────────────────────────────────────

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">{label}</span>
      {children}
      {hint ? <span className="block text-[10px] text-gray-500 mt-1">{hint}</span> : null}
    </label>
  );
}

const inputClass = "w-full bg-surface-light border border-surface-lighter rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-cyber-500";

function NumberInput({ value, onChange, step = 1, min, max, suffix }: {
  value: number; onChange: (value: number) => void; step?: number; min?: number; max?: number; suffix?: string;
}) {
  return (
    <span className="relative block">
      <input
        type="number"
        className={inputClass}
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        max={max}
        onChange={event => onChange(Number(event.target.value))}
      />
      {suffix ? <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-500">{suffix}</span> : null}
    </span>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <input className={inputClass} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />;
}

function SelectInput<T extends string>({ value, onChange, options }: {
  value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string }>;
}) {
  return (
    <select className={inputClass} value={value} onChange={event => onChange(event.target.value as T)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

function Chips<T extends string>({ value, onChange, options }: {
  value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string; title?: string }>;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          onClick={() => onChange(option.value)}
          className={`px-2 py-1 rounded text-[10px] border transition-colors ${
            value === option.value
              ? "bg-cyber-600/25 border-cyber-500 text-cyber-200"
              : "bg-surface-light border-surface-lighter text-gray-400 hover:text-gray-200"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer" title={hint}>
      <input type="checkbox" className="mt-0.5 accent-cyber-500" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span className="text-xs text-gray-300">{label}</span>
    </label>
  );
}

function Colour({ value, onChange, allowClear }: { value: string | null; onChange: (value: string | null) => void; allowClear?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <input
        type="color"
        className="h-7 w-10 bg-surface-light border border-surface-lighter rounded cursor-pointer"
        value={value ?? "#111827"}
        onChange={event => onChange(event.target.value)}
      />
      <span className="text-[10px] font-mono text-gray-400">{value ?? "none"}</span>
      {allowClear ? (
        <button type="button" className="text-[10px] text-gray-500 hover:text-gray-300" onClick={() => onChange(null)}>clear</button>
      ) : null}
    </span>
  );
}

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="border-b border-surface-lighter px-3 py-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{title}</h4>
        {actions}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

// ── Element panel ───────────────────────────────────────────────────

function ElementPanel({ document, band, element, catalog, templates, issues, onDocument, onSelect }: {
  document: ReportTemplateDocument;
  band: TemplateBand;
  element: TemplateElement;
  catalog: DesignerCatalog | null;
  templates: CatalogTemplate[];
  issues: TemplateIssue[];
  onDocument: (next: ReportTemplateDocument, options?: { push?: boolean }) => void;
  onSelect: (selection: Selection) => void;
}) {
  const bandIndex = document.bands.findIndex(candidate => candidate.id === band.id);

  const update = (mutate: (element: TemplateElement) => TemplateElement, options?: { push?: boolean }) => {
    if (!band) return;
    const bands = document.bands.map((candidate, index) =>
      index === bandIndex ? { ...candidate, elements: candidate.elements.map(el => (el.id === element.id ? mutate(el) : el)) } : candidate);
    onDocument({ ...document, bands }, options);
  };
  const updateStyle = (patch: Partial<ElementStyle>, options?: { push?: boolean }) => {
    update(el => ({ ...el, style: { ...el.style, ...patch } }) as TemplateElement, options);
  };

  const expressionIssue = issueFor(issues, issue => issue.elementId === element.id && /expression|field|aggregate|element/.test(issue.code));
  const source = document.dataSources[0]?.source;
  const fields = catalog?.sources.find(candidate => candidate.key === source)?.fields ?? [];

  const moveSelection = (direction: -1 | 1) => {
    if (!band) return;
    const index = band.elements.findIndex(candidate => candidate.id === element.id);
    const target = index + direction;
    if (target < 0 || target >= band.elements.length) return;
    const elements = [...band.elements];
    const [moved] = elements.splice(index, 1);
    if (!moved) return;
    elements.splice(target, 0, moved);
    onDocument({ ...document, bands: document.bands.map((candidate, at) => (at === bandIndex ? { ...candidate, elements } : candidate)) });
  };

  const spec = ELEMENT_TYPES.find(candidate => candidate.type === element.type);
  const chosen = element.type === "subreport" ? templates.find(candidate => candidate.id === element.templateId) : undefined;

  return (
    <>
      <Section title={`${spec?.label ?? element.type} element`}>
        <p className="text-[10px] text-gray-500">{spec?.help}</p>

        {element.type === "text" ? (
          <ExpressionInput
            label="Text"
            multiline
            path={`${element.id}.text`}
            value={element.text}
            onChange={text => update(el => ({ ...el, text }) as TemplateElement)}
            issue={expressionIssue?.message ?? null}
            placeholder="Report title, or {{Fields.client}}"
          />
        ) : null}

        {element.type === "field" ? (
          <>
            <ExpressionInput
              label="Expression"
              path={`${element.id}.expression`}
              value={element.expression}
              onChange={expression => update(el => ({ ...el, expression }) as TemplateElement)}
              issue={expressionIssue?.message ?? null}
              placeholder="Fields.client"
            />
            <Field label="Format">
              <SelectInput
                value={element.format}
                onChange={format => update(el => ({ ...el, format }) as TemplateElement)}
                options={VALUE_FORMATS.map(format => ({ value: format, label: FORMAT_LABELS[format] }))}
              />
            </Field>
          </>
        ) : null}

        {element.type === "aggregate" ? (
          <>
            <Field label="Total">
              <SelectInput
                value={element.fn}
                onChange={fn => update(el => ({ ...el, fn }) as TemplateElement)}
                options={AGGREGATE_FUNCTIONS.map(fn => ({ value: fn, label: fn }))}
              />
            </Field>
            <ExpressionInput
              label={element.fn === "COUNT" ? "Of field (optional)" : "Of field"}
              path={`${element.id}.aggregate`}
              value={element.expression}
              onChange={expression => update(el => ({ ...el, expression }) as TemplateElement)}
              issue={expressionIssue?.message ?? null}
              placeholder={element.fn === "COUNT" ? "leave empty to count rows" : fields.find(field => field.type === "money")?.key ? `Fields.${fields.find(field => field.type === "money")!.key}` : "Fields.amount"}
            />
            <Field label="Over" hint={element.scope === "group" ? "The rows of the group this band belongs to." : element.scope === "page" ? "The rows printed on the same page. Resolved after pagination." : "Every row the report selected."}>
              <Chips
                value={element.scope}
                onChange={scope => update(el => ({ ...el, scope }) as TemplateElement)}
                options={AGGREGATE_SCOPES.map(scope => ({ value: scope, label: scope }))}
              />
            </Field>
            <Field label="Format">
              <SelectInput
                value={element.format}
                onChange={format => update(el => ({ ...el, format }) as TemplateElement)}
                options={VALUE_FORMATS.map(format => ({ value: format, label: FORMAT_LABELS[format] }))}
              />
            </Field>
          </>
        ) : null}

        {element.type === "image" ? (
          <Field label="Source" hint="A built-in asset, or an expression that returns a URL.">
            <TextInput value={element.src} onChange={src => update(el => ({ ...el, src }) as TemplateElement)} />
          </Field>
        ) : null}

        {element.type === "chart" ? (
          <>
            <Field label="Chart">
              <SelectInput
                value={element.kind}
                onChange={kind => update(el => ({ ...el, kind }) as TemplateElement)}
                options={(catalog?.chartKinds ?? CHART_KINDS.map(kind => ({ kind: kind.kind, label: kind.label, help: kind.help }))).map(kind => ({ value: kind.kind as ChartElement["kind"], label: kind.label }))}
              />
            </Field>
            <p className="text-[10px] text-gray-500">
              {(catalog?.chartKinds ?? CHART_KINDS).find(kind => kind.kind === element.kind)?.help}
            </p>
            <Field label="Title">
              <TextInput value={element.title} onChange={title => update(el => ({ ...el, title }) as TemplateElement)} placeholder="Optional" />
            </Field>
            <ExpressionInput
              label="Category field"
              path={`${element.id}.categoryExpression`}
              value={element.categoryExpression}
              onChange={categoryExpression => update(el => ({ ...el, categoryExpression }) as TemplateElement)}
              issue={issueFor(issues, issue => issue.elementId === element.id && /chartCategory/.test(issue.code))?.message ?? null}
              placeholder="Fields.status"
            />
            <Field label={chartVerb(element.fn)}>
              <SelectInput
                value={element.fn}
                onChange={fn => update(el => ({ ...el, fn }) as TemplateElement)}
                options={(catalog?.chartFunctions ?? CHART_FUNCTIONS.map(entry => ({ fn: entry.fn, label: entry.label }))).map(entry => ({ value: entry.fn as ChartElement["fn"], label: entry.label }))}
              />
            </Field>
            {element.fn === "COUNT" ? null : (
              <ExpressionInput
                label="Value field"
                path={`${element.id}.valueExpression`}
                value={element.valueExpression}
                onChange={valueExpression => update(el => ({ ...el, valueExpression }) as TemplateElement)}
                issue={issueFor(issues, issue => issue.elementId === element.id && /chartValue|chartType/.test(issue.code))?.message ?? null}
                placeholder={fields.find(field => field.type === "money")?.key ? `Fields.${fields.find(field => field.type === "money")!.key}` : "Fields.total"}
              />
            )}
            <Field label="Over" hint={element.scope === "group" ? "Fold the rows of the group this band belongs to." : element.scope === "page" ? "Fold the rows printed on the same page, once pagination is known." : "Fold every row the report selected."}>
              <Chips
                value={element.scope}
                onChange={scope => update(el => ({ ...el, scope }) as TemplateElement)}
                options={AGGREGATE_SCOPES.map(scope => ({ value: scope, label: scope }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Categories" hint="The rest fold into one Other bar.">
                <NumberInput value={element.maxCategories} step={1} min={1} max={50} onChange={maxCategories => update(el => ({ ...el, maxCategories }) as TemplateElement)} />
              </Field>
              <Field label="Values on bars">
                <Toggle checked={element.showValues} onChange={showValues => update(el => ({ ...el, showValues }) as TemplateElement)} label="Print" />
              </Field>
            </div>
            <Field label="Legend">
              <Toggle checked={element.showLegend} onChange={showLegend => update(el => ({ ...el, showLegend }) as TemplateElement)} label="Show the legend" />
            </Field>
          </>
        ) : null}

        {element.type === "subreport" ? (
          <>
            <Field label="Saved report" hint="Printed inside this band, on this report's pages.">
              <SelectInput
                value={element.templateId}
                onChange={templateId => {
                  const chosen = templates.find(candidate => candidate.id === templateId);
                  update(el => ({ ...el, templateId, templateName: chosen?.name ?? "" }) as TemplateElement);
                }}
                options={[{ value: "", label: templates.length ? "— choose a report —" : "No saved designed reports yet" },
                  ...templates.map(candidate => ({ value: candidate.id, label: candidate.name }))]}
              />
            </Field>
            <p className="text-[10px] text-gray-500">
              The sub-report inherits this report&apos;s pages and page numbers, and runs its own data source with the
              parameters you bind below. Sub-reports nest at most three deep.
            </p>
            {chosen?.parameters.length ? (
              <div className="space-y-2">
                <p className="text-[11px] text-gray-400">Parameters</p>
                {chosen.parameters.map(parameter => (
                  <ExpressionInput
                    key={parameter.key}
                    label={`${parameter.label || parameter.key}${parameter.required ? " *" : ""}`}
                    path={`${element.id}.parameterBindings.${parameter.key}`}
                    value={element.parameterBindings[parameter.key] ?? ""}
                    onChange={value => update(el => ({
                      ...el,
                      parameterBindings: { ...(el as SubreportElement).parameterBindings, [parameter.key]: value },
                    }) as TemplateElement)}
                    issue={issueFor(issues, issue => issue.elementId === element.id && issue.path.includes(`parameterBindings.${parameter.key}`))?.message ?? null}
                    placeholder="Parameters.from — a parameter, not a field"
                  />
                ))}
              </div>
            ) : element.templateId ? (
              <p className="text-[10px] text-gray-500">This report declares no parameters, so there is nothing to bind.</p>
            ) : null}
            <p className="text-[10px] text-gray-500">
              A binding is worked out once, before the sub-report&apos;s rows are fetched, so it cannot read Fields.
            </p>
          </>
        ) : null}

        <div className="flex gap-2 pt-1">
          <button type="button" className="text-[10px] text-gray-400 hover:text-gray-200" onClick={() => moveSelection(-1)}>Send back</button>
          <button type="button" className="text-[10px] text-gray-400 hover:text-gray-200" onClick={() => moveSelection(1)}>Bring forward</button>
        </div>
      </Section>

      <Section title="Position and size">
        <div className="grid grid-cols-2 gap-2">
          <Field label="X"><NumberInput value={element.x} step={0.5} suffix="mm" onChange={x => update(el => ({ ...el, x }))} /></Field>
          <Field label="Y"><NumberInput value={element.y} step={0.5} suffix="mm" onChange={y => update(el => ({ ...el, y }))} /></Field>
          <Field label="Width"><NumberInput value={element.w} step={0.5} suffix="mm" onChange={w => update(el => ({ ...el, w }))} /></Field>
          <Field label="Height"><NumberInput value={element.h} step={0.5} suffix="mm" onChange={h => update(el => ({ ...el, h }))} /></Field>
        </div>
      </Section>

      <Section title="Text">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Font">
            <SelectInput
              value={element.style.fontFamily}
              onChange={fontFamily => updateStyle({ fontFamily })}
              options={[{ value: "sans" as const, label: "Sans" }, { value: "serif" as const, label: "Serif" }, { value: "mono" as const, label: "Mono" }]}
            />
          </Field>
          <Field label="Size"><NumberInput value={element.style.fontSize} step={0.5} min={4} suffix="pt" onChange={fontSize => updateStyle({ fontSize })} /></Field>
        </div>
        <div className="flex gap-1">
          <Chips
            value={element.style.bold ? "b" : "n"}
            onChange={() => updateStyle({ bold: !element.style.bold })}
            options={[{ value: "b" as const, label: "Bold" }, { value: "n" as const, label: "Regular" }]}
          />
          <Chips
            value={element.style.italic ? "i" : "n"}
            onChange={() => updateStyle({ italic: !element.style.italic })}
            options={[{ value: "i" as const, label: "Italic" }, { value: "n" as const, label: "Upright" }]}
          />
          <Chips
            value={element.style.underline ? "u" : "n"}
            onChange={() => updateStyle({ underline: !element.style.underline })}
            options={[{ value: "u" as const, label: "Underline" }, { value: "n" as const, label: "None" }]}
          />
        </div>
        <Field label="Colour"><Colour value={element.style.color} onChange={color => updateStyle({ color: color ?? "#111827" })} /></Field>
        <Field label="Align">
          <Chips
            value={element.style.align}
            onChange={align => updateStyle({ align })}
            options={[{ value: "left" as const, label: "Left" }, { value: "center" as const, label: "Centre" }, { value: "right" as const, label: "Right" }]}
          />
        </Field>
        <Field label="Vertical">
          <Chips
            value={element.style.valign}
            onChange={valign => updateStyle({ valign })}
            options={[{ value: "top" as const, label: "Top" }, { value: "middle" as const, label: "Middle" }, { value: "bottom" as const, label: "Bottom" }]}
          />
        </Field>
        <Field label="Padding"><NumberInput value={element.style.padding} step={0.5} min={0} suffix="mm" onChange={padding => updateStyle({ padding })} /></Field>
      </Section>

      <Section title="Fill and border">
        <Field label="Background"><Colour value={element.style.background} allowClear onChange={background => updateStyle({ background })} /></Field>
        <Field label="Border">
          <div className="flex items-center gap-2">
            <NumberInput value={element.style.border?.width ?? 0} step={0.1} min={0} suffix="mm" onChange={width => updateStyle({ border: width > 0 ? { width, color: element.style.border?.color ?? "#94a3b8" } : null })} />
            <Colour value={element.style.border?.color ?? null} onChange={color => updateStyle({ border: color ? { width: element.style.border?.width || 0.3, color } : null })} />
          </div>
        </Field>
      </Section>

      <Section title="Actions">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="text-[10px] text-gray-300 hover:text-white bg-surface-light border border-surface-lighter rounded px-2 py-1"
            onClick={() => {
              if (!band) return;
              const copy = { ...element, id: newId("el"), y: Math.min(band.height - element.h, element.y + element.h + 1) };
              const bands = document.bands.map((candidate, index) =>
                index === bandIndex ? { ...candidate, elements: [...candidate.elements, copy] } : candidate);
              onDocument({ ...document, bands });
              onSelect({ kind: "element", bandId: band.id, elementId: copy.id });
            }}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="text-[10px] text-red-300 hover:text-red-200 bg-red-600/10 border border-red-600/30 rounded px-2 py-1"
            onClick={() => {
              if (!band) return;
              onDocument({ ...document, bands: document.bands.map((candidate, index) => (index === bandIndex ? { ...candidate, elements: candidate.elements.filter(el => el.id !== element.id) } : candidate)) });
              onSelect({ kind: "band", bandId: band.id });
            }}
          >
            Delete element
          </button>
        </div>
      </Section>
    </>
  );
}

// ── Band panel ──────────────────────────────────────────────────────

function BandPanel({ document, band, issues, selection, onDocument, onSelect, catalog }: {
  document: ReportTemplateDocument;
  band: TemplateBand;
  issues: TemplateIssue[];
  selection: Selection;
  onDocument: (next: ReportTemplateDocument, options?: { push?: boolean }) => void;
  onSelect: (selection: Selection) => void;
  catalog: DesignerCatalog | null;
}) {
  const spec = BAND_BY_KIND.get(band.kind);
  const update = (patch: Partial<TemplateBand>, options?: { push?: boolean }) =>
    onDocument({ ...document, bands: document.bands.map(candidate => (candidate.id === band.id ? { ...candidate, ...patch } : candidate)) }, options);
  const bandIssues = issues.filter(issue => issue.bandId === band.id && issue.severity === "error");
  const heightIssue = bandIssues.find(issue => issue.code === "band.height");
  const source = document.dataSources[0]?.source;
  const fields = catalog?.sources.find(candidate => candidate.key === source)?.fields ?? [];

  return (
    <>
      <Section title={`${spec?.label ?? band.kind} band`}>
        <p className="text-[10px] text-gray-500">{spec?.help}</p>
        <Field label="Height">
          <NumberInput value={band.height} step={0.5} min={0.5} suffix="mm" onChange={height => update({ height })} />
        </Field>
        {heightIssue ? <p className="text-[10px] text-red-400">{heightIssue.message}</p> : null}

        {spec?.needsGroup ? (
          <Field label="Group">
            <SelectInput
              value={band.groupKey ?? ""}
              onChange={groupKey => update({ groupKey })}
              options={[{ value: "", label: "Choose a group…" }, ...document.groups.map(group => ({ value: group.key, label: group.label ?? group.key }))]}
            />
          </Field>
        ) : null}

        <Toggle
          checked={band.repeatOnNewPage}
          onChange={repeatOnNewPage => update({ repeatOnNewPage })}
          label="Repeat at the top of every page"
          hint="What a column caption or a group header needs when the rows it labels continue overleaf."
        />
        <Toggle
          checked={band.pageBreakBefore}
          onChange={pageBreakBefore => update({ pageBreakBefore })}
          label="Start a new page before this band"
        />

        <div className="pt-1">
          <button
            type="button"
            className="text-[10px] text-gray-300 hover:text-white bg-surface-light border border-surface-lighter rounded px-2 py-1"
            onClick={() => {
              const placement = fitInBand(band, band.elements.length);
              const quick = createElement("text", { x: 0, y: placement.y, w: Math.min(60, band.height * 8), h: placement.h, text: "Label" });
              onDocument({ ...document, bands: document.bands.map(candidate => (candidate.id === band.id ? { ...candidate, elements: [...candidate.elements, quick] } : candidate)) });
              onSelect({ kind: "element", bandId: band.id, elementId: quick.id });
            }}
          >
            + Text
          </button>
        </div>
      </Section>

      <Section title="Fields in this report">
        <p className="text-[10px] text-gray-500">Drag one onto the band, or click to add it here.</p>
        <div className="flex flex-wrap gap-1">
          {fields.slice(0, 12).map(field => (
            <button
              key={field.key}
              type="button"
              draggable
              onDragStart={event => event.dataTransfer.setData("text/plain", `field:${field.key}`)}
              onClick={() => {
                const element = createElement("field", { x: 0, y: 0, w: 45, h: Math.max(4, band.height - 1), expression: `Fields.${field.key}`, format: field.type === "date" ? "date" : field.type === "money" ? "money" : field.type === "number" ? "number" : "text" });
                onDocument({ ...document, bands: document.bands.map(candidate => (candidate.id === band.id ? { ...candidate, elements: [...candidate.elements, element] } : candidate)) });
                onSelect({ kind: "element", bandId: band.id, elementId: element.id });
              }}
              className="px-2 py-1 rounded text-[10px] bg-surface-light border border-surface-lighter text-gray-300 hover:border-cyber-500"
            >
              {field.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Band actions">
        <button
          type="button"
          className="text-[10px] text-red-300 hover:text-red-200 bg-red-600/10 border border-red-600/30 rounded px-2 py-1"
          onClick={() => {
            onDocument({ ...document, bands: document.bands.filter(candidate => candidate.id !== band.id) });
            onSelect({ kind: "report" });
          }}
        >
          Delete this band
        </button>
        {selection.kind !== "band" ? null : <p className="text-[10px] text-gray-500">{band.elements.length} element{band.elements.length === 1 ? "" : "s"}</p>}
      </Section>
    </>
  );
}

// ── Report panel ────────────────────────────────────────────────────

function ReportPanel({ document, catalog, issues, onDocument, onName, onDescription, onSelect }: {
  document: ReportTemplateDocument;
  catalog: DesignerCatalog | null;
  issues: TemplateIssue[];
  onDocument: (next: ReportTemplateDocument, options?: { push?: boolean }) => void;
  onName: (name: string) => void;
  onDescription: (description: string) => void;
  onSelect: (selection: Selection) => void;
}) {
  const source = document.dataSources[0];
  const sourceFields = catalog?.sources.find(candidate => candidate.key === source?.source)?.fields ?? [];
  const operators = catalog?.operators ?? [];

  const setPage = (patch: Partial<ReportTemplateDocument["page"]>) => onDocument({ ...document, page: { ...document.page, ...patch } });
  const setMargins = (patch: Partial<ReportTemplateDocument["page"]["margins"]>) =>
    onDocument({ ...document, page: { ...document.page, margins: { ...document.page.margins, ...patch } } });
  const setSource = (patch: Partial<TemplateDataSource>) =>
    onDocument({ ...document, dataSources: document.dataSources.map((candidate, index) => (index === 0 ? { ...candidate, ...patch } : candidate)) });
  const setParameters = (parameters: TemplateParameter[]) => onDocument({ ...document, parameters });
  const setGroups = (groups: TemplateGroup[]) => onDocument({ ...document, groups });

  const pageIssues = issues.filter(issue => issue.severity === "error" && issue.path.startsWith("page"));
  const sourceIssues = issues.filter(issue => issue.severity === "error" && issue.path.startsWith("dataSources"));

  const pageSizeOptions = useMemo(() => PAGE_SIZES.map(size => ({ value: size.key as PageSizeKey, label: `${size.label}${size.key === "custom" ? "" : ` (${size.width}×${size.height}mm)`}` })), []);

  return (
    <>
      <Section title="Report">
        <Field label="Name"><TextInput value={document.name} onChange={onName} placeholder="Monthly client summary" /></Field>
        <Field label="Description"><TextInput value={document.description ?? ""} onChange={onDescription} placeholder="What this report is for" /></Field>
      </Section>

      <Section title="Page">
        <Field label="Size"><SelectInput value={document.page.size} onChange={size => setPage({ size })} options={pageSizeOptions} /></Field>
        {document.page.size === "custom" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Width"><NumberInput value={document.page.width} step={1} min={50} suffix="mm" onChange={width => setPage({ width })} /></Field>
            <Field label="Height"><NumberInput value={document.page.height} step={1} min={50} suffix="mm" onChange={height => setPage({ height })} /></Field>
          </div>
        ) : null}
        <Field label="Orientation">
          <Chips
            value={document.page.orientation}
            onChange={orientation => setPage({ orientation })}
            options={[{ value: "portrait" as const, label: "Portrait" }, { value: "landscape" as const, label: "Landscape" }]}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Top margin"><NumberInput value={document.page.margins.top} step={1} min={0} suffix="mm" onChange={top => setMargins({ top })} /></Field>
          <Field label="Bottom margin"><NumberInput value={document.page.margins.bottom} step={1} min={0} suffix="mm" onChange={bottom => setMargins({ bottom })} /></Field>
          <Field label="Left margin"><NumberInput value={document.page.margins.left} step={1} min={0} suffix="mm" onChange={left => setMargins({ left })} /></Field>
          <Field label="Right margin"><NumberInput value={document.page.margins.right} step={1} min={0} suffix="mm" onChange={right => setMargins({ right })} /></Field>
        </div>
        {pageIssues.map(issue => <p key={issue.path} className="text-[10px] text-red-400">{issue.message}</p>)}
      </Section>

      <Section title="Data">
        <Field label="Source">
          <SelectInput
            value={(source?.source ?? "tickets") as never}
            onChange={value => setSource({ source: value as TemplateDataSource["source"] })}
            options={(catalog?.sources ?? []).map(candidate => ({ value: candidate.key as never, label: candidate.label }))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Sort by">
            <SelectInput
              value={source?.sortBy ?? ""}
              onChange={sortBy => setSource({ sortBy: sortBy || undefined })}
              options={[{ value: "", label: "Default" }, ...sourceFields.map(field => ({ value: field.key, label: field.label }))]}
            />
          </Field>
          <Field label="Direction">
            <Chips
              value={(source?.sortDir ?? "asc") as "asc" | "desc"}
              onChange={sortDir => setSource({ sortDir })}
              options={[{ value: "asc" as const, label: "Ascending" }, { value: "desc" as const, label: "Descending" }]}
            />
          </Field>
        </div>
        <Field label="Row limit" hint="1–2000. A report that reaches it says so rather than silently stopping.">
          <NumberInput value={source?.limit ?? 500} step={50} min={1} max={2000} onChange={limit => setSource({ limit })} />
        </Field>

        <div className="pt-1 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-gray-500">Filters</span>
            <button
              type="button"
              className="text-[10px] text-cyber-300 hover:text-cyber-200"
              onClick={() => setSource({ filters: [...(source?.filters ?? []), { field: sourceFields[0]?.key ?? "", op: "equals", value: "" }] })}
            >
              + Add filter
            </button>
          </div>
          {(source?.filters ?? []).map((filter, index) => (
            <div key={index} className="border border-surface-lighter rounded p-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <SelectInput
                  value={filter.field}
                  onChange={field => setSource({ filters: (source?.filters ?? []).map((candidate, at) => (at === index ? { ...candidate, field } : candidate)) })}
                  options={sourceFields.map(field => ({ value: field.key, label: field.label }))}
                />
                <SelectInput
                  value={filter.op}
                  onChange={op => setSource({ filters: (source?.filters ?? []).map((candidate, at) => (at === index ? { ...candidate, op } : candidate)) })}
                  options={operators
                    // "is empty" is only a question about a column that can be empty; offering it on a
                    // required one invites a filter that can never match.
                    .filter(operator => (operator.key === "isNull" || operator.key === "isNotNull")
                      ? sourceFields.find(field => field.key === filter.field)?.nullable
                      : true)
                    .map(operator => ({ value: operator.key, label: operator.label }))}
                />
              </div>
              {filter.op === "isNull" || filter.op === "isNotNull" ? null : (
                <div className="grid grid-cols-2 gap-2">
                  <TextInput
                    value={filter.parameterKey ? "" : String(filter.value ?? "")}
                    placeholder={filter.parameterKey ? "from a parameter" : "value"}
                    onChange={value => setSource({ filters: (source?.filters ?? []).map((candidate, at) => (at === index ? { ...candidate, value } : candidate)) })}
                  />
                  <SelectInput
                    value={filter.parameterKey ?? ""}
                    onChange={parameterKey => setSource({ filters: (source?.filters ?? []).map((candidate, at) => (at === index ? { ...candidate, parameterKey: parameterKey || undefined } : candidate)) })}
                    options={[{ value: "", label: "typed value" }, ...document.parameters.map(parameter => ({ value: parameter.key, label: `from ${parameter.label || parameter.key}` }))]}
                  />
                </div>
              )}
              <button
                type="button"
                className="text-[10px] text-red-300 hover:text-red-200"
                onClick={() => setSource({ filters: (source?.filters ?? []).filter((_, at) => at !== index) })}
              >
                Remove filter
              </button>
            </div>
          ))}
        </div>
        {sourceIssues.map(issue => <p key={issue.path} className="text-[10px] text-red-400">{issue.message}</p>)}
      </Section>

      <Section
        title="Parameters"
        actions={
          <button
            type="button"
            className="text-[10px] text-cyber-300 hover:text-cyber-200"
            onClick={() => setParameters([...document.parameters, { key: `parameter${document.parameters.length + 1}`, label: `Parameter ${document.parameters.length + 1}`, type: "text", required: false }])}
          >
            + Add
          </button>
        }
      >
        {!document.parameters.length ? <p className="text-[10px] text-gray-500">A parameter is a value asked for at run time — a date range, a client, a threshold.</p> : null}
        {document.parameters.map((parameter, index) => (
          <div key={index} className="border border-surface-lighter rounded p-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <TextInput value={parameter.key} onChange={key => setParameters(document.parameters.map((candidate, at) => (at === index ? { ...candidate, key } : candidate)))} placeholder="key" />
              <TextInput value={parameter.label} onChange={label => setParameters(document.parameters.map((candidate, at) => (at === index ? { ...candidate, label } : candidate)))} placeholder="Label" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <SelectInput
                value={parameter.type}
                onChange={type => setParameters(document.parameters.map((candidate, at) => (at === index ? { ...candidate, type } : candidate)))}
                options={[{ value: "text" as const, label: "Text" }, { value: "number" as const, label: "Number" }, { value: "date" as const, label: "Date" }, { value: "boolean" as const, label: "Yes / no" }, { value: "select" as const, label: "List" }]}
              />
              <TextInput value={parameter.defaultValue ?? ""} onChange={defaultValue => setParameters(document.parameters.map((candidate, at) => (at === index ? { ...candidate, defaultValue } : candidate)))} placeholder="Default" />
            </div>
            {parameter.type === "select" ? (
              <TextInput
                value={(parameter.options ?? []).join(", ")}
                onChange={value => setParameters(document.parameters.map((candidate, at) => (at === index ? { ...candidate, options: value.split(",").map(option => option.trim()).filter(Boolean) } : candidate)))}
                placeholder="one, two, three"
              />
            ) : null}
            <div className="flex items-center justify-between">
              <Toggle checked={parameter.required} onChange={required => setParameters(document.parameters.map((candidate, at) => (at === index ? { ...candidate, required } : candidate)))} label="Required" />
              <button type="button" className="text-[10px] text-red-300 hover:text-red-200" onClick={() => setParameters(document.parameters.filter((_, at) => at !== index))}>Remove</button>
            </div>
          </div>
        ))}
      </Section>

      <Section
        title="Groups"
        actions={
          <button
            type="button"
            className="text-[10px] text-cyber-300 hover:text-cyber-200"
            onClick={() => {
              const key = `group${document.groups.length + 1}`;
              const field = sourceFields.find(candidate => ["status", "client", "type", "category"].includes(candidate.key)) ?? sourceFields[0];
              const group: TemplateGroup = {
                key, label: field?.label ?? key, expression: field ? `Fields.${field.key}` : "Fields.id", sort: "asc", keepTogether: true,
              };
              // A group with no header band would only sort the rows, so one is added with it — that is
              // where the group's own name goes, and removing the group removes it again.
              onDocument({ ...document, groups: [...document.groups, group], bands: [...document.bands, createBand("groupHeader", { groupKey: key, height: 9 })] });
            }}
          >
            + Add group
          </button>
        }
      >
        {!document.groups.length ? <p className="text-[10px] text-gray-500">Grouping sorts the rows and prints a band at each change — clients, statuses, months.</p> : null}
        {document.groups.map((group, index) => (
          <div key={index} className="border border-surface-lighter rounded p-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <TextInput value={group.key} onChange={key => setGroups(document.groups.map((candidate, at) => (at === index ? { ...candidate, key } : candidate)))} placeholder="key" />
              <TextInput value={group.label ?? ""} onChange={label => setGroups(document.groups.map((candidate, at) => (at === index ? { ...candidate, label } : candidate)))} placeholder="Label" />
            </div>
            <ExpressionInput
              label="Group by"
              path={`group.${index}.expression`}
              value={group.expression}
              onChange={expression => setGroups(document.groups.map((candidate, at) => (at === index ? { ...candidate, expression } : candidate)))}
              placeholder="Fields.client"
              issue={issues.find(issue => issue.groupKey === group.key && issue.severity === "error")?.message ?? null}
            />
            <div className="grid grid-cols-2 gap-2">
              <SelectInput
                value={group.sort}
                onChange={sort => setGroups(document.groups.map((candidate, at) => (at === index ? { ...candidate, sort } : candidate)))}
                options={[{ value: "asc" as const, label: "Ascending" }, { value: "desc" as const, label: "Descending" }, { value: "none" as const, label: "Source order" }]}
              />
              <Toggle checked={group.keepTogether} onChange={keepTogether => setGroups(document.groups.map((candidate, at) => (at === index ? { ...candidate, keepTogether } : candidate)))} label="Keep together" hint="Move the whole group to the next page rather than splitting it." />
            </div>
            <button
              type="button"
              className="text-[10px] text-red-300 hover:text-red-200"
              onClick={() => {
                setGroups(document.groups.filter((_, at) => at !== index));
                onDocument({
                  ...document,
                  groups: document.groups.filter((_, at) => at !== index),
                  bands: document.bands.filter(band => !(band.groupKey === group.key)),
                });
              }}
            >
              Remove group and its bands
            </button>
          </div>
        ))}
      </Section>

      <Section title="Bands">
        <div className="space-y-1">
          {BAND_KINDS.map(spec => {
            const count = document.bands.filter(band => band.kind === spec.kind).length;
            const available = spec.needsGroup ? document.groups.some(group => !document.bands.some(band => band.groupKey === group.key && band.kind === spec.kind)) : count === 0;
            return (
              <div key={spec.kind} className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-gray-300">{spec.label}{count > 1 ? ` ×${count}` : ""}</span>
                <button
                  type="button"
                  disabled={!available}
                  title={available ? `Add a ${spec.label.toLowerCase()}` : spec.needsGroup ? "Every group already has one" : "Already present"}
                  onClick={() => {
                    const group = spec.needsGroup ? document.groups.find(candidate => !document.bands.some(band => band.groupKey === candidate.key && band.kind === spec.kind)) : undefined;
                    const band = createBand(spec.kind, group ? { groupKey: group.key } : {});
                    onDocument({ ...document, bands: [...document.bands, band] });
                    onSelect({ kind: "band", bandId: band.id });
                  }}
                  className={`text-[10px] px-2 py-1 rounded border ${available ? "text-cyber-200 border-cyber-500/40 hover:bg-cyber-600/15" : "text-gray-600 border-surface-lighter"}`}
                >
                  Add
                </button>
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}

export function Inspector(props: InspectorProps) {
  const { document, selection } = props;

  if (selection.kind === "element") {
    const band = document.bands.find(candidate => candidate.id === selection.bandId);
    const element = band?.elements.find(candidate => candidate.id === selection.elementId);
    if (band && element) return <ElementPanel {...props} band={band} element={element} />;
  }
  if (selection.kind === "band") {
    const band = document.bands.find(candidate => candidate.id === selection.bandId);
    if (band) return <BandPanel {...props} band={band} />;
  }
  return <ReportPanel {...props} />;
}