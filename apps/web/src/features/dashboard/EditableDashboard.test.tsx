import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { DashboardLayout, NavigationItem } from "@workbench/contracts";
import { SidebarEditor } from "./SidebarEditor";
import { EditableDashboard } from "./EditableDashboard";
import { Sidebar } from "../../app/Sidebar";
import { ThemeProvider, useTheme } from "../../app/ThemeProvider";

const profileLayout: DashboardLayout[] = [{ moduleId: "profile", x: 0, y: 0, w: 4, h: 4, enabled: true }];

const navigation: NavigationItem[] = [
  { id: "home", label: "我的主页", path: "/", position: 0, visible: true, disabled: false },
  { id: "ai-office", label: "AI 办公", path: "/ai-office", position: 1, visible: true, disabled: false },
  { id: "reminders", label: "提醒事项", path: "/reminders", position: 2, visible: true, disabled: false },
  { id: "vault-coming-soon", label: "密码保险箱", path: "/vault", position: 3, visible: true, disabled: true },
  { id: "settings", label: "设置", path: "/settings", position: 4, visible: true, disabled: false }
];

describe("EditableDashboard", () => {
  it("locks the grid until editing and persists when editing is complete", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableDashboard initialLayout={profileLayout} onSave={onSave} />);

    expect(screen.getByTestId("dashboard-grid")).toHaveAttribute("data-editable", "false");
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
});

describe("SidebarEditor", () => {
  it("can hide, restore, and reorder optional entries but protects required entries", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SidebarEditor initialItems={navigation} onSave={onSave} />);

    expect(screen.getByRole("button", { name: "删除 我的主页" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "隐藏 AI 办公" }));
    await user.click(screen.getByRole("button", { name: "恢复 AI 办公" }));
    await user.click(screen.getByRole("button", { name: "下移 AI 办公" }));
    await user.click(screen.getByRole("button", { name: "保存导航" }));

    expect(onSave).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: "ai-office", position: 2, visible: true })]));
  });

  it("renders the vault as disabled regardless of submitted navigation state", () => {
    render(<MemoryRouter><Sidebar initialItems={navigation.map((item) => item.id === "vault-coming-soon" ? { ...item, disabled: false } : item)} /></MemoryRouter>);

    expect(screen.getByText("密码保险箱")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("即将推出")).toBeVisible();
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
