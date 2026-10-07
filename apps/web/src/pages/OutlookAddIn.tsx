/**
 * C7NC → Outlook Add-in.
 *
 * The install page for the add-in, which is two separate things wearing one name:
 *
 *   · the **server side**, already built and switchable in Administration → Configuration
 *     (the taskpane served at `/addin`, and the endpoint it posts to);
 *   · the **client side**, which is a manifest that has to be present on each user's own
 *     machine and registered in their own registry hive.
 *
 * This page closes the second gap. Before it existed the only way to install the add-in was to
 * follow a README by hand, so "install it" was a task for whoever already knew where the file
 * was.
 *
 * Two data sources, deliberately:
 *
 *   · a `HEAD` for the installer, which answers for *every* signed-in user — the button has to
 *     work for a technician who cannot read the deployment report;
 *   · `GET /system/deployment` for the detail, which is admin-only and therefore optional. The
 *     page is written so a 403 costs it a card rather than the whole screen.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, CheckCircle2, Download, ExternalLink, FileCode2, Info, Mail, Package, ShieldCheck, Terminal,
} from "lucide-react";
import api from "../api";
import { PageHeader } from "../components/ui";
import { Chip } from "./Configuration";

/** The versionless download the page links to; the response carries the real filename. */
const INSTALLER_URL = "/addin/installer/C7NTAX-OutlookAddIn.msi";
const MANIFEST_URL = "/addin/manifest.xml";
/** Public, so this answers for a technician without SystemConfig. */
const INSTALLER_INFO_URL = "/addin/installer";

/** What `/addin/installer` says about the artifact on offer. */
interface Artifact {
  available: boolean;
  fileName?: string;
  version?: string;
  productVersion?: string;
  size?: number;
  builtAt?: string;
  sha256?: string;
  downloadPath?: string;
}

interface InstallerFacts extends Artifact {
  addinHost: string;
  matchesOrigin: boolean;
}

interface AddinFacts {
  enabled: boolean;
  origin: string;
  manifestId: string;
  manifestUrl: string;
  assetsPresent: boolean;
  installer: InstallerFacts | null;
  installerDirectory: string;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** One labelled fact. Two per line on a wide screen, one on a narrow one. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-500 shrink-0">{label}</dt>
      <dd className="text-gray-300 text-right break-all">{children}</dd>
    </div>
  );
}

export function OutlookAddInPage() {
  const [facts, setFacts] = useState<AddinFacts | null>(null);
  const [adminView, setAdminView] = useState(true);
  const [artifact, setArtifact] = useState<Artifact | null>(null);

  const load = useCallback(async () => {
    // The artifact first, and unauthenticated: this is the fact the page is built around, and the
    // one a role without SystemConfig is still allowed to have.
    try {
      const response = await fetch(INSTALLER_INFO_URL);
      const data: Artifact = response.ok ? await response.json() : { available: false };
      setArtifact(data.available ? data : null);
    } catch {
      setArtifact(null);
    }
    try {
      const { data } = await api.get<{ addin: AddinFacts }>("/system/deployment");
      setFacts(data.addin);
    } catch {
      // 403 for a role without SystemConfig, or the API is unreachable. Either way the page keeps
      // working: it loses the detail card, not the download.
      setAdminView(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const serverOrigin = facts?.origin ?? window.location.origin;
  const installer = facts?.installer ?? null;
  /** Admin detail when it is there, the public descriptor otherwise. */
  const shownSize = installer?.size ?? artifact?.size ?? 0;
  const shownVersion = installer?.productVersion ?? artifact?.productVersion ?? "";

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <PageHeader
        title="Outlook Add-in"
        subtitle="Turn the email you are reading into a C7NTAX ticket without leaving Outlook."
      />

      {/* ── Install ─────────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex items-center justify-center w-12 h-12 shrink-0 rounded-lg bg-cyber-600/10">
            <Mail size={24} className="text-cyber-400" />
          </div>
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-white font-medium">Install for Outlook</h2>
              {facts ? (facts.enabled
                ? <Chip tone="good">Switched on</Chip>
                : <Chip tone="warn">Switched off</Chip>) : null}
            </div>
            <p className="text-sm text-gray-400 leading-relaxed">
              Installs the C7NTAX group on the ribbon of an open message. The installer is per-user
              and needs no administrator rights: an Office add-in is registered in the hive of the
              person running it, so a machine-wide install would write the wrong place and appear
              to work only for whoever ran it.
            </p>

            {artifact === null ? (
              <p className="text-sm text-gray-400 leading-relaxed">
                No installer has been built for this deployment. The manifest below works as it is —
                the installer is the convenience, not the requirement.
              </p>
            ) : (
              <p className="text-sm text-gray-400 leading-relaxed">
                The installer on offer is version{" "}
                <span className="text-gray-300">{artifact.productVersion}</span> ({formatBytes(shownSize)}),
                built {formatDate(artifact.builtAt ?? "")}.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <a href={INSTALLER_URL} download className="btn-primary text-sm flex items-center gap-2">
                <Download size={15} />
                Download the installer
              </a>
              <a href={MANIFEST_URL} download="C7NTAX-OutlookAddIn.xml" className="btn-secondary text-sm flex items-center gap-2">
                <FileCode2 size={15} />
                Download the manifest
              </a>
              <Link to="/help/getting-started" className="btn-secondary text-sm flex items-center gap-2">
                <ExternalLink size={15} />
                Setup guide
              </Link>
            </div>

            <p className="text-xs text-gray-500">
              Restart Outlook after installing. Office reads its add-in list once at start-up, so a
              running Outlook will not show the button until it is reopened.
            </p>
          </div>
        </div>
      </div>

      {/* ── An installer built for a different server ───────────────────────── */}
      {installer && !installer.matchesOrigin ? (
        <div className="card border-amber-500/30">
          <div className="flex gap-4">
            <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-2 text-sm">
              <h3 className="text-white font-medium">This installer was built for another server</h3>
              <p className="text-gray-400 leading-relaxed">
                It registers a manifest whose URLs point at{" "}
                <code className="text-gray-300">{installer.addinHost}</code>, not at this server's{" "}
                <code className="text-gray-300">{facts?.origin}</code>. The add-in would install and
                then open an empty pane, because the taskpane does not exist at that address.
                Rebuild it against this server's origin:
              </p>
              <pre className="text-xs text-gray-300 bg-surface-lighter/60 rounded-md p-3 overflow-x-auto">
{`cd installer/outlook-addin
pwsh -File ./build.ps1 -ApiUrl ${facts?.origin}`}
              </pre>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── The three ways to install ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <Package size={16} className="text-cyber-400 shrink-0" />
            <h3 className="text-white text-sm font-medium">Windows installer</h3>
            <Chip tone="info">Recommended</Chip>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            Copies the manifest into your own profile and registers it in one step. Uninstalls
            cleanly from Installed apps.
          </p>
          <p className="text-xs text-gray-500 mt-2">
            Per-user, no administrator rights, and no mailbox access requested.
          </p>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <FileCode2 size={16} className="text-cyber-400 shrink-0" />
            <h3 className="text-white text-sm font-medium">Manual sideload</h3>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            Outlook → <span className="text-gray-300">Get Add-ins → My add-ins → Add a custom
            add-in → Add from file</span>, then choose the manifest downloaded above.
          </p>
          <p className="text-xs text-gray-500 mt-2">
            Nothing is written to the registry — the fastest way to test a change.
          </p>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck size={16} className="text-cyber-400 shrink-0" />
            <h3 className="text-white text-sm font-medium">Centralized deployment</h3>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            A Microsoft 365 administrator adds the manifest URL in the admin center, so it reaches
            every user without anyone installing anything.
          </p>
          <p className="text-xs text-gray-500 mt-2">
            Needs the Exchange or Global admin role, and the manifest URL must be publicly
            reachable over HTTPS.
          </p>
        </div>
      </div>

      {/* ── Deployment facts ────────────────────────────────────────────────── */}
      {adminView && facts ? (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Info size={16} className="text-cyber-400" />
            <h3 className="text-white text-sm font-medium">How this deployment is set up</h3>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <Fact label="Served from">{facts.origin}</Fact>
            <Fact label="Taskpane files">
              {facts.assetsPresent ? "present on disk" : "missing from disk"}
            </Fact>
            <Fact label="Add-in identity">
              <span className="font-mono text-xs">{facts.manifestId}</span>
            </Fact>
            <Fact label="Installer">
              {installer ? `${shownVersion} · ${formatBytes(shownSize)}` : "not built"}
            </Fact>
            {installer ? (
              <>
                <Fact label="Built">{formatDate(installer.builtAt ?? "")}</Fact>                <Fact label="Built for">
                  {installer.addinHost}{" "}
                  {installer.matchesOrigin
                    ? <CheckCircle2 size={13} className="inline text-emerald-400 -mt-0.5" />
                    : <AlertTriangle size={13} className="inline text-amber-400 -mt-0.5" />}
                </Fact>
                <Fact label="SHA-256">
                  <span className="font-mono text-[11px]">{installer.sha256 || "—"}</span>
                </Fact>
              </>
            ) : null}
          </dl>

          {installer ? (
            <div className="mt-4 pt-4 border-t border-surface-border">
              <p className="text-xs text-gray-500 mb-2">
                Silent install, for a script or a management tool. Run it as the user who will use
                the add-in — the registration goes into that account's own hive.
              </p>
              <pre className="text-xs text-gray-300 bg-surface-lighter/60 rounded-md p-3 overflow-x-auto">
{`msiexec /i "${installer.fileName}" /qn
msiexec /x "${installer.fileName}" /qn   # remove it`}
              </pre>
            </div>
          ) : (
            <div className="mt-4 pt-4 border-t border-surface-border">
              <p className="text-xs text-gray-500 mb-2">
                Build one against this server. The manifest is fetched from the running API, so the
                installer and the manifest above can never disagree about the origin:
              </p>
              <pre className="text-xs text-gray-300 bg-surface-lighter/60 rounded-md p-3 overflow-x-auto">
{`dotnet tool install --global wix --version '5.*'
cd installer/outlook-addin
pwsh -File ./build.ps1 -ApiUrl ${facts.origin}`}
              </pre>
              <p className="text-xs text-gray-500 mt-2">
                The add-in also has to be switched on, or the manifest fetch answers 404.
              </p>
            </div>
          )}
        </div>
      ) : null}

      {!adminView ? (
        <div className="card flex gap-4">
          <AlertTriangle size={18} className="text-gray-500 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-400 leading-relaxed">
            Deployment detail — the origin the add-in is served from, its identity, and the
            installer's build record — is visible to administrators only. Ask an administrator if
            the download above is not what you need.
          </p>
        </div>
      ) : null}

      {/* ── Troubleshooting ─────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Terminal size={16} className="text-cyber-400" />
          <h3 className="text-white text-sm font-medium">If the button does not appear</h3>
        </div>
        <ol className="text-sm text-gray-400 space-y-2 list-decimal list-inside leading-relaxed">
          <li>Close Outlook and open it again — the add-in list is read once at start-up.</li>
          <li>
            Open <span className="text-gray-300 break-all">{serverOrigin}</span> in a browser on the
            same computer. Outlook fetches the taskpane and the ribbon icons from that address
            itself, so an address that is unreachable for you is unreachable for Outlook.
          </li>
          <li>
            Open <span className="text-gray-300">Get Add-ins → My add-ins</span>. A manifest Office
            could not parse is listed there with an error rather than hidden, so its absence is
            itself a clue.
          </li>
          <li>
            Check that the add-in is switched on in{" "}
            <Link to="/admin/configuration/apps" className="text-cyber-400 hover:underline">
              Configuration → Client Apps
            </Link>
            . When it is off the taskpane answers 404 and the pane looks broken.
          </li>
        </ol>
      </div>
    </div>
  );
}
