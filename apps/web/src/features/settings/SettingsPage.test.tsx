import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../app/ThemeProvider";
import { SettingsPage, type SettingsApi } from "./SettingsPage";
import { AppearanceProvider, defaultAppearance } from "../../app/AppearanceProvider";

const configuredSettings = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKeyConfigured: true },
  mail: {
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    transportMode: "starttls" as const,
    smtpUsername: "sender@example.com",
    fromAddress: "sender@example.com",
    smtpPasswordConfigured: true
  }
};

function createApi(): SettingsApi {
  return {
    getSettings: vi.fn().mockResolvedValue(configuredSettings),
    updateDeepSeekSettings: vi.fn().mockImplementation(async (input) => ({ ...input, apiKeyConfigured: Boolean(input.apiKey) || true })),
    updateMailSettings: vi.fn().mockImplementation(async (input) => ({ ...input, smtpPasswordConfigured: Boolean(input.smtpPassword) || true })),
    testDeepSeekConnection: vi.fn().mockResolvedValue({ status: "success", message: "连接成功" }),
    testMailConnection: vi.fn().mockResolvedValue({ status: "success", message: "连接成功" })
  };
}

function renderPage(settingsApi = createApi()) {
  render(
    <AppearanceProvider initialAppearance={defaultAppearance}>
      <ThemeProvider initialTheme="light" onSave={vi.fn().mockResolvedValue(undefined)}>
        <SettingsPage api={settingsApi} />
      </ThemeProvider>
    </AppearanceProvider>
  );
  return settingsApi;
}

describe("SettingsPage", () => {
  it("shows configured status without displaying saved secret values", async () => {
    renderPage();

    expect(await screen.findByText("API Key 已配置")).toBeVisible();
    expect(screen.getByText("SMTP 密码已配置")).toBeVisible();
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    expect(screen.getByLabelText("SMTP 密码")).toHaveValue("");
    expect(screen.queryByDisplayValue(/secret/i)).not.toBeInTheDocument();
  });

  it("omits empty secret inputs so saving leaves stored secrets unchanged", async () => {
    const settingsApi = renderPage();
    await screen.findByDisplayValue("deepseek-chat");

    fireEvent.click(screen.getByRole("button", { name: "保存 DeepSeek 设置" }));
    fireEvent.click(screen.getByRole("button", { name: "保存邮件设置" }));

    await waitFor(() => {
      expect(settingsApi.updateDeepSeekSettings).toHaveBeenCalledWith({ baseUrl: "https://api.deepseek.com", model: "deepseek-chat" });
      expect(settingsApi.updateMailSettings).toHaveBeenCalledWith({
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        transportMode: "starttls",
        smtpUsername: "sender@example.com",
        fromAddress: "sender@example.com"
      });
    });
  });

  it("submits replacement secrets only when the user enters them", async () => {
    const settingsApi = renderPage();
    await screen.findByDisplayValue("deepseek-chat");

    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "replacement-key" } });
    fireEvent.change(screen.getByLabelText("SMTP 密码"), { target: { value: "replacement-password" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 DeepSeek 设置" }));
    fireEvent.click(screen.getByRole("button", { name: "保存邮件设置" }));

    await waitFor(() => {
      expect(settingsApi.updateDeepSeekSettings).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "replacement-key" }));
      expect(settingsApi.updateMailSettings).toHaveBeenCalledWith(expect.objectContaining({ smtpPassword: "replacement-password" }));
    });
  });

  it.each([
    ["success", "连接成功"],
    ["auth_failure", "身份验证失败，请检查凭据"],
    ["timeout", "连接超时，请稍后重试"],
    ["unreachable_host", "无法连接到服务器"]
  ] as const)("shows the DeepSeek %s connection-test state", async (status, message) => {
    let resolveTest!: (value: { status: typeof status; message: string }) => void;
    const pending = new Promise<{ status: typeof status; message: string }>((resolve) => { resolveTest = resolve; });
    const settingsApi = createApi();
    settingsApi.testDeepSeekConnection = vi.fn().mockReturnValue(pending);
    renderPage(settingsApi);
    await screen.findByDisplayValue("deepseek-chat");

    fireEvent.click(screen.getByRole("button", { name: "测试 DeepSeek 连接" }));
    expect(screen.getByRole("button", { name: "测试中…" })).toBeDisabled();
    resolveTest({ status, message });

    expect(await screen.findByText(message)).toBeVisible();
  });

  it.each([
    ["success", "连接成功"],
    ["auth_failure", "身份验证失败，请检查凭据"],
    ["timeout", "连接超时，请稍后重试"],
    ["unreachable_host", "无法连接到服务器"]
  ] as const)("shows the mail %s connection-test state", async (status, message) => {
    const settingsApi = createApi();
    settingsApi.testMailConnection = vi.fn().mockResolvedValue({ status, message });
    renderPage(settingsApi);
    await screen.findByDisplayValue("smtp.example.com");

    fireEvent.click(screen.getByRole("button", { name: "测试邮件连接" }));

    expect(await screen.findByText(message)).toBeVisible();
  });

  it("reuses the existing theme provider for the appearance section", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AppearanceProvider initialAppearance={defaultAppearance}>
        <ThemeProvider initialTheme="light" onSave={onSave}>
          <SettingsPage api={createApi()} />
        </ThemeProvider>
      </AppearanceProvider>
    );
    await screen.findByText("外观");

    fireEvent.change(screen.getByLabelText("主题"), { target: { value: "dark" } });

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("dark"));
  });

  it("previews skin, density, radius and glass settings immediately", async () => {
    renderPage();
    await screen.findByText("外观");

    fireEvent.click(screen.getByLabelText(/雾林青/));
    fireEvent.change(screen.getByLabelText("界面密度"), { target: { value: "compact" } });
    fireEvent.change(screen.getByLabelText("圆角风格"), { target: { value: "subtle" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /通透面板/ }));

    expect(document.documentElement).toHaveAttribute("data-skin", "paper");
    expect(document.documentElement).toHaveAttribute("data-density", "compact");
    expect(document.documentElement).toHaveAttribute("data-radius", "subtle");
    expect(document.documentElement).toHaveAttribute("data-glass", "false");
  });
});
