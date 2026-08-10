import React, { Component, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import App from "./App";
import { ThemeProvider } from "./hooks/useTheme";
import "./index.css";

// ── Error Boundary — catches rendering crashes ────────────────────
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: "100vh", background: "#0a1628", color: "#e2e8f0",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "system-ui, sans-serif", padding: "2rem",
        }}>
          <div style={{ maxWidth: "520px", textAlign: "center" }}>
            <div style={{ fontSize: "48px", marginBottom: "1rem" }}>⚠️</div>
            <h1 style={{ fontSize: "20px", marginBottom: "0.5rem", color: "#fff" }}>
              Application Error
            </h1>
            <p style={{ fontSize: "14px", color: "#94a3b8", marginBottom: "1rem" }}>
              A rendering error occurred. This is usually caused by missing dependencies.
            </p>
            <pre style={{
              background: "#1e293b", padding: "1rem", borderRadius: "8px",
              fontSize: "12px", color: "#ef4444", textAlign: "left",
              overflow: "auto", maxHeight: "200px", whiteSpace: "pre-wrap",
            }}>
              {this.state.error.message}
              {"\n\n"}
              {this.state.error.stack?.split("\n").slice(0, 6).join("\n")}
            </pre>
            <p style={{ fontSize: "12px", color: "#64748b", marginTop: "1rem" }}>
              Run <code style={{ background: "#1e293b", padding: "2px 6px", borderRadius: "4px" }}>pnpm install</code> then{" "}
              <code style={{ background: "#1e293b", padding: "2px 6px", borderRadius: "4px" }}>pnpm dev</code> from the project root.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30000, retry: 1, refetchOnWindowFocus: false },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <Toaster
            position="top-right"
            toastOptions={{
              style: { background: "#162238", color: "#fff", border: "1px solid #2a3a5c", borderRadius: "0.625rem" },
            }}
          />
        </BrowserRouter>
      </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
