import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const navigation = [
  { id: "home", label: "我的主页", path: "/", position: 0, visible: true, disabled: false },
  { id: "ai-office", label: "AI 办公", path: "/ai-office", position: 1, visible: true, disabled: false },
  { id: "reminders", label: "提醒事项", path: "/reminders", position: 2, visible: true, disabled: false },
  { id: "vault-coming-soon", label: "密码保险箱", path: "/vault", position: 3, visible: true, disabled: false },
  { id: "settings", label: "设置", path: "/settings", position: 4, visible: true, disabled: false }
];

const layout = [{ moduleId: "profile", x: 0, y: 0, w: 4, h: 4, enabled: true }];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

describe("complete application navigation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-theme");
  });

  it("navigates the real shell through every MVP route and preserves interactive boundaries", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      if (path === "/api/preferences/navigation") return json(navigation);
      if (path === "/api/preferences/layout" && method === "GET") return json(layout);
      if (path === "/api/preferences/layout" && method === "PUT") return json(JSON.parse(String(init?.body)));
      if (path === "/api/preferences/theme" && method === "GET") return json({ theme: "light" });
      if (path === "/api/preferences/theme" && method === "PUT") return json(JSON.parse(String(init?.body)));
      if (path === "/api/profile") return json({ name: "LYJ", birthday: "", employeeNumber: "001", customFields: [], photoFilename: null });
      if (path === "/api/daily-reports") return json([]);
      if (path === "/api/settings") return json({
        deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKeyConfigured: false },
        mail: { smtpHost: "", smtpPort: 587, transportMode: "starttls", smtpUsername: "", fromAddress: "", smtpPasswordConfigured: false }
      });
      if (path === "/api/reminders/outbound-checkin") return json({
        id: "outbound-checkin", weekday: 1, enabled: false, localTime: "09:00", recipient: "",
        subject: "提交外勤打卡提醒", body: "请提交本周外勤打卡。", nextRun: null,
        schedulerReinstallRequired: false, schedulerReinstallInstruction: "", lastSuccess: null, lastFailure: null
      });
      return json({ error: { message: `Unexpected integration request: ${method} ${path}` } }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "我的主页" })).toBeVisible();
    expect(screen.getByTestId("dashboard-grid")).toHaveAttribute("data-editable", "false");
    await user.click(screen.getByRole("button", { name: "编辑工作台" }));
    expect(screen.getByTestId("dashboard-grid")).toHaveAttribute("data-editable", "true");
    await user.click(screen.getByRole("button", { name: "完成编辑" }));
    await waitFor(() => expect(screen.getByTestId("dashboard-grid")).toHaveAttribute("data-editable", "false"));

    const vault = screen.getByText("密码保险箱");
    expect(vault).toHaveAttribute("aria-disabled", "true");
    expect(vault.closest("a")).toBeNull();

    await user.click(screen.getByRole("link", { name: "AI 办公" }));
    expect(await screen.findByRole("heading", { name: "AI 办公" })).toBeVisible();
    await user.click(screen.getByRole("link", { name: "日报填写" }));
    expect(await screen.findByRole("heading", { name: "日报填写" })).toBeVisible();
    expect(screen.getByLabelText("今日完成")).toBeVisible();

    await user.click(screen.getByRole("link", { name: "设置" }));
    expect(await screen.findByRole("heading", { name: "设置" })).toBeVisible();
    const theme = screen.getByRole("combobox", { name: "主题" });
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    await user.selectOptions(theme, "dark");
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "dark"));
    await user.selectOptions(theme, "light");
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "light"));

    await user.click(screen.getByRole("link", { name: "提醒事项" }));
    expect(await screen.findByRole("heading", { name: "外勤打卡邮件提醒" })).toBeVisible();
    expect(screen.getByLabelText("收件邮箱")).toBeVisible();
    expect(screen.getByText("密码保险箱")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("密码保险箱").closest("a")).toBeNull();
  });
});
