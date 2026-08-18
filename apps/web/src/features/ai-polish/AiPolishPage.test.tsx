import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { AiPolishRecord } from "@workbench/contracts";
import { AiPolishPage, type AiPolishApi } from "./AiPolishPage";

const generated: AiPolishRecord = {
  id: 1, kind: "leadership", primaryText: "项目完成", secondaryText: "请确认方案", systemPrompt: "领导沟通提示词",
  content: "领导您好，项目已完成，请确认下一步方案。", model: "deepseek-chat",
  createdAt: "2026-08-18T09:00:00.000Z", updatedAt: "2026-08-18T09:00:00.000Z"
};

function createApi(): AiPolishApi {
  return {
    generateAiPolish: vi.fn().mockResolvedValue(generated),
    generateAiSystemPrompt: vi.fn().mockResolvedValue({ prompt: "自动生成的系统提示词", model: "deepseek-chat" }),
    getAiPolishHistory: vi.fn().mockResolvedValue([]),
    updateAiPolish: vi.fn().mockImplementation(async (id, content) => ({ ...generated, id, content }))
  };
}

describe("AI polish workspace", () => {
  it("starts directly with the scenario cards and keeps history in the workspace", () => {
    const { container } = render(<MemoryRouter><AiPolishPage api={createApi()} /></MemoryRouter>);

    expect(screen.queryByText("AI POLISH")).not.toBeInTheDocument();
    expect(screen.queryByText("选择办公场景，使用对应提示词生成可以直接使用的文案。")).not.toBeInTheDocument();
    expect(screen.queryByText("本地保存")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "润色场景" })).toBeVisible();
    expect(screen.getByRole("region", { name: "历史记录" }).parentElement).toBe(container.querySelector(".ai-polish-workspace"));
  });

  it("puts translation first and moves prompt drafting into its own tool card", async () => {
    const user = userEvent.setup();
    const polishApi = createApi();
    render(<MemoryRouter><AiPolishPage api={polishApi} /></MemoryRouter>);

    const tools = within(screen.getByRole("navigation", { name: "润色场景" })).getAllByRole("link");
    expect(tools).toHaveLength(6);
    expect(tools[0]).toHaveTextContent("翻译");
    expect(tools[5]).toHaveTextContent("提示词生成");
    expect(screen.getAllByRole("link", { name: /日报填写/ })[0]).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText<HTMLInputElement>("系统提示词").value).toContain("工作日报");
    await user.click(screen.getAllByRole("link", { name: /给领导的话/ })[0]);
    expect(screen.getByLabelText("沟通素材")).toBeVisible();
    expect(screen.getByLabelText<HTMLInputElement>("系统提示词").value).toContain("职场沟通");
    await user.click(screen.getAllByRole("link", { name: /^翻译/ })[0]);
    expect(screen.getByLabelText("翻译方向")).toHaveValue("中文 → 英文");
    await user.selectOptions(screen.getByLabelText("翻译方向"), "英文 → 中文");
    expect(screen.getByLabelText("翻译方向")).toHaveValue("英文 → 中文");
    await user.click(screen.getAllByRole("link", { name: /普通润色/ })[0]);
    expect(screen.getByLabelText("待润色原文")).toBeVisible();
    await user.click(screen.getAllByRole("link", { name: /自定义/ })[0]);
    expect(screen.queryByLabelText("提示词生成需求")).not.toBeInTheDocument();
    expect(screen.getByLabelText("系统提示词")).toBeVisible();
    await user.click(screen.getByRole("link", { name: /提示词生成/ }));
    await user.type(screen.getByLabelText("提示词生成需求"), "把会议记录整理成行动项");
    await user.click(screen.getByRole("button", { name: "自动生成提示词" }));
    await waitFor(() => expect(polishApi.generateAiSystemPrompt).toHaveBeenCalledWith({ goal: "把会议记录整理成行动项" }));
    expect(screen.getByLabelText("生成的系统提示词")).toHaveValue("自动生成的系统提示词");
    expect(screen.getByText(/系统提示词已生成/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "应用到自定义" }));
    expect(screen.getByLabelText("系统提示词")).toHaveValue("自动生成的系统提示词");
    expect(screen.getByRole("link", { name: /自定义/ })).toHaveAttribute("aria-current", "page");
  });

  it("generates with the visible prompt and filters history by card", async () => {
    const polishApi = createApi();
    polishApi.getAiPolishHistory = vi.fn().mockResolvedValue([generated, { ...generated, id: 2, kind: "daily_report", content: "日报内容" }]);
    render(<MemoryRouter initialEntries={["/ai-office/polish?mode=leadership"]}><AiPolishPage api={polishApi} /></MemoryRouter>);
    await screen.findByText(/领导您好/);

    fireEvent.change(screen.getByLabelText("沟通素材"), { target: { value: "项目完成" } });
    fireEvent.change(screen.getByLabelText("希望领导关注"), { target: { value: "请确认方案" } });
    fireEvent.change(screen.getByLabelText("系统提示词"), { target: { value: "领导沟通提示词" } });
    fireEvent.click(screen.getByRole("button", { name: "整理沟通文案" }));

    await waitFor(() => expect(polishApi.generateAiPolish).toHaveBeenCalledWith({ kind: "leadership", primaryText: "项目完成", secondaryText: "请确认方案", systemPrompt: "领导沟通提示词" }));
    expect(await screen.findByRole("region", { name: "给领导的话结果" })).toHaveTextContent("领导您好");
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(1);
    expect(within(articles[0]).getByText(/领导您好/)).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "历史日报" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText(/日报内容/)).toBeVisible();
  });
});
