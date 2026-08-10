import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeState>(null!);

const STORAGE_KEY = "c7_theme";

function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  return "dark";
}

// ── Injected style tag — always wins because it uses html[data-theme="light"] (0,1,1)
//     which beats the base html {} (0,0,1) regardless of DOM position ──
const STYLE_ID = "c7-theme-vars";

const LIGHT_CSS = `html[data-theme="light"] {
  --navy-50: #f5f5f5; --navy-100: #ebebeb; --navy-200: #d9d9d9;
  --navy-300: #b3b3b3; --navy-400: #808080; --navy-500: #5c5c5c;
  --navy-600: #424242; --navy-700: #2b2b2b; --navy-800: #1a1a1a;
  --navy-900: #0d0d0d; --navy-950: #ffffff;
  --cyber-50: #f0f9ff; --cyber-100: #e0f2fe; --cyber-200: #bae6fd;
  --cyber-300: #7dd3fc; --cyber-400: #38bdf8; --cyber-500: #0ea5e9;
  --cyber-600: #0284c7; --cyber-700: #0369a1; --cyber-800: #075985;
  --cyber-900: #0c4a6e;
  --surface: #ffffff; --surface-light: #f7f7f7;
  --surface-lighter: #f0f0f0; --surface-border: #e2e2e2;
  --alert-red: #dc2626; --alert-amber: #d97706; --alert-green: #16a34a;
  --text-primary: #1a1a1a; --text-secondary: #404040;
  --text-tertiary: #5c5c5c; --text-muted: #737373;
  --text-muted-alt: #a3a3a3;
}`;

function ensureStyleTag(): HTMLStyleElement {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    // Place at end of <head> so it's always after Vite's injected CSS
    document.head.appendChild(el);
  }
  return el;
}

function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  document.documentElement.classList.toggle("light", t === "light");

  const el = ensureStyleTag();
  el.textContent = t === "light" ? LIGHT_CSS : "";

  try { localStorage.setItem(STORAGE_KEY, t); } catch {}
}

// Apply before React mounts — no flash
applyTheme(loadTheme());

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(loadTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const next = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
