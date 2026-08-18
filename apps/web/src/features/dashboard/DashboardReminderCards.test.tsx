import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { WorkdayCalendarCard } from "../calendar/WorkdayCalendarCard";
import { UpcomingRemindersCard } from "../reminders/UpcomingRemindersCard";

describe("homepage reminder cards", () => {
  it("shows Chinese holiday and makeup-workday markers and updates manually", async () => {
    const user = userEvent.setup();
    const api = {
      getCalendar: vi.fn().mockResolvedValue({
        days: [
          { localDate: "2026-08-18", dayType: "holiday", name: "测试假日" },
          { localDate: "2026-08-22", dayType: "makeup_workday", name: "调休补班" }
        ],
        coverage: [{ year: 2026, synchronizedAt: "2026-08-01T00:00:00.000Z" }]
      }),
      syncCalendar: vi.fn().mockResolvedValue({ updatedYears: [2026], unavailableYears: [2027] })
    };
    render(<WorkdayCalendarCard api={api} initialMonth="2026-08" />);

    expect(await screen.findByRole("heading", { name: "中国工作日日历" })).toBeVisible();
    expect(screen.getByLabelText("2026-08-18 测试假日")).toHaveTextContent("休");
    expect(screen.getByLabelText("2026-08-22 调休补班")).toHaveTextContent("班");
    await user.click(screen.getByRole("button", { name: "更新节假日" }));
    expect(api.syncCalendar).toHaveBeenCalledWith([2026, 2027]);
  });

  it("shows upcoming reminders in time order", async () => {
    const api = { getUpcomingReminders: vi.fn().mockResolvedValue({ items: [
      { id: "1", name: "上午提醒", nextRun: "2026-08-19T01:00:00.000Z", scheduleType: "workday", enabled: true },
      { id: "2", name: "下午提醒", nextRun: "2026-08-19T06:00:00.000Z", scheduleType: "daily", enabled: true }
    ] }) };
    render(<MemoryRouter><UpcomingRemindersCard api={api as never} /></MemoryRouter>);

    const region = await screen.findByRole("region", { name: "近期提醒" });
    expect(region.textContent?.indexOf("上午提醒")).toBeLessThan(region.textContent?.indexOf("下午提醒") ?? 0);
  });
});
