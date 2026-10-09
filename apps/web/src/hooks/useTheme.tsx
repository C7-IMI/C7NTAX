import { createContext, useContext, useState, useEffect, useCallback, type Context, type ReactNode } from "react";

export type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

/**
 * One context object per tab, rather than one per evaluation of this module.
 *
 * `createContext` returns a **new** object every time the module runs, and in development it runs again on
 * every edit — so the provider mounted in the tree can belong to the previous copy while a re-rendered
 * consumer resolves its import to the new one, and reads a context nothing provides. `useTheme`'s two
 * callers destructure the result, so that arrives as a TypeError on a property name and a blank screen
 * rather than as anything a person could act on. The same guard covers the other way a second context
 * appears: two copies of this file in one bundle. In a real deployment the module is evaluated once and
 * none of this is reachable — which is why the fix is quiet rather than clever.
 */
const ThemeContext = ((): Context<ThemeState | null> => {
  const tab = globalThis as typeof globalThis & { __c7ThemeContext?: Context<ThemeState | null> };
  return (tab.__c7ThemeContext ??= createContext<ThemeState | null>(null));
})();

const STORAGE_KEY = "c7_theme";

function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  return "dark";
}

function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  document.documentElement.classList.toggle("light", t === "light");

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

/**
 * The current theme, from anywhere inside `<ThemeProvider>`.
 *
 * A missing context is a mistake in the tree rather than a state the application can be in, so it says
 * which mistake it is instead of handing back `null` for the caller to trip over.
 */
export function useTheme(): ThemeState {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme() was called outside <ThemeProvider>");
  return context;
}
