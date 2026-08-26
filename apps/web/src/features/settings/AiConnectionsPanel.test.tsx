import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiConnectionsPanel, type AiConnectionsApi } from "./AiConnectionsPanel";

const deepseek = {
  id: "legacy-deepseek",
  name: "DeepSeek",
  protocol: "openai" as const,
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  apiKeyConfigured: true,
  isDefault: true
};

const claude = {
  id: "claude-main",
  name: "Claude",
  protocol: "anthropic" as const,
  baseUrl: "https://api.anthropic.com/v1",
  model: "claude-sonnet",
  apiKeyConfigured: false,
  isDefault: false
};

function createApi(): AiConnectionsApi {
  let connections = [deepseek, claude];
  return {
    getAiConnections: vi.fn(async () => connections),
    createAiConnection: vi.fn(async (input) => {
      const created = { id: "new-service", ...input, apiKeyConfigured: Boolean(input.apiKey), isDefault: false };
      connections = [...connections, created];
      return created;
    }),
    updateAiConnection: vi.fn(async (id, input) => {
      const current = connections.find((entry) => entry.id === id)!;
      const updated = { ...current, ...input, apiKeyConfigured: Boolean(input.apiKey) || current.apiKeyConfigured };
      connections = connections.map((entry) => entry.id === id ? updated : entry);
      return updated;
    }),
    setDefaultAiConnection: vi.fn(async (id) => {
      connections = connections.map((entry) => ({ ...entry, isDefault: entry.id === id }));
      return connections.find((entry) => entry.id === id)!;
    }),
    testAiConnection: vi.fn(async () => ({ status: "success" as const, message: "连接成功" })),
    deleteAiConnection: vi.fn(async (id) => { connections = connections.filter((entry) => entry.id !== id); })
  };
}

describe("AiConnectionsPanel", () => {
  it("lists connections without rendering saved keys and marks the default", async () => {
    render(<AiConnectionsPanel api={createApi()} />);

    expect(await screen.findByRole("heading", { name: "模型服务" })).toBeVisible();
    expect(screen.getByText("DeepSeek")).toBeVisible();
    expect(screen.getByText("Claude")).toBeVisible();
    expect(screen.getByText("默认服务")).toBeVisible();
    expect(screen.getByText("API Key 已配置")).toBeVisible();
    expect(screen.queryByDisplayValue(/secret|key/i)).not.toBeInTheDocument();
  });

  it("creates an Anthropic connection and sends a newly entered key", async () => {
    const api = createApi();
    render(<AiConnectionsPanel api={api} />);
    await screen.findByText("DeepSeek");

    fireEvent.click(screen.getByRole("button", { name: "添加模型服务" }));
    fireEvent.change(screen.getByLabelText("服务名称"), { target: { value: "Claude 工作" } });
    fireEvent.change(screen.getByLabelText("协议"), { target: { value: "anthropic" } });
    fireEvent.change(screen.getByLabelText("API 地址"), { target: { value: "https://api.anthropic.com/v1" } });
    fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "claude-sonnet" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "anthropic-key" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模型服务" }));

    await waitFor(() => expect(api.createAiConnection).toHaveBeenCalledWith({
      name: "Claude 工作",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-sonnet",
      apiKey: "anthropic-key"
    }, expect.any(AbortSignal)));
    expect(await screen.findByText("Claude 工作")).toBeVisible();
  });

  it("preserves an existing key while editing and can test, switch, and delete connections", async () => {
    const api = createApi();
    render(<AiConnectionsPanel api={api} />);
    await screen.findByText("DeepSeek");

    fireEvent.click(screen.getByRole("button", { name: "编辑 Claude" }));
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "claude-opus" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模型服务" }));
    await waitFor(() => expect(api.updateAiConnection).toHaveBeenCalledWith("claude-main", {
      name: "Claude",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-opus"
    }, expect.any(AbortSignal)));

    fireEvent.click(screen.getByRole("button", { name: "测试 Claude" }));
    expect(await screen.findByText("连接成功")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "将 Claude 设为默认" }));
    await waitFor(() => expect(api.setDefaultAiConnection).toHaveBeenCalledWith("claude-main", expect.any(AbortSignal)));
    fireEvent.click(screen.getByRole("button", { name: "删除 DeepSeek" }));
    await waitFor(() => expect(api.deleteAiConnection).toHaveBeenCalledWith("legacy-deepseek", expect.any(AbortSignal)));
  });

  it("keeps the final connection and shows a sanitized load failure", async () => {
    const api = createApi();
    api.getAiConnections = vi.fn().mockResolvedValue([deepseek]);
    const { unmount } = render(<AiConnectionsPanel api={api} />);
    await screen.findByText("DeepSeek");
    expect(screen.getByRole("button", { name: "删除 DeepSeek" })).toBeDisabled();

    unmount();
    const failingApi = createApi();
    failingApi.getAiConnections = vi.fn().mockRejectedValue(new Error("raw sqlite path C:\\private"));
    render(<AiConnectionsPanel api={failingApi} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("模型服务暂时无法读取，请稍后重试。");
    expect(document.body).not.toHaveTextContent("raw sqlite");
  });

  it("aborts an in-flight connection action when the panel unmounts", async () => {
    const api = createApi();
    let actionSignal: AbortSignal | undefined;
    api.testAiConnection = vi.fn((_id, signal) => {
      actionSignal = signal;
      return new Promise<never>(() => undefined);
    });
    const { unmount } = render(<AiConnectionsPanel api={api} />);
    await screen.findByText("DeepSeek");

    fireEvent.click(screen.getByRole("button", { name: "测试 DeepSeek" }));
    expect(actionSignal?.aborted).toBe(false);
    unmount();

    expect(actionSignal?.aborted).toBe(true);
  });

  it("requires an explicit default switch before deleting the current default", async () => {
    render(<AiConnectionsPanel api={createApi()} />);
    await screen.findByText("DeepSeek");

    expect(screen.getByRole("button", { name: "删除 DeepSeek" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除 Claude" })).toBeEnabled();
  });
});
