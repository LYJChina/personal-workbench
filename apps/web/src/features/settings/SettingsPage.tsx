import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  ConnectionTestResult,
  MailSettings,
  MailSettingsUpdate,
  SettingsResponse
} from "@workbench/contracts";
import type { AiPersonaSettings } from "@workbench/contracts";
import { useTheme } from "../../app/ThemeProvider";
import { api as defaultApi } from "../../lib/api";
import { Icon } from "../../app/Icon";
import { useAppearance, type WorkbenchSkin } from "../../app/AppearanceProvider";
import { PluginManager, type PluginManagerApi } from "../plugins/PluginManager";
import { AiConnectionsPanel, type AiConnectionsApi } from "./AiConnectionsPanel";
import { AccountSecurityPanel, type AccountSecurityApi } from "./AccountSecurityPanel";

export interface SettingsApi extends PluginManagerApi, AiConnectionsApi, AccountSecurityApi {
  getSettings(): Promise<SettingsResponse>;
  updateMailSettings(settings: MailSettingsUpdate): Promise<MailSettings>;
  testMailConnection(): Promise<ConnectionTestResult>;
  exportDatabase(): Promise<string>;
  getAiPersona(): Promise<AiPersonaSettings>;
  updateAiPersona(settings: Omit<AiPersonaSettings, "updatedAt">): Promise<AiPersonaSettings>;
}

function AiPersonaPanel({ api }: { api: SettingsApi }) {
  const [value, setValue] = useState<AiPersonaSettings | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => { void api.getAiPersona().then(setValue).catch(() => setMessage("画像加载失败")); }, [api]);
  if (!value) return <section className="settings-section"><p>{message || "正在加载 AI 画像…"}</p></section>;
  async function save(event: FormEvent) { event.preventDefault(); setMessage("保存中…"); try { setValue(await api.updateAiPersona({ assistantName: value.assistantName, personality: value.personality, userProfile: value.userProfile, customPrompt: value.customPrompt })); setMessage("AI 设置已保存"); } catch { setMessage("保存失败"); } }
  return <section className="settings-section" aria-labelledby="ai-persona-heading"><div className="settings-section-heading"><div className="card-icon"><Icon name="sparkles" /></div><div><h3 id="ai-persona-heading">问问 AI 设置</h3><p>自定义 AI 名称、性格和会话系统提示词。</p></div></div><form onSubmit={(event) => void save(event)}><div className="form-grid"><label>AI 名称<input value={value.assistantName} onChange={(event) => setValue({ ...value, assistantName: event.target.value })} /></label><label>AI 性格<input value={value.personality} onChange={(event) => setValue({ ...value, personality: event.target.value })} /></label></div><label>我的个人画像<textarea rows={4} value={value.userProfile} onChange={(event) => setValue({ ...value, userProfile: event.target.value })} /></label><label>自定义系统提示词<textarea rows={5} value={value.customPrompt} onChange={(event) => setValue({ ...value, customPrompt: event.target.value })} /></label><div className="form-actions"><button className="button-primary" type="submit">保存 AI 设置</button>{message && <span role="status">{message}</span>}</div></form></section>;
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
  const { appearance, updateAppearance, resetAppearance, persistenceError, retryAppearance } = useAppearance();
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpCurrentPassword, setSmtpCurrentPassword] = useState("");
  const [mailTest, setMailTest] = useState<TestState>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const mounted = useRef(true);
  const exportInFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    settingsApi.getSettings()
      .then((loaded) => { if (active) setSettings(loaded); })
      .catch((error: unknown) => { if (active) setFeedback(messageFor(error)); });
    return () => { active = false; };
  }, [settingsApi]);

  function updateMail(field: "smtpHost" | "smtpUsername" | "fromAddress", value: string) {
    setSettings((current) => current ? { ...current, mail: { ...current.mail, [field]: value } } : current);
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
      ...(replacement ? { smtpPassword: replacement } : {}),
      ...(replacement && smtpCurrentPassword ? { currentPassword: smtpCurrentPassword } : {})
    };
    try {
      const mail = await settingsApi.updateMailSettings(input);
      setSettings((current) => current ? { ...current, mail } : current);
      setSmtpPassword("");
      setSmtpCurrentPassword("");
      setFeedback("邮件设置已保存");
    } catch (error) {
      setFeedback(messageFor(error));
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

  async function exportBackup() {
    if (exportInFlight.current) return;
    exportInFlight.current = true;
    setExporting(true);
    setExportFeedback(null);
    try {
      const filename = await settingsApi.exportDatabase();
      if (mounted.current) setExportFeedback({ kind: "success", message: `备份已导出：${filename}` });
    } catch (error) {
      if (mounted.current) setExportFeedback({ kind: "error", message: messageFor(error) });
    } finally {
      exportInFlight.current = false;
      if (mounted.current) setExporting(false);
    }
  }

  if (!settings) return <section className="page-loading">{feedback ? <p role="alert">{feedback}</p> : <><span className="spinner" />正在加载设置…</>}</section>;

  return (
    <section className="settings-page">
      <header className="page-heading"><div><span className="eyebrow">PREFERENCES</span><h2>设置</h2><p>管理 AI、邮件通知、备份和工作台外观。</p></div></header>
      {feedback && <p className="feedback-banner" role="status">{feedback}</p>}

      <AiConnectionsPanel api={settingsApi} />
      <AiPersonaPanel api={settingsApi} />
      <AccountSecurityPanel api={settingsApi} />

      <section aria-labelledby="mail-heading">
        <div className="settings-section-heading"><div className="card-icon warm"><Icon name="mail" /></div><div><h3 id="mail-heading">邮件通知</h3><p>仅供手动测试发送；提醒计划不会自动发送邮件</p></div><span className={`status-chip ${settings.mail.smtpPasswordConfigured ? "" : "neutral"}`}>{settings.mail.smtpPasswordConfigured ? "SMTP 密码已配置" : "SMTP 密码未配置"}</span></div>
        <form onSubmit={saveMail}>
          <div className="form-grid three"><label>SMTP 主机<input required value={settings.mail.smtpHost} onChange={(event) => updateMail("smtpHost", event.target.value)} /></label><label>SMTP 端口<input type="number" min="1" max="65535" required value={settings.mail.smtpPort} onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, smtpPort: Number(event.target.value) } } : current)} /></label><label>传输模式<select value={settings.mail.transportMode} onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, transportMode: event.target.value as MailSettings["transportMode"] } } : current)}><option value="starttls">STARTTLS</option><option value="tls">TLS</option></select></label></div>
          <div className="form-grid"><label>SMTP 用户名<input value={settings.mail.smtpUsername} onChange={(event) => updateMail("smtpUsername", event.target.value)} /></label>
          <label>发件地址<input type="email" required value={settings.mail.fromAddress} onChange={(event) => updateMail("fromAddress", event.target.value)} /></label>
          </div><label>SMTP 密码<input aria-label="SMTP 密码" type="password" autoComplete="new-password" value={smtpPassword} onChange={(event) => setSmtpPassword(event.target.value)} placeholder="留空则保持不变" /></label>
          {smtpPassword && <label>当前主密码<input aria-label="更新 SMTP 时的当前主密码" type="password" autoComplete="current-password" value={smtpCurrentPassword} onChange={(event) => setSmtpCurrentPassword(event.target.value)} placeholder="用于同步更新 SMTP 恢复密钥" /></label>}
          <div className="form-actions"><button className="button-primary" type="submit">保存邮件设置</button><button className="button-secondary" type="button" disabled={mailTest?.status === "pending"} onClick={() => void runMailTest()}>{mailTest?.status === "pending" ? "测试中…" : "测试邮件连接"}</button></div>
          {mailTest && mailTest.status !== "pending" && <p role="status">{mailTest.message}</p>}
        </form>
      </section>

      <PluginManager api={settingsApi} />

      <section aria-labelledby="backup-heading">
        <div className="settings-section-heading"><div className="card-icon"><Icon name="file" /></div><div><h3 id="backup-heading">备份与迁移</h3><p>导出一份完整且可验证的本地数据库快照</p></div></div>
        <p>导出的数据库包含个人资料和头像、加密后的密钥、设置、提醒和历史。迁移后需要使用同一主密码；明文密钥不会被直接读取。</p>
        <div className="form-actions"><button className="button-primary" type="button" disabled={exporting} onClick={() => void exportBackup()}>{exporting ? "正在导出…" : "导出数据库"}</button></div>
        {exportFeedback && <p role={exportFeedback.kind === "error" ? "alert" : "status"}>{exportFeedback.message}</p>}
      </section>

      <section aria-labelledby="appearance-heading">
        <div className="settings-section-heading"><div className="card-icon violet"><Icon name="palette" /></div><div><h3 id="appearance-heading">外观</h3><p>外观偏好保存在权威 SQLite 数据库中，并随数据库备份迁移</p></div></div>
        <fieldset className="skin-picker">
          <legend>界面皮肤</legend>
          <div className="skin-options">
            {([
              ["aurora", "冰羽蓝", "冰晶照片与轻盈蓝色玻璃"],
              ["paper", "雾林青", "晨雾山林与沉静青色玻璃"],
              ["sage", "星河夜", "极光星空与深邃靛紫玻璃"]
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
        {persistenceError ? <div role="alert"><span>外观偏好尚未保存，当前预览不会丢失。</span><button className="button-secondary" type="button" onClick={retryAppearance}>重试保存外观</button></div> : null}
      </section>
    </section>
  );
}
