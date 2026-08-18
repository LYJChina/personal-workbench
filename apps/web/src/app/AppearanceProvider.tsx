import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type WorkbenchSkin = "aurora" | "paper" | "sage";
export type WorkbenchDensity = "comfortable" | "compact";
export type WorkbenchRadius = "rounded" | "subtle";

export interface AppearanceSettings {
  skin: WorkbenchSkin;
  density: WorkbenchDensity;
  radius: WorkbenchRadius;
  glass: boolean;
}

export const defaultAppearance: AppearanceSettings = {
  skin: "aurora",
  density: "comfortable",
  radius: "rounded",
  glass: true
};

const STORAGE_KEY = "workbench.appearance.v1";

interface AppearanceContextValue {
  appearance: AppearanceSettings;
  updateAppearance: (patch: Partial<AppearanceSettings>) => void;
  resetAppearance: () => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function isAppearance(value: unknown): value is AppearanceSettings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AppearanceSettings>;
  return ["aurora", "paper", "sage"].includes(candidate.skin ?? "")
    && ["comfortable", "compact"].includes(candidate.density ?? "")
    && ["rounded", "subtle"].includes(candidate.radius ?? "")
    && typeof candidate.glass === "boolean";
}

function loadAppearance(): AppearanceSettings {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return defaultAppearance;
    const parsed: unknown = JSON.parse(saved);
    return isAppearance(parsed) ? parsed : defaultAppearance;
  } catch {
    return defaultAppearance;
  }
}

export function AppearanceProvider({ children, initialAppearance }: { children: React.ReactNode; initialAppearance?: AppearanceSettings }) {
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => initialAppearance ?? loadAppearance());

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.skin = appearance.skin;
    root.dataset.density = appearance.density;
    root.dataset.radius = appearance.radius;
    root.dataset.glass = String(appearance.glass);
    if (!initialAppearance) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
      } catch {
        // Visual preferences remain usable for the session when storage is unavailable.
      }
    }
  }, [appearance, initialAppearance]);

  const value = useMemo<AppearanceContextValue>(() => ({
    appearance,
    updateAppearance: (patch) => setAppearance((current) => ({ ...current, ...patch })),
    resetAppearance: () => setAppearance(defaultAppearance)
  }), [appearance]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error("useAppearance must be used within AppearanceProvider");
  return context;
}
