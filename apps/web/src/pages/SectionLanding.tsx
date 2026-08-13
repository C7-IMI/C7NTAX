import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

interface SubSection {
  id: string;
  to: string;
  icon?: React.ComponentType<any>;
  label: string;
}

interface SectionLandingProps {
  sectionId: string;
  sectionLabel: string;
  subSections: SubSection[];
  descriptions?: Record<string, string>;
}

/**
 * SectionLanding — renders a landing page for a parent section with cards
 * for each subsection. Displayed when clicking a parent section in collapsed
 * sidebar mode.
 */
export function SectionLanding({ sectionId, sectionLabel, subSections, descriptions }: SectionLandingProps) {
  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold text-white">{sectionLabel}</h2>
        <p className="text-sm text-gray-400 mt-0.5">
          {subSections.length} subsection{subSections.length !== 1 ? "s" : ""} — select one to get started
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {subSections.map((sub) => {
          const Icon = sub.icon;
          const desc = descriptions?.[sub.id] || sub.label;
          return (
            <Link
              key={sub.id}
              to={sub.to}
              className="card border border-surface-border hover:border-cyber-500/30 transition-colors group flex flex-col gap-3 p-5"
            >
              <div className="flex items-center gap-3">
                {Icon && (
                  <div className="p-2 rounded-lg bg-cyber-600/10 group-hover:bg-cyber-600/20 transition-colors">
                    <Icon size={20} className="text-cyber-400" />
                  </div>
                )}
                <h3 className="text-white font-medium text-sm group-hover:text-cyber-400 transition-colors">
                  {sub.label}
                </h3>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
              <div className="flex items-center gap-1 text-xs text-cyber-500 mt-auto">
                <span>Open</span>
                <ChevronRight size={12} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ── Pre-built descriptions for common sections ──
export const SECTION_DESCRIPTIONS: Record<string, Record<string, string>> = {
  administration: {
    "admin-general": "Configure company profile, defaults, and overall application settings",
    "admin-boards": "Manage service boards, SLA policies, email connectors, and automations",
    "admin-service-alerts": "Configure monitored services, RSS feeds, and the outage alerting mechanism",
    "admin-system": "System-level configuration including database, backups, and integrations",
    "admin-logs": "View audit trail and track all changes across the system",
    "admin-cloudconnect": "Connect third-party services with 16 available connector types",
    "admin-changelog": "Release history and feature changelog for C7NTAX",
  },
  "service-alerts": {
    "service-alerts-dashboard": "Aggregate outage monitoring for Microsoft 365, Azure, AWS, GitHub, ISPs, and other configured services",
  },
  clients: {
    "clients-list": "Browse, search, and manage all client companies and accounts",
    "clients-contacts": "Manage contacts across all client organizations",
  },
  assets: {
    "assets-inventory": "Track hardware, software, and all IT assets across your organization",
    "assets-procurement": "Manage purchase orders, vendors, and procurement workflow",
  },
  "users-roles": {
    "users-list": "Create, edit, and manage user accounts with role assignments",
    "users-roles": "View, create, and manage roles with granular permission assignments",
  },
  projects: {
    "projects-list": "View and manage all projects with phases and milestones",
    calendar: "Calendar view of scheduled tasks, deadlines, and events",
    pto: "Manage time-off requests and team availability",
  },
  billing: {
    "billing-dashboard": "Financial overview with invoiced, paid, outstanding, and overdue metrics",
    "billing-invoices": "Create, send, and track invoices with line items and payments",
    "billing-agreements": "Manage recurring service agreements and billing schedules",
    "billing-payments": "Record and reconcile payments against invoices",
    "billing-time": "Track billable and non-billable time entries per ticket and project",
    "billing-reports": "Revenue summaries, aging reports, and billing analytics",
  },
  reports: {
    "reports-dashboard": "KPI dashboards with real-time ticket and SLA metrics",
    "reports-standard": "Pre-built reports: ticket volume, SLA, revenue, technician utilization",
    "reports-analytics": "Advanced analytics with visual charts and trend data",
  },
  kumo: {
    "kumo-dashboard": "IT documentation overview with recently viewed items",
    "kumo-assets": "Flexible assets with custom templates and dynamic fields",
    "kumo-passwords": "AES-256 encrypted password vault with TOTP support",
    "kumo-configs": "Server, workstation, and network device configurations",
    "kumo-documents": "SOPs and documentation with folder organization and version history",
  },
};
