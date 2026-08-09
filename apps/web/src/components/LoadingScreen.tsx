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

export function LoadingScreen({ allReady = false, onForceContinue }: { allReady?: boolean; onForceContinue?: () => void }) {
  const [stuck, setStuck] = useState(false);
  const [services, setServices] = useState<ServiceStatus[]>([
    { name: "Web Server", label: "Frontend", icon: <Globe size={13} />, port: 3010, status: "up", message: "Serving" },
    { name: "API Server", label: "Backend", icon: <Server size={13} />, port: 4000, status: "checking", message: "Checking..." },
    { name: "Database", label: "PostgreSQL", icon: <Database size={13} />, port: 5432, status: "checking", message: "Checking..." },
    { name: "WebSocket", label: "Real-time", icon: <Wifi size={13} />, port: 4000, status: "checking", message: "Checking..." },
  ]);

  useEffect(() => {
    // If still showing after 5 seconds, offer a force-continue escape
    if (onForceContinue) {
      const t = setTimeout(() => setStuck(true), 5000);
      return () => clearTimeout(t);
    }
  }, [onForceContinue]);

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
        timer = setTimeout(check, 3000); // retry every 3s
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
    <div className="min-h-screen bg-navy-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-cyber-600 flex items-center justify-center mx-auto mb-3">
            <span className="text-white font-bold text-xl">C7</span>
          </div>
          <h1 className="text-2xl font-bold text-white">C7NTAX</h1>
          <p className="text-gray-400 text-sm mt-1">
            {allUp ? "All systems ready" : downCount > 0 ? `${downCount} service${downCount > 1 ? "s" : ""} down` : "Loading services..."}
          </p>
        </div>

        {/* Spinner — hide when allReady (auth resolved) even during min display time */}
        {!allReady && services.some((s) => s.status === "checking") && (
          <div className="flex justify-center mb-6">
            <div className="animate-spin h-6 w-6 border-2 border-cyber-400 border-t-transparent rounded-full" />
          </div>
        )}

        {/* Status list */}
        <div className="space-y-2">
          {services.map((s) => (
            <div
              key={s.name}
              className={`rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                s.status === "up"
                  ? "border-green-900/40 bg-green-900/10"
                  : s.status === "down"
                  ? "border-red-900/40 bg-red-900/10"
                  : "border-surface-border bg-surface/50"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className={s.status === "up" ? "text-green-400" : s.status === "down" ? "text-red-400" : "text-gray-500"}>
                  {s.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white font-medium truncate">{s.name}</span>
                    <span className="text-xs text-gray-500 shrink-0">:{s.port}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {statusIcon(s.status)}
                    <span
                      className={`text-xs ${
                        s.status === "up" ? "text-green-400" : s.status === "down" ? "text-red-400" : "text-amber-400"
                      }`}
                    >
                      {s.message}
                    </span>
                  </div>
                </div>
              </div>

              {/* Diagnostic tip for down services */}
              {s.status === "down" && s.detail && (
                <div className="mt-2 flex items-start gap-1.5 bg-red-950/30 rounded p-2">
                  <AlertTriangle size={11} className="text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-[11px] text-gray-400 leading-relaxed">{s.detail}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Skip login — show when services are up AND auth has resolved, or all services green */}
        {(allUp || (allReady && servicesDone)) && (
          <div className="text-center mt-6">
            <button
              onClick={() => {
                localStorage.setItem("c7_bypass", "1");
                window.location.href = "/";
              }}
              className="text-sm text-cyber-400 hover:text-cyber-300 transition-colors"
            >
              Skip login — go to dashboard
            </button>
          </div>
        )}

        {/* Stuck escape hatch — appears after 5s if the screen hasn't transitioned */}
        {stuck && onForceContinue && (
          <div className="text-center mt-4 pt-4 border-t border-surface-border">
            <p className="text-xs text-gray-500 mb-2">Taking longer than expected?</p>
            <button
              onClick={onForceContinue}
              className="text-sm text-amber-400 hover:text-amber-300 transition-colors font-medium"
            >
              Continue anyway →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
