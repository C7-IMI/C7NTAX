import { Link } from "react-router-dom";
import {
  Ticket, Columns3, Building2, Target, DollarSign,
  FolderKanban, Monitor, BookOpen, Shield, Database, Users, AlertTriangle
} from "lucide-react";

interface QuickLink {
  label: string;
  description: string;
  to: string;
  icon: React.ComponentType<any>;
}

const GETTING_STARTED: QuickLink[] = [
  {
    label: "Tickets",
    description: "Track client issues, manage troubleshooting workflows, and log billable time.",
    to: "/tickets",
    icon: Ticket,
  },
  {
    label: "Service Boards",
    description: "Monitor service boards with live ticket metrics, stale tracking, and SLA status.",
    to: "/boards",
    icon: Columns3,
  },
  {
    label: "Service Alerts",
    description: "Live outage monitoring for Microsoft 365, Azure, AWS, GitHub, ISPs, and more.",
    to: "/service-alerts",
    icon: AlertTriangle,
  },
  {
    label: "Pipeline",
    description: "Manage your sales pipeline, track deal stages, and forecast revenue.",
    to: "/opportunities",
    icon: Target,
  },
  {
    label: "Clients",
    description: "Browse, search, and manage all client companies and accounts.",
    to: "/clients",
    icon: Building2,
  },
  {
    label: "Billing",
    description: "Create, send, and track invoices with line items and payment processing.",
    to: "/billing",
    icon: DollarSign,
  },
  {
    label: "Projects",
    description: "View and manage all projects with phases, milestones, and time tracking.",
    to: "/projects",
    icon: FolderKanban,
  },
  {
    label: "Asset Inventory",
    description: "Track hardware, software, and all IT assets across your organization.",
    to: "/assets",
    icon: Monitor,
  },
  {
    label: "Knowledge Base",
    description: "Search and browse internal and external knowledge base articles.",
    to: "/kb",
    icon: BookOpen,
  },
  {
    label: "Kumo",
    description: "IT documentation hub — assets, passwords, configurations, and SOPs.",
    to: "/kumo",
    icon: Database,
  },
  {
    label: "Manage Users",
    description: "Create, edit, and manage user accounts with role assignments.",
    to: "/users",
    icon: Users,
  },
  {
    label: "Manage Roles",
    description: "View, create, and manage roles with granular permission assignments.",
    to: "/roles",
    icon: Shield,
  },
  {
    label: "Administration",
    description: "Configure company profile, service boards, system settings, and audit logs.",
    to: "/admin",
    icon: Shield,
  },
];

export function HomePage() {
  return (
    <div className="space-y-8 animate-fade-in max-w-4xl">
      {/* Welcome */}
      <div>
        <h2 className="text-2xl font-bold text-white">Welcome to C7NTAX</h2>
        <p className="text-gray-400 mt-2 max-w-2xl">
          Your all-in-one Professional Services Automation platform. Manage tickets, track
          billable time, monitor client agreements, and document your IT environment — all from
          a single, unified dashboard.
        </p>
      </div>

      {/* Getting Started */}
      <div>
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Getting Started
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {GETTING_STARTED.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                to={item.to}
                className="card border border-surface-border hover:border-cyber-500/30 transition-colors group flex items-start gap-3 p-4"
              >
                <div className="p-2 rounded-lg bg-cyber-600/10 group-hover:bg-cyber-600/20 transition-colors shrink-0">
                  <Icon size={18} className="text-cyber-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-white font-medium text-sm group-hover:text-cyber-400 transition-colors">
                    {item.label}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
