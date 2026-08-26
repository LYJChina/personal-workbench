import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import type { VaultStatus } from "@workbench/contracts";
import { api } from "../../lib/api";
import { smtpPresets, type SmtpPresetId } from "./smtpPresets";

interface VaultGateProps {
  children: ReactNode;
}

export function VaultGate({ children }: VaultGateProps) {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [legacyImportDetected, setLegacyImportDetected] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState<"none" | "choose" | "code" | "smtp">("none");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [smtpEmail, setSmtpEmail] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpPreset, setSmtpPreset] = useState<SmtpPresetId>("gmail");
  const [smtpHost, setSmtpHost] = useState<string>(smtpPresets.gmail.host);
  const [smtpPort, setSmtpPort] = useState<number>(smtpPresets.gmail.port);
  const [transportMode, setTransportMode] = useState<"starttls" | "tls">(smtpPresets.gmail.transportMode);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [confirmationCode, setConfirmationCode] = useState("");

  useEffect(() => {
    let active = true;
    api.getVaultStatus()
      .then((nextStatus) => {
        if (active) setStatus(nextStatus);
        if (active && !nextStatus.configured) {
          void api.getLegacyImportStatus()
            .then((legacyStatus) => { if (active) setLegacyImportDetected(legacyStatus.detected); })
            .catch(() => undefined);
        }
      })
      .catch(() => { if (active) setError("无法读取本地保险库状态，请重新启动工作台"); });
    return () => { active = false; };
  }, []);

  if (!status) {
    return (
      <main className="vault-gate" aria-labelledby="vault-title">
        <section className="vault-panel">
          <h1 id="vault-title">本地保险库</h1>
          {error
            ? <p className="vault-error" role="alert">{error}</p>
            : <p className="vault-loading" role="status"><span className="spinner" />正在检查本地保险库…</p>}
        </section>
      </main>
    );
  }

  if (confirmationPending) {
    return <main className="vault-gate" aria-labelledby="vault-title"><section className="vault-panel">
      <h1 id="vault-title">确认恢复邮箱</h1><p className="vault-description">请输入刚刚发送到恢复邮箱的 6 位确认码。</p>
      <form className="vault-form" onSubmit={async (event) => { event.preventDefault(); setSubmitting(true); setError(null); try { await api.confirmVaultRecovery(confirmationCode); setConfirmationPending(false); setStatus({ configured: true, unlocked: true }); } catch (reason) { setError(reason instanceof Error ? reason.message : "确认失败"); } finally { setConfirmationCode(""); setSubmitting(false); } }}>
        <label><span>邮箱确认码</span><input inputMode="numeric" pattern="\d{6}" maxLength={6} value={confirmationCode} onChange={(event) => setConfirmationCode(event.target.value)} /></label>
        {error && <p className="vault-error" role="alert">{error}</p>}
        <button className="button-primary" type="submit" disabled={submitting}>确认并进入工作台</button>
      </form>
    </section></main>;
  }

  if (status.unlocked) return <>{children}</>;

  const setupMode = !status.configured;

  async function submitRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password !== confirmation) return setError("两次输入的新主密码不一致");
    if (password.length < 12 || password.length > 1024) return setError("主密码须为 12 至 1024 个字符");
    setSubmitting(true);
    try {
      if (recoveryMode === "code") await api.resetVaultWithRecoveryCode(recoveryCode, password);
      else await api.resetVaultWithSmtp(smtpEmail, smtpPassword, password);
      setStatus({ configured: true, unlocked: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "恢复失败，请稍后再试");
    } finally {
      setPassword(""); setConfirmation(""); setRecoveryCode(""); setSmtpPassword(""); setSubmitting(false);
    }
  }

  if (!setupMode && recoveryMode !== "none") {
    return (
      <main className="vault-gate" aria-labelledby="vault-title"><section className="vault-panel">
        <span className="vault-kicker">ACCOUNT RECOVERY</span>
        <h1 id="vault-title">找回工作台</h1>
        {recoveryMode === "choose" ? <div className="vault-form">
          <button className="button-primary" type="button" onClick={() => setRecoveryMode("code")}>使用邮件恢复码</button>
          <button className="button-secondary" type="button" onClick={() => setRecoveryMode("smtp")}>使用 SMTP 邮箱恢复</button>
          <button className="button-secondary" type="button" onClick={() => setRecoveryMode("none")}>返回主密码登录</button>
        </div> : <form className="vault-form" onSubmit={submitRecovery} aria-busy={submitting}>
          {recoveryMode === "code" ? <label><span>邮件恢复码</span><input type="password" autoComplete="off" value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} /></label> : <>
            <label><span>SMTP 邮箱</span><input type="email" value={smtpEmail} onChange={(event) => setSmtpEmail(event.target.value)} /></label>
            <label><span>SMTP 授权码</span><input type="password" autoComplete="off" value={smtpPassword} onChange={(event) => setSmtpPassword(event.target.value)} /></label>
          </>}
          <label><span>设置新主密码</span><input type="password" autoComplete="new-password" minLength={12} maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label><span>确认新主密码</span><input type="password" autoComplete="new-password" minLength={12} maxLength={1024} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
          {error && <p className="vault-error" role="alert">{error}</p>}
          <button className="button-primary vault-submit" type="submit" disabled={submitting}>重设密码并进入</button>
          <button className="button-secondary" type="button" onClick={() => setRecoveryMode("choose")}>返回</button>
        </form>}
      </section></main>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (setupMode && password !== confirmation) {
      setError("两次输入的主密码不一致");
      return;
    }
    if (password.length < 12 || password.length > 1024) {
      setError("主密码须为 12 至 1024 个字符");
      return;
    }

    setSubmitting(true);
    try {
      if (setupMode) {
        await api.enrollVault({ masterPassword: password, recoveryEmail, mail: { smtpHost, smtpPort, transportMode, smtpUsername: smtpEmail, fromAddress: smtpEmail, smtpPassword } });
        setConfirmationPending(true);
      } else {
        await api.unlockVault(password);
        setStatus({ configured: true, unlocked: true });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保险库操作失败，请稍后再试");
    } finally {
      setPassword("");
      setConfirmation("");
      setSubmitting(false);
    }
  }

  return (
    <main className="vault-gate" aria-labelledby="vault-title">
      <section className="vault-panel">
        <span className="vault-kicker">LOCAL SECURITY</span>
        <h1 id="vault-title">{setupMode ? "保护你的本地数据" : "解锁工作台"}</h1>
        <p className="vault-description">
          {setupMode
            ? "设置一个主密码，用于加密 API 密钥和邮箱密码。更换设备时，它将随数据库安全迁移。"
            : "输入主密码以访问保存的 API 与邮箱设置。主密码只用于本次运行，不会保存在浏览器中。"}
        </p>
        {setupMode && legacyImportDetected && <p>检测到旧版 Windows 密钥，将在设置主密码后迁移</p>}
        <form className="vault-form" onSubmit={submit} aria-busy={submitting}>
          <label>
            <span>{setupMode ? "设置主密码" : "主密码"}</span>
            <input
              type="password"
              autoComplete={setupMode ? "new-password" : "current-password"}
              value={password}
              disabled={submitting}
              minLength={12}
              maxLength={1024}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {setupMode && (
            <><label>
              <span>确认主密码</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmation}
                disabled={submitting}
                minLength={12}
                maxLength={1024}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <label><span>邮箱服务商</span><select aria-label="邮箱服务商" value={smtpPreset} onChange={(event) => { const id = event.target.value as SmtpPresetId; setSmtpPreset(id); const preset = smtpPresets[id]; if (preset) { setSmtpHost(preset.host); setSmtpPort(preset.port); setTransportMode(preset.transportMode); } }}><option value="gmail">Gmail</option><option value="qq">QQ 邮箱</option><option value="netease163">网易 163</option><option value="custom">自定义 SMTP</option></select></label>
            <label><span>SMTP 主机</span><input aria-label="SMTP 主机" value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} /></label>
            <label><span>SMTP 端口</span><input aria-label="SMTP 端口" type="number" min={1} max={65535} value={smtpPort} onChange={(event) => setSmtpPort(Number(event.target.value))} /></label>
            <label><span>传输模式</span><select value={transportMode} onChange={(event) => setTransportMode(event.target.value as "starttls" | "tls")}><option value="tls">TLS</option><option value="starttls">STARTTLS</option></select></label>
            <label><span>SMTP 邮箱</span><input aria-label="SMTP 邮箱" type="email" value={smtpEmail} onChange={(event) => setSmtpEmail(event.target.value)} /></label>
            <label><span>SMTP 授权码</span><input aria-label="SMTP 授权码" type="password" autoComplete="off" value={smtpPassword} onChange={(event) => setSmtpPassword(event.target.value)} /></label>
            <label><span>恢复邮箱</span><input aria-label="恢复邮箱" type="email" value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} /></label></>
          )}
          {error && <p className="vault-error" role="alert">{error}</p>}
          <button className="button-primary vault-submit" type="submit" disabled={submitting}>
            {submitting ? "正在处理…" : setupMode ? "设置并进入工作台" : "解锁工作台"}
          </button>
          {!setupMode && <button className="button-secondary" type="button" onClick={() => setRecoveryMode("choose")}>忘记主密码</button>}
        </form>
      </section>
    </main>
  );
}
