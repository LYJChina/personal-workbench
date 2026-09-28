import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ModelDigestHistoryPage, ModelDigestOverview, ModelDigestRun } from "@workbench/contracts";
import { ModelDigestPage } from "./ModelDigestPage";

const run: ModelDigestRun = {
  id: "123e4567-e89b-42d3-a456-426614174001", type: "manual", status: "succeeded",
  scheduledLocalDate: null, createdAt: "2026-09-28T01:00:00.000Z", startedAt: "2026-09-28T01:00:00.000Z",
  finishedAt: "2026-09-28T01:00:05.000Z", sourceSnapshots: [], summary: "本周模型摘要", recipientIds: [],
  emailStatus: "not_requested", errorCategory: null, deletedAt: null,
  progressEvents: [
    { stage: "queued", message: "任务已创建，等待开始", at: "2026-09-28T01:00:00.000Z" },
    { stage: "fetching_huggingface", message: "正在读取 Hugging Face 趋势榜", at: "2026-09-28T01:00:01.000Z" },
    { stage: "completed", message: "总结已完成", at: "2026-09-28T01:00:05.000Z" }
  ]
};

const history: ModelDigestHistoryPage = { items: [{
  id: run.id, type: run.type, status: run.status, createdAt: run.createdAt,
  finishedAt: run.finishedAt, emailStatus: run.emailStatus, deletedAt: null, hasSummary: true
}], total: 1, limit: 20, offset: 0 };
const historyApi = {
  listModelDigestRuns: vi.fn().mockResolvedValue(history),
  listModelDigestTrash: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
  getDeletedModelDigestRun: vi.fn().mockResolvedValue({ ...run, deletedAt: "2026-09-28T02:00:00.000Z" }),
  deleteModelDigestRun: vi.fn().mockResolvedValue(undefined),
  restoreModelDigestRun: vi.fn().mockResolvedValue(run)
};

const overview: ModelDigestOverview = {
  settings: { enabled: false, recipientIds: [], schedule: { weekdays: [1, 2, 3, 4, 5], localTime: "09:00", timeZone: "Asia/Shanghai" } },
  emails: [{ id: "123e4567-e89b-42d3-a456-426614174000", label: "工作邮箱", address: "user@example.com" }],
  readiness: { aiConfigured: true, smtpConfigured: true }, latestRun: null, lastRun: null, activeRun: null, nextRunAt: null
};

describe("model digest page", () => {
  it("runs an immediate summary without sending email unless opted in", async () => {
    const api = {
      ...historyApi,
      getModelDigest: vi.fn().mockResolvedValue(overview),
      updateModelDigestSettings: vi.fn(),
      startModelDigestRun: vi.fn().mockResolvedValue({ runId: run.id }),
      getModelDigestRun: vi.fn().mockResolvedValue(run)
    };
    render(<MemoryRouter><ModelDigestPage api={api} /></MemoryRouter>);

    expect(await screen.findByText("最新模型总结")).toBeVisible();
    expect(screen.getByLabelText("本次同时发送邮件")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "立即获取并总结" }));

    await waitFor(() => expect(api.startModelDigestRun).toHaveBeenCalledWith({ sendEmail: false, recipientIds: [] }));
    expect(await screen.findByText("本周模型摘要")).toBeVisible();
  });

  it("renders a summary as headings, tables, and safe source links", async () => {
    const markdown = "# 模型趋势摘要\n\n| 模型 | 名次 |\n| --- | --- |\n| [test/model](https://huggingface.co/test/model) | 1 |\n\n[bad](javascript:alert(1))";
    const api = {
      ...historyApi,
      getModelDigest: vi.fn().mockResolvedValue({ ...overview, latestRun: { ...run, summary: markdown } }),
      updateModelDigestSettings: vi.fn(),
      startModelDigestRun: vi.fn(),
      getModelDigestRun: vi.fn()
    };
    render(<MemoryRouter><ModelDigestPage api={api} /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "模型趋势摘要" })).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByRole("link", { name: "test/model" })).toHaveAttribute("href", "https://huggingface.co/test/model");
    expect(screen.queryByRole("link", { name: "bad" })).not.toBeInTheDocument();
    expect(screen.getByText("查看来源数据").closest("details")).not.toHaveAttribute("open");
  });

  it("explains a failed Hugging Face fetch when reopening the page", async () => {
    const failedOverview: ModelDigestOverview = {
      ...overview,
      lastRun: { ...run, status: "failed", summary: null, errorCategory: "huggingface_network" }
    };
    const api = {
      ...historyApi,
      getModelDigest: vi.fn().mockResolvedValue(failedOverview),
      updateModelDigestSettings: vi.fn(),
      startModelDigestRun: vi.fn(),
      getModelDigestRun: vi.fn()
    };
    render(<MemoryRouter><ModelDigestPage api={api} /></MemoryRouter>);

    expect(await screen.findByRole("alert")).toHaveTextContent("连接 Hugging Face 失败");
    expect(screen.getByText("本次总结未完成")).toBeVisible();
  });

  it.each([
    ["upstream", "AI 模型服务返回异常"],
    ["timeout", "AI 模型响应超时"]
  ])("explains an AI %s failure", async (category, message) => {
    const api = {
      ...historyApi,
      getModelDigest: vi.fn().mockResolvedValue({
        ...overview,
        lastRun: { ...run, status: "failed", summary: null, errorCategory: category }
      }),
      updateModelDigestSettings: vi.fn(),
      startModelDigestRun: vi.fn(),
      getModelDigestRun: vi.fn()
    };
    render(<MemoryRouter><ModelDigestPage api={api} /></MemoryRouter>);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("shows saved history and a step by step timeline", async () => {
    const api = { ...historyApi,
      getModelDigest: vi.fn().mockResolvedValue({ ...overview, latestRun: run, lastRun: run }),
      updateModelDigestSettings: vi.fn(), startModelDigestRun: vi.fn(), getModelDigestRun: vi.fn().mockResolvedValue(run)
    };
    render(<MemoryRouter><ModelDigestPage api={api} /></MemoryRouter>);

    expect(await screen.findByText("查看历史记录")).toBeVisible();
    expect(screen.getByText("正在读取 Hugging Face 趋势榜")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "查看记录" }));
    await waitFor(() => expect(api.getModelDigestRun).toHaveBeenCalledWith(run.id));
    expect(screen.getByText("本周模型摘要")).toBeVisible();
  });

  it("moves a finished history record to trash and offers restore", async () => {
    const api = { ...historyApi,
      listModelDigestTrash: vi.fn().mockResolvedValue({ ...history, items: [{ ...history.items[0], deletedAt: "2026-09-28T02:00:00.000Z" }] }),
      getModelDigest: vi.fn().mockResolvedValue({ ...overview, latestRun: run, lastRun: run }),
      updateModelDigestSettings: vi.fn(), startModelDigestRun: vi.fn(), getModelDigestRun: vi.fn().mockResolvedValue(run)
    };
    render(<MemoryRouter><ModelDigestPage api={api} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "移到回收站" }));
    await waitFor(() => expect(api.deleteModelDigestRun).toHaveBeenCalledWith(run.id));
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    await waitFor(() => expect(api.listModelDigestTrash).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: "恢复" }));
    await waitFor(() => expect(api.restoreModelDigestRun).toHaveBeenCalledWith(run.id));
  });
});
