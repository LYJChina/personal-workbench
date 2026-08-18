import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { GenericReminder, GenericReminderAttempt, SchedulerStatus } from "@workbench/contracts";
import { ReminderPage, type ReminderCenterApi } from "./ReminderPage";

const reminder: GenericReminder = {
  id: "outbound-checkin", name: "外勤打卡", enabled: true, lifecycle: "recurring",
  scheduleType: "weekly", startDate: "2026-08-18", localTime: "21:10", weekdays: [1],
  monthDay: null, totalOccurrences: null, successfulOccurrences: 0,
  recipient: "me@example.com", subject: "提交外勤打卡提醒", body: "请提交本周外勤打卡。",
  nextRun: "2026-08-24T13:10:00.000Z", calendarBlocked: false
};

const attempt: GenericReminderAttempt = {
  id: 1, reminderId: "outbound-checkin", reminderName: "外勤打卡",
  scheduledFor: "2026-08-17T13:10:00.000Z", attemptedAt: "2026-08-17T13:10:05.000Z",
  status: "success", errorCategory: null, recipient: "me@example.com",
  subject: "提交外勤打卡提醒", body: "请提交本周外勤打卡。"
};

const unsynchronized: SchedulerStatus = {
  installed: false, synchronized: false, taskName: "LYJWorkBench-ReminderRunner", message: "尚未同步"
};

function createApi(overrides: Partial<ReminderCenterApi> = {}): ReminderCenterApi {
  return {
    listReminders: vi.fn().mockResolvedValue({ items: [reminder] }),
    createReminder: vi.fn().mockImplementation(async (input) => ({ ...reminder, ...input, id: "new-id" })),
    updateReminder: vi.fn().mockImplementation(async (_id, input) => ({ ...reminder, ...input })),
    deleteReminder: vi.fn().mockResolvedValue(undefined),
    listAttempts: vi.fn().mockResolvedValue({ items: [attempt] }),
    testReminder: vi.fn().mockResolvedValue({ status: "success", message: "测试邮件已发送" }),
    getSchedulerStatus: vi.fn().mockResolvedValue(unsynchronized),
    syncScheduler: vi.fn().mockResolvedValue({
      ...unsynchronized, installed: true, synchronized: true, message: "已同步", nextRun: "2026-08-18T01:00:00.000Z"
    }),
    ...overrides
  };
}

describe("generic reminder center", () => {
  it("switches between pending reminders and execution history in one workspace", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(<MemoryRouter><ReminderPage api={api} /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "提醒事项" })).toBeVisible();
    expect(screen.getByRole("tablist", { name: "提醒视图" })).toBeVisible();
    expect(screen.getByRole("tab", { name: /等待执行/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "等待执行" })).toHaveTextContent("外勤打卡");
    expect(screen.queryByRole("region", { name: "已执行" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /已执行/ }));
    expect(screen.getByRole("tab", { name: /已执行/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "已执行" })).toHaveTextContent("发送成功");

    await user.click(screen.getByRole("button", { name: "同步系统计划" }));
    expect(api.syncScheduler).toHaveBeenCalledTimes(1);
    expect((await screen.findAllByText("已同步")).length).toBeGreaterThan(0);
    expect(screen.getByText("下次执行：2026年8月18日 09:00")).toBeVisible();
  });

  it("creates a finite workday email reminder", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(<MemoryRouter><ReminderPage api={api} /></MemoryRouter>);
    await screen.findByRole("heading", { name: "提醒事项" });

    await user.click(screen.getByRole("button", { name: "新建提醒" }));
    await user.type(screen.getByLabelText("提醒名称"), "提交报销");
    await user.type(screen.getByLabelText("收件邮箱"), "finance@example.com");
    await user.selectOptions(screen.getByLabelText("提醒类型"), "finite");
    await user.selectOptions(screen.getByLabelText("重复规则"), "workday");
    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-08-19" } });
    fireEvent.change(screen.getByLabelText("提醒时间"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("执行次数"), { target: { value: "3" } });
    await user.type(screen.getByLabelText("邮件主题"), "提交报销");
    await user.type(screen.getByLabelText("邮件正文"), "请提交报销材料。");
    await user.click(screen.getByRole("button", { name: "保存提醒" }));

    await waitFor(() => expect(api.createReminder).toHaveBeenCalledWith(expect.objectContaining({
      name: "提交报销", lifecycle: "finite", scheduleType: "workday", totalOccurrences: 3
    })));
  });
});
