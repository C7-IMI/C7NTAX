import { useState, useEffect } from "react";
import api from "../api";
import {
  TrendingUp, BarChart3, PieChart, Download, Filter, Clock, CheckCircle,
  XCircle, AlertTriangle, Ticket, DollarSign, Users, Activity,
  ClipboardList, Calendar, Timer, FileText, Printer,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface TicketVolume { total: number; byStatus: Array<{ status: string; count: number }>; byPriority: Array<{ priority: string; count: number }>; byBoard: Array<{ board: string; count: number }>; }
interface SlaData { metResponse: number; breachedResponse: number; metResolution: number; breachedResolution: number; totalTickets: number; }
interface Utilization { userId: string; name: string; billable: number; nonBillable: number; }[]
interface RevenueData { totalPaid: number; totalOutstanding: number; monthlyRevenue: Array<{ month: string; amount: number }>; }

const TABS = [
  { id: "dashboard", label: "Dashboards", icon: BarChart3 },
  { id: "standard", label: "Standard Reports", icon: ClipboardList },
  { id: "analytics", label: "Analytics", icon: TrendingUp },
];

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-600/20 text-blue-400", in_progress: "bg-cyber-600/20 text-cyber-400",
  waiting_on_client: "bg-amber-600/20 text-amber-400", on_hold: "bg-purple-600/20 text-purple-400",
  resolved: "bg-green-600/20 text-green-400", closed: "bg-gray-600/20 text-gray-400",
  cancelled: "bg-red-600/20 text-red-400", pending_approval: "bg-orange-600/20 text-orange-400",
};

function formatMinutes(m: number) { return `${(m / 60).toFixed(1)}h`; }
function formatCurrency(n: number) { return `$${n.toLocaleString()}`; }

export function ReportsPage({ tab: initialTab }: { tab?: string }) {
  const [activeTab, setActiveTab] = useState(initialTab || "dashboard");

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Reporting</h2>
          <p className="text-sm text-gray-400">Dashboards, reports, and analytics</p>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-surface-border pb-0 overflow-x-auto">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${activeTab === tab.id ? "bg-surface border border-b-0 border-surface-border text-cyber-400" : "text-gray-400 hover:text-white hover:bg-surface-lighter/50"}`}>
              <Icon size={15} />{tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "dashboard" && <DashboardTab />}
      {activeTab === "standard" && <StandardReportsTab />}
      {activeTab === "analytics" && <AnalyticsTab />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  DASHBOARD TAB
// ═══════════════════════════════════════════════════════════════════

function DashboardTab() {
  const [ticketVolume, setTicketVolume] = useState<TicketVolume | null>(null);
  const [sla, setSla] = useState<SlaData | null>(null);
  const [utilization, setUtilization] = useState<Utilization>([]);
  const [revenue, setRevenue] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get("/reports/data/ticket-volume").then(r => setTicketVolume(r.data)).catch(() => {}),
      api.get("/reports/data/sla-compliance").then(r => setSla(r.data)).catch(() => {}),
      api.get("/reports/data/technician-utilization").then(r => setUtilization(r.data)).catch(() => {}),
      api.get("/reports/data/revenue-summary").then(r => setRevenue(r.data)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-20 text-gray-500">Loading dashboard data...</div>;

  const slaResponsePct = sla ? Math.round((sla.metResponse / (sla.metResponse + sla.breachedResponse)) * 100) : 0;
  const slaResolutionPct = sla ? Math.round((sla.metResolution / (sla.metResolution + sla.breachedResolution)) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard icon={Ticket} label="Total Tickets" value={ticketVolume?.total || 0} color="text-cyber-400" />
        <KPICard icon={CheckCircle} label="SLA Response" value={`${slaResponsePct}%`} color={slaResponsePct >= 80 ? "text-green-400" : "text-red-400"} />
        <KPICard icon={DollarSign} label="Revenue (Paid)" value={formatCurrency(revenue?.totalPaid || 0)} color="text-green-400" />
        <KPICard icon={Clock} label="Outstanding" value={formatCurrency(revenue?.totalOutstanding || 0)} color="text-amber-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ticket Status Distribution */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2"><PieChart size={16} className="text-cyber-400"/>Ticket Status</h3>
          <div className="space-y-2">
            {(ticketVolume?.byStatus || []).map(s => {
              const pct = ticketVolume?.total ? Math.round((s.count / ticketVolume.total) * 100) : 0;
              return (
                <div key={s.status} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className={`badge ${STATUS_COLORS[s.status] || ""}`}>{s.status.replace(/_/g, " ")}</span>
                    <span className="text-gray-500">{s.count} ({pct}%)</span>
                  </div>
                  <div className="h-2 bg-surface-lighter rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${s.status === "new" ? "bg-blue-500" : s.status === "in_progress" ? "bg-cyber-500" : s.status === "resolved" ? "bg-green-500" : s.status === "closed" ? "bg-gray-500" : s.status === "waiting_on_client" ? "bg-amber-500" : s.status === "on_hold" ? "bg-purple-500" : "bg-red-500"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Priority Distribution */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2"><AlertTriangle size={16} className="text-cyber-400"/>Ticket Priority</h3>
          <div className="space-y-2">
            {(ticketVolume?.byPriority || []).map(p => {
              const pct = ticketVolume?.total ? Math.round((p.count / ticketVolume.total) * 100) : 0;
              const color = p.priority === "critical" ? "bg-red-500" : p.priority === "high" ? "bg-orange-500" : p.priority === "medium" ? "bg-amber-500" : "bg-gray-500";
              return (
                <div key={p.priority} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-300 capitalize">{p.priority}</span>
                    <span className="text-gray-500">{p.count} ({pct}%)</span>
                  </div>
                  <div className="h-2 bg-surface-lighter rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* SLA Compliance */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Timer size={16} className="text-cyber-400"/>SLA Compliance</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-surface-lighter rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">Response SLA</p>
              <p className={`text-2xl font-bold ${slaResponsePct >= 80 ? "text-green-400" : "text-red-400"}`}>{slaResponsePct}%</p>
              <p className="text-xs text-gray-600 mt-1">{sla?.metResponse || 0} met · {sla?.breachedResponse || 0} breached</p>
            </div>
            <div className="bg-surface-lighter rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">Resolution SLA</p>
              <p className={`text-2xl font-bold ${slaResolutionPct >= 80 ? "text-green-400" : "text-red-400"}`}>{slaResolutionPct}%</p>
              <p className="text-xs text-gray-600 mt-1">{sla?.metResolution || 0} met · {sla?.breachedResolution || 0} breached</p>
            </div>
          </div>
        </div>

        {/* Board Distribution */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Activity size={16} className="text-cyber-400"/>Tickets by Board</h3>
          <div className="space-y-2">
            {(ticketVolume?.byBoard || []).map(b => {
              const max = Math.max(...(ticketVolume?.byBoard || []).map(x => x.count), 1);
              const pct = Math.round((b.count / max) * 100);
              return (
                <div key={b.board} className="space-y-1">
                  <div className="flex items-center justify-between text-xs"><span className="text-gray-300">{b.board}</span><span className="text-gray-500">{b.count}</span></div>
                  <div className="h-1.5 bg-surface-lighter rounded-full overflow-hidden"><div className="h-full bg-cyber-500 rounded-full" style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Technician Utilization */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Users size={16} className="text-cyber-400"/>Technician Utilization (30 days)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-surface-border text-left text-gray-500 text-xs uppercase"><th className="p-3">Technician</th><th className="p-3">Billable</th><th className="p-3">Non-Billable</th><th className="p-3">Total</th><th className="p-3">Billable %</th></tr></thead>
            <tbody>
              {utilization.map(u => {
                const total = u.billable + u.nonBillable;
                const pct = total > 0 ? Math.round((u.billable / total) * 100) : 0;
                return (
                  <tr key={u.userId} className="border-b border-surface-border/50 hover:bg-surface-lighter/30">
                    <td className="p-3 text-white font-medium">{u.name}</td>
                    <td className="p-3 text-green-400">{formatMinutes(u.billable)}</td>
                    <td className="p-3 text-gray-400">{formatMinutes(u.nonBillable)}</td>
                    <td className="p-3 text-white">{formatMinutes(total)}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 bg-surface-lighter rounded-full overflow-hidden"><div className="h-full bg-cyber-500 rounded-full" style={{ width: `${pct}%` }} /></div>
                        <span className="text-xs text-gray-400">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  STANDARD REPORTS TAB
// ═══════════════════════════════════════════════════════════════════

function StandardReportsTab() {
  const [reportData, setReportData] = useState<{type:string;title:string;data:unknown}|null>(null);
  const [showExport, setShowExport] = useState<{type:string;title:string;data:unknown}|null>(null);
  const [exportForm, setExportForm] = useState({ format:"pdf", clientId:"", dateFrom:"", dateTo:"" });
  const [companies, setCompanies] = useState<Array<{id:string;name:string}>>([]);
  useEffect(() => { api.get("/clients?limit=100").then(r=>setCompanies(r.data.data||[])).catch(()=>{}); }, []);

  const reports = [
    { icon: Ticket, title: "Ticket Volume Report", desc: "Tickets by status, priority, board, and assignee with date range filtering", type: "ticket_summary" },
    { icon: Timer, title: "SLA Performance Report", desc: "Response and resolution time compliance by board and technician", type: "sla" },
    { icon: DollarSign, title: "Revenue Report", desc: "Monthly revenue, outstanding balances, payments collected", type: "revenue" },
    { icon: Users, title: "Technician Productivity", desc: "Billable hours, utilization rates, and ticket throughput per technician", type: "utilization" },
    { icon: Clock, title: "Ticket Aging Report", desc: "Aging analysis of open tickets: <1d, 1-3d, 3-7d, 7-30d, >30d", type: "aging" },
    { icon: CheckCircle, title: "Client Satisfaction Report", desc: "Survey response rates, NPS scores, and satisfaction trends by client", type: "csat" },
    { icon: Calendar, title: "Time Tracking Report", desc: "Detailed time entries by date, technician, project, and billable status", type: "time" },
    { icon: ClipboardList, title: "Contract Profitability", desc: "Revenue vs cost per service agreement with margin analysis", type: "contract" },
  ];

  const fetchData = async (type: string) => {
    const map: Record<string,string> = {
      ticket_summary: "/reports/data/ticket-volume", sla: "/reports/data/sla-compliance",
      revenue: "/reports/data/revenue-summary", utilization: "/reports/data/technician-utilization",
      aging: "/reports/data/ticket-aging", csat: "/reports/data/csat",
      time: "/reports/data/time-tracking", contract: "/reports/data/contract-profitability",
    };
    if (map[type]) { const { data } = await api.get(map[type]); return data; }
    return null;
  };
  const handleRun = async (type: string) => { const data = await fetchData(type); if (data) setReportData({ type, title: reports.find(r=>r.type===type)?.title||type, data }); };
  const handleOpenExport = async (type: string) => { const data = await fetchData(type); if (data) setShowExport({ type, title: reports.find(r=>r.type===type)?.title||type, data }); };
  const handlePrint = () => window.print();
  const handleExport = () => {
    if (!showExport) return;
    const fmt = exportForm.format;
    if (fmt === "csv") {
      const rows: unknown[] = Array.isArray(showExport.data) ? showExport.data : [showExport.data];
      const headers = rows.length>0 ? Object.keys(rows[0] as object).join(",") : "";
      const content = headers+"\n"+rows.map(r=>Object.values(r as object).map(v=>typeof v==="object"?JSON.stringify(v):String(v)).join(",")).join("\n");
      const blob = new Blob([content],{type:"text/csv"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href=url; a.download=`${showExport.title.replace(/\s+/g,"_")}.csv`; a.click(); URL.revokeObjectURL(url);
    } else if (fmt === "pdf") {
      const doc = new jsPDF({ orientation: "landscape" });
      doc.setFontSize(16); doc.text(showExport.title, 14, 20);
      doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleString()} — C7NTAX Reporting`, 14, 28);
      const data = showExport.data;
      if (Array.isArray(data) && data.length > 0) {
        const cols = Object.keys(data[0] as object).filter(k => !k.startsWith("_"));
        const rows = (data as Array<Record<string,unknown>>).map(r => cols.map(c => {
          const v = r[c]; if (v === null || v === undefined) return "—";
          if (typeof v === "number") return v.toLocaleString();
          if (typeof v === "string" && /^[a-z]+(_[a-z]+)*$/.test(v)) return v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          return typeof v === "object" ? JSON.stringify(v) : String(v);
        }));
        autoTable(doc, { head: [cols.map(c => c.replace(/([A-Z])/g," $1").replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase()))], body: rows, startY: 34, styles: { fontSize: 8 }, headStyles: { fillColor: [34, 211, 238] } });
      } else if (data && typeof data === "object") {
        const entries = Object.entries(data as Record<string,unknown>).filter(([k]) => !k.startsWith("_"));
        autoTable(doc, { head: [["Key","Value"]], body: entries.map(([k,v]) => {
          const val = v !== null && v !== undefined ? (typeof v === "number" ? v.toLocaleString() : typeof v === "string" && /^[a-z]+(_[a-z]+)*$/.test(v) ? v.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase()) : typeof v === "object" ? JSON.stringify(v) : String(v)) : "—";
          return [k.replace(/([A-Z])/g," $1").replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase()), val];
        }), startY: 34, styles: { fontSize: 8 } });
      }
      doc.save(`${showExport.title.replace(/\s+/g,"_")}.pdf`);
    } else {
      const w = window.open("","_blank","width=900,height=700")!;
      w.document.write(generateReportHTML(showExport.title, showExport.data));
      w.document.close(); setTimeout(()=>w.print(),500);
    }
    setShowExport(null);
  };

  return (<>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {reports.map(r => (
        <div key={r.type} className="card hover:border-cyber-500/30 transition-colors group">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-cyber-600/10"><r.icon size={18} className="text-cyber-400" /></div>
            <div className="flex-1"><h3 className="font-semibold text-white text-sm group-hover:text-cyber-400">{r.title}</h3><p className="text-xs text-gray-500 mt-1">{r.desc}</p></div>
          </div>
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <button onClick={()=>handleRun(r.type)} className="btn-primary text-xs flex items-center gap-1.5 px-3 py-1.5"><FileText size={12}/>Run Report</button>
            <button onClick={()=>handleRun(r.type)} className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"><Printer size={12}/>Print</button>
            <button onClick={()=>handleOpenExport(r.type)} className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"><Download size={12}/>Export</button>
          </div>
        </div>
      ))}
    </div>

    {/* Report Preview Modal */}
    {reportData && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={()=>setReportData(null)}>
      <div className="card w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-lg font-semibold text-white">{reportData.title}</h3>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"><Printer size={12}/>Print</button>
            <button onClick={()=>{setReportData(null);handleOpenExport(reportData.type);}} className="btn-primary text-xs flex items-center gap-1.5 px-3 py-1.5"><Download size={12}/>Export</button>
            <button onClick={()=>setReportData(null)} className="text-gray-500 hover:text-white">✕</button>
          </div>
        </div>
        <ReportPreview data={reportData.data} type={reportData.type}/>
      </div>
    </div>)}

    {/* Export Modal */}
    {showExport && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={()=>setShowExport(null)}>
      <div className="card w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto space-y-4" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-white">Export Report</h3><button onClick={()=>setShowExport(null)} className="text-gray-500 hover:text-white">✕</button></div>
        <p className="text-sm text-gray-400">{showExport.title}</p>
        <div><label className="text-xs text-gray-500 block mb-2">Format</label>
          <div className="flex gap-2">{[{id:"pdf",label:"PDF"},{id:"csv",label:"CSV"},{id:"xls",label:"XLS"},{id:"doc",label:"DOC"}].map(f=>(<button key={f.id} onClick={()=>setExportForm({...exportForm,format:f.id})} className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${exportForm.format===f.id?"bg-cyber-600/20 border-cyber-500/40 text-cyber-400":"border-surface-border text-gray-400 hover:text-white hover:bg-surface-lighter"}`}>{f.label}</button>))}</div>
        </div>
        <div><label className="text-xs text-gray-500 block mb-2">Report by Client</label><select className="input-field" value={exportForm.clientId} onChange={e=>setExportForm({...exportForm,clientId:e.target.value})}><option value="">All Clients</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="grid grid-cols-2 gap-3"><div><label className="text-xs text-gray-500 block mb-1">From</label><input type="date" className="input-field" value={exportForm.dateFrom} onChange={e=>setExportForm({...exportForm,dateFrom:e.target.value})}/></div><div><label className="text-xs text-gray-500 block mb-1">To</label><input type="date" className="input-field" value={exportForm.dateTo} onChange={e=>setExportForm({...exportForm,dateTo:e.target.value})}/></div></div>
        <div><label className="text-xs text-gray-500 block mb-2">Preview</label><div className="bg-surface-lighter rounded-lg p-3 max-h-48 overflow-auto"><ReportPreview data={showExport.data} type={showExport.type} compact/></div></div>
        <div className="flex gap-2 justify-end"><button onClick={()=>setShowExport(null)} className="btn-secondary text-sm">Cancel</button><button onClick={handleExport} className="btn-primary text-sm flex items-center gap-1.5"><Download size={14}/>Export</button></div>
      </div>
    </div>)}
  </>);
}

// ═══════════════════════════════════════════════════════════════════
//  ANALYTICS TAB
// ═══════════════════════════════════════════════════════════════════

function AnalyticsTab() {
  const [revenue, setRevenue] = useState<RevenueData | null>(null);
  useEffect(() => { api.get("/reports/data/revenue-summary").then(r => setRevenue(r.data)).catch(() => {}); }, []);

  const maxRevenue = Math.max(...(revenue?.monthlyRevenue || []).map(m => m.amount), 1);

  return (
    <div className="space-y-6">
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2"><TrendingUp size={16} className="text-cyber-400"/>Monthly Revenue Trend</h3>
        {revenue?.monthlyRevenue && revenue.monthlyRevenue.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-end gap-2 h-48">
              {revenue.monthlyRevenue.map(m => {
                const h = Math.round((m.amount / maxRevenue) * 100);
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1 group cursor-pointer">
                    <span className="text-xs text-gray-500 opacity-0 group-hover:opacity-100">${m.amount.toLocaleString()}</span>
                    <div className="w-full bg-cyber-500 rounded-t hover:bg-cyber-400 transition-colors" style={{ height: `${h}%` }} />
                    <span className="text-[10px] text-gray-600">{m.month}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : <p className="text-gray-500 text-sm">No revenue data available</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Financial Overview</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-400">Total Invoiced</span><span className="text-white">{formatCurrency(revenue?.totalPaid || 0)}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Total Outstanding</span><span className="text-amber-400">{formatCurrency(revenue?.totalOutstanding || 0)}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Collection Rate</span><span className="text-green-400">{revenue?.totalPaid && revenue.totalPaid + (revenue?.totalOutstanding || 0) > 0 ? Math.round((revenue.totalPaid / (revenue.totalPaid + (revenue?.totalOutstanding || 0))) * 100) : 0}%</span></div>
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Quick Actions</h3>
          <div className="space-y-2">
            <button className="btn-secondary w-full text-sm flex items-center gap-2 justify-center"><Download size={14}/>Export Dashboard PDF</button>
            <button className="btn-secondary w-full text-sm flex items-center gap-2 justify-center"><Calendar size={14}/>Schedule Weekly Report</button>
            <button onClick={() => window.location.href = "/reports/custom"} className="btn-secondary w-full text-sm flex items-center gap-2 justify-center"><Filter size={14}/>Custom Report Builder</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════

function KPICard({ icon: Icon, label, value, color }: { icon: React.ComponentType<{ size?: number }>; label: string; value: string | number; color: string }) {
  return (
    <div className="bg-surface rounded-xl border border-surface-border p-4 flex items-center gap-3">
      <div className="p-2 rounded-lg bg-surface-lighter"><Icon size={18} className={color} /></div>
      <div><p className="text-xs text-gray-500">{label}</p><p className={`text-lg font-bold ${color}`}>{value}</p></div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  REPORT PREVIEW COMPONENT
// ═══════════════════════════════════════════════════════════════════

function ReportPreview({ data, type, compact }: { data: unknown; type: string; compact?: boolean }) {
  if (!data) return <p className="text-gray-500 text-sm">No data</p>;
  const d = data as Record<string,unknown>;

  // ── Universal card-based preview for any data ──
  const renderValue = (v: unknown): string => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "number") return v.toLocaleString();
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (typeof v === "string") {
      // Format status/priority codes to readable text
      if (/^[a-z]+(_[a-z]+)*$/.test(v) && v.length < 40) return v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      return v;
    }
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") return `${v.length} items`;
    return JSON.stringify(v).slice(0, 120);
  };

  // Build a key-value table from any data object
  const entries: Array<[string, unknown]> = [];
  for (const [key, val] of Object.entries(d)) {
    if (key.startsWith("_")) continue;
    entries.push([key.replace(/([A-Z])/g," $1").replace(/_/g," ").replace(/^./,c=>c.toUpperCase()), val]);
  }

  // If data is an array, show as table
  if (Array.isArray(data)) {
    const arr = data as Array<Record<string,unknown>>;
    if (arr.length === 0) return <p className="text-gray-500 text-sm">No records found</p>;
    const cols = Object.keys(arr[0]).filter(k => !k.startsWith("_"));
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-surface-border">{cols.map(c => <th key={c} className="text-left p-2 text-gray-500 uppercase font-semibold">{c.replace(/([A-Z])/g," $1").replace(/_/g," ").replace(/^./,c=>c.toUpperCase())}</th>)}</tr></thead>
          <tbody>{arr.map((row,i) => <tr key={i} className="border-b border-surface-border/30 hover:bg-surface-lighter/20">{cols.map(c => <td key={c} className="p-2 text-white">{renderValue(row[c])}</td>)}</tr>)}</tbody>
        </table>
        {!compact && <p className="text-xs text-gray-600 mt-2">{arr.length} record{arr.length!==1?"s":""}</p>}
      </div>
    );
  }

  // Object data — show as value cards
  return (
    <div className={compact ? "space-y-1" : "space-y-3"}>
      <div className={`grid ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-3"} gap-2`}>
        {entries.map(([label, value]) => (
          <div key={label} className="bg-surface-lighter rounded-lg px-3 py-2">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">{label}</p>
            <p className="text-sm font-medium text-white">{renderValue(value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function generateReportHTML(title: string, data: unknown): string {
  const now = new Date().toLocaleString();
  const renderValue = (v: unknown): string => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "number") return v.toLocaleString();
    if (typeof v === "string" && /^[a-z]+(_[a-z]+)*$/.test(v) && v.length < 40) return v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") {
      const cols = Object.keys(v[0] as object).filter(k => !k.startsWith("_"));
      return `<table style="margin:4px 0;font-size:11px"><thead><tr>${cols.map(c => `<th>${c.replace(/([A-Z])/g," $1").replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase())}</th>`).join("")}</tr></thead><tbody>${v.map(row => `<tr>${cols.map(c => `<td>${renderValue((row as Record<string,unknown>)[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    }
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };

  let bodyHtml = "";
  if (Array.isArray(data) && data.length > 0) {
    const cols = Object.keys((data[0] as object) || {}).filter(k => !k.startsWith("_"));
    bodyHtml = `<table><thead><tr>${cols.map(c => `<th>${c.replace(/([A-Z])/g," $1").replace(/_/g," ")}</th>`).join("")}</tr></thead><tbody>${(data as Array<Record<string,unknown>>).map(row => `<tr>${cols.map(c => `<td>${renderValue(row[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  } else if (data && typeof data === "object") {
    const entries = Object.entries(data as Record<string,unknown>).filter(([k]) => !k.startsWith("_"));
    bodyHtml = `<table><tbody>${entries.map(([k,v]) => `<tr><th>${k.replace(/([A-Z])/g," $1").replace(/_/g," ")}</th><td>${renderValue(v)}</td></tr>`).join("")}</tbody></table>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:#1e293b;padding:32px}
  h1{font-size:22px;color:#0b1120;border-bottom:3px solid #22d3ee;padding-bottom:8px;margin-bottom:4px}
  .meta{font-size:12px;color:#64748b;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px}
  th{text-align:left;padding:8px 10px;background:#f1f5f9;border-bottom:2px solid #cbd5e1;font-weight:600;color:#334155}
  td{padding:8px 10px;border-bottom:1px solid #e2e8f0;color:#1e293b;vertical-align:top}
  tr:nth-child(even) td{background:#f8fafc}
  @media print{body{padding:16px}}
</style></head><body>
<h1>${title}</h1><p class="meta">Generated: ${now} — C7NTAX Reporting</p>
${bodyHtml || "<p>No data available</p>"}
</body></html>`;
}

function renderTable(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const obj = data as Record<string,unknown>;
  const arr = (Array.isArray(obj.data) ? obj.data : Array.isArray(obj) ? obj : []) as Array<Record<string,unknown>>;
  if (!arr.length) return "<p>No records</p>";
  const keys = Object.keys(arr[0]);
  return '<table><thead><tr>'+keys.map(k=>'<th>'+k+'</th>').join("")+'</tr></thead><tbody>'+arr.map(row=>'<tr>'+keys.map(k=>'<td>'+(typeof row[k]==="object"?JSON.stringify(row[k]):String(row[k]??""))+'</td>').join("")+'</tr>').join("")+'</tbody></table>';
}
