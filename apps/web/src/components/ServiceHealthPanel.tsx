import { useState, useEffect, type ReactNode } from "react";
import { Wifi, Database, Globe, Server, AlertTriangle, CheckCircle, XCircle, Loader2 } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────

interface ServiceStatus {
  name: string;
  label: string;
  icon: ReactNode;
  port: number;
  status: "checking" | "up" | "down";
  message: string;
  detail?: string;
}

function statusIcon(s: ServiceStatus["status"]) {
  if (s === "checking") return <Loader2 size={13} className="text-amber-400 animate-spin" />;
  if (s === "up") return <CheckCircle size={13} className="text-green-400" />;
  return <XCircle size={13} className="text-red-400" />;
}

const HELP_MESSAGES: Record<string, string> = {
  "Web Server": "The frontend is serving this page, so Vite is running. No action needed.",
  "API Server": "Run 'pnpm dev' in apps/api. Check that port 4000 is free (netstat -ano | findstr :4000).",
  Database: "Verify PostgreSQL is running (pg_isready). Check DATABASE_URL in apps/api/.env points to a reachable instance.",
  WebSocket: "The WebSocket shares the API port (4000). If the API is up, restart the server (kill stale node processes first).",
};

// ── Component ───────────────────────────────────────────────────────

export function ServiceHealthPanel() {
  const [services, setServices] = useState<ServiceStatus[]>([
    { name: "Web Server", label: "Frontend", icon: <Globe size={13} />, port: 3010, status: "up", message: "Serving" },
    { name: "API Server", label: "Backend", icon: <Server size={13} />, port: 4000, status: "checking", message: "Checking..." },
    { name: "Database", label: "PostgreSQL", icon: <Database size={13} />, port: 5432, status: "checking", message: "Checking..." },
    { name: "WebSocket", label: "Real-time", icon: <Wifi size={13} />, port: 4000, status: "checking", message: "Checking..." },
  ]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function check() {
      try {
        const h = await fetch("/api/health", { signal: AbortSignal.timeout(3000) });
        const ok = h.ok;
        if (cancelled) return;
        setServices((prev) =>
          prev.map((s) => {
            if (s.name === "API Server")
              return { ...s, status: ok ? "up" : "down", message: ok ? "Healthy" : "Unreachable", detail: ok ? undefined : HELP_MESSAGES["API Server"] };
            if (s.name === "Database")
              return { ...s, status: ok ? "up" : "down", message: ok ? "Connected" : "Unreachable", detail: ok ? undefined : HELP_MESSAGES["Database"] };
            if (s.name === "WebSocket")
              return { ...s, status: ok ? "up" : "down", message: ok ? "Available" : "Unavailable", detail: ok ? undefined : HELP_MESSAGES["WebSocket"] };
            return s;
          })
        );
      } catch {
        if (cancelled) return;
        setServices((prev) =>
          prev.map((s) => {
            if (s.name === "API Server")
              return { ...s, status: "down", message: "Unreachable", detail: HELP_MESSAGES["API Server"] };
            if (s.name === "Database")
              return { ...s, status: "down", message: "Unreachable", detail: HELP_MESSAGES["Database"] };
            if (s.name === "WebSocket")
              return { ...s, status: "down", message: "Unreachable", detail: HELP_MESSAGES["WebSocket"] };
            return s;
          })
        );
      }

      if (!cancelled) {
        timer = setTimeout(check, 3000);
      }
    }

    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const downCount = services.filter((s) => s.status === "down").length;
  const servicesDone = services.every((s) => s.status !== "checking");
  const allUp = downCount === 0 && servicesDone;

  return (
    <div className="space-y-2">
      {/* Summary line */}
      <p className="text-[11px] text-gray-500 text-center mb-1">
        {allUp ? "All systems ready" : downCount > 0 ? `${downCount} service${downCount > 1 ? "s" : ""} down` : "Checking services..."}
      </p>

      {!allUp && services.some((s) => s.status === "checking") && (
        <div className="flex justify-center mb-2">
          <div className="animate-spin h-4 w-4 border-2 border-cyber-400 border-t-transparent rounded-full" />
        </div>
      )}

      {services.map((s) => (
        <div
          key={s.name}
          className={`rounded-lg border px-2.5 py-2 text-xs transition-colors ${
            s.status === "up"
              ? "border-green-900/40 bg-green-900/10"
              : s.status === "down"
              ? "border-red-900/40 bg-red-900/10"
              : "border-surface-border bg-surface/50"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className={s.status === "up" ? "text-green-400" : s.status === "down" ? "text-red-400" : "text-gray-500"}>
              {s.icon}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-white font-medium truncate">{s.name}</span>
                <span className="text-[10px] text-gray-600 shrink-0">:{s.port}</span>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                {statusIcon(s.status)}
                <span
                  className={`text-[11px] ${
                    s.status === "up" ? "text-green-400" : s.status === "down" ? "text-red-400" : "text-amber-400"
                  }`}
                >
                  {s.message}
                </span>
              </div>
            </div>
          </div>

          {s.status === "down" && s.detail && (
            <div className="mt-1.5 flex items-start gap-1 bg-red-950/30 rounded p-1.5">
              <AlertTriangle size={10} className="text-amber-400 mt-0.5 shrink-0" />
              <p className="text-[10px] text-gray-400 leading-relaxed">{s.detail}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
