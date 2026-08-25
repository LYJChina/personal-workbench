import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardLayout, NavigationItem } from "@workbench/contracts";
import { App } from "../app/App";
import { Sidebar } from "../app/Sidebar";
import { AiOfficePage } from "../features/ai-office/AiOfficePage";
import { EditableDashboard } from "../features/dashboard/EditableDashboard";
import { ContributionProvider, usePluginContributions } from "./ContributionProvider";
import { PluginRoutes } from "./PluginRoutes";

type ContributionEntry = {
  pluginId: string;
  contribution: Record<string, unknown>;
};

const navigation: NavigationItem[] = [
  { id: "home", label: "我的主页", path: "/", position: 0, visible: true, disabled: false },
  { id: "ai-office", label: "AI 办公", path: "/ai-office", position: 1, visible: true, disabled: false },
  { id: "reminders", label: "提醒事项", path: "/reminders", position: 2, visible: true, disabled: false },
  { id: "vault-coming-soon", label: "密码保险箱", path: "/vault", position: 3, visible: true, disabled: true },
  { id: "settings", label: "设置", path: "/settings", position: 4, visible: true, disabled: false }
];

const layout: DashboardLayout[] = [
  { moduleId: "profile", x: 0, y: 0, w: 4, h: 5, enabled: true },
  { moduleId: "ai-chat", x: 12, y: 0, w: 4, h: 5, enabled: true }
];

const enabledContributions: ContributionEntry[] = [
  {
    pluginId: "lyj.system.daily-reports",
    contribution: {
      type: "ai-tool", id: "daily-report", label: "日报生成",
      description: "整理工作进展、风险和下一步计划。",
      path: "/ai-office/daily-report", icon: "file", position: 20
    }
  },
  {
    pluginId: "lyj.system.ai-polish",
    contribution: {
      type: "ai-tool", id: "ai-polish", label: "AI 润色",
      description: "日报、领导沟通、翻译和普通润色。",
      path: "/ai-office/polish", icon: "sparkles", position: 10
    }
  },
  {
    pluginId: "lyj.system.ai-chat",
    contribution: {
      type: "dashboard", id: "ai-chat", title: "大模型对话",
      component: "system.ai-chat.dashboard", minW: 4, minH: 5
    }
  },
  {
    pluginId: "lyj.system.daily-reports",
    contribution: {
      type: "route", id: "daily-report-page", path: "/ai-office/daily-report",
      component: "system.daily-reports.page"
    }
  },
  {
    pluginId: "lyj.system.ai-polish",
    contribution: {
      type: "route", id: "ai-polish-page", path: "/ai-office/polish",
      component: "system.ai-polish.page"
    }
  },
  {
    pluginId: "lyj.system.reminders",
    contribution: {
      type: "navigation", id: "reminders", label: "提醒事项",
      path: "/reminders", icon: "bell", position: 20
    }
  },
  {
    pluginId: "lyj.system.reminders",
    contribution: {
      type: "route", id: "reminders-page", path: "/reminders",
      component: "system.reminders.page"
    }
  }
];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function createFetch(contributions: () => ContributionEntry[] | Response | Promise<Response>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    if (path === "/api/vault/status") return json({ configured: true, unlocked: true });
    if (path === "/api/plugins/contributions") {
      const result = await contributions();
      return result instanceof Response ? result : json(result);
    }
    if (path === "/api/preferences/navigation") return json(navigation);
    if (path === "/api/preferences/layout" && method === "GET") return json(layout);
    if (path === "/api/preferences/theme") return json({ theme: "light" });
    if (path === "/api/preferences/appearance") return json({ appearance: null });
    if (path === "/api/profile") return json({ name: "LYJ", birthday: "", employeeNumber: "001", customFields: [], photoVersion: null });
    if (path === "/api/ai-chat/messages") return json([]);
    if (path === "/api/daily-reports") return json([]);
    if (path === "/api/ai-polish" || path === "/api/ai-polish/prompts") return json([]);
    if (path === "/api/reminders") return json({ items: [] });
    if (path === "/api/reminder-attempts") return json({ items: [] });
    return json({ error: { message: `Unexpected request: ${method} ${path}` } }, 500);
  });
}

function renderApp(path = "/") {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-theme");
});

describe("server-declared web contributions", () => {
  it("renders enabled dashboard, navigation, route, and AI-tool contributions in stable position order", async () => {
    const user = userEvent.setup();
    const fetchMock = createFetch(() => enabledContributions);
    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    expect(await screen.findByRole("region", { name: "大模型对话" })).toBeVisible();
    expect(screen.getByRole("link", { name: "提醒事项" })).toBeVisible();
    const contributionRequest = fetchMock.mock.calls.find(([path]) => String(path) === "/api/plugins/contributions");
    expect(contributionRequest?.[1]?.signal).toBeInstanceOf(AbortSignal);

    await user.click(screen.getByRole("link", { name: "AI 办公" }));
    const tools = within(await screen.findByRole("main")).getAllByRole("link", { name: /AI 润色|日报生成/ });
    expect(tools.map((tool) => tool.getAttribute("aria-label"))).toEqual(["AI 润色", "日报生成"]);

    await user.click(screen.getByRole("link", { name: "日报生成" }));
    expect(await screen.findByRole("heading", { name: "日报填写" })).toBeVisible();
  });

  it.each([
    ["unknown compiled component tokens", [{
      pluginId: "lyj.system.ai-polish",
      contribution: { type: "route", id: "unknown-page", path: "/unknown", component: "system.unknown.page" }
    }]],
    ["duplicate contribution IDs", [
      enabledContributions[5],
      { ...enabledContributions[5], pluginId: "lyj.system.workday-calendar" }
    ]],
    ["a core navigation identity", [{
      pluginId: "lyj.system.reminders",
      contribution: { type: "navigation", id: "home", label: "非核心主页", path: "/reminders", icon: "bell", position: 0 }
    }]],
    ["the core profile dashboard identity", [{
      pluginId: "lyj.system.ai-chat",
      contribution: {
        type: "dashboard", id: "profile", title: "非核心个人信息",
        component: "system.ai-chat.dashboard", minW: 4, minH: 5
      }
    }]],
    ["a core route path", [{
      pluginId: "lyj.system.ai-polish",
      contribution: { type: "route", id: "settings-replacement", path: "/settings/", component: "system.ai-polish.page" }
    }]],
    ["equivalent route paths with trailing slashes", [
      {
        pluginId: "lyj.system.ai-polish",
        contribution: { type: "route", id: "example-one", path: "/example", component: "system.ai-polish.page" }
      },
      {
        pluginId: "lyj.system.daily-reports",
        contribution: { type: "route", id: "example-two", path: "/example/", component: "system.daily-reports.page" }
      }
    ]]
  ])("rejects %s without exposing response details or crashing core pages", async (_case, entries) => {
    vi.stubGlobal("fetch", createFetch(() => entries as ContributionEntry[]));

    renderApp();

    expect(await screen.findByRole("region", { name: "个人信息" })).toBeVisible();
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("插件功能暂时无法加载");
    expect(banner).not.toHaveTextContent("system.unknown.page");
    expect(screen.queryByRole("link", { name: "提醒事项" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "大模型对话" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "设置" })).toBeVisible();
  });

  it("refreshes enabled contributions in place after lifecycle changes", async () => {
    const user = userEvent.setup();
    let enabled = true;
    vi.stubGlobal("fetch", createFetch(() => enabled ? [enabledContributions[5]] : []));

    function Probe() {
      const contributions = usePluginContributions();
      return <>
        <span>{contributions.navigation.length === 1 ? "提醒已启用" : "提醒已停用"}</span>
        <button type="button" onClick={() => void contributions.refresh()}>刷新贡献</button>
      </>;
    }

    render(<ContributionProvider><Probe /></ContributionProvider>);
    expect(await screen.findByText("提醒已启用")).toBeVisible();

    enabled = false;
    await user.click(screen.getByRole("button", { name: "刷新贡献" }));
    expect(await screen.findByText("提醒已停用")).toBeVisible();

    enabled = true;
    await user.click(screen.getByRole("button", { name: "刷新贡献" }));
    expect(await screen.findByText("提醒已启用")).toBeVisible();
  });

  it("keeps the newest overlapping refresh authoritative when it settles first", async () => {
    const user = userEvent.setup();
    const refreshB = deferred<Response>();
    let contributionRequest = 0;
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      contributionRequest += 1;
      if (contributionRequest === 1) return Promise.resolve(json([enabledContributions[5]]));
      if (contributionRequest === 2) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      }
      return refreshB.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    function Probe() {
      const contributions = usePluginContributions();
      return <>
        <span>{contributions.navigation.length === 1 ? "提醒已启用" : "提醒已停用"}</span>
        {contributions.error && <span role="alert">{contributions.error}</span>}
        <button type="button" onClick={() => void contributions.refresh()}>刷新贡献</button>
      </>;
    }

    render(<ContributionProvider><Probe /></ContributionProvider>);
    expect(await screen.findByText("提醒已启用")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "刷新贡献" }));
    await user.click(screen.getByRole("button", { name: "刷新贡献" }));
    const refreshASignal = fetchMock.mock.calls[1]?.[1]?.signal;
    const refreshBSignal = fetchMock.mock.calls[2]?.[1]?.signal;
    expect(refreshASignal).toBeInstanceOf(AbortSignal);
    expect(refreshASignal?.aborted).toBe(true);
    expect(refreshBSignal).toBeInstanceOf(AbortSignal);
    expect(refreshBSignal?.aborted).toBe(false);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    refreshB.resolve(json([enabledContributions[5]]));
    expect(await screen.findByText("提醒已启用")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("提醒已启用")).toBeVisible();
  });

  it("ignores a pending contribution response after unmount without updating consumers or reporting an error", async () => {
    const pending = deferred<Response>();
    const observedNavigation = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unhandled = vi.fn();
    const uncaught = vi.fn();
    window.addEventListener("unhandledrejection", unhandled);
    window.addEventListener("error", uncaught);
    const fetchMock = createFetch(() => pending.promise);
    vi.stubGlobal("fetch", fetchMock);

    function Probe() {
      const contributions = usePluginContributions();
      observedNavigation(contributions.navigation.map((item) => item.id));
      return <span>{contributions.loading ? "加载中" : "加载完成"}</span>;
    }

    const view = render(<ContributionProvider><Probe /></ContributionProvider>);
    expect(screen.getByText("加载中")).toBeVisible();
    const requestSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(requestSignal).toBeInstanceOf(AbortSignal);
    expect(requestSignal?.aborted).toBe(false);
    const observationsBeforeUnmount = observedNavigation.mock.calls.length;
    view.unmount();
    expect(requestSignal?.aborted).toBe(true);

    await act(async () => {
      pending.resolve(json([enabledContributions[5]]));
      await pending.promise;
    });

    expect(observedNavigation).toHaveBeenCalledTimes(observationsBeforeUnmount);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
    expect(uncaught).not.toHaveBeenCalled();
    window.removeEventListener("unhandledrejection", unhandled);
    window.removeEventListener("error", uncaught);
  });

  it("keeps core routes and the profile usable while contributions are loading", async () => {
    let resolveContributions: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => { resolveContributions = resolve; });
    vi.stubGlobal("fetch", createFetch(() => pending));

    renderApp();

    expect(await screen.findByRole("region", { name: "个人信息" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("正在加载插件功能");
    expect(screen.getByRole("link", { name: "AI 办公" })).toBeVisible();
    expect(screen.getByRole("link", { name: "设置" })).toBeVisible();

    resolveContributions?.(json([]));
    await waitFor(() => expect(screen.queryByText("正在加载插件功能…")).not.toBeInTheDocument());
  });

  it("clears, disables, and restores every contribution consumer in one mounted shell", async () => {
    const user = userEvent.setup();
    const layoutSave = vi.fn(async (_layout: DashboardLayout[]) => undefined);
    const disabled = deferred<Response>();
    const reEnabled = deferred<Response>();
    let contributionRequest = 0;
    const fetchMock = createFetch(() => {
      contributionRequest += 1;
      if (contributionRequest === 1) return enabledContributions;
      if (contributionRequest === 2) return disabled.promise;
      return reEnabled.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    function MountedShell() {
      const contributions = usePluginContributions();
      return <>
        <Sidebar initialItems={navigation} />
        <button type="button" onClick={() => void contributions.refresh()}>刷新贡献</button>
        {contributions.loading && <span role="status">正在加载插件功能</span>}
        <main>
          <Routes>
            <Route path="/" element={<EditableDashboard initialLayout={layout} onSave={layoutSave} />} />
            <Route path="/ai-office" element={<AiOfficePage />} />
            <Route path="*" element={<PluginRoutes />} />
          </Routes>
        </main>
      </>;
    }

    render(
      <MemoryRouter initialEntries={["/"]}>
        <ContributionProvider><MountedShell /></ContributionProvider>
      </MemoryRouter>
    );

    expect(await screen.findByRole("region", { name: "大模型对话" })).toBeVisible();
    expect(screen.getByRole("link", { name: "提醒事项" })).toBeVisible();
    const originalGeometry = screen.getByRole("region", { name: "大模型对话" }).closest(".react-grid-item")?.getAttribute("style");
    expect(originalGeometry).toBeTruthy();
    const originalNavigationOrder = within(screen.getByRole("navigation")).getAllByRole("link").map((link) => link.textContent);

    await user.click(screen.getByRole("link", { name: "AI 办公" }));
    const originalToolOrder = within(screen.getByRole("main")).getAllByRole("link", { name: /AI 润色|日报生成/ }).map((link) => link.getAttribute("aria-label"));
    await user.click(screen.getByRole("link", { name: "AI 润色" }));
    expect(await screen.findByRole("heading", { name: "AI 润色" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "刷新贡献" }));
    expect(screen.getByRole("status")).toHaveTextContent("正在加载插件功能");
    expect(screen.queryByRole("heading", { name: "AI 润色" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "提醒事项" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "我的主页" }));
    expect(screen.queryByRole("region", { name: "大模型对话" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "AI 办公" }));
    expect(screen.queryByRole("link", { name: "AI 润色" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "日报生成" })).not.toBeInTheDocument();
    expect(layoutSave).not.toHaveBeenCalled();

    disabled.resolve(json([]));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "AI 润色" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "我的主页" }));
    expect(screen.queryByRole("region", { name: "大模型对话" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "提醒事项" })).not.toBeInTheDocument();
    expect(layoutSave).not.toHaveBeenCalled();

    await user.click(screen.getByRole("link", { name: "AI 办公" }));
    expect(screen.queryByRole("link", { name: "AI 润色" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "日报生成" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "编辑导航" }));
    await user.click(screen.getByRole("button", { name: "保存导航" }));
    const navigationSave = fetchMock.mock.calls.find(([path, init]) => String(path) === "/api/preferences/navigation" && (init as RequestInit | undefined)?.method === "PUT");
    expect(JSON.parse(String((navigationSave?.[1] as RequestInit | undefined)?.body))).toEqual(navigation);

    await user.click(screen.getByRole("button", { name: "刷新贡献" }));
    reEnabled.resolve(json(enabledContributions));
    expect(await screen.findByRole("link", { name: "提醒事项" })).toBeVisible();
    await user.click(screen.getByRole("link", { name: "我的主页" }));
    expect(await screen.findByRole("region", { name: "大模型对话" })).toBeVisible();
    expect(screen.getByRole("region", { name: "大模型对话" }).closest(".react-grid-item")?.getAttribute("style")).toBe(originalGeometry);
    expect(within(screen.getByRole("navigation")).getAllByRole("link").map((link) => link.textContent)).toEqual(originalNavigationOrder);
    await user.click(screen.getByRole("link", { name: "AI 办公" }));
    expect(within(screen.getByRole("main")).getAllByRole("link", { name: /AI 润色|日报生成/ }).map((link) => link.getAttribute("aria-label"))).toEqual(originalToolOrder);
    await user.click(screen.getByRole("link", { name: "AI 润色" }));
    expect(await screen.findByRole("heading", { name: "AI 润色" })).toBeVisible();
    expect(layoutSave).not.toHaveBeenCalled();
  });
});
