import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DailyReport } from "@workbench/contracts";
import { App } from "../../app/App";
import { ThemeProvider } from "../../app/ThemeProvider";
import { api } from "../../lib/api";
import { DailyReportPage, type DailyReportApi } from "./DailyReportPage";

const firstReport: DailyReport = {
  id: 1,
  completed: "完成日报页面",
  risks: "等待接口权限",
  content: "今日完成\n完成日报页面\n\n问题与风险\n等待接口权限",
  model: "deepseek-chat",
  createdAt: "2026-08-17T09:00:00.000Z",
  updatedAt: "2026-08-17T09:00:00.000Z"
};

const secondReport: DailyReport = {
  ...firstReport,
  id: 2,
  completed: "完成服务端联调",
  content: "今日完成\n完成服务端联调",
  createdAt: "2026-08-18T10:00:00.000Z",
  updatedAt: "2026-08-18T10:00:00.000Z"
};

function createApi(overrides: Partial<DailyReportApi> = {}): DailyReportApi {
  return {
    generateDailyReport: vi.fn().mockResolvedValue(firstReport),
    getDailyReports: vi.fn().mockResolvedValue([]),
    getDailyReport: vi.fn().mockResolvedValue(firstReport),
    updateDailyReport: vi.fn().mockImplementation(async (id, content) => ({ ...firstReport, id, content })),
    ...overrides
  };
}

function renderPage(reportApi = createApi()) {
  render(
    <MemoryRouter>
      <ThemeProvider initialTheme="light" onSave={vi.fn().mockResolvedValue(undefined)}>
        <DailyReportPage api={reportApi} />
      </ThemeProvider>
    </MemoryRouter>
  );
  return reportApi;
}

afterEach(() => vi.restoreAllMocks());

describe("AI Office daily report flow", () => {
  it("navigates from the sidebar to the tool hub and then to the independent daily report page", async () => {
    vi.spyOn(api, "getNavigation").mockResolvedValue([
      { id: "home", label: "我的主页", path: "/", position: 0, visible: true, disabled: false },
      { id: "ai-office", label: "AI 办公", path: "/ai-office", position: 1, visible: true, disabled: false },
      { id: "reminders", label: "提醒事项", path: "/reminders", position: 2, visible: true, disabled: false },
      { id: "vault-coming-soon", label: "密码保险箱", path: "/vault", position: 3, visible: true, disabled: true },
      { id: "settings", label: "设置", path: "/settings", position: 4, visible: true, disabled: false }
    ]);
    vi.spyOn(api, "getTheme").mockResolvedValue({ theme: "light" });
    vi.spyOn(api, "getLayout").mockResolvedValue([]);
    vi.spyOn(api, "getDailyReports").mockResolvedValue([]);
    const user = userEvent.setup();
    render(<MemoryRouter><App /></MemoryRouter>);

    await user.click(screen.getByRole("link", { name: "AI 办公" }));
    expect(screen.getByRole("heading", { name: "AI 办公" })).toBeVisible();
    const card = screen.getByRole("link", { name: /AI 润色/ });
    expect(card).toHaveClass("ai-tool-card");
    await user.click(card);

    expect(screen.getByRole("heading", { name: "AI 润色" })).toBeVisible();
    expect(screen.getByLabelText("今日完成")).toBeVisible();
    expect(screen.getByLabelText("问题与风险")).toBeVisible();
  });

  it("generates a separate result, refreshes history, and reports clipboard success", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const history = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([firstReport]);
    const reportApi = renderPage(createApi({ getDailyReports: history }));

    await user.type(screen.getByLabelText("今日完成"), "完成日报页面");
    await user.type(screen.getByLabelText("问题与风险"), "等待接口权限");
    await user.click(screen.getByRole("button", { name: "生成日报" }));

    const result = await screen.findByRole("region", { name: "生成结果" });
    expect(result).toHaveTextContent("完成日报页面");
    expect(result).toHaveTextContent("等待接口权限");
    expect(reportApi.generateDailyReport).toHaveBeenCalledWith({ completed: "完成日报页面", risks: "等待接口权限" });
    expect(history).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "复制全文" }));
    expect(writeText).toHaveBeenCalledWith(firstReport.content);
    expect(await screen.findByText("已复制全文")).toBeVisible();
  });

  it("keeps a successful result and shows a distinct warning when only history refresh fails", async () => {
    const history = vi.fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("history-refresh-raw-error"));
    const reportApi = renderPage(createApi({ getDailyReports: history }));
    fireEvent.change(screen.getByLabelText("今日完成"), { target: { value: "完成日报页面" } });

    fireEvent.click(screen.getByRole("button", { name: "生成日报" }));

    const result = await screen.findByRole("region", { name: "生成结果" });
    expect(result).toHaveTextContent("完成日报页面");
    expect(reportApi.generateDailyReport).toHaveBeenCalledTimes(1);
    expect(history).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("history-refresh-raw-error")).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("日报已生成并保存，但历史记录刷新失败，请勿重复生成");
  });

  it("reports clipboard failure accurately", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    renderPage();
    fireEvent.change(screen.getByLabelText("今日完成"), { target: { value: "完成日报页面" } });
    fireEvent.click(screen.getByRole("button", { name: "生成日报" }));
    await screen.findByRole("button", { name: "复制全文" });

    fireEvent.click(screen.getByRole("button", { name: "复制全文" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("复制失败");
  });

  it("links missing-configuration errors to Settings and retains inputs after failure", async () => {
    const reportApi = createApi({ generateDailyReport: vi.fn().mockRejectedValue(new Error("请先在设置中配置 DeepSeek")) });
    renderPage(reportApi);
    fireEvent.change(screen.getByLabelText("今日完成"), { target: { value: "保留的完成事项" } });
    fireEvent.change(screen.getByLabelText("问题与风险"), { target: { value: "保留的风险" } });

    fireEvent.click(screen.getByRole("button", { name: "生成日报" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("请先在设置中配置 DeepSeek");
    expect(screen.getByRole("link", { name: "前往设置" })).toHaveAttribute("href", "/settings");
    expect(screen.getByLabelText("今日完成")).toHaveValue("保留的完成事项");
    expect(screen.getByLabelText("问题与风险")).toHaveValue("保留的风险");
  });

  it("prevents duplicate submissions while generation is pending", async () => {
    let resolveGeneration!: (report: DailyReport) => void;
    const pending = new Promise<DailyReport>((resolve) => { resolveGeneration = resolve; });
    const reportApi = createApi({ generateDailyReport: vi.fn().mockReturnValue(pending) });
    renderPage(reportApi);
    fireEvent.change(screen.getByLabelText("今日完成"), { target: { value: "完成日报页面" } });

    fireEvent.click(screen.getByRole("button", { name: "生成日报" }));
    fireEvent.click(screen.getByRole("button", { name: "生成中…" }));

    expect(reportApi.generateDailyReport).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "生成中…" })).toBeDisabled();
    resolveGeneration(firstReport);
    expect(await screen.findByRole("button", { name: "复制全文" })).toBeVisible();
  });

  it("shows newest-first history with previews and supports reopen, edit, and successful save", async () => {
    const reportApi = createApi({ getDailyReports: vi.fn().mockResolvedValue([secondReport, firstReport]) });
    renderPage(reportApi);

    const items = await screen.findAllByRole("article");
    expect(within(items[0]).getByText(/2026/)).toBeVisible();
    expect(within(items[0]).getByText(/完成服务端联调/)).toBeVisible();
    expect(within(items[1]).getByText(/完成日报页面/)).toBeVisible();

    fireEvent.click(within(items[0]).getByRole("button", { name: "重新打开" }));
    expect(screen.getByRole("region", { name: "生成结果" })).toHaveTextContent("完成服务端联调");
    fireEvent.click(within(items[0]).getByRole("button", { name: "编辑" }));
    const editor = screen.getByLabelText("编辑日报正文");
    fireEvent.change(editor, { target: { value: "修改后的日报正文" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(reportApi.updateDailyReport).toHaveBeenCalledWith(secondReport.id, "修改后的日报正文"));
    expect(await screen.findByText("修改已保存")).toBeVisible();
  });

  it("does not report success when a history edit fails", async () => {
    const reportApi = createApi({
      getDailyReports: vi.fn().mockResolvedValue([firstReport]),
      updateDailyReport: vi.fn().mockRejectedValue(new Error("保存失败，请重试"))
    });
    renderPage(reportApi);
    const item = (await screen.findAllByRole("article"))[0];
    fireEvent.click(within(item).getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("编辑日报正文"), { target: { value: "不会保存的内容" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败，请重试");
    expect(screen.queryByText("修改已保存")).not.toBeInTheDocument();
  });
});
