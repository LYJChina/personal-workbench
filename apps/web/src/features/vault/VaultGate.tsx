import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import type { VaultStatus } from "@workbench/contracts";
import { api } from "../../lib/api";

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

  if (status.unlocked) return <>{children}</>;

  const setupMode = !status.configured;

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
        setStatus(await api.setupVault(password));
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
            <label>
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
          )}
          {error && <p className="vault-error" role="alert">{error}</p>}
          <button className="button-primary vault-submit" type="submit" disabled={submitting}>
            {submitting ? "正在处理…" : setupMode ? "设置并进入工作台" : "解锁工作台"}
          </button>
        </form>
      </section>
    </main>
  );
}
