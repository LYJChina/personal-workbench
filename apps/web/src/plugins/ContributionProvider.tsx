import {
  ModuleIdSchema,
  NavigationIdSchema,
  PluginContributionSchema,
  PluginIdSchema,
  type ModuleId,
  type NavigationItem,
  type PluginContribution
} from "@workbench/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode
} from "react";
import { api } from "../lib/api";
import { resolveSystemComponent } from "./systemComponentRegistry";

type ContributionOf<Type extends PluginContribution["type"]> = Extract<PluginContribution, { type: Type }>;

interface OwnedContribution {
  pluginId: string;
}

export type NavigationContribution = Omit<ContributionOf<"navigation">, "id"> & OwnedContribution & {
  id: NavigationItem["id"];
};

export type RouteContribution = ContributionOf<"route"> & OwnedContribution & {
  Component: ComponentType;
};

export type DashboardContribution = Omit<ContributionOf<"dashboard">, "id"> & OwnedContribution & {
  id: ModuleId;
  Component: ComponentType;
};

export type AiToolContribution = ContributionOf<"ai-tool"> & OwnedContribution;

export type SettingsContribution = ContributionOf<"settings"> & OwnedContribution & {
  Component: ComponentType;
};

export interface PluginContributions {
  navigation: NavigationContribution[];
  routes: RouteContribution[];
  dashboardModules: DashboardContribution[];
  aiTools: AiToolContribution[];
  settingsSections: SettingsContribution[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

type ContributionState = Omit<PluginContributions, "refresh">;

const emptyContributions: ContributionState = {
  navigation: [],
  routes: [],
  dashboardModules: [],
  aiTools: [],
  settingsSections: [],
  loading: false,
  error: null
};

export const pluginContributionLoadError = "插件功能暂时无法加载，请稍后重试。";

const ContributionContext = createContext<PluginContributions>({ ...emptyContributions, refresh: async () => undefined });

const reservedNavigationIds = new Set(["home", "ai-office", "vault-coming-soon", "settings"]);
const reservedRoutePaths = new Set(["/", "/ai-office", "/settings"]);

interface RawEntry {
  pluginId: string;
  contribution: PluginContribution;
}

function strictEntry(value: unknown): RawEntry {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid contribution entry");
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "contribution" || keys[1] !== "pluginId") throw new Error("Invalid contribution entry");
  const candidate = value as { pluginId?: unknown; contribution?: unknown };
  const pluginId = PluginIdSchema.safeParse(candidate.pluginId);
  const contribution = PluginContributionSchema.safeParse(candidate.contribution);
  if (!pluginId.success || !contribution.success) throw new Error("Invalid contribution entry");
  return { pluginId: pluginId.data, contribution: contribution.data };
}

function compare(left: OwnedContribution & { id: string; position?: number }, right: OwnedContribution & { id: string; position?: number }): number {
  const byPosition = (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER);
  if (byPosition !== 0) return byPosition;
  if (left.pluginId !== right.pluginId) return left.pluginId < right.pluginId ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

function canonicalRoutePath(path: string): string {
  return path === "/" ? path : path.replace(/\/+$/, "");
}

export function compilePluginContributions(value: unknown): Omit<ContributionState, "loading" | "error"> {
  if (!Array.isArray(value)) throw new Error("Invalid contribution response");
  const entries = value.map(strictEntry);
  const identities = new Set<string>();
  const ids = new Set<string>();
  const routePaths = new Set<string>();
  const componentTokens = new Set<string>();

  for (const { contribution } of entries) {
    const identity = `${contribution.type}:${contribution.id}`;
    if (identities.has(identity) || ids.has(contribution.id)) throw new Error("Duplicate contribution ID");
    identities.add(identity);
    ids.add(contribution.id);
    if (contribution.type === "route") {
      const routePath = canonicalRoutePath(contribution.path);
      if (routePaths.has(routePath)) throw new Error("Duplicate contribution route");
      routePaths.add(routePath);
    }
    if ("component" in contribution) {
      if (componentTokens.has(contribution.component)) throw new Error("Duplicate component token");
      componentTokens.add(contribution.component);
      if (!resolveSystemComponent(contribution.component)) throw new Error("Unknown component token");
    }
    if (contribution.type === "navigation" && !NavigationIdSchema.safeParse(contribution.id).success) {
      throw new Error("Unsupported navigation preference ID");
    }
    if (contribution.type === "navigation" && reservedNavigationIds.has(contribution.id)) {
      throw new Error("Reserved core navigation ID");
    }
    if (contribution.type === "dashboard" && !ModuleIdSchema.safeParse(contribution.id).success) {
      throw new Error("Unsupported dashboard preference ID");
    }
    if (contribution.type === "dashboard" && contribution.id === "profile") {
      throw new Error("Reserved core dashboard ID");
    }
    if (contribution.type === "route" && reservedRoutePaths.has(canonicalRoutePath(contribution.path))) {
      throw new Error("Reserved core route path");
    }
  }

  const navigation: NavigationContribution[] = [];
  const routes: RouteContribution[] = [];
  const dashboardModules: DashboardContribution[] = [];
  const aiTools: AiToolContribution[] = [];
  const settingsSections: SettingsContribution[] = [];

  for (const entry of entries) {
    const contribution = entry.contribution;
    if (contribution.type === "navigation") {
      navigation.push({ ...contribution, id: NavigationIdSchema.parse(contribution.id), pluginId: entry.pluginId });
    } else if (contribution.type === "route") {
      routes.push({ ...contribution, pluginId: entry.pluginId, Component: resolveSystemComponent(contribution.component)! });
    } else if (contribution.type === "dashboard") {
      dashboardModules.push({
        ...contribution,
        id: ModuleIdSchema.parse(contribution.id),
        pluginId: entry.pluginId,
        Component: resolveSystemComponent(contribution.component)!
      });
    } else if (contribution.type === "ai-tool") {
      aiTools.push({ ...contribution, pluginId: entry.pluginId });
    } else {
      settingsSections.push({ ...contribution, pluginId: entry.pluginId, Component: resolveSystemComponent(contribution.component)! });
    }
  }

  navigation.sort(compare);
  routes.sort(compare);
  dashboardModules.sort(compare);
  aiTools.sort(compare);
  settingsSections.sort(compare);
  return { navigation, routes, dashboardModules, aiTools, settingsSections };
}

export function ContributionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ContributionState>({ ...emptyContributions, loading: true });
  const requestGeneration = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setState({ ...emptyContributions, loading: true });
    try {
      const compiled = compilePluginContributions(await api.getPluginContributions(controller.signal));
      if (requestGeneration.current === generation) {
        setState({ ...compiled, loading: false, error: null });
      }
    } catch {
      if (requestGeneration.current === generation) {
        setState({ ...emptyContributions, error: pluginContributionLoadError });
      }
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      requestGeneration.current += 1;
      requestController.current?.abort();
      requestController.current = null;
    };
  }, [refresh]);

  const value = useMemo(() => ({ ...state, refresh }), [refresh, state]);
  return <ContributionContext.Provider value={value}>{children}</ContributionContext.Provider>;
}

export function usePluginContributions(): PluginContributions {
  return useContext(ContributionContext);
}
