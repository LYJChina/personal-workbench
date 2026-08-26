import type { AiOfficeOrder, PluginSummary, SurfaceLayoutItem } from "@workbench/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../app/Icon";
import { api } from "../../lib/api";
import { usePluginContributions } from "../../plugins/ContributionProvider";
import { FixedPluginGrid, type AiOfficeCard } from "./FixedPluginGrid";

const legacyLayoutKey = "lyj.ai-office.layout";
const legacyPlacementsKey = "lyj.plugin-placements.v1";
const loadErrorText = "AI 办公暂时无法加载，请稍后重试。";
const saveErrorText = "AI 办公顺序暂时无法保存，请稍后重试。";
const supportedIcons = ["home", "sparkles", "bell", "lock", "settings", "edit", "arrow", "user", "copy", "file", "palette", "mail", "check", "grid", "clock"] as const;

interface LegacyPlacement {
  pluginId: string;
  name: string;
  path: string;
  surface: "dashboard" | "ai-office";
}

function iconName(value: string): typeof supportedIcons[number] {
  return supportedIcons.includes(value as typeof supportedIcons[number]) ? value as typeof supportedIcons[number] : "grid";
}

function preferredPath(contributions: PluginSummary["manifest"]["contributions"]): string {
  const match = contributions.find((contribution) => contribution.type === "route" || contribution.type === "navigation");
  return match && "path" in match ? match.path : "/plugins";
}

function buildCard(plugin: PluginSummary, aiTool: ReturnType<typeof usePluginContributions>["aiTools"][number] | undefined): AiOfficeCard {
  return {
    pluginId: plugin.manifest.id,
    label: aiTool?.label ?? plugin.manifest.name,
    description: aiTool?.description ?? "插件快捷入口",
    path: aiTool?.path ?? preferredPath(plugin.manifest.contributions),
    icon: aiTool?.icon ?? "grid"
  };
}

function readLegacyLayout(): SurfaceLayoutItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(legacyLayoutKey) ?? "null") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is SurfaceLayoutItem => Boolean(item && typeof item === "object" && "itemId" in item && "surface" in item && "x" in item && "y" in item && "w" in item && "h" in item && "enabled" in item)) : [];
  } catch {
    return [];
  }
}

function readLegacyPlacements(): LegacyPlacement[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(legacyPlacementsKey) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is LegacyPlacement => Boolean(item && typeof item === "object" && "pluginId" in item && "name" in item && "path" in item && "surface" in item)) : [];
  } catch {
    return [];
  }
}

function clearLegacyKeysAfterMigration() {
  localStorage.removeItem(legacyLayoutKey);
  const preserved = readLegacyPlacements().filter((item) => item.surface !== "ai-office");
  if (preserved.length === 0) localStorage.removeItem(legacyPlacementsKey);
  else localStorage.setItem(legacyPlacementsKey, JSON.stringify(preserved));
}

function moveItem(items: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function orderFromIds(ids: string[]): AiOfficeOrder {
  return ids.map((itemId, position) => ({ itemId, position }));
}

function sameIds(left: string[] | null, right: string[]): boolean {
  if (left === null || left.length !== right.length) return false;
  return left.every((itemId, index) => itemId === right[index]);
}

function normalizeOrderIds(order: AiOfficeOrder, availableIds: Set<string>): string[] {
  return order
    .slice()
    .sort((left, right) => left.position - right.position)
    .map((item) => item.itemId)
    .filter((itemId, index, items) => availableIds.has(itemId) && items.indexOf(itemId) === index);
}

function migrateAiOfficeIds(
  aiTools: ReturnType<typeof usePluginContributions>["aiTools"],
  enabledPluginIds: Set<string>
): string[] {
  const toolPluginIds = new Map(aiTools.map((tool) => [tool.id, tool.pluginId]));
  const fromLayout = readLegacyLayout()
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .filter(({ item }) => item.surface === "ai-office" && item.enabled)
    .sort((left, right) => left.item.y - right.item.y || left.item.x - right.item.x || left.sourceIndex - right.sourceIndex)
    .map(({ item }) => toolPluginIds.get(item.itemId))
    .filter((pluginId): pluginId is string => Boolean(pluginId && enabledPluginIds.has(pluginId)))
    .filter((pluginId, index, items) => items.indexOf(pluginId) === index);
  const migrated = [...fromLayout];
  for (const placement of readLegacyPlacements()) {
    if (placement.surface !== "ai-office") continue;
    if (!enabledPluginIds.has(placement.pluginId)) continue;
    if (!migrated.includes(placement.pluginId)) migrated.push(placement.pluginId);
  }
  return migrated;
}

export function AiOfficePage() {
  const { aiTools, loading: contributionsLoading } = usePluginContributions();
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [persistedOrder, setPersistedOrder] = useState<AiOfficeOrder | null>(null);
  const [draftIds, setDraftIds] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const migrationAttempted = useRef(false);

  const aiToolsByPluginId = useMemo(() => new Map(aiTools.map((tool) => [tool.pluginId, tool])), [aiTools]);
  const enabledPlugins = useMemo(() => plugins.filter((plugin) => plugin.enabled), [plugins]);
  const cardsByPluginId = useMemo(() => new Map(enabledPlugins.map((plugin) => [plugin.manifest.id, buildCard(plugin, aiToolsByPluginId.get(plugin.manifest.id))])), [aiToolsByPluginId, enabledPlugins]);
  const availableIds = useMemo(() => new Set(cardsByPluginId.keys()), [cardsByPluginId]);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    migrationAttempted.current = false;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setDraftIds(null);
    void Promise.all([api.getPlugins(controller.signal), api.getAiOfficeOrder()])
      .then(([loadedPlugins, order]) => {
        if (requestGeneration.current !== generation) return;
        setPlugins(loadedPlugins.filter((plugin) => plugin.enabled));
        setPersistedOrder(order);
      })
      .catch(() => {
        if (requestGeneration.current !== generation || controller.signal.aborted) return;
        setLoadError(loadErrorText);
      })
      .finally(() => {
        if (requestGeneration.current === generation) setLoading(false);
      });
    return () => {
      controller.abort();
      requestGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    if (loading || contributionsLoading || persistedOrder === null || editing) return;
    const generation = requestGeneration.current;
    const normalized = normalizeOrderIds(persistedOrder, availableIds);
    if (persistedOrder.length > 0) {
      clearLegacyKeysAfterMigration();
      setDraftIds((current) => sameIds(current, normalized) ? current : normalized);
      migrationAttempted.current = true;
      return;
    }
    if (migrationAttempted.current) {
      setDraftIds((current) => current ?? []);
      return;
    }
    migrationAttempted.current = true;
    const migratedIds = migrateAiOfficeIds(aiTools, availableIds);
    if (migratedIds.length === 0) {
      setDraftIds([]);
      return;
    }
    setMigrating(true);
    void api.updateAiOfficeOrder(orderFromIds(migratedIds))
      .then((savedOrder) => {
        if (requestGeneration.current !== generation) return;
        clearLegacyKeysAfterMigration();
        setPersistedOrder(savedOrder);
        setDraftIds((current) => {
          const normalizedSaved = normalizeOrderIds(savedOrder, availableIds);
          return sameIds(current, normalizedSaved) ? current : normalizedSaved;
        });
      })
      .catch(() => {
        if (requestGeneration.current !== generation) return;
        setLoadError(loadErrorText);
        setDraftIds([]);
      })
      .finally(() => {
        if (requestGeneration.current === generation) setMigrating(false);
      });
  }, [aiTools, availableIds, contributionsLoading, editing, loading, persistedOrder]);

  const orderedIds = editing ? draftIds ?? [] : persistedOrder ? normalizeOrderIds(persistedOrder, availableIds) : [];
  const orderedCards = orderedIds.map((pluginId) => cardsByPluginId.get(pluginId)).filter((card): card is AiOfficeCard => Boolean(card));
  const addableCards = enabledPlugins
    .filter((plugin) => !orderedIds.includes(plugin.manifest.id))
    .map((plugin) => cardsByPluginId.get(plugin.manifest.id))
    .filter((card): card is AiOfficeCard => Boolean(card));

  async function finishEditing() {
    if (draftIds === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      const savedOrder = await api.updateAiOfficeOrder(orderFromIds(draftIds.filter((pluginId) => availableIds.has(pluginId))));
      setPersistedOrder(savedOrder);
      setDraftIds(normalizeOrderIds(savedOrder, availableIds));
      setEditing(false);
    } catch {
      setSaveError(saveErrorText);
    } finally {
      setSaving(false);
    }
  }

  const busy = loading || contributionsLoading || migrating;

  return (
    <section className="ai-office-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">AI OFFICE</span>
          <h2>AI 办公</h2>
          <p>把重复的文字工作交给 AI，把时间留给更重要的事情。</p>
        </div>
        <button
          className="button-secondary"
          type="button"
          disabled={busy || saving}
          onClick={() => {
            if (editing) {
              void finishEditing();
              return;
            }
            setSaveError(null);
            setDraftIds(orderedIds);
            setEditing(true);
          }}
        >
          {editing ? "完成编辑" : "编辑工具"}
        </button>
      </header>

      {saveError && <p className="feedback-banner error" role="alert">{saveError}</p>}

      {busy ? (
        <div className="page-loading" role="status">
          <span className="spinner" />
          正在准备 AI 办公…
        </div>
      ) : loadError ? (
        <div className="empty-state" role="alert">
          <strong>{loadErrorText}</strong>
          <span>请稍后重试。</span>
        </div>
      ) : orderedCards.length > 0 || editing ? (
        <>
          <FixedPluginGrid
            items={orderedCards}
            editing={editing}
            onMove={(from, to) => {
              if (!editing || draftIds === null) return;
              setDraftIds((current) => current ? moveItem(current, from, to) : current);
            }}
            onRemove={(pluginId) => {
              if (!editing) return;
              setDraftIds((current) => current ? current.filter((itemId) => itemId !== pluginId) : current);
            }}
          />

          {editing && addableCards.length > 0 && (
            <section className="ai-office-additions" aria-label="可添加插件">
              <h3>可添加插件</h3>
              <ul className="ai-office-additions-list">
                {addableCards.map((card) => (
                  <li className="ai-office-addition-card" key={card.pluginId}>
                    <div className="ai-fixed-card-main">
                      <span className="tool-icon">
                        <Icon name={iconName(card.icon)} size={24} />
                      </span>
                      <span className="tool-content">
                        <strong>{card.label}</strong>
                        <span>{card.description}</span>
                      </span>
                    </div>
                    <button
                      className="button-secondary compact"
                      type="button"
                      onClick={() => setDraftIds((current) => current ? [...current, card.pluginId] : [card.pluginId])}
                    >
                      {`添加到 AI 办公 ${card.label}`}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <div className="empty-state">
          <strong>AI 办公还是空的</strong>
          <span>进入编辑后，把已启用插件添加到这里。</span>
        </div>
      )}

      <aside className="ai-office-note" aria-label="可用工具说明">
        <Icon name="lock" size={15} />
        <span>
          <strong>可用工具</strong>
          <small>所有输入通过本机服务处理，API Key 保存在本地加密保险库中。</small>
        </span>
      </aside>
    </section>
  );
}
