import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiOfficeOrder, PluginSummary } from "@workbench/contracts";
import { api } from "../../lib/api";
import { AiOfficePage } from "./AiOfficePage";

const mockContributions = {
  aiTools: [] as Array<{ id: string; label: string; description: string; path: string; icon: string; position: number; pluginId: string }>,
  routes: [] as Array<{ id: string; path: string; component: string; pluginId: string; Component: () => null }>,
  navigation: [] as Array<{ id: string; label: string; path: string; icon: string; position: number; pluginId: string }>,
  dashboardModules: [],
  settingsSections: [],
  loading: false,
  error: null,
  refresh: vi.fn(async () => undefined)
};

vi.mock("../../plugins/ContributionProvider", () => ({
  usePluginContributions: () => mockContributions
}));

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getPlugins: vi.fn(),
      getAiOfficeOrder: vi.fn(),
      updateAiOfficeOrder: vi.fn()
    }
  };
});

function plugin(
  id: string,
  name: string,
  options: {
    enabled?: boolean;
    aiTool?: { id: string; label: string; description: string; path: string; icon: string; position?: number };
    route?: { id: string; path: string };
    navigation?: { id: string; label: string; path: string; icon?: string; position?: number };
  } = {}
): PluginSummary {
  const contributions: PluginSummary["manifest"]["contributions"] = [];
  if (options.route) {
    contributions.push({
      type: "route",
      id: options.route.id,
      path: options.route.path,
      component: "system.ai-polish.page"
    });
  }
  if (options.navigation) {
    contributions.push({
      type: "navigation",
      id: options.navigation.id,
      label: options.navigation.label,
      path: options.navigation.path,
      icon: options.navigation.icon ?? "grid",
      position: options.navigation.position ?? 0
    });
  }
  if (options.aiTool) {
    contributions.push({
      type: "ai-tool",
      id: options.aiTool.id,
      label: options.aiTool.label,
      description: options.aiTool.description,
      path: options.aiTool.path,
      icon: options.aiTool.icon,
      position: options.aiTool.position ?? 0
    });
  }
  return {
    manifest: {
      manifestVersion: 1,
      id,
      name,
      version: "1.0.0",
      author: "LYJ",
      kind: id.startsWith("lyj.system.") ? "system" : "third-party",
      platforms: ["win32", "darwin"],
      permissions: ["ai:use"],
      contributions
    },
    enabled: options.enabled ?? true,
    required: false,
    permissionsGranted: ["ai:use"],
    runtimeStatus: "running",
    errorCode: null
  };
}

function configureApi(overrides: Partial<{
  getPlugins: (signal?: AbortSignal) => Promise<PluginSummary[]>;
  getAiOfficeOrder: () => Promise<AiOfficeOrder>;
  updateAiOfficeOrder: (order: AiOfficeOrder) => Promise<AiOfficeOrder>;
}> = {}) {
  vi.mocked(api.getPlugins).mockImplementation(overrides.getPlugins ?? (async () => []));
  vi.mocked(api.getAiOfficeOrder).mockImplementation(overrides.getAiOfficeOrder ?? (async () => []));
  vi.mocked(api.updateAiOfficeOrder).mockImplementation(overrides.updateAiOfficeOrder ?? (async (order) => order));
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/ai-office"]}>
      <Routes>
        <Route path="/ai-office" element={<AiOfficePage />} />
        <Route path="/ai-office/polish" element={<h1>AI 润色</h1>} />
        <Route path="/ai-office/daily-report" element={<h1>日报填写</h1>} />
        <Route path="/plugins" element={<h1>插件中心</h1>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  mockContributions.aiTools = [];
  mockContributions.routes = [];
  mockContributions.navigation = [];
  mockContributions.loading = false;
  mockContributions.error = null;
  configureApi();
});

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("AiOfficePage", () => {
  it("renders fixed cards without free-grid affordances and follows preferred contribution paths", async () => {
    const polish = plugin("lyj.system.ai-polish", "AI 润色", {
      route: { id: "polish-page", path: "/ai-office/polish" },
      aiTool: { id: "ai-polish", label: "AI 润色", description: "润色文字", path: "/ai-office/polish", icon: "sparkles" }
    });
    const notes = plugin("lyj.plugin.notes", "智能便签");
    mockContributions.aiTools = [{
      id: "ai-polish",
      label: "AI 润色",
      description: "润色文字",
      path: "/ai-office/polish",
      icon: "sparkles",
      position: 0,
      pluginId: polish.manifest.id
    }];
    configureApi({
      getPlugins: async () => [polish, notes],
      getAiOfficeOrder: async () => [
        { itemId: polish.manifest.id, position: 0 },
        { itemId: notes.manifest.id, position: 1 }
      ]
    });
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByRole("link", { name: "AI 润色" })).toHaveAttribute("href", "/ai-office/polish");
    expect(screen.getByRole("link", { name: "智能便签" })).toHaveAttribute("href", "/plugins");
    expect(document.querySelector(".react-grid-layout")).toBeNull();
    expect(document.querySelector(".react-resizable-handle")).toBeNull();

    await user.click(screen.getByRole("link", { name: "AI 润色" }));
    expect(await screen.findByRole("heading", { name: "AI 润色" })).toBeVisible();
  });

  it("edits the draft order through remove, keyboard reorder, add, and save", async () => {
    const polish = plugin("lyj.system.ai-polish", "AI 润色", {
      route: { id: "polish-page", path: "/ai-office/polish" },
      aiTool: { id: "ai-polish", label: "AI 润色", description: "润色文字", path: "/ai-office/polish", icon: "sparkles" }
    });
    const report = plugin("lyj.system.daily-reports", "日报生成", {
      route: { id: "daily-report-page", path: "/ai-office/daily-report" },
      aiTool: { id: "daily-report", label: "日报生成", description: "整理日报", path: "/ai-office/daily-report", icon: "file" }
    });
    const notes = plugin("lyj.plugin.notes", "智能便签");
    mockContributions.aiTools = [
      {
        id: "ai-polish",
        label: "AI 润色",
        description: "润色文字",
        path: "/ai-office/polish",
        icon: "sparkles",
        position: 0,
        pluginId: polish.manifest.id
      },
      {
        id: "daily-report",
        label: "日报生成",
        description: "整理日报",
        path: "/ai-office/daily-report",
        icon: "file",
        position: 1,
        pluginId: report.manifest.id
      }
    ];
    configureApi({
      getPlugins: async () => [polish, report, notes],
      getAiOfficeOrder: async () => [
        { itemId: polish.manifest.id, position: 0 },
        { itemId: report.manifest.id, position: 1 }
      ]
    });
    const user = userEvent.setup();

    renderPage();
    await screen.findByRole("link", { name: "AI 润色" });

    await user.click(screen.getByRole("button", { name: "编辑工具" }));
    await user.click(screen.getByRole("button", { name: "上移 日报生成" }));
    await user.click(screen.getByRole("button", { name: "移出 AI 办公 AI 润色" }));
    await user.click(screen.getByRole("button", { name: "添加到 AI 办公 智能便签" }));
    await user.click(screen.getByRole("button", { name: "完成编辑" }));

    expect(api.updateAiOfficeOrder).toHaveBeenCalledWith([
      { itemId: report.manifest.id, position: 0 },
      { itemId: notes.manifest.id, position: 1 }
    ]);
  });

  it("keeps editing active and preserves the draft after a rejected save", async () => {
    const polish = plugin("lyj.system.ai-polish", "AI 润色", {
      aiTool: { id: "ai-polish", label: "AI 润色", description: "润色文字", path: "/ai-office/polish", icon: "sparkles" }
    });
    const report = plugin("lyj.system.daily-reports", "日报生成", {
      aiTool: { id: "daily-report", label: "日报生成", description: "整理日报", path: "/ai-office/daily-report", icon: "file" }
    });
    mockContributions.aiTools = [
      {
        id: "ai-polish",
        label: "AI 润色",
        description: "润色文字",
        path: "/ai-office/polish",
        icon: "sparkles",
        position: 0,
        pluginId: polish.manifest.id
      },
      {
        id: "daily-report",
        label: "日报生成",
        description: "整理日报",
        path: "/ai-office/daily-report",
        icon: "file",
        position: 1,
        pluginId: report.manifest.id
      }
    ];
    configureApi({
      getPlugins: async () => [polish, report],
      getAiOfficeOrder: async () => [{ itemId: polish.manifest.id, position: 0 }],
      updateAiOfficeOrder: async () => {
        throw new Error("SQLITE_BUSY");
      }
    });
    const user = userEvent.setup();

    renderPage();
    await screen.findByRole("link", { name: "AI 润色" });

    await user.click(screen.getByRole("button", { name: "编辑工具" }));
    await user.click(screen.getByRole("button", { name: "移出 AI 办公 AI 润色" }));
    await user.click(screen.getByRole("button", { name: "添加到 AI 办公 日报生成" }));
    await user.click(screen.getByRole("button", { name: "完成编辑" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("AI 办公顺序暂时无法保存，请稍后重试。");
    expect(screen.getByRole("button", { name: "完成编辑" })).toBeVisible();
    expect(screen.getByRole("button", { name: "添加到 AI 办公 AI 润色" })).toBeVisible();
    expect(screen.getByText("日报生成")).toBeVisible();
  });

  it("shows the empty state until the user chooses plugins to add", async () => {
    const polish = plugin("lyj.system.ai-polish", "AI 润色", {
      aiTool: { id: "ai-polish", label: "AI 润色", description: "润色文字", path: "/ai-office/polish", icon: "sparkles" }
    });
    mockContributions.aiTools = [{
      id: "ai-polish",
      label: "AI 润色",
      description: "润色文字",
      path: "/ai-office/polish",
      icon: "sparkles",
      position: 0,
      pluginId: polish.manifest.id
    }];
    configureApi({
      getPlugins: async () => [polish],
      getAiOfficeOrder: async () => []
    });
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByText("AI 办公还是空的")).toBeVisible();
    expect(screen.queryByRole("link", { name: "AI 润色" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "编辑工具" }));
    expect(screen.getByRole("heading", { name: "可添加插件" })).toBeVisible();
    expect(screen.getByRole("button", { name: "添加到 AI 办公 AI 润色" })).toBeVisible();
  });

  it("shows a fixed load error when plugin or order loading fails", async () => {
    configureApi({
      getPlugins: async () => {
        throw new Error("SELECT * FROM installed_plugins");
      },
      getAiOfficeOrder: async () => []
    });

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("AI 办公暂时无法加载，请稍后重试。");
    expect(document.body).not.toHaveTextContent("installed_plugins");
  });

  it("migrates legacy local storage into database order once and removes only AI Office legacy entries after success", async () => {
    const polish = plugin("lyj.system.ai-polish", "AI 润色", {
      aiTool: { id: "ai-polish", label: "AI 润色", description: "润色文字", path: "/ai-office/polish", icon: "sparkles" }
    });
    const report = plugin("lyj.system.daily-reports", "日报生成", {
      aiTool: { id: "daily-report", label: "日报生成", description: "整理日报", path: "/ai-office/daily-report", icon: "file" }
    });
    const notes = plugin("lyj.plugin.notes", "智能便签");
    mockContributions.aiTools = [
      {
        id: "ai-polish",
        label: "AI 润色",
        description: "润色文字",
        path: "/ai-office/polish",
        icon: "sparkles",
        position: 0,
        pluginId: polish.manifest.id
      },
      {
        id: "daily-report",
        label: "日报生成",
        description: "整理日报",
        path: "/ai-office/daily-report",
        icon: "file",
        position: 1,
        pluginId: report.manifest.id
      }
    ];
    localStorage.setItem("lyj.ai-office.layout", JSON.stringify([
      { itemId: "daily-report", surface: "ai-office", x: 8, y: 0, w: 8, h: 4, enabled: true },
      { itemId: "ai-polish", surface: "ai-office", x: 2, y: 0, w: 8, h: 4, enabled: true },
      { itemId: "ignored-disabled", surface: "ai-office", x: 0, y: 1, w: 8, h: 4, enabled: false }
    ]));
    localStorage.setItem("lyj.plugin-placements.v1", JSON.stringify([
      { pluginId: "lyj.system.dashboard", name: "主页卡片", path: "/", surface: "dashboard" },
      { pluginId: notes.manifest.id, name: "智能便签", path: "/plugins", surface: "ai-office" }
    ]));
    configureApi({
      getPlugins: async () => [polish, report, notes],
      getAiOfficeOrder: async () => [],
      updateAiOfficeOrder: async (order) => order
    });

    renderPage();

    await waitFor(() => expect(api.updateAiOfficeOrder).toHaveBeenCalledWith([
      { itemId: polish.manifest.id, position: 0 },
      { itemId: report.manifest.id, position: 1 },
      { itemId: notes.manifest.id, position: 2 }
    ]));
    expect(localStorage.getItem("lyj.ai-office.layout")).toBeNull();
    expect(JSON.parse(localStorage.getItem("lyj.plugin-placements.v1") ?? "[]")).toEqual([
      { pluginId: "lyj.system.dashboard", name: "主页卡片", path: "/", surface: "dashboard" }
    ]);
  });

  it("keeps legacy storage intact and shows the normal load error when migration persistence fails", async () => {
    const polish = plugin("lyj.system.ai-polish", "AI 润色", {
      aiTool: { id: "ai-polish", label: "AI 润色", description: "润色文字", path: "/ai-office/polish", icon: "sparkles" }
    });
    mockContributions.aiTools = [{
      id: "ai-polish",
      label: "AI 润色",
      description: "润色文字",
      path: "/ai-office/polish",
      icon: "sparkles",
      position: 0,
      pluginId: polish.manifest.id
    }];
    localStorage.setItem("lyj.ai-office.layout", JSON.stringify([
      { itemId: "ai-polish", surface: "ai-office", x: 0, y: 0, w: 8, h: 4, enabled: true }
    ]));
    localStorage.setItem("lyj.plugin-placements.v1", JSON.stringify([
      { pluginId: polish.manifest.id, name: "AI 润色", path: "/ai-office/polish", surface: "ai-office" }
    ]));
    configureApi({
      getPlugins: async () => [polish],
      getAiOfficeOrder: async () => [],
      updateAiOfficeOrder: async () => {
        throw new Error("SQLITE_BUSY");
      }
    });

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("AI 办公暂时无法加载，请稍后重试。");
    expect(localStorage.getItem("lyj.ai-office.layout")).not.toBeNull();
    expect(localStorage.getItem("lyj.plugin-placements.v1")).not.toBeNull();
  });

  it("aborts plugin loading and ignores settled requests after unmount", async () => {
    let pluginSignal: AbortSignal | undefined;
    let resolvePlugins!: (value: PluginSummary[]) => void;
    let resolveOrder!: (value: AiOfficeOrder) => void;
    configureApi({
      getPlugins: (signal) => {
        pluginSignal = signal;
        return new Promise<PluginSummary[]>((resolve) => {
          resolvePlugins = resolve;
        });
      },
      getAiOfficeOrder: () => new Promise<AiOfficeOrder>((resolve) => {
        resolveOrder = resolve;
      })
    });

    const view = renderPage();
    view.unmount();

    expect(pluginSignal?.aborted).toBe(true);
    resolvePlugins([]);
    resolveOrder([]);
    await Promise.resolve();
  });
});
