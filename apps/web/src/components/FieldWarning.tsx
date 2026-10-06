import type { ReactNode } from "react";

/**
 * Validation bubble used under a field — a white card with an orange marker and
 * a pointer at the top, matching the pattern the form validators use elsewhere.
 * Warnings built on this never block: they explain what looks wrong and let the
 * user carry on.
 */
export function FieldWarning({ message, tone = "warning" }: { message: ReactNode; tone?: "warning" | "error" }) {
  return (
    <div className="absolute left-0 top-full z-30 mt-2 max-w-md" role="status">
      <span
        aria-hidden="true"
        className="absolute -top-1.5 left-5 h-3 w-3 rotate-45 border-l border-t border-black/5 bg-white"
      />
      <div className="flex items-start gap-1.5 rounded-md border border-black/5 bg-white px-2 py-1 shadow-xl">
        <span
          aria-hidden="true"
          className={`mt-px flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-sm text-[8px] font-bold leading-none text-white ${
            tone === "error" ? "bg-red-500" : "bg-orange-500"
          }`}
        >
          !
        </span>
        <p className="text-[10px] leading-tight text-gray-800">{message}</p>
      </div>
    </div>
  );
}
