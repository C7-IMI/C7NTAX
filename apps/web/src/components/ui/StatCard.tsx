import type { ReactNode } from "react";
import { useRedesign } from "../../hooks/useNavigationStyle";

const TONES = {
  cyber: "bg-cyber-600/20 text-cyber-400",
  red: "bg-red-600/15 text-red-400",
  amber: "bg-amber-500/15 text-amber-400",
  green: "bg-emerald-500/15 text-emerald-400",
  neutral: "bg-surface-lighter text-gray-300",
} as const;

/**
 * Compact KPI tile used on dashboards and summary strips.
 *
 * The redesigned tile leads with the number rather than the icon: a dashboard is read by scanning
 * figures, and an icon sitting where the figure belongs makes that scan slower. The glyph moves to
 * the corner, where it labels the figure without competing with it.
 */
export function StatCard({
  label,
  value,
  icon,
  tone = "cyber",
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: keyof typeof TONES;
}) {
  const redesign = useRedesign();

  if (redesign) {
    return (
      <div className="card card--interactive">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] text-gray-500 leading-tight">{label}</p>
          {icon ? (
            <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${TONES[tone]}`}>{icon}</span>
          ) : null}
        </div>
        <p className="mt-2 text-2xl font-semibold leading-none tracking-tight text-white tabular-nums">{value}</p>
      </div>
    );
  }

  return (
    <div className="card card--interactive flex items-center gap-3 !py-4">
      {icon ? (
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${TONES[tone]}`}>{icon}</div>
      ) : null}
      <div className="min-w-0">
        <p className="text-2xl font-bold text-white leading-none tabular-nums">{value}</p>
        <p className="text-xs text-gray-400 mt-1 truncate">{label}</p>
      </div>
    </div>
  );
}
