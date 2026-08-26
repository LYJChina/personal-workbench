export type PluginPlacementSurface = "dashboard" | "ai-office";
export interface PluginPlacement { pluginId: string; name: string; path: string; surface: PluginPlacementSurface; }
const storageKey = "lyj.plugin-placements.v1";
export const placementEvent = "lyj:plugin-placements";

export function readPluginPlacements(): PluginPlacement[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PluginPlacement => Boolean(item && typeof item === "object" && "pluginId" in item && "name" in item && "path" in item && "surface" in item));
  } catch { return []; }
}

export function setPluginPlacement(placement: PluginPlacement, enabled: boolean): void {
  const current = readPluginPlacements().filter((item) => !(item.pluginId === placement.pluginId && item.surface === placement.surface));
  if (enabled) current.push(placement);
  localStorage.setItem(storageKey, JSON.stringify(current));
  window.dispatchEvent(new Event(placementEvent));
}
