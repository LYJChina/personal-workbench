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
import { Icon } from "../../app/Icon";
import { useAppearance, type WorkbenchSkin } from "../../app/AppearanceProvider";

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
  const { appearance, updateAppearance, resetAppearance } = useAppearance();
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

  if (!settings) return <section className="page-loading">{feedback ? <p role="alert">{feedback}</p> : <><span className="spinner" />正在加载设置…</>}</section>;

  return (
    <section className="settings-page">
      <header className="page-heading"><div><span className="eyebrow">PREFERENCES</span><h2>设置</h2><p>管理 AI、邮件通知和工作台外观。</p></div></header>
      {feedback && <p className="feedback-banner" role="status">{feedback}</p>}

      <section aria-labelledby="deepseek-heading">
        <div className="settings-section-heading"><div className="card-icon"><Icon name="sparkles" /></div><div><h3 id="deepseek-heading">DeepSeek</h3><p>用于日报润色和后续 AI 办公功能</p></div><span className={`status-chip ${settings.deepseek.apiKeyConfigured ? "" : "neutral"}`}>{settings.deepseek.apiKeyConfigured ? "API Key 已配置" : "API Key 未配置"}</span></div>
        <form onSubmit={saveDeepSeek}>
          <div className="form-grid"><label>API 地址<input type="url" required value={settings.deepseek.baseUrl} onChange={(event) => updateDeepSeek("baseUrl", event.target.value)} /></label><label>模型名称<input required value={settings.deepseek.model} onChange={(event) => updateDeepSeek("model", event.target.value)} /></label></div>
          <label>API Key<input aria-label="API Key" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="留空则保持不变" /><small>密钥使用 Windows DPAPI 加密，仅当前账户可读取。</small></label>
          <div className="form-actions"><button className="button-primary" type="submit">保存 DeepSeek 设置</button><button className="button-secondary" type="button" disabled={deepSeekTest?.status === "pending"} onClick={() => void runDeepSeekTest()}>{deepSeekTest?.status === "pending" ? "测试中…" : "测试 DeepSeek 连接"}</button></div>
          {deepSeekTest && deepSeekTest.status !== "pending" && <p role="status">{deepSeekTest.message}</p>}
        </form>
      </section>

      <section aria-labelledby="mail-heading">
        <div className="settings-section-heading"><div className="card-icon warm"><Icon name="mail" /></div><div><h3 id="mail-heading">邮件通知</h3><p>为每周一外勤打卡提醒提供发送服务</p></div><span className={`status-chip ${settings.mail.smtpPasswordConfigured ? "" : "neutral"}`}>{settings.mail.smtpPasswordConfigured ? "SMTP 密码已配置" : "SMTP 密码未配置"}</span></div>
        <form onSubmit={saveMail}>
          <div className="form-grid three"><label>SMTP 主机<input required value={settings.mail.smtpHost} onChange={(event) => updateMail("smtpHost", event.target.value)} /></label><label>SMTP 端口<input type="number" min="1" max="65535" required value={settings.mail.smtpPort} onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, smtpPort: Number(event.target.value) } } : current)} /></label><label>传输模式<select value={settings.mail.transportMode} onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, transportMode: event.target.value as MailSettings["transportMode"] } } : current)}><option value="starttls">STARTTLS</option><option value="tls">TLS</option></select></label></div>
          <div className="form-grid"><label>SMTP 用户名<input value={settings.mail.smtpUsername} onChange={(event) => updateMail("smtpUsername", event.target.value)} /></label>
          <label>发件地址<input type="email" required value={settings.mail.fromAddress} onChange={(event) => updateMail("fromAddress", event.target.value)} /></label>
          </div><label>SMTP 密码<input aria-label="SMTP 密码" type="password" autoComplete="new-password" value={smtpPassword} onChange={(event) => setSmtpPassword(event.target.value)} placeholder="留空则保持不变" /></label>
          <div className="form-actions"><button className="button-primary" type="submit">保存邮件设置</button><button className="button-secondary" type="button" disabled={mailTest?.status === "pending"} onClick={() => void runMailTest()}>{mailTest?.status === "pending" ? "测试中…" : "测试邮件连接"}</button></div>
          {mailTest && mailTest.status !== "pending" && <p role="status">{mailTest.message}</p>}
        </form>
      </section>

      <section aria-labelledby="appearance-heading">
        <div className="settings-section-heading"><div className="card-icon violet"><Icon name="palette" /></div><div><h3 id="appearance-heading">外观</h3><p>你的外观工作室；所有偏好仅保存在本机浏览器</p></div></div>
        <fieldset className="skin-picker">
          <legend>界面皮肤</legend>
          <div className="skin-options">
            {([
              ["aurora", "云境蓝", "蓝紫渐变与通透面板"],
              ["paper", "纸间白", "克制、清晰的办公界面"],
              ["sage", "青屿绿", "保留原来的沉静绿色"]
            ] as const).map(([value, title, description]) => (
              <label className={`skin-option skin-option-${value}`} key={value}>
                <input type="radio" name="skin" value={value} checked={appearance.skin === value} onChange={() => updateAppearance({ skin: value as WorkbenchSkin })} />
                <span className="skin-swatch" aria-hidden="true"><i /><i /><i /></span>
                <span><strong>{title}</strong><small>{description}</small></span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="appearance-controls">
          <label>主题<select value={theme} onChange={(event) => void setTheme(event.target.value as typeof theme)}><option value="light">浅色模式</option><option value="dark">深色模式</option></select></label>
          <label>界面密度<select value={appearance.density} onChange={(event) => updateAppearance({ density: event.target.value as typeof appearance.density })}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label>
          <label>圆角风格<select value={appearance.radius} onChange={(event) => updateAppearance({ radius: event.target.value as typeof appearance.radius })}><option value="rounded">柔和圆角</option><option value="subtle">轻微圆角</option></select></label>
        </div>
        <div className="appearance-footer">
          <label className="appearance-toggle"><input type="checkbox" checked={appearance.glass} onChange={(event) => updateAppearance({ glass: event.target.checked })} /><span><strong>通透面板</strong><small>启用背景模糊与轻微层次感</small></span></label>
          <button className="button-secondary" type="button" onClick={resetAppearance}>恢复默认外观</button>
        </div>
      </section>
    </section>
  );
}
