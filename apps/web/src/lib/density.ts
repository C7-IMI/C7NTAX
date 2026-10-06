/** UI density preference (comfortable | compact), persisted to localStorage. */
export type Density = "comfortable" | "compact";

const DENSITY_KEY = "c7_density";

export function getDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

export function applyDensity(density: Density): void {
  document.documentElement.setAttribute("data-density", density);
}

export function setDensity(density: Density): void {
  try {
    localStorage.setItem(DENSITY_KEY, density);
  } catch {
    /* ignore */
  }
  applyDensity(density);
}
