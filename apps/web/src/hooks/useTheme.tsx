import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeState>(null!);

function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem("c7_theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  return "dark";
}

/** Apply theme class to <html> element directly */
function applyThemeClass(t: Theme) {
  document.documentElement.classList.toggle("light", t === "light");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const initial = loadTheme();
    // Apply class immediately during init so there's no flash
    applyThemeClass(initial);
    return initial;
  });

  // Keep class in sync whenever state changes (belt-and-suspenders with direct calls below)
  useEffect(() => {
    applyThemeClass(theme);
    localStorage.setItem("c7_theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const next = prev === "dark" ? "light" : "dark";
      applyThemeClass(next);
      return next;
    });
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyThemeClass(t);
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
