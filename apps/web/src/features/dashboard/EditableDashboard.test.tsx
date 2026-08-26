import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardLayout, NavigationItem } from "@workbench/contracts";
import { SidebarEditor } from "./SidebarEditor";
import { EditableDashboard, mergeDashboardLayout } from "./EditableDashboard";
import { Sidebar } from "../../app/Sidebar";
import { ThemeProvider, useTheme } from "../../app/ThemeProvider";
import { ContributionProvider, usePluginContributions } from "../../plugins/ContributionProvider";

const profileLayout: DashboardLayout[] = [{ moduleId: "profile", x: 0, y: 0, w: 4, h: 4, enabled: true }];

const navigation: NavigationItem[] = [
  { id: "home", label: "我的主页", path: "/", position: 0, visible: true, disabled: false },
  { id: "ai-office", label: "AI 办公", path: "/ai-office", position: 1, visible: true, disabled: false },
  { id: "reminders", label: "提醒事项", path: "/reminders", position: 2, visible: true, disabled: false },
  { id: "vault-coming-soon", label: "密码保险箱", path: "/vault", position: 3, visible: true, disabled: true },
  { id: "settings", label: "设置", path: "/settings", position: 4, visible: true, disabled: false }
];

afterEach(() => vi.unstubAllGlobals());

describe("EditableDashboard", () => {
  it("assigns a default layout only to a newly enabled contribution", () => {
    const merged = mergeDashboardLayout(profileLayout, {
      profile: { id: "profile", title: "个人信息", minW: 4, minH: 5, render: () => null },
      "analytics-card": { id: "analytics-card" as DashboardLayout["moduleId"], title: "Analytics", minW: 3, minH: 4, render: () => null }
    }, ["analytics-card" as DashboardLayout["moduleId"]]);

    expect(merged).toEqual(expect.arrayContaining([expect.objectContaining({ moduleId: "analytics-card", enabled: true, w: 4, h: 4 })]));
    expect(merged.find((item) => item.moduleId === "profile")).toEqual(profileLayout[0]);
  });

  it("shows only a compact daily quote in the dashboard header", () => {
    render(<EditableDashboard initialLayout={profileLayout} onSave={vi.fn()} now={new Date(2026, 7, 18)} />);

    expect(screen.queryByText("PERSONAL SPACE")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "我的主页" })).not.toBeInTheDocument();
    expect(screen.getByText("及时当勉励，岁月不待人。")).toBeVisible();
    expect(screen.getByText("——陶渊明")).toBeVisible();
    expect(screen.getByRole("button", { name: "编辑工作台" })).toBeVisible();
  });

  it("changes the quote when the local calendar date changes", () => {
    const { rerender } = render(<EditableDashboard initialLayout={profileLayout} onSave={vi.fn()} now={new Date(2026, 7, 18)} />);

    expect(screen.getByText("及时当勉励，岁月不待人。")).toBeVisible();
    rerender(<EditableDashboard initialLayout={profileLayout} onSave={vi.fn()} now={new Date(2026, 7, 19)} />);
    expect(screen.getByText("纸上得来终觉浅，绝知此事要躬行。")).toBeVisible();
  });

  it("locks the grid until editing and persists when editing is complete", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableDashboard initialLayout={profileLayout} onSave={onSave} />);

    expect(screen.getByTestId("dashboard-grid")).toHaveAttribute("data-editable", "false");
    expect(screen.getByTestId("dashboard-grid")).toHaveAttribute("data-columns", "16");
    await user.click(screen.getByRole("button", { name: "编辑工作台" }));
    expect(screen.getByTestId("dashboard-grid")).toHaveAttribute("data-editable", "true");
    await user.click(screen.getByRole("button", { name: "完成编辑" }));
    expect(onSave).toHaveBeenCalledWith(profileLayout);
  });

  it("keeps editing available and explains a save failure", async () => {
    const user = userEvent.setup();
    render(<EditableDashboard initialLayout={profileLayout} onSave={vi.fn().mockRejectedValue(new Error("网络不可用"))} />);

    await user.click(screen.getByRole("button", { name: "编辑工作台" }));
    await user.click(screen.getByRole("button", { name: "完成编辑" }));

    expect(await screen.findByText("网络不可用")).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("dashboard-grid")).toHaveAttribute("data-editable", "true");
  });

  it("preserves the desktop layout after viewing and editing on a narrow screen", async () => {
    const desktopLayout: DashboardLayout[] = [
      { moduleId: "profile", x: 8, y: 0, w: 8, h: 5, enabled: true }
    ];
    let resize: (width: number) => void = () => undefined;

    class TestResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = (width) => callback([
          { contentRect: { width } } as ResizeObserverEntry
        ], this);
      }

      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableDashboard initialLayout={desktopLayout} onSave={onSave} />);

    act(() => resize(600));
    expect(screen.getByTestId("dashboard-grid")).toHaveAttribute("data-columns", "4");
    await user.click(screen.getByRole("button", { name: "编辑工作台" }));
    act(() => resize(1200));
    expect(screen.getByTestId("dashboard-grid")).toHaveAttribute("data-columns", "16");
    await user.click(screen.getByRole("button", { name: "完成编辑" }));

    expect(onSave).toHaveBeenCalledWith(desktopLayout);
  });

  it("renders and saves an installed dashboard contribution with a generalized stable ID", async () => {
    const pluginLayout: DashboardLayout[] = [{
      moduleId: "analytics-card" as DashboardLayout["moduleId"],
      x: 7,
      y: 3,
      w: 6,
      h: 8,
      enabled: true
    }];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      if (path === "/api/plugins/contributions") {
        return new Response(JSON.stringify([{
          pluginId: "lyj.plugin.analytics",
          contribution: {
            type: "dashboard",
            id: "analytics-card",
            title: "Analytics",
            component: "system.ai-chat.dashboard",
            minW: 3,
            minH: 4
          }
        }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (path === "/api/ai-chat/messages") {
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: { message: "Unexpected request", code: "NOT_FOUND" } }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <ContributionProvider>
        <EditableDashboard initialLayout={pluginLayout} onSave={onSave} />
      </ContributionProvider>
    );

    expect(await screen.findByRole("region", { name: "大模型对话" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "编辑工作台" }));
    await user.click(screen.getByRole("button", { name: "完成编辑" }));
    expect(onSave).toHaveBeenCalledWith(pluginLayout);
  });
});

describe("SidebarEditor", () => {
  it("allows optional entries to be hidden, restored, and reordered without offering deletion", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SidebarEditor initialItems={navigation} onSave={onSave} />);

    expect(screen.queryByRole("button", { name: "删除 AI 办公" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "隐藏 AI 办公" }));
    await user.click(screen.getByRole("button", { name: "恢复 AI 办公" }));
    await user.click(screen.getByRole("button", { name: "下移 AI 办公" }));
    await user.click(screen.getByRole("button", { name: "保存导航" }));

    expect(onSave).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: "ai-office", position: 2, visible: true })]));
  });

  it("renders the password manager as an available local plugin", () => {
    render(<MemoryRouter><Sidebar initialItems={navigation.map((item) => item.id === "vault-coming-soon" ? { ...item, id: "password-manager", path: "/password-vault", disabled: false } : item)} /></MemoryRouter>);

    expect(screen.getByRole("link", { name: "密码保险箱" })).toHaveAttribute("href", "/password-vault");
  });

  it("separates the plugin center from workspace navigation above settings", () => {
    const items: NavigationItem[] = [
      ...navigation.filter((item) => item.id !== "settings"),
      { id: "plugins", label: "插件中心", path: "/plugins", position: 4, visible: true, disabled: false },
      { id: "settings", label: "设置", path: "/settings", position: 5, visible: true, disabled: false }
    ];

    render(<MemoryRouter><Sidebar initialItems={items} /></MemoryRouter>);

    const workspace = screen.getByRole("navigation", { name: "工作区" });
    const plugins = screen.getByRole("navigation", { name: "插件" });
    expect(within(workspace).queryByRole("link", { name: "插件中心" })).not.toBeInTheDocument();
    expect(within(plugins).getByRole("link", { name: "插件中心" })).toHaveAttribute("href", "/plugins");
    expect(screen.getByText("插件", { selector: ".sidebar-section-label" })).toBeVisible();
    expect(screen.getByRole("link", { name: "设置" })).toHaveAttribute("href", "/settings");
  });

  it("hides the entire plugin navigation section when plugin center is hidden", () => {
    const items: NavigationItem[] = [
      ...navigation,
      { id: "plugins", label: "插件中心", path: "/plugins", position: 5, visible: false, disabled: false }
    ];

    render(<MemoryRouter><Sidebar initialItems={items} /></MemoryRouter>);

    expect(screen.queryByRole("navigation", { name: "插件" })).not.toBeInTheDocument();
    expect(screen.queryByText("插件", { selector: ".sidebar-section-label" })).not.toBeInTheDocument();
  });

  it("preserves an inactive sparse row exactly and restores its position after re-enable", async () => {
    const user = userEvent.setup();
    const sparseNavigation: NavigationItem[] = navigation.map((item) => item.id === "reminders"
      ? { ...item, position: 100, visible: false }
      : item);
    let contributionsEnabled = false;
    const savedPayloads: NavigationItem[][] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/plugins/contributions") {
        return new Response(JSON.stringify(contributionsEnabled ? [{
          pluginId: "lyj.system.reminders",
          contribution: {
            type: "navigation",
            id: "reminders",
            label: "提醒事项",
            path: "/reminders",
            icon: "bell",
            position: 2
          }
        }] : []), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (path === "/api/preferences/navigation" && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body)) as NavigationItem[];
        savedPayloads.push(payload);
        return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    function Shell() {
      const contributions = usePluginContributions();
      return <>
        <Sidebar initialItems={sparseNavigation} />
        <button type="button" onClick={() => void contributions.refresh()}>刷新贡献</button>
      </>;
    }

    render(<MemoryRouter><ContributionProvider><Shell /></ContributionProvider></MemoryRouter>);
    await screen.findByRole("button", { name: "刷新贡献" });
    await user.click(screen.getByRole("button", { name: "编辑导航" }));
    await user.click(screen.getByRole("button", { name: "保存导航" }));

    expect(savedPayloads[0]?.find((item) => item.id === "reminders")).toEqual(sparseNavigation[2]);

    contributionsEnabled = true;
    await user.click(screen.getByRole("button", { name: "刷新贡献" }));
    await user.click(await screen.findByRole("button", { name: "编辑导航" }));
    await user.click(screen.getByRole("button", { name: "恢复 提醒事项" }));
    await user.click(screen.getByRole("button", { name: "保存导航" }));

    expect(savedPayloads[1]?.find((item) => item.id === "reminders")).toMatchObject({ position: 100, visible: true });

    await user.click(screen.getByRole("button", { name: "编辑导航" }));
    await user.click(screen.getByRole("button", { name: "上移 提醒事项" }));
    await user.click(screen.getByRole("button", { name: "保存导航" }));

    expect(savedPayloads[2]?.find((item) => item.id === "reminders")).toMatchObject({ position: 4, visible: true });
    expect(savedPayloads[2]?.find((item) => item.id === "settings")).toMatchObject({ position: 100 });
  });

  it("allocates a collision-free position only for a genuinely new navigation entry", async () => {
    const user = userEvent.setup();
    const savedPayloads: NavigationItem[][] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/plugins/contributions") {
        return new Response(JSON.stringify([{
          pluginId: "lyj.plugin.new-navigation",
          contribution: {
            type: "navigation",
            id: "new-page",
            label: "New",
            path: "/new",
            icon: "grid",
            position: 2
          }
        }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (path === "/api/preferences/navigation" && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body)) as NavigationItem[];
        savedPayloads.push(payload);
        return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    render(<MemoryRouter><ContributionProvider><Sidebar initialItems={navigation} /></ContributionProvider></MemoryRouter>);
    expect(await screen.findByRole("link", { name: "New" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "编辑导航" }));
    await user.click(screen.getByRole("button", { name: "保存导航" }));

    expect(savedPayloads[0]?.find((item) => item.id === "reminders")).toEqual(navigation[2]);
    expect(savedPayloads[0]?.find((item) => item.id === "new-page")).toMatchObject({ position: 5 });
  });
});

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return <button type="button" onClick={() => void setTheme(theme === "light" ? "dark" : "light")}>切换主题</button>;
}

describe("ThemeProvider", () => {
  it("switches the document theme and persists the chosen value", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ThemeProvider initialTheme="light" onSave={onSave}><ThemeToggle /></ThemeProvider>);

    await user.click(screen.getByRole("button", { name: "切换主题" }));

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(onSave).toHaveBeenCalledWith("dark");
  });
});
