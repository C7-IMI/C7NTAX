import { BrandMark } from "./BrandMark";
import { Wordmark } from "./Wordmark";

/**
 * Minimal loading screen — the brand lockup and a spinner, shown during the
 * initial auth check. Service health is shown on the login page.
 */
export function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-surface">
      <BrandMark size={56} />
      <Wordmark height={38} className="text-white" />
      <div className="animate-spin h-6 w-6 border-2 border-cyber-400 border-t-transparent rounded-full" />
    </div>
  );
}
