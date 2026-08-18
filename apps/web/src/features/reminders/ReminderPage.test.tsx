import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reminder, ReminderTestResult } from "@workbench/contracts";
import { App } from "../../app/App";
import { api } from "../../lib/api";
import { ReminderPage, type ReminderApi } from "./ReminderPage";

const reminder: Reminder = {
  id: "outbound-checkin",
  enabled: true,
  weekday: 1,
  localTime: "09:00",
  recipient: "original@example.com",
  subject: "提交外勤打卡提醒",
  body: "请提交本周外勤打卡。",
  nextRun: "2026-08-24T01:00:00.000Z",
  lastSuccess: { localDate: "2026-08-17", attemptedAt: "2026-08-17T01:00:00.000Z" },
  lastFailure: { localDate: "2026-08-10", attemptedAt: "2026-08-10T01:00:00.000Z", category: "timeout" }
};

function createApi(overrides: Partial<ReminderApi> = {}): ReminderApi {
  return {
    getReminder: vi.fn().mockResolvedValue(reminder),
    updateReminder: vi.fn().mockImplementation(async (input) => ({ ...reminder, ...input })),
    testReminder: vi.fn().mockResolvedValue({ status: "success", message: "测试邮件已发送" }),
    ...overrides
  };
}

function renderPage(reminderApi = createApi()) {
  render(<MemoryRouter><ReminderPage api={reminderApi} /></MemoryRouter>);
  return reminderApi;
}

afterEach(() => vi.restoreAllMocks());

describe("outbound check-in reminder page", () => {
  it("renders the real reminder route in the application shell", async () => {
    vi.spyOn(api, "getNavigation").mockResolvedValue([
      { id: "home", label: "我的主页", path: "/", position: 0, visible: true, disabled: false },
      { id: "ai-office", label: "AI 办公", path: "/ai-office", position: 1, visible: true, disabled: false },
      { id: "reminders", label: "提醒事项", path: "/reminders", position: 2, visible: true, disabled: false },
      { id: "vault-coming-soon", label: "密码保险箱", path: "/vault", position: 3, visible: true, disabled: true },
      { id: "settings", label: "设置", path: "/settings", position: 4, visible: true, disabled: false }
    ]);
    vi.spyOn(api, "getTheme").mockResolvedValue({ theme: "light" });
    vi.spyOn(api, "getReminder").mockResolvedValue(reminder);
    render(<MemoryRouter initialEntries={["/reminders"]}><App /></MemoryRouter>);

    expect(await screen.findByLabelText("收件邮箱")).toHaveValue("original@example.com");
    expect(screen.getByRole("heading", { name: "外勤打卡邮件提醒" })).toBeVisible();
  });

  it("shows enabled state, next run, delivery success, and failure category", async () => {
    renderPage();

    expect(await screen.findByLabelText("启用每周一提醒")).toBeChecked();
    expect(screen.getByLabelText("提醒时间")).toHaveValue("09:00");
    expect(screen.getByLabelText("邮件主题")).toHaveValue("提交外勤打卡提醒");
    expect(screen.getByLabelText("邮件正文")).toHaveValue("请提交本周外勤打卡。");
    expect(screen.getByText("下次运行").parentElement).toHaveTextContent("2026");
    expect(screen.getByText("上次成功").parentElement).toHaveTextContent("2026-08-17");
    expect(screen.getByText("上次失败").parentElement).toHaveTextContent("timeout");
  });

  it("edits and saves recipient, time, copy, and enabled state", async () => {
    const user = userEvent.setup();
    const reminderApi = renderPage();
    const recipient = await screen.findByLabelText("收件邮箱");
    await user.clear(recipient);
    await user.type(recipient, "me@example.com");
    fireEvent.change(screen.getByLabelText("提醒时间"), { target: { value: "10:15" } });
    await user.click(screen.getByLabelText("启用每周一提醒"));
    await user.clear(screen.getByLabelText("邮件主题"));
    await user.type(screen.getByLabelText("邮件主题"), "请提交外勤打卡");
    await user.clear(screen.getByLabelText("邮件正文"));
    await user.type(screen.getByLabelText("邮件正文"), "请在今天提交外勤打卡。");

    await user.click(screen.getByRole("button", { name: "保存提醒" }));

    await waitFor(() => expect(reminderApi.updateReminder).toHaveBeenCalledWith({
      enabled: false,
      localTime: "10:15",
      recipient: "me@example.com",
      subject: "请提交外勤打卡",
      body: "请在今天提交外勤打卡。"
    }));
    expect(await screen.findByText("提醒设置已保存")).toBeVisible();
  });

  it("shows pending and real success states for test-send", async () => {
    let resolveTest!: (result: ReminderTestResult) => void;
    const pending = new Promise<ReminderTestResult>((resolve) => { resolveTest = resolve; });
    const reminderApi = renderPage(createApi({ testReminder: vi.fn().mockReturnValue(pending) }));
    await screen.findByDisplayValue("original@example.com");

    fireEvent.click(screen.getByRole("button", { name: "发送测试邮件" }));

    expect(screen.getByRole("button", { name: "发送中…" })).toBeDisabled();
    expect(reminderApi.testReminder).toHaveBeenCalledTimes(1);
    resolveTest({ status: "success", message: "测试邮件已发送" });
    expect(await screen.findByText("测试邮件已发送")).toBeVisible();
  });

  it("shows a truthful test failure and retains edited inputs", async () => {
    const user = userEvent.setup();
    const reminderApi = renderPage(createApi({
      testReminder: vi.fn().mockResolvedValue({ status: "failure", category: "auth_failure", message: "测试邮件发送失败" })
    }));
    const recipient = await screen.findByLabelText("收件邮箱");
    await user.clear(recipient);
    await user.type(recipient, "retained@example.com");

    await user.click(screen.getByRole("button", { name: "发送测试邮件" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("测试邮件发送失败");
    expect(screen.getByRole("alert")).toHaveTextContent("auth_failure");
    expect(recipient).toHaveValue("retained@example.com");
    expect(reminderApi.testReminder).toHaveBeenCalledTimes(1);
  });

  it("retains all edits and does not report success when save fails", async () => {
    const user = userEvent.setup();
    renderPage(createApi({ updateReminder: vi.fn().mockRejectedValue(new Error("保存失败，请重试")) }));
    const recipient = await screen.findByLabelText("收件邮箱");
    await user.clear(recipient);
    await user.type(recipient, "keep@example.com");
    fireEvent.change(screen.getByLabelText("提醒时间"), { target: { value: "11:30" } });

    await user.click(screen.getByRole("button", { name: "保存提醒" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败，请重试");
    expect(recipient).toHaveValue("keep@example.com");
    expect(screen.getByLabelText("提醒时间")).toHaveValue("11:30");
    expect(screen.queryByText("提醒设置已保存")).not.toBeInTheDocument();
  });
});
