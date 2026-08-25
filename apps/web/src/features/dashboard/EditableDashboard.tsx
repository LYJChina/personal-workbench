import { useEffect, useMemo, useState } from "react";
import type { DashboardLayout } from "@workbench/contracts";
import { createModuleRegistry, type ModuleDefinition } from "./moduleRegistry";
import { dailyQuote } from "./dailyQuotes";
import { Icon } from "../../app/Icon";
import { usePluginContributions } from "../../plugins/ContributionProvider";
import { EditableSurfaceGrid } from "../layout/EditableSurfaceGrid";

interface EditableDashboardProps {
  initialLayout: DashboardLayout[];
  onSave: (layout: DashboardLayout[]) => Promise<void>;
  now?: Date;
}

export function mergeDashboardLayout(layout: DashboardLayout[], registry: Partial<Record<DashboardLayout["moduleId"], ModuleDefinition>>, contributionIds: DashboardLayout["moduleId"][] = []): DashboardLayout[] {
  const known = new Set(layout.map((item) => item.moduleId));
  const definitions: ModuleDefinition[] = [];
  for (const id of contributionIds) {
    const definition = registry[id];
    if (definition && !known.has(definition.id)) definitions.push(definition);
  }
  const additions = definitions.map((definition, index) => ({
    moduleId: definition.id,
    x: (index % 2) * 8,
    y: Math.floor(index / 2) * 5,
    w: Math.max(4, definition.minW),
    h: definition.minH,
    enabled: true
  }));
  return [...layout, ...additions];
}

export function EditableDashboard({ initialLayout, onSave, now }: EditableDashboardProps) {
  const { dashboardModules } = usePluginContributions();
  const registry = useMemo(() => createModuleRegistry(dashboardModules), [dashboardModules]);
  const [layout, setLayout] = useState(initialLayout);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState(() => now ?? new Date());
  const contributionIds = dashboardModules.map((module) => module.id);
  const effectiveLayout = useMemo(() => mergeDashboardLayout(layout, registry, contributionIds), [contributionIds, layout, registry]);

  useEffect(() => {
    if (now) {
      setCurrentDate(now);
      return;
    }
    const timer = window.setInterval(() => setCurrentDate(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [now]);

  useEffect(() => {
    if (!editing) setLayout(initialLayout);
  }, [editing, initialLayout]);

  async function finishEditing() {
    setSaving(true);
    setError(null);
    try {
      await onSave(effectiveLayout);
      setLayout(effectiveLayout);
      setEditing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "工作台保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  const quote = dailyQuote(now ?? currentDate);
  const surfaceItems = effectiveLayout.filter((item) => registry[item.moduleId]).map((item) => ({ ...item, itemId: item.moduleId, surface: "dashboard" as const }));

  return (
    <section aria-label="工作台" className="dashboard-page">
      <div className="dashboard-toolbar page-heading">
        <div className="dashboard-daily-quote"><p>{quote.text}</p><cite>——{quote.author}</cite></div>
        {editing
          ? <button className="button-primary" type="button" disabled={saving} onClick={() => void finishEditing()}><Icon name="check" size={17} />完成编辑</button>
          : <button className="button-secondary" type="button" onClick={() => { setError(null); setEditing(true); }}><Icon name="edit" size={17} />编辑工作台</button>}
      </div>
      {error && <p role="alert">{error}</p>}
      {editing && <div className="info-banner" role="status"><Icon name="grid" size={18} />拖动卡片调整位置，拖拽右下角调整大小。</div>}
      <EditableSurfaceGrid testId="dashboard-grid" className="dashboard-grid" surface="dashboard" items={surfaceItems} editing={editing} onLayoutChange={(next) => setLayout((current) => mergeDashboardLayout(current, registry, contributionIds).map((item) => {
          const changed = next.find((candidate) => candidate.itemId === item.moduleId);
          return changed ? { ...item, x: changed.x, y: changed.y, w: changed.w, h: changed.h } : item;
        }))} renderItem={(item) => <div className="dashboard-module">{registry[item.itemId as DashboardLayout["moduleId"]]!.render()}</div>} />
    </section>
  );
}
