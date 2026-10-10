import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity, AlertTriangle, ArrowUpDown, Database, ExternalLink, Plug, ShieldCheck, SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useModernInterface } from "../../hooks/useNavigationStyle";
import {
  CATALOGUE, CATALOGUE_GROUPS, type CatalogueEntry, type CatalogueGroup, type CatalogueGroupId, type EntryState,
} from "./catalogueData";
import { StateChip } from "./developerUi";

/**
 * The catalogue, in the two arrangements the repository keeps.
 *
 * **Modern is a rail you filter.** The grouping is by subject, and the rail is the list of subjects —
 * chips you press that say how many entries each holds — with the chosen group's cards beside it. It is
 * drawn this way because the question a person arrives with is "which of these is it", and a rail
 * answers that by letting them narrow to a subject without reading the whole list.
 *
 * **Classic is a table you sort.** Group, Entry, Does, Can destroy and Safeguard are five labelled
 * columns, and the grouping is a column you sort by rather than a rail you press — which is what every
 * classic screen does with a list, and is deliberately not a restyle of the rail (see
 * components/CloseTicketDialog.tsx for the same rule applied to a dialog).
 *
 * The words are shared: `does`, `canDestroy` and `safeguard` are the same three strings in both, because
 * what changes between the interfaces is the arrangement, never what the section is claiming.
 */

const GROUP_ICON: Record<CatalogueGroupId, LucideIcon> = {
  data: Database,
  env: SlidersHorizontal,
  int: Plug,
  id: ShieldCheck,
  diag: Activity,
  kill: AlertTriangle,
};

const STATE_LABEL: Record<EntryState, string> = {
  exists: "built",
  "read-only": "read-only",
  "cli-only": "command only",
  proposed: "proposed",
};

function stateTone(state: EntryState) {
  if (state === "exists") return "good" as const;
  if (state === "proposed") return "warn" as const;
  return "neutral" as const;
}

/** The three answers, in the same order and the same words in both interfaces. */
function Answers({ entry, compact = false }: { entry: CatalogueEntry; compact?: boolean }) {
  const rows: Array<[string, string, string]> = [
    ["Does", entry.does, "text-gray-300"],
    ["Can destroy", entry.canDestroy, "text-alert-amber"],
    ["Safeguard", entry.safeguard, "text-gray-300"],
  ];
  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      {rows.map(([label, value, tone]) => (
        <div key={label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
          <span className="w-full shrink-0 text-[11px] font-semibold uppercase tracking-wide text-gray-500 sm:w-24">
            {label}
          </span>
          <span className={`text-xs leading-relaxed ${tone}`}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function EntryLink({ entry }: { entry: CatalogueEntry }) {
  if (!entry.to) return null;
  return (
    <Link
      to={entry.to}
      className="inline-flex items-center gap-1 text-xs font-medium text-cyber-400 hover:text-cyber-300"
    >
      {entry.toLabel || "Open"}
      <ExternalLink size={11} />
    </Link>
  );
}

export function Catalogue() {
  const modern = useModernInterface();
  const [group, setGroup] = useState<CatalogueGroupId | "all">("all");
  const [sort, setSort] = useState<{ key: "group" | "name"; dir: 1 | -1 }>({ key: "group", dir: 1 });

  const counts = useMemo(() => {
    const map = new Map<CatalogueGroupId, number>();
    for (const entry of CATALOGUE) map.set(entry.group, (map.get(entry.group) ?? 0) + 1);
    return map;
  }, []);

  const shownGroups: CatalogueGroup[] =
    group === "all" ? CATALOGUE_GROUPS : CATALOGUE_GROUPS.filter((g) => g.id === group);

  // ── Classic: five labelled columns, sorted by whichever column you press ───────────────────────
  if (!modern) {
    const groupOrder = new Map(CATALOGUE_GROUPS.map((g, index) => [g.id, index]));
    const sorted = [...CATALOGUE].sort((a, b) => {
      const primary =
        sort.key === "group"
          ? (groupOrder.get(a.group)! - groupOrder.get(b.group)!) * sort.dir
          : a.name.localeCompare(b.name) * sort.dir;
      return primary !== 0 ? primary : a.name.localeCompare(b.name);
    });
    const toggle = (key: "group" | "name") => {
      setSort((current) => (current.key === key ? { key, dir: current.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
    };
    const arrow = (key: "group" | "name") =>
      sort.key === key ? <ArrowUpDown size={11} className={sort.dir === -1 ? "rotate-180" : undefined} /> : null;

    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-400">
          Every capability that belongs in this section, each row answering the same three questions. Sort by
          the Group or Entry column; the entries marked proposed are the only new build in the catalogue.
        </p>
        <div className="overflow-x-auto rounded-xl border border-surface-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-lighter text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-3 py-2 font-semibold">
                  <button type="button" onClick={() => toggle("group")} className="inline-flex items-center gap-1">
                    Group {arrow("group")}
                  </button>
                </th>
                <th className="px-3 py-2 font-semibold">
                  <button type="button" onClick={() => toggle("name")} className="inline-flex items-center gap-1">
                    Entry {arrow("name")}
                  </button>
                </th>
                <th className="px-3 py-2 font-semibold">Does</th>
                <th className="px-3 py-2 font-semibold">Can destroy</th>
                <th className="px-3 py-2 font-semibold">Safeguard</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => {
                const groupMeta = CATALOGUE_GROUPS.find((g) => g.id === entry.group)!;
                return (
                  <tr key={entry.name} className="border-t border-surface-border align-top">
                    <td className="px-3 py-2 text-xs text-gray-400">{groupMeta.label}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-white">{entry.name}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-gray-500">{entry.where}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <StateChip tone={stateTone(entry.state)}>{STATE_LABEL[entry.state]}</StateChip>
                        <EntryLink entry={entry} />
                      </div>
                      {entry.note ? <div className="mt-1 text-[11px] text-gray-500">{entry.note}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-xs leading-relaxed text-gray-300">{entry.does}</td>
                    <td className="px-3 py-2 text-xs leading-relaxed text-alert-amber">{entry.canDestroy}</td>
                    <td className="px-3 py-2 text-xs leading-relaxed text-gray-300">{entry.safeguard}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-600">
          {CATALOGUE.length} entries across {CATALOGUE_GROUPS.length} groups. Nothing here is a new capability
          except where it says proposed: the section's whole claim is that the capability already exists and is
          currently unusable by anyone who did not write it.
        </p>
      </div>
    );
  }

  // ── Modern: a rail of subjects, and the chosen subject's cards beside it ───────────────────────
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <div className="card space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">What the section holds</p>
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setGroup("all")}
              aria-pressed={group === "all"}
              className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                group === "all" ? "border-cyber-500/50 bg-cyber-600/15" : "border-surface-border hover:bg-surface-lighter"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-white">Everything</span>
                <span className="chip__n">{CATALOGUE.length}</span>
              </span>
              <span className="mt-0.5 block text-[11px] text-gray-500">The whole catalogue, in the order below.</span>
            </button>
            {CATALOGUE_GROUPS.map((g) => {
              const Icon = GROUP_ICON[g.id];
              const on = group === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGroup(g.id)}
                  aria-pressed={on}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    on ? "border-cyber-500/50 bg-cyber-600/15" : "border-surface-border hover:bg-surface-lighter"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-white">
                      <Icon size={13} className={on ? "text-cyber-400" : "text-gray-500"} />
                      {g.label}
                    </span>
                    <span className="chip__n">{counts.get(g.id) ?? 0}</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-gray-500">{g.say}</span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-surface-border pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Where this lives today</p>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
              A terminal and a README: two toggles, ten seed packs and eight guard commands, and exactly two of
              these capabilities already have a screen — Administration → Security (sessions) and Administration
              → API access (keys). The rest is a command somebody has to remember.
            </p>
          </div>
        </div>
      </aside>

      <div className="space-y-4">
        {shownGroups.map((g) => {
          const Icon = GROUP_ICON[g.id];
          const entries = CATALOGUE.filter((entry) => entry.group === g.id);
          return (
            <section key={g.id} className="card space-y-3">
              <div className="flex flex-wrap items-center gap-2 border-b border-surface-border pb-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyber-600/15 text-cyber-400">
                  <Icon size={14} />
                </span>
                <h3 className="text-sm font-semibold text-white">{g.label}</h3>
                <span className="text-xs text-gray-500">{g.say}</span>
                <span className="ml-auto chip__n">{entries.length} entries</span>
              </div>
              <div className="divide-y divide-surface-border">
                {entries.map((entry) => (
                  <article key={entry.name} className="space-y-2 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-sm font-medium text-white">{entry.name}</span>
                      <span className="font-mono text-[11px] text-gray-500">{entry.where}</span>
                      <span className="ml-auto flex items-center gap-1.5">
                        <StateChip tone={stateTone(entry.state)}>{STATE_LABEL[entry.state]}</StateChip>
                        <EntryLink entry={entry} />
                      </span>
                    </div>
                    {entry.note ? <p className="text-[11px] text-gray-500">{entry.note}</p> : null}
                    <Answers entry={entry} />
                  </article>
                ))}
              </div>
            </section>
          );
        })}
        <p className="px-1 text-[11px] text-gray-600">
          Hover nothing, guess nothing: the entries that say proposed are the only new build in this catalogue,
          and the rest carry where they live today.
        </p>
      </div>
    </div>
  );
}
