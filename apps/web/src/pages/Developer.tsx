import { Link } from "react-router-dom";
import { AlertTriangle, Server, ShieldCheck, Trash2, Wrench } from "lucide-react";
import { PageHeader } from "../components/ui";
import { Catalogue } from "../components/developer/Catalogue";
import { EnvironmentBadge } from "../components/developer/EnvironmentBadge";
import { RepoHealthPanel } from "../components/developer/RepoHealth";
import { useDeveloperEnvironment, useRepoHealth } from "../components/developer/developerApi";
import { useRedesign } from "../hooks/useNavigationStyle";

/**
 * `/developer` — the hub, and the proposal made real.
 *
 * It is the catalogue of everything the section can change, grouped by subject, each entry answering the
 * same three questions in the same three words: **Does**, **Can destroy**, **Safeguard**. A section for
 * "changes not normally available to users" is only defensible if every control can answer those three
 * on its own line, so the page is a list of answers rather than a grid of tiles.
 *
 * Three other things belong on this page and nowhere else:
 *
 *   · the **Repo health** panel, because a health panel that only ever shows green is a panel nobody
 *     reads — it is drawn with whatever the checks really printed, a failure and a `skip` included;
 *   · the **audit notice**, because the section's promise is that every action, including the reads, is
 *     written down with actor, IP, section, operation and reason — by the service, not the screen;
 *   · the **gate**, said accurately: `developer:view` decides whether the section is drawn at all, and
 *     `developer:purge` decides whether the destructive controls inside it will arm.
 *
 * Two designs: the modern hub is a rail of subjects you press to filter, and the classic hub is a table
 * whose grouping is a column you sort by. The environment badge is a band in the modern arrangement and
 * a labelled field in the classic one — the same fact, different furniture.
 */
export function DeveloperHubPage() {
  const redesign = useRedesign();
  const environment = useDeveloperEnvironment();
  const health = useRepoHealth();

  const auditNotice = (
    <>
      <b className="text-gray-200">Every action here is written down before it can be questioned,</b> including
      the reads: actor, IP, the section and the operation, the reason, and what the dry run said the blast
      radius was. The reason is mandatory for the destructive ones and the control stays disabled without it.
      The record is written to the audit log by the service that performs the work, not by the screen — a
      section whose logging lived in the browser would be one a{" "}
      <code className="font-mono text-xs">curl</code> could skip.
    </>
  );

  const gateNotice = (
    <>
      Reachable only with <code className="font-mono text-xs text-cyber-300">developer:view</code>, which is
      held by the <b className="text-gray-200">Super Admin</b> role and by the{" "}
      <b className="text-gray-200">Developer Admin</b> role and deliberately withheld from{" "}
      <b className="text-gray-200">Admin</b>. The destructive controls additionally require{" "}
      <code className="font-mono text-xs text-cyber-300">developer:purge</code>, so a role can be trusted with
      the environment inspector without being trusted to empty the database.
    </>
  );

  const screens = [
    { to: "/developer/purge", label: "Purge Data", icon: Trash2, say: "Remove sample and seed data; count it first." },
    { to: "/developer/deployment", label: "Prepare for Live Deployment", icon: Server, say: "Sanitise and validate this instance." },
    { to: "/developer/danger", label: "Danger Zone", icon: AlertTriangle, say: "The operations with no way back." },
  ];

  // ── Classic: a paragraph of consequence above a table of entries ────────────────────────────────
  if (!redesign) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Developer"
          subtitle="What can be changed here that cannot be changed anywhere else, and what each one costs."
        />
        <EnvironmentBadge read={environment} />
        <div className="space-y-2 rounded-lg border border-surface-border bg-surface-light px-4 py-3 text-sm text-gray-400">
          <p className="flex items-start gap-2">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-cyber-400" />
            <span>{gateNotice}</span>
          </p>
          <p className="flex items-start gap-2">
            <Wrench size={16} className="mt-0.5 shrink-0 text-gray-500" />
            <span>{auditNotice}</span>
          </p>
          <p className="text-xs text-gray-500">
            The section's three screens:{" "}
            {screens.map((screen, index) => (
              <span key={screen.to}>
                {index > 0 ? " · " : null}
                <Link to={screen.to} className="text-cyber-400 hover:text-cyber-300">
                  {screen.label}
                </Link>
              </span>
            ))}
            .
          </p>
        </div>
        <Catalogue />
        <RepoHealthPanel read={health} />
      </div>
    );
  }

  // ── Modern: the gate and the audit notice as one band, then the screens, the rail, the health ────
  return (
    <div className="space-y-4">
      <PageHeader
        title="Developer Hub"
        icon={<Wrench size={16} className="text-cyber-400" />}
        subtitle="What can be changed here that cannot be changed anywhere else, and what each one costs."
      />

      <EnvironmentBadge read={environment} />

      <div className="card space-y-3">
        <p className="flex items-start gap-2 text-sm text-gray-400">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-cyber-400" />
          <span>{gateNotice}</span>
        </p>
        <p className="flex items-start gap-2 border-t border-surface-border pt-3 text-sm text-gray-400">
          <Wrench size={16} className="mt-0.5 shrink-0 text-gray-500" />
          <span>{auditNotice}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {screens.map((screen) => {
          const Icon = screen.icon;
          return (
            <Link
              key={screen.to}
              to={screen.to}
              className="card card--interactive flex items-start gap-3 transition-colors hover:border-cyber-500/40"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyber-600/15 text-cyber-400">
                <Icon size={15} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-white">{screen.label}</span>
                <span className="mt-0.5 block text-xs text-gray-500">{screen.say}</span>
              </span>
            </Link>
          );
        })}
      </div>

      <Catalogue />

      <RepoHealthPanel read={health} />
    </div>
  );
}
