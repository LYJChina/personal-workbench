import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AppearanceSettings } from "@workbench/contracts";
import { api as defaultApi } from "../lib/api";

export type WorkbenchSkin = "aurora" | "paper" | "sage";
export type WorkbenchDensity = "comfortable" | "compact";
export type WorkbenchRadius = "rounded" | "subtle";

export type { AppearanceSettings } from "@workbench/contracts";

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
  persistenceError: boolean;
  retryAppearance: () => void;
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

function loadLegacyAppearance(): AppearanceSettings | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const parsed: unknown = JSON.parse(saved);
    return isAppearance(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

interface AppearanceApi {
  getAppearance(): Promise<{ appearance: AppearanceSettings | null }>;
  updateAppearance(appearance: AppearanceSettings): Promise<AppearanceSettings>;
}

export function AppearanceProvider({ children, initialAppearance, api: appearanceApi = defaultApi }: {
  children: React.ReactNode;
  initialAppearance?: AppearanceSettings;
  api?: AppearanceApi;
}) {
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => initialAppearance ?? defaultAppearance);
  const [persistenceError, setPersistenceError] = useState(false);
  const appearanceRef = useRef(appearance);
  const interactionVersion = useRef(0);
  const writeTail = useRef<Promise<unknown>>(Promise.resolve());
  const failedPersistence = useRef<{ target: AppearanceSettings; generation: number; legacy: boolean } | null>(null);

  const persist = useCallback((next: AppearanceSettings, generation: number, legacy = false) => {
    const write = writeTail.current.catch(() => undefined).then(() => appearanceApi.updateAppearance(next));
    writeTail.current = write;
    void write.then(() => {
      if (failedPersistence.current && failedPersistence.current.generation <= generation) failedPersistence.current = null;
      if (interactionVersion.current === generation) setPersistenceError(false);
    }, () => {
      if (interactionVersion.current !== generation) return;
      failedPersistence.current = { target: next, generation, legacy };
      setPersistenceError(true);
    });
    return write;
  }, [appearanceApi]);

  useEffect(() => {
    if (initialAppearance) return;
    let active = true;
    const bootstrapVersion = interactionVersion.current;
    void appearanceApi.getAppearance().then(async ({ appearance: stored }) => {
      if (!active || interactionVersion.current !== bootstrapVersion) return;
      if (stored) {
        window.localStorage.removeItem(STORAGE_KEY);
        appearanceRef.current = stored;
        setAppearance(stored);
        return;
      }
      const legacy = loadLegacyAppearance();
      if (!legacy) return;
      try {
        const confirmed = await persist(legacy, bootstrapVersion, true);
        if (!active || interactionVersion.current !== bootstrapVersion) return;
        appearanceRef.current = confirmed;
        setAppearance(confirmed);
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Keep the validated legacy value for a later retry and retain the safe fallback.
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [appearanceApi, initialAppearance, persist]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.skin = appearance.skin;
    root.dataset.density = appearance.density;
    root.dataset.radius = appearance.radius;
    root.dataset.glass = String(appearance.glass);
  }, [appearance, initialAppearance]);

  const value = useMemo<AppearanceContextValue>(() => ({
    appearance,
    updateAppearance: (patch) => {
      const generation = ++interactionVersion.current;
      failedPersistence.current = null;
      setPersistenceError(false);
      const next = { ...appearanceRef.current, ...patch };
      appearanceRef.current = next;
      setAppearance(next);
      void persist(next, generation);
    },
    resetAppearance: () => {
      const generation = ++interactionVersion.current;
      failedPersistence.current = null;
      setPersistenceError(false);
      appearanceRef.current = defaultAppearance;
      setAppearance(defaultAppearance);
      void persist(defaultAppearance, generation);
    },
    persistenceError,
    retryAppearance: () => {
      const failed = failedPersistence.current;
      if (!failed || failed.generation !== interactionVersion.current) return;
      void persist(failed.target, failed.generation, failed.legacy).then((confirmed) => {
        if (interactionVersion.current !== failed.generation) return;
        appearanceRef.current = confirmed;
        setAppearance(confirmed);
        if (failed.legacy) window.localStorage.removeItem(STORAGE_KEY);
      }).catch(() => undefined);
    }
  }), [appearance, persist, persistenceError]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error("useAppearance must be used within AppearanceProvider");
  return context;
}
