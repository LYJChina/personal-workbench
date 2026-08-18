import { useEffect, useState, type FormEvent } from "react";
import type {
  ConnectionTestResult,
  DeepSeekSettings,
  DeepSeekSettingsUpdate,
  MailSettings,
  MailSettingsUpdate,
  SettingsResponse
} from "@workbench/contracts";
import { useTheme } from "../../app/ThemeProvider";
import { api as defaultApi } from "../../lib/api";

export interface SettingsApi {
  getSettings(): Promise<SettingsResponse>;
  updateDeepSeekSettings(settings: DeepSeekSettingsUpdate): Promise<DeepSeekSettings>;
  updateMailSettings(settings: MailSettingsUpdate): Promise<MailSettings>;
  testDeepSeekConnection(): Promise<ConnectionTestResult>;
  testMailConnection(): Promise<ConnectionTestResult>;
}

interface SettingsPageProps {
  api?: SettingsApi;
}

type TestState = ConnectionTestResult | { status: "pending"; message: string } | null;

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败，请稍后重试";
}

export function SettingsPage({ api: settingsApi = defaultApi }: SettingsPageProps) {
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [deepSeekTest, setDeepSeekTest] = useState<TestState>(null);
  const [mailTest, setMailTest] = useState<TestState>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    settingsApi.getSettings()
      .then((loaded) => { if (active) setSettings(loaded); })
      .catch((error: unknown) => { if (active) setFeedback(messageFor(error)); });
    return () => { active = false; };
  }, [settingsApi]);

  function updateDeepSeek(field: "baseUrl" | "model", value: string) {
    setSettings((current) => current ? { ...current, deepseek: { ...current.deepseek, [field]: value } } : current);
  }

  function updateMail(field: "smtpHost" | "smtpUsername" | "fromAddress", value: string) {
    setSettings((current) => current ? { ...current, mail: { ...current.mail, [field]: value } } : current);
  }

  async function saveDeepSeek(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    setFeedback(null);
    const replacement = apiKey.trim();
    const input: DeepSeekSettingsUpdate = {
      baseUrl: settings.deepseek.baseUrl,
      model: settings.deepseek.model,
      ...(replacement ? { apiKey: replacement } : {})
    };
    try {
      const deepseek = await settingsApi.updateDeepSeekSettings(input);
      setSettings((current) => current ? { ...current, deepseek } : current);
      setApiKey("");
      setFeedback("DeepSeek 设置已保存");
    } catch (error) {
      setFeedback(messageFor(error));
    }
  }

  async function saveMail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    setFeedback(null);
    const replacement = smtpPassword.trim();
    const input: MailSettingsUpdate = {
      smtpHost: settings.mail.smtpHost,
      smtpPort: settings.mail.smtpPort,
      transportMode: settings.mail.transportMode,
      smtpUsername: settings.mail.smtpUsername,
      fromAddress: settings.mail.fromAddress,
      ...(replacement ? { smtpPassword: replacement } : {})
    };
    try {
      const mail = await settingsApi.updateMailSettings(input);
      setSettings((current) => current ? { ...current, mail } : current);
      setSmtpPassword("");
      setFeedback("邮件设置已保存");
    } catch (error) {
      setFeedback(messageFor(error));
    }
  }

  async function runDeepSeekTest() {
    setDeepSeekTest({ status: "pending", message: "测试中…" });
    try {
      setDeepSeekTest(await settingsApi.testDeepSeekConnection());
    } catch (error) {
      setDeepSeekTest({ status: "unreachable_host", message: messageFor(error) });
    }
  }

  async function runMailTest() {
    setMailTest({ status: "pending", message: "测试中…" });
    try {
      setMailTest(await settingsApi.testMailConnection());
    } catch (error) {
      setMailTest({ status: "unreachable_host", message: messageFor(error) });
    }
  }

  if (!settings) return <section><h2>设置</h2>{feedback ? <p role="alert">{feedback}</p> : <p>正在加载设置…</p>}</section>;

  return (
    <section className="settings-page">
      <h2>设置</h2>
      {feedback && <p role="status">{feedback}</p>}

      <section aria-labelledby="deepseek-heading">
        <h3 id="deepseek-heading">DeepSeek</h3>
        <form onSubmit={saveDeepSeek}>
          <label>API 地址<input type="url" required value={settings.deepseek.baseUrl} onChange={(event) => updateDeepSeek("baseUrl", event.target.value)} /></label>
          <label>模型名称<input required value={settings.deepseek.model} onChange={(event) => updateDeepSeek("model", event.target.value)} /></label>
          <label>API Key<input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="留空则保持不变" /></label>
          <p>{settings.deepseek.apiKeyConfigured ? "API Key 已配置" : "API Key 未配置"}</p>
          <button type="submit">保存 DeepSeek 设置</button>
          <button type="button" disabled={deepSeekTest?.status === "pending"} onClick={() => void runDeepSeekTest()}>{deepSeekTest?.status === "pending" ? "测试中…" : "测试 DeepSeek 连接"}</button>
          {deepSeekTest && deepSeekTest.status !== "pending" && <p role="status">{deepSeekTest.message}</p>}
        </form>
      </section>

      <section aria-labelledby="mail-heading">
        <h3 id="mail-heading">邮件</h3>
        <form onSubmit={saveMail}>
          <label>SMTP 主机<input required value={settings.mail.smtpHost} onChange={(event) => updateMail("smtpHost", event.target.value)} /></label>
          <label>SMTP 端口<input type="number" min="1" max="65535" required value={settings.mail.smtpPort} onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, smtpPort: Number(event.target.value) } } : current)} /></label>
          <label>传输模式<select value={settings.mail.transportMode} onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, transportMode: event.target.value as MailSettings["transportMode"] } } : current)}><option value="starttls">STARTTLS</option><option value="tls">TLS</option></select></label>
          <label>SMTP 用户名<input value={settings.mail.smtpUsername} onChange={(event) => updateMail("smtpUsername", event.target.value)} /></label>
          <label>发件地址<input type="email" required value={settings.mail.fromAddress} onChange={(event) => updateMail("fromAddress", event.target.value)} /></label>
          <label>SMTP 密码<input type="password" autoComplete="new-password" value={smtpPassword} onChange={(event) => setSmtpPassword(event.target.value)} placeholder="留空则保持不变" /></label>
          <p>{settings.mail.smtpPasswordConfigured ? "SMTP 密码已配置" : "SMTP 密码未配置"}</p>
          <button type="submit">保存邮件设置</button>
          <button type="button" disabled={mailTest?.status === "pending"} onClick={() => void runMailTest()}>{mailTest?.status === "pending" ? "测试中…" : "测试邮件连接"}</button>
          {mailTest && mailTest.status !== "pending" && <p role="status">{mailTest.message}</p>}
        </form>
      </section>

      <section aria-labelledby="appearance-heading">
        <h3 id="appearance-heading">外观</h3>
        <label>主题 <select value={theme} onChange={(event) => void setTheme(event.target.value as typeof theme)}><option value="light">浅色</option><option value="dark">深色</option></select></label>
      </section>
    </section>
  );
}
