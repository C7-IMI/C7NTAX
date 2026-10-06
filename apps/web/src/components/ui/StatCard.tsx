import type { ReactNode } from "react";

const TONES = {
  cyber: "bg-cyber-600/20 text-cyber-400",
  red: "bg-red-600/15 text-red-400",
  amber: "bg-amber-500/15 text-amber-400",
  green: "bg-emerald-500/15 text-emerald-400",
  neutral: "bg-surface-lighter text-gray-300",
} as const;

/** Compact KPI tile (icon + value + label) used on dashboards and summary strips. */
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
