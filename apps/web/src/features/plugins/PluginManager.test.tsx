import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PluginSummary } from "@workbench/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginManager, type PluginManagerApi } from "./PluginManager";

function summary(overrides: Partial<PluginSummary> & { id: string; name: string }): PluginSummary {
  const manifest = {
    manifestVersion: 1 as const,
    id: overrides.id as PluginSummary["manifest"]["id"],
    name: overrides.name,
    version: "1.0.0",
    author: "LYJ Workbench",
    kind: "system" as const,
    platforms: ["win32", "darwin"] as ("win32" | "darwin")[],
    permissions: ["ai:use"] as PluginSummary["manifest"]["permissions"],
    contributions: [{
      type: "dashboard" as const,
      id: "sample-card",
      title: "示例卡片",
      component: "system.sample.dashboard",
      minW: 4,
      minH: 5
    }],
    ...overrides.manifest
  };
  return {
    enabled: true,
    required: false,
    runtimeStatus: "running",
    permissionsGranted: ["ai:use"],
    errorCode: null,
    ...overrides,
    manifest
  };
}

const running = summary({ id: "lyj.system.ai-chat", name: "大模型对话" });
const stopped = summary({
  id: "lyj.system.ai-polish",
  name: "AI 润色",
  enabled: false,
  runtimeStatus: "stopped",
  permissionsGranted: [],
  manifest: {
    manifestVersion: 1,
    id: "lyj.system.ai-polish",
    name: "AI 润色",
    version: "1.0.0",
    author: "LYJ Workbench",
    kind: "system",
    platforms: ["win32", "darwin"],
    permissions: ["ai:use"],
    contributions: [
      { type: "route", id: "polish-page", path: "/ai-office/polish", component: "system.ai-polish.page" },
      { type: "ai-tool", id: "polish", label: "AI 润色", description: "润色文字", path: "/ai-office/polish", icon: "sparkles", position: 10 }
    ]
  }
});
const failed = summary({
  id: "lyj.system.reminders",
  name: "提醒事项",
  runtimeStatus: "failed",
  errorCode: "PLUGIN_START_FAILED",
  manifest: {
    manifestVersion: 1,
    id: "lyj.system.reminders",
    name: "提醒事项",
    version: "1.0.0",
    author: "LYJ Workbench",
    kind: "system",
    platforms: ["win32", "darwin"],
    permissions: ["reminders:read", "reminders:write", "mail:send"],
    contributions: [
      { type: "navigation", id: "reminders", label: "提醒事项", path: "/reminders", icon: "bell", position: 20 },
      { type: "route", id: "reminders-page", path: "/reminders", component: "system.reminders.page" },
      { type: "dashboard", id: "upcoming-reminders", title: "近期提醒", component: "system.reminders.dashboard", minW: 4, minH: 5 }
    ]
  },
  permissionsGranted: ["reminders:read", "reminders:write", "mail:send"]
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function createApi(items: PluginSummary[] = [running, stopped, failed]): PluginManagerApi {
  return {
    getPlugins: vi.fn().mockResolvedValue(items),
    setPluginEnabled: vi.fn().mockImplementation(async (_id, enabled) => ({ ...running, enabled, runtimeStatus: enabled ? "running" : "stopped" })),
    resetPluginSafeMode: vi.fn().mockResolvedValue(items),
    getAiOfficeOrder: vi.fn().mockResolvedValue([]),
    updateAiOfficeOrder: vi.fn().mockImplementation(async (order) => order)
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("PluginManager", () => {
  it("shows exact system plugin names, statuses, contribution summaries, and curated permissions only", async () => {
    const required = summary({ id: "lyj.system.required", name: "基础服务", required: true });
    render(<PluginManager api={createApi([running, stopped, failed, required])} refreshContributions={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "系统插件" })).toBeVisible();
    const chat = screen.getByRole("article", { name: "大模型对话" });
    expect(within(chat).getByText("已启用")).toBeVisible();
    expect(within(chat).getByText("工作台卡片 1 项")).toBeVisible();
    expect(within(chat).getByText("使用 AI 功能")).toBeVisible();
    expect(within(screen.getByRole("article", { name: "AI 润色" })).getByText("已停用")).toBeVisible();
    expect(within(screen.getByRole("article", { name: "AI 润色" })).getByText("功能页面 1 项 · AI 办公工具 1 项")).toBeVisible();
    const reminder = screen.getByRole("article", { name: "提醒事项" });
    expect(within(reminder).getByText("启动失败")).toBeVisible();
    expect(within(reminder).getByText("此功能暂时无法启动。关闭后再重新开启即可重试。")).toBeVisible();
    expect(within(reminder).getByText("查看提醒 · 管理提醒 · 发送邮件")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "启用 大模型对话" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "启用 AI 润色" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "启用 基础服务" })).toBeDisabled();
    expect(screen.getByText("基础功能，始终保持启用")).toBeVisible();
    expect(document.body).not.toHaveTextContent(/ai:use|reminders:read|PLUGIN_START_FAILED|lyj\.system|manifestVersion/);
    expect(screen.queryByRole("button", { name: /卸载|安装|更新|配额|批准|授权/ })).not.toBeInTheDocument();
  });

  it("disables relevant controls, submits once, refreshes contributions in place, then refreshes the list", async () => {
    const toggle = deferred<PluginSummary>();
    const refreshed = { ...running, enabled: false, runtimeStatus: "stopped" as const };
    const calls: string[] = [];
    const api = createApi([running]);
    vi.mocked(api.getPlugins)
      .mockImplementationOnce(async () => { calls.push("list-initial"); return [running]; })
      .mockImplementationOnce(async () => { calls.push("list-after"); return [refreshed]; });
    vi.mocked(api.setPluginEnabled).mockImplementation((_id, _enabled, signal) => {
      calls.push("toggle");
      expect(signal).toBeInstanceOf(AbortSignal);
      return toggle.promise;
    });
    const refreshContributions = vi.fn(async () => { calls.push("contributions"); });
    render(<PluginManager api={api} refreshContributions={refreshContributions} />);
    const control = await screen.findByRole("checkbox", { name: "启用 大模型对话" });

    fireEvent.click(control);
    fireEvent.click(control);

    expect(control).not.toBeChecked();
    expect(control).toBeDisabled();
    expect(api.setPluginEnabled).toHaveBeenCalledTimes(1);
    expect(api.setPluginEnabled).toHaveBeenCalledWith("lyj.system.ai-chat", false, expect.any(AbortSignal));
    toggle.resolve(refreshed);
    await waitFor(() => expect(api.getPlugins).toHaveBeenCalledTimes(2));
    expect(calls).toEqual(["list-initial", "toggle", "contributions", "list-after"]);
    expect(control).not.toBeChecked();
    expect(control).toBeEnabled();
  });

  it("rolls a failed toggle back and shows only the fixed recoverable error", async () => {
    const toggle = deferred<PluginSummary>();
    const api = createApi([running]);
    vi.mocked(api.setPluginEnabled).mockReturnValue(toggle.promise);
    render(<PluginManager api={api} refreshContributions={vi.fn()} />);
    const control = await screen.findByRole("checkbox", { name: "启用 大模型对话" });

    fireEvent.click(control);
    expect(control).not.toBeChecked();
    toggle.reject(new Error("SQLITE_BUSY at installed_plugins.stack"));

    expect(await screen.findByRole("alert")).toHaveTextContent("无法更改系统插件，请稍后重试。");
    expect(control).toBeChecked();
    expect(document.body).not.toHaveTextContent(/SQLITE_BUSY|installed_plugins|stack/);
  });

  it("explains safe mode and rolls back a failed, duplicate-safe reset", async () => {
    const paused = summary({ id: "lyj.system.ai-chat", name: "大模型对话", runtimeStatus: "safe-mode" });
    const reset = deferred<PluginSummary[]>();
    const api = createApi([paused]);
    vi.mocked(api.resetPluginSafeMode).mockReturnValue(reset.promise);
    render(<PluginManager api={api} refreshContributions={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "安全模式" })).toBeVisible();
    expect(screen.getByText("为保证工作台可以打开，可选工具已暂时停用。你的其他设置仍可正常使用。")).toBeVisible();
    const button = screen.getByRole("button", { name: "重新尝试正常启动" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "启用 大模型对话" })).toBeDisabled();
    expect(api.resetPluginSafeMode).toHaveBeenCalledTimes(1);
    expect(api.resetPluginSafeMode).toHaveBeenCalledWith(expect.any(AbortSignal));

    reset.reject(new Error("raw reset stack"));
    expect(await screen.findByRole("alert")).toHaveTextContent("无法恢复正常启动，请稍后重试。");
    expect(screen.getByRole("heading", { name: "安全模式" })).toBeVisible();
    expect(button).toBeEnabled();
    expect(document.body).not.toHaveTextContent("raw reset stack");
  });

  it("refreshes contributions and the plugin list after a successful safe-mode reset", async () => {
    const paused = summary({ id: "lyj.system.ai-chat", name: "大模型对话", runtimeStatus: "safe-mode" });
    const restored = { ...paused, runtimeStatus: "running" as const };
    const calls: string[] = [];
    const api = createApi([paused]);
    vi.mocked(api.getPlugins)
      .mockImplementationOnce(async () => { calls.push("list-initial"); return [paused]; })
      .mockImplementationOnce(async () => { calls.push("list-after"); return [restored]; });
    vi.mocked(api.resetPluginSafeMode).mockImplementation(async () => { calls.push("reset"); return [restored]; });
    const refreshContributions = vi.fn(async () => { calls.push("contributions"); });
    render(<PluginManager api={api} refreshContributions={refreshContributions} />);

    fireEvent.click(await screen.findByRole("button", { name: "重新尝试正常启动" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "安全模式" })).not.toBeInTheDocument());
    expect(calls).toEqual(["list-initial", "reset", "contributions", "list-after"]);
    expect(screen.getByText("已启用")).toBeVisible();
  });

  it("keeps the newest list response authoritative and aborts the superseded request", async () => {
    const first = deferred<PluginSummary[]>();
    let firstSignal: AbortSignal | undefined;
    const apiA = createApi();
    vi.mocked(apiA.getPlugins).mockImplementation((signal) => { firstSignal = signal; return first.promise; });
    const apiB = createApi([stopped]);
    const view = render(<PluginManager api={apiA} refreshContributions={vi.fn()} />);

    view.rerender(<PluginManager api={apiB} refreshContributions={vi.fn()} />);
    expect(await screen.findByText("AI 润色")).toBeVisible();
    expect(firstSignal?.aborted).toBe(true);
    first.resolve([running]);
    await Promise.resolve();
    expect(screen.queryByText("大模型对话")).not.toBeInTheDocument();
  });

  it("aborts in-flight work on unmount and ignores its later settlement", async () => {
    const toggle = deferred<PluginSummary>();
    let toggleSignal: AbortSignal | undefined;
    const api = createApi([running]);
    vi.mocked(api.setPluginEnabled).mockImplementation((_id, _enabled, signal) => { toggleSignal = signal; return toggle.promise; });
    const view = render(<PluginManager api={api} refreshContributions={vi.fn()} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "启用 大模型对话" }));

    view.unmount();
    expect(toggleSignal?.aborted).toBe(true);
    toggle.resolve({ ...running, enabled: false, runtimeStatus: "stopped" });
    await Promise.resolve();
  });

  it("keeps the section available with fixed copy when the plugin list cannot load", async () => {
    const api = createApi();
    vi.mocked(api.getPlugins).mockRejectedValue(new Error("SELECT manifest_json FROM installed_plugins"));
    render(<PluginManager api={api} refreshContributions={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("系统插件暂时无法读取。其他设置仍可正常使用。");
    expect(document.body).not.toHaveTextContent(/SELECT|manifest_json|installed_plugins/);
  });

  it("reads and updates the database-backed AI Office order while preserving dashboard placement storage", async () => {
    localStorage.setItem("lyj.plugin-placements.v1", JSON.stringify([
      { pluginId: running.manifest.id, name: running.manifest.name, path: "/", surface: "dashboard" }
    ]));
    const pluginWithRoute = summary({
      id: "lyj.system.ai-chat",
      name: "大模型对话",
      manifest: {
        ...running.manifest,
        contributions: [
          { type: "route", id: "chat-page", path: "/ai-office/chat", component: "system.ai-chat.page" }
        ]
      }
    });
    const api = createApi([pluginWithRoute]) as PluginManagerApi & {
      getAiOfficeOrder: ReturnType<typeof vi.fn>;
      updateAiOfficeOrder: ReturnType<typeof vi.fn>;
    };
    const user = userEvent.setup();
    vi.mocked(api.getAiOfficeOrder)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ itemId: "lyj.plugin.newer", position: 0 }]);
    render(<PluginManager api={api} refreshContributions={vi.fn()} />);

    const article = await screen.findByRole("article", { name: "大模型对话" });
    await user.click(within(article).getByRole("button", { name: "添加到 AI 办公" }));

    expect(api.getAiOfficeOrder).toHaveBeenCalledTimes(2);
    expect(api.updateAiOfficeOrder).toHaveBeenCalledWith([
      { itemId: "lyj.plugin.newer", position: 0 },
      { itemId: pluginWithRoute.manifest.id, position: 1 }
    ]);
    expect(JSON.parse(localStorage.getItem("lyj.plugin-placements.v1") ?? "[]")).toEqual([
      { pluginId: running.manifest.id, name: running.manifest.name, path: "/", surface: "dashboard" }
    ]);

    await user.click(screen.getByRole("button", { name: "从主页移除" }));
    expect(JSON.parse(localStorage.getItem("lyj.plugin-placements.v1") ?? "[]")).toEqual([]);
  });

  it("keeps lifecycle controls available when only AI Office order loading fails", async () => {
    const api = createApi();
    vi.mocked(api.getAiOfficeOrder).mockRejectedValue(new Error("SQLITE_BUSY"));

    render(<PluginManager api={api} refreshContributions={vi.fn()} />);

    expect(await screen.findByRole("article", { name: "大模型对话" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "启用 大模型对话" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("AI 办公入口暂时无法更新，请稍后重试。");
    expect(document.body).not.toHaveTextContent("SQLITE_BUSY");
  });

  it("applies the visible add intent idempotently when a fresh order already contains the plugin", async () => {
    const api = createApi() as PluginManagerApi & {
      getAiOfficeOrder: ReturnType<typeof vi.fn>;
      updateAiOfficeOrder: ReturnType<typeof vi.fn>;
    };
    vi.mocked(api.getAiOfficeOrder)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ itemId: running.manifest.id, position: 0 }]);
    const user = userEvent.setup();
    render(<PluginManager api={api} refreshContributions={vi.fn()} />);

    const article = await screen.findByRole("article", { name: "大模型对话" });
    await user.click(within(article).getByRole("button", { name: "添加到 AI 办公" }));

    expect(api.updateAiOfficeOrder).toHaveBeenCalledWith([{ itemId: running.manifest.id, position: 0 }]);
  });

  it("prevents duplicate AI Office placement mutations and shows fixed Chinese feedback on failure", async () => {
    const placement = deferred<Array<{ itemId: string; position: number }>>();
    const pluginWithRoute = summary({
      id: "lyj.system.ai-chat",
      name: "大模型对话",
      manifest: {
        ...running.manifest,
        contributions: [
          { type: "route", id: "chat-page", path: "/ai-office/chat", component: "system.ai-chat.page" }
        ]
      }
    });
    const api = createApi([pluginWithRoute]) as PluginManagerApi & {
      getAiOfficeOrder: ReturnType<typeof vi.fn>;
      updateAiOfficeOrder: ReturnType<typeof vi.fn>;
    };
    vi.mocked(api.updateAiOfficeOrder).mockReturnValue(placement.promise);
    const user = userEvent.setup();
    render(<PluginManager api={api} refreshContributions={vi.fn()} />);

    const button = await screen.findByRole("button", { name: "添加到 AI 办公" });
    await user.click(button);
    await user.click(button);

    expect(api.updateAiOfficeOrder).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "正在添加到 AI 办公…" })).toBeDisabled();

    placement.reject(new Error("SQLITE_BUSY"));
    expect(await screen.findByRole("alert")).toHaveTextContent("AI 办公入口暂时无法更新，请稍后重试。");
    expect(document.body).not.toHaveTextContent("SQLITE_BUSY");
  });
});
