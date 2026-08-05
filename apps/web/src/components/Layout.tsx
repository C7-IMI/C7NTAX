import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import {
  LayoutDashboard, Ticket, Columns3, Building2, DollarSign, Plug, Users, Settings, Menu, X, LogOut, ChevronRight,
  Target, FolderKanban, Monitor, BookOpen,
} from "lucide-react";

const NAV_ITEMS = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/tickets", icon: Ticket, label: "Tickets" },
  { to: "/boards", icon: Columns3, label: "Service Boards" },
  { to: "/opportunities", icon: Target, label: "Pipeline" },
  { to: "/projects", icon: FolderKanban, label: "Projects" },
  { to: "/assets", icon: Monitor, label: "Assets" },
  { to: "/kb", icon: BookOpen, label: "Knowledge Base" },
  { to: "/clients", icon: Building2, label: "Clients" },
  { to: "/billing", icon: DollarSign, label: "Billing" },
  { to: "/integrations", icon: Plug, label: "Integrations" },
  { to: "/users", icon: Users, label: "Users" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-navy-950">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-surface border-r border-surface-border flex flex-col transition-transform duration-300 lg:relative lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-5 h-16 border-b border-surface-border shrink-0">
          <Link to="/" className="flex items-center gap-2.5" onClick={() => setSidebarOpen(false)}>
            <div className="w-8 h-8 rounded-lg bg-cyber-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">C7</span>
            </div>
            <span className="font-semibold text-base text-white tracking-tight">Overwatch</span>
          </Link>
          <button className="lg:hidden text-gray-400 hover:text-white p-1" onClick={() => setSidebarOpen(false)}>
            <X size={20} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.to || (item.to !== "/" && location.pathname.startsWith(item.to));
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-cyber-600/15 text-cyber-400"
                    : "text-gray-400 hover:text-white hover:bg-surface-lighter"
                }`}
              >
                <item.icon size={18} />
                {item.label}
                {active && <ChevronRight size={14} className="ml-auto" />}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="border-t border-surface-border p-3">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-cyber-600/30 text-cyber-400 flex items-center justify-center text-sm font-bold">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs text-gray-500 truncate">{user?.email}</p>
            </div>
            <button onClick={logout} className="text-gray-500 hover:text-red-400 transition-colors p-1" title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 border-b border-surface-border flex items-center justify-between px-4 lg:px-6 shrink-0 bg-surface/50">
          <button className="lg:hidden text-gray-400 hover:text-white p-1" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>
          <h1 className="text-base font-semibold text-white truncate ml-2 lg:ml-0">
            {NAV_ITEMS.find((n) => n.to === location.pathname || (n.to !== "/" && location.pathname.startsWith(n.to)))?.label || "Dashboard"}
          </h1>
          <div className="w-8 lg:hidden" />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
