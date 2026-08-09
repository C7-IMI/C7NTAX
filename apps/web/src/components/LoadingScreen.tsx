/**
 * Minimal loading screen — simple spinner with C7 branding.
 * Used during the initial auth check. Service health is shown on the login page.
 */
export function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-navy-950">
      <div className="text-center">
        <div className="w-14 h-14 rounded-xl bg-cyber-600 flex items-center justify-center mx-auto mb-4">
          <span className="text-white font-bold text-xl">C7</span>
        </div>
        <h1 className="text-2xl font-bold text-white">C7NTAX</h1>
        <div className="flex justify-center mt-6">
          <div className="animate-spin h-6 w-6 border-2 border-cyber-400 border-t-transparent rounded-full" />
        </div>
      </div>
    </div>
  );
}
