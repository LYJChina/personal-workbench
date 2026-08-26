import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
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
  const aiConnection = {
    id: "legacy-deepseek",
    name: "DeepSeek",
    protocol: "openai" as const,
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    apiKeyConfigured: true,
    isDefault: true
  };
  return {
    getSettings: vi.fn().mockResolvedValue(configuredSettings),
    getAiConnections: vi.fn().mockResolvedValue([aiConnection]),
    createAiConnection: vi.fn(),
    updateAiConnection: vi.fn(),
    setDefaultAiConnection: vi.fn(),
    testAiConnection: vi.fn().mockResolvedValue({ status: "success", message: "连接成功" }),
    deleteAiConnection: vi.fn(),
    updateMailSettings: vi.fn().mockImplementation(async (input) => ({ ...input, smtpPasswordConfigured: Boolean(input.smtpPassword) || true })),
    testMailConnection: vi.fn().mockResolvedValue({ status: "success", message: "连接成功" }),
    exportDatabase: vi.fn().mockResolvedValue("LYJWorkBench-backup-2026-08-23.sqlite"),
    getPlugins: vi.fn().mockResolvedValue([]),
    getAiOfficeOrder: vi.fn().mockResolvedValue([]),
    updateAiOfficeOrder: vi.fn().mockImplementation(async (order) => order),
    setPluginEnabled: vi.fn(),
    resetPluginSafeMode: vi.fn().mockResolvedValue([])
    ,getVaultRecoveryStatus: vi.fn().mockResolvedValue({ state: "disabled", maskedEmail: null, smtpHealth: "unknown", checkedAt: null })
    ,changeVaultPassword: vi.fn().mockResolvedValue(undefined)
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
  it("keeps core settings usable while plugin management loads or fails", async () => {
    const settingsApi = createApi();
    const pluginFailure = new Error("raw plugin database failure");
    Object.assign(settingsApi, {
      getPlugins: vi.fn().mockRejectedValue(pluginFailure),
      setPluginEnabled: vi.fn(),
      resetPluginSafeMode: vi.fn()
    });
    renderPage(settingsApi);

    expect(await screen.findByRole("heading", { name: "模型服务" })).toBeVisible();
    expect(screen.getByRole("button", { name: "添加模型服务" })).toBeEnabled();
    expect(await screen.findByRole("alert")).toHaveTextContent("系统插件暂时无法读取。其他设置仍可正常使用。");
    expect(document.body).not.toHaveTextContent("raw plugin database failure");
  });

  it("shows a non-blocking appearance retry and retries the failed legacy target", async () => {
    const legacy = { skin: "paper", density: "compact", radius: "subtle", glass: false } as const;
    localStorage.setItem("workbench.appearance.v1", JSON.stringify(legacy));
    const appearanceApi = {
      getAppearance: vi.fn().mockResolvedValue({ appearance: null }),
      updateAppearance: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(legacy)
    };
    render(
      <AppearanceProvider api={appearanceApi}>
        <ThemeProvider initialTheme="light" onSave={vi.fn().mockResolvedValue(undefined)}>
          <SettingsPage api={createApi()} />
        </ThemeProvider>
      </AppearanceProvider>
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("外观偏好尚未保存");
    expect(screen.getByLabelText(/冰羽蓝/)).toBeChecked();
    expect(localStorage.getItem("workbench.appearance.v1")).toBe(JSON.stringify(legacy));
    fireEvent.click(screen.getByRole("button", { name: "重试保存外观" }));
    await waitFor(() => expect(screen.getByLabelText(/雾林青/)).toBeChecked());
    expect(appearanceApi.updateAppearance).toHaveBeenLastCalledWith(legacy);
    expect(localStorage.getItem("workbench.appearance.v1")).toBeNull();
  });

  it("shows configured status without displaying saved secret values", async () => {
    renderPage();

    expect(await screen.findByText("API Key 已配置")).toBeVisible();
    expect(screen.getByText("SMTP 密码已配置")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "编辑 DeepSeek" }));
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    expect(screen.getByLabelText("SMTP 密码")).toHaveValue("");
    expect(screen.queryByDisplayValue(/secret/i)).not.toBeInTheDocument();
  });

  it("omits empty secret inputs so saving leaves stored secrets unchanged", async () => {
    const settingsApi = renderPage();
    await screen.findByDisplayValue("smtp.example.com");

    fireEvent.click(screen.getByRole("button", { name: "保存邮件设置" }));

    await waitFor(() => {
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
    await screen.findByDisplayValue("smtp.example.com");

    fireEvent.change(screen.getByLabelText("SMTP 密码"), { target: { value: "replacement-password" } });
    fireEvent.click(screen.getByRole("button", { name: "保存邮件设置" }));

    await waitFor(() => {
      expect(settingsApi.updateMailSettings).toHaveBeenCalledWith(expect.objectContaining({ smtpPassword: "replacement-password" }));
    });
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

  it("explains portable encrypted backups and exports once while the action is pending", async () => {
    let finishExport!: (filename: string) => void;
    const settingsApi = createApi();
    settingsApi.exportDatabase = vi.fn(() => new Promise<string>((resolve) => { finishExport = resolve; }));
    renderPage(settingsApi);

    expect(await screen.findByRole("heading", { name: "备份与迁移" })).toBeVisible();
    expect(screen.getByText(/头像/)).toBeVisible();
    expect(screen.getByText(/加密后的密钥/)).toBeVisible();
    expect(screen.getAllByText(/同一主密码/)).not.toHaveLength(0);
    expect(screen.getByText(/明文密钥不会被直接读取/)).toBeVisible();

    const button = screen.getByRole("button", { name: "导出数据库" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(settingsApi.exportDatabase).toHaveBeenCalledTimes(1);
    finishExport("LYJWorkBench-backup-2026-08-23.sqlite");
    expect(await screen.findByRole("status")).toHaveTextContent("备份已导出");
  });

  it("restores its mounted lifecycle marker after the Strict Mode effect replay", async () => {
    const settingsApi = createApi();
    render(
      <StrictMode>
        <AppearanceProvider initialAppearance={defaultAppearance}>
          <ThemeProvider initialTheme="light" onSave={vi.fn().mockResolvedValue(undefined)}>
            <SettingsPage api={settingsApi} />
          </ThemeProvider>
        </AppearanceProvider>
      </StrictMode>
    );

    await screen.findByRole("heading", { name: "备份与迁移" });
    fireEvent.click(screen.getByRole("button", { name: "导出数据库" }));

    expect(await screen.findByRole("status")).toHaveTextContent("备份已导出");
    expect(screen.getByRole("button", { name: "导出数据库" })).toBeEnabled();
  });

  it("shows an accessible export failure and does not update state after unmount", async () => {
    const failureApi = createApi();
    failureApi.exportDatabase = vi.fn().mockRejectedValue(new Error("导出失败，请稍后重试"));
    const view = render(
      <AppearanceProvider initialAppearance={defaultAppearance}>
        <ThemeProvider initialTheme="light" onSave={vi.fn().mockResolvedValue(undefined)}>
          <SettingsPage api={failureApi} />
        </ThemeProvider>
      </AppearanceProvider>
    );

    await screen.findByRole("heading", { name: "备份与迁移" });
    fireEvent.click(screen.getByRole("button", { name: "导出数据库" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("导出失败，请稍后重试");

    let resolvePending!: (filename: string) => void;
    const pendingApi = createApi();
    pendingApi.exportDatabase = vi.fn(() => new Promise<string>((resolve) => { resolvePending = resolve; }));
    view.rerender(
      <AppearanceProvider initialAppearance={defaultAppearance}>
        <ThemeProvider initialTheme="light" onSave={vi.fn().mockResolvedValue(undefined)}>
          <SettingsPage api={pendingApi} />
        </ThemeProvider>
      </AppearanceProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "导出数据库" }));
    view.unmount();
    resolvePending("LYJWorkBench-backup.sqlite");
    await Promise.resolve();
  });
});
