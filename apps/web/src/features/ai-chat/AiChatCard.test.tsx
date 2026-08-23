import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiChatMessage } from "@workbench/contracts";
import { AiChatCard, type AiChatCardApi } from "./AiChatCard";

const existing: AiChatMessage[] = [
  { id: 1, role: "user", content: "你好", model: null, createdAt: "2026-08-19T08:00:00.000Z" },
  { id: 2, role: "assistant", content: "你好，有什么可以帮你？", model: "deepseek-chat", createdAt: "2026-08-19T08:00:01.000Z" }
];

function createApi(overrides: Partial<AiChatCardApi> = {}): AiChatCardApi {
  return {
    listMessages: vi.fn().mockResolvedValue(existing),
    sendMessage: vi.fn().mockResolvedValue({ id: 4, role: "assistant", content: "这是回答", model: "deepseek-chat", createdAt: "2026-08-19T08:01:00.000Z" }),
    clearMessages: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

afterEach(() => vi.restoreAllMocks());

describe("AI chat dashboard card", () => {
  it("loads the local conversation and sends with Enter", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(<AiChatCard api={api} />);

    expect(await screen.findByText("你好，有什么可以帮你？")).toBeVisible();
    const textbox = screen.getByRole("textbox", { name: "输入问题" });
    await user.type(textbox, "帮我总结今天的工作{Enter}");

    expect(api.sendMessage).toHaveBeenCalledWith("帮我总结今天的工作");
    expect(await screen.findByText("这是回答")).toBeVisible();
    expect(textbox).toHaveValue("");
  });

  it("keeps Shift+Enter for a new line without sending", async () => {
    const api = createApi();
    render(<AiChatCard api={api} />);
    const textbox = await screen.findByRole("textbox", { name: "输入问题" });

    fireEvent.change(textbox, { target: { value: "第一行" } });
    fireEvent.keyDown(textbox, { key: "Enter", shiftKey: true });

    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(textbox).toHaveValue("第一行");
  });

  it("shows a failed question and a useful error", async () => {
    const user = userEvent.setup();
    const api = createApi({ sendMessage: vi.fn().mockRejectedValue(new Error("请先在设置中配置大模型 API")) });
    render(<AiChatCard api={api} />);
    const textbox = await screen.findByRole("textbox", { name: "输入问题" });

    await user.type(textbox, "失败的问题{Enter}");

    expect(await screen.findByText("失败的问题")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("请先在设置中配置大模型 API");
  });

  it("starts a new conversation after confirmation", async () => {
    const user = userEvent.setup();
    const api = createApi();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AiChatCard api={api} />);
    await screen.findByText("你好，有什么可以帮你？");

    await user.click(screen.getByRole("button", { name: "新对话" }));

    await waitFor(() => expect(api.clearMessages).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("你好，有什么可以帮你？")).not.toBeInTheDocument();
    expect(screen.getByText("随时问我一个问题")).toBeVisible();
  });
});
