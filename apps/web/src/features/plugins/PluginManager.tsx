import type {
  PluginContribution,
  PluginId,
  PluginPermission,
  PluginRuntimeStatus,
  PluginSummary
} from "@workbench/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../app/Icon";
import { api as defaultApi } from "../../lib/api";
import { usePluginContributions } from "../../plugins/ContributionProvider";
import { readPluginPlacements, setPluginPlacement, type PluginPlacementSurface } from "./pluginPlacements";

export interface PluginManagerApi {
  getPlugins(signal?: AbortSignal): Promise<PluginSummary[]>;
  getAiOfficeOrder(): Promise<Array<{ itemId: string; position: number }>>;
  updateAiOfficeOrder(order: Array<{ itemId: string; position: number }>): Promise<Array<{ itemId: string; position: number }>>;
  setPluginEnabled(id: PluginId | string, enabled: boolean, signal?: AbortSignal): Promise<PluginSummary>;
  resetPluginSafeMode(signal?: AbortSignal): Promise<PluginSummary[]>;
}

interface PluginManagerProps {
  api?: PluginManagerApi;
  refreshContributions?: () => Promise<void>;
  kind?: "system" | "third-party";
}

const listError = "系统插件暂时无法读取。其他设置仍可正常使用。";
const toggleError = "无法更改系统插件，请稍后重试。";
const resetError = "无法恢复正常启动，请稍后重试。";
const aiOfficePlacementError = "AI 办公入口暂时无法更新，请稍后重试。";
const failedRecovery = "此功能暂时无法启动。关闭后再重新开启即可重试。";

const permissionLabels: Record<PluginPermission, string> = {
  "storage:own": "保存自己的数据",
  "profile:read": "查看个人资料",
  "profile:write": "管理个人资料",
  "reminders:read": "查看提醒",
  "reminders:write": "管理提醒",
  "ai:use": "使用 AI 功能",
  "mail:send": "发送邮件"
};

const contributionLabels: Record<PluginContribution["type"], string> = {
  navigation: "主导航",
  route: "功能页面",
  dashboard: "工作台卡片",
  "ai-tool": "AI 办公工具",
  settings: "设置内容"
};

const statusLabels: Record<PluginRuntimeStatus, string> = {
  stopped: "已停用",
  starting: "正在启动",
  running: "已启用",
  failed: "启动失败",
  "safe-mode": "安全模式"
};

function contributionSummary(plugin: PluginSummary): string {
  const counts = new Map<PluginContribution["type"], number>();
  for (const contribution of plugin.manifest.contributions) {
    counts.set(contribution.type, (counts.get(contribution.type) ?? 0) + 1);
  }
  return (["navigation", "route", "dashboard", "ai-tool", "settings"] as const)
    .flatMap((type) => {
      const count = counts.get(type);
      return count ? [`${contributionLabels[type]} ${count} 项`] : [];
    })
    .join(" · ") || "没有可见内容";
}

function statusFor(plugin: PluginSummary): string {
  if (!plugin.enabled && plugin.runtimeStatus !== "failed") return statusLabels.stopped;
  return statusLabels[plugin.runtimeStatus];
}

function replacePlugin(items: PluginSummary[], replacement: PluginSummary): PluginSummary[] {
  return items.map((item) => item.manifest.id === replacement.manifest.id ? replacement : item);
}

export function PluginManager({ api = defaultApi, refreshContributions: refreshOverride, kind = "system" }: PluginManagerProps) {
  const contributions = usePluginContributions();
  const refreshContributions = refreshOverride ?? contributions.refresh;
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [aiOfficeOrder, setAiOfficeOrder] = useState<Array<{ itemId: string; position: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState<{ kind: "toggle"; id: string } | { kind: "reset" } | { kind: "ai-office"; id: string; mode: "add" | "remove" } | null>(null);
  const [placements, setPlacements] = useState(() => readPluginPlacements());
  const mounted = useRef(false);
  const listGeneration = useRef(0);
  const mutationGeneration = useRef(0);
  const listController = useRef<AbortController | null>(null);
  const mutationController = useRef<AbortController | null>(null);
  const mutationInFlight = useRef(false);

  const loadPlugins = useCallback(async () => {
    const generation = ++listGeneration.current;
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    if (mounted.current) {
      setLoading(true);
      setFeedback((current) => current === listError ? null : current);
    }
    try {
      const loaded = await api.getPlugins(controller.signal);
      if (mounted.current && listGeneration.current === generation) {
        setPlugins(loaded.filter((plugin) => plugin.manifest.kind === kind));
      }
      try {
        const order = await api.getAiOfficeOrder();
        if (mounted.current && listGeneration.current === generation) setAiOfficeOrder(order);
      } catch {
        if (mounted.current && listGeneration.current === generation) setFeedback(aiOfficePlacementError);
      }
    } catch {
      if (mounted.current && listGeneration.current === generation && !controller.signal.aborted) {
        setFeedback(listError);
      }
    } finally {
      if (mounted.current && listGeneration.current === generation) setLoading(false);
      if (listController.current === controller) listController.current = null;
    }
  }, [api, kind]);

  useEffect(() => {
    mounted.current = true;
    void loadPlugins();
    return () => {
      mounted.current = false;
      listGeneration.current += 1;
      mutationGeneration.current += 1;
      listController.current?.abort();
      mutationController.current?.abort();
      listController.current = null;
      mutationController.current = null;
      mutationInFlight.current = false;
    };
  }, [loadPlugins]);

  async function togglePlugin(plugin: PluginSummary, enabled: boolean) {
    if (plugin.required || mutationInFlight.current) return;
    mutationInFlight.current = true;
    const generation = ++mutationGeneration.current;
    const controller = new AbortController();
    mutationController.current = controller;
    const previous = plugins;
    setFeedback(null);
    setPending({ kind: "toggle", id: plugin.manifest.id });
    setPlugins((current) => replacePlugin(current, {
      ...plugin,
      enabled,
      runtimeStatus: enabled ? "starting" : "stopped",
      errorCode: null
    }));
    try {
      const updated = await api.setPluginEnabled(plugin.manifest.id, enabled, controller.signal);
      if (!mounted.current || mutationGeneration.current !== generation) return;
      setPlugins((current) => replacePlugin(current, updated));
      await refreshContributions();
      if (!mounted.current || mutationGeneration.current !== generation) return;
      await loadPlugins();
    } catch {
      if (mounted.current && mutationGeneration.current === generation && !controller.signal.aborted) {
        setPlugins(previous);
        setFeedback(toggleError);
      }
    } finally {
      if (mutationGeneration.current === generation) {
        mutationInFlight.current = false;
        mutationController.current = null;
        if (mounted.current) setPending(null);
      }
    }
  }

  async function resetSafeMode() {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    const generation = ++mutationGeneration.current;
    const controller = new AbortController();
    mutationController.current = controller;
    const previous = plugins;
    setFeedback(null);
    setPending({ kind: "reset" });
    try {
      const restored = await api.resetPluginSafeMode(controller.signal);
      if (!mounted.current || mutationGeneration.current !== generation) return;
      setPlugins(restored.filter((plugin) => plugin.manifest.kind === kind));
      await refreshContributions();
      if (!mounted.current || mutationGeneration.current !== generation) return;
      await loadPlugins();
    } catch {
      if (mounted.current && mutationGeneration.current === generation && !controller.signal.aborted) {
        setPlugins(previous);
        setFeedback(resetError);
      }
    } finally {
      if (mutationGeneration.current === generation) {
        mutationInFlight.current = false;
        mutationController.current = null;
        if (mounted.current) setPending(null);
      }
    }
  }

  const safeMode = plugins.some((plugin) => plugin.runtimeStatus === "safe-mode");
  const mutationPending = pending !== null;
  function normalizeAiOfficeOrder(ids: string[]) {
    return ids.map((itemId, position) => ({ itemId, position }));
  }
  function placementPath(plugin: PluginSummary): string {
    const contribution = plugin.manifest.contributions.find((item) => item.type === "route" || item.type === "navigation" || item.type === "ai-tool");
    return contribution && "path" in contribution ? contribution.path : "/";
  }
  function togglePlacement(plugin: PluginSummary, surface: PluginPlacementSurface) {
    const path = placementPath(plugin);
    const enabled = !placements.some((item) => item.pluginId === plugin.manifest.id && item.surface === surface);
    setPluginPlacement({ pluginId: plugin.manifest.id, name: plugin.manifest.name, path, surface }, enabled);
    setPlacements(readPluginPlacements());
  }
  async function toggleAiOfficePlacement(plugin: PluginSummary) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    const generation = ++mutationGeneration.current;
    const controller = new AbortController();
    mutationController.current = controller;
    const previousOrder = aiOfficeOrder;
    const cachedIncluded = previousOrder.some((item) => item.itemId === plugin.manifest.id);
    setFeedback(null);
    setPending({ kind: "ai-office", id: plugin.manifest.id, mode: cachedIncluded ? "remove" : "add" });
    try {
      const latestOrder = await api.getAiOfficeOrder();
      if (!mounted.current || mutationGeneration.current !== generation || controller.signal.aborted) return;
      const currentIds = latestOrder
        .slice()
        .sort((left, right) => left.position - right.position)
        .map((item) => item.itemId);
      const nextIds = cachedIncluded
        ? currentIds.filter((itemId) => itemId !== plugin.manifest.id)
        : currentIds.includes(plugin.manifest.id) ? currentIds : [...currentIds, plugin.manifest.id];
      const nextOrder = normalizeAiOfficeOrder(nextIds);
      setAiOfficeOrder(nextOrder);
      const saved = await api.updateAiOfficeOrder(nextOrder);
      if (!mounted.current || mutationGeneration.current !== generation || controller.signal.aborted) return;
      setAiOfficeOrder(saved);
    } catch {
      if (mounted.current && mutationGeneration.current === generation && !controller.signal.aborted) {
        setAiOfficeOrder(previousOrder);
        setFeedback(aiOfficePlacementError);
      }
    } finally {
      if (mutationGeneration.current === generation) {
        mutationInFlight.current = false;
        mutationController.current = null;
        if (mounted.current) setPending(null);
      }
    }
  }

  return (
    <section className="plugin-manager" aria-labelledby="system-plugins-heading" aria-busy={loading || mutationPending}>
      <div className="settings-section-heading">
        <div className="card-icon"><Icon name="grid" /></div>
        <div><h3 id={`${kind}-plugins-heading`}>{kind === "system" ? "系统插件" : "第三方插件"}</h3><p>{kind === "system" ? "管理工作台自带功能。停用后，对应入口和卡片会暂时隐藏。" : "管理已安装的扩展功能。停用后，对应入口和卡片会暂时隐藏。"}</p></div>
      </div>

      {safeMode && (
        <aside className="plugin-safe-mode" aria-labelledby="plugin-safe-mode-heading">
          <div><h4 id="plugin-safe-mode-heading">安全模式</h4><p>为保证工作台可以打开，可选工具已暂时停用。你的其他设置仍可正常使用。</p></div>
          <button className="button-secondary" type="button" disabled={mutationPending} onClick={() => void resetSafeMode()}>
            {pending?.kind === "reset" ? "正在尝试…" : "重新尝试正常启动"}
          </button>
        </aside>
      )}

      {feedback && <p className="feedback-banner" role="alert">{feedback}</p>}
      {loading && plugins.length === 0 && <p role="status">正在读取系统插件…</p>}

      <div className="plugin-list">
        {plugins.map((plugin) => {
          const permissionText = plugin.manifest.permissions.map((permission) => permissionLabels[permission]).join(" · ");
          const descriptionId = `plugin-description-${plugin.manifest.id.replaceAll(".", "-")}`;
          return (
            <article className="plugin-card" aria-label={plugin.manifest.name} key={plugin.manifest.id}>
              <div className="plugin-card-main">
                <div className="plugin-card-title">
                  <h4>{plugin.manifest.name}</h4>
                  <span className={`status-chip ${plugin.runtimeStatus === "failed" ? "plugin-status-failed" : plugin.enabled ? "" : "neutral"}`}>{statusFor(plugin)}</span>
                </div>
                <p id={descriptionId}>{contributionSummary(plugin)}</p>
                {permissionText && <p className="plugin-permissions"><strong>可以使用：</strong>{permissionText}</p>}
                {plugin.runtimeStatus === "failed" && <p className="plugin-recovery">{failedRecovery}</p>}
                {plugin.required && <p className="plugin-required">基础功能，始终保持启用</p>}
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  aria-label={`启用 ${plugin.manifest.name}`}
                  aria-describedby={descriptionId}
                  checked={plugin.enabled}
                  disabled={plugin.required || mutationPending}
                  onChange={(event) => void togglePlugin(plugin, event.target.checked)}
                />
                <span aria-hidden="true" />
              </label>
              {plugin.enabled && (
                <div className="plugin-placement-actions">
                  <button type="button" className="button-secondary compact" onClick={() => togglePlacement(plugin, "dashboard")}>
                    {placements.some((item) => item.pluginId === plugin.manifest.id && item.surface === "dashboard") ? "从主页移除" : "添加到我的主页"}
                  </button>
                  <button
                    type="button"
                    className="button-secondary compact"
                    disabled={mutationPending}
                    onClick={() => void toggleAiOfficePlacement(plugin)}
                  >
                    {pending?.kind === "ai-office" && pending.id === plugin.manifest.id
                      ? pending.mode === "add"
                        ? "正在添加到 AI 办公…"
                        : "正在从 AI 办公移除…"
                      : aiOfficeOrder.some((item) => item.itemId === plugin.manifest.id)
                        ? "从 AI 办公移除"
                        : "添加到 AI 办公"}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
