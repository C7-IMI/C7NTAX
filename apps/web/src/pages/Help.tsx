import { Link } from "react-router-dom";
import { BookOpen, HelpCircle, Settings2, ListOrdered, ChevronRight, ArrowRight } from "lucide-react";
import { HELP_SECTIONS } from "./HelpDoc";

const SECTION_ICONS: Record<string, typeof BookOpen> = {
  "getting-started": BookOpen,
  "faq": HelpCircle,
  "configuration": Settings2,
  "index": ListOrdered,
};

export function HelpPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-white">Help</h1>
        <p className="text-sm text-gray-400 mt-1">Documentation and reference for C7NTAX — structured like the major PSA help centers (Autotask, ConnectWise Asio, HaloPSA): guided getting-started content, a question-and-answer section, configuration reference, and a cross-linked index.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {HELP_SECTIONS.map((s) => {
          const Icon = SECTION_ICONS[s.id] || BookOpen;
          return (
            <Link key={s.id} to={s.path} className="card p-5 hover:border-cyber-500/40 transition-colors group">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-cyber-600/10 text-cyber-400"><Icon size={18} /></div>
                <div className="flex-1">
                  <h2 className="text-base font-semibold text-white group-hover:text-cyber-400 transition-colors">{s.title}</h2>
                  <p className="text-sm text-gray-400 mt-1 leading-relaxed">{s.description}</p>
                </div>
                <ChevronRight size={16} className="text-gray-600 group-hover:text-cyber-400 transition-colors mt-1" />
              </div>
            </Link>
          );
        })}
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Quick links</h2>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Tickets", to: "/tickets" },
            { label: "Service Boards", to: "/boards" },
            { label: "CloudConnect", to: "/cloudconnect" },
            { label: "Kumo", to: "/kumo" },
            { label: "Billing", to: "/billing" },
            { label: "What's New", to: "/admin/changelog" },
          ].map((l) => (
            <Link key={l.to} to={l.to} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-surface-lighter text-gray-300 hover:text-white hover:bg-cyber-600/20">
              {l.label} <ArrowRight size={12} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
