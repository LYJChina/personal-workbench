import { useEffect, useState, type FormEvent } from "react";
import type { VaultRecoveryStatus } from "@workbench/contracts";
import { Icon } from "../../app/Icon";

export interface AccountSecurityApi {
  getVaultRecoveryStatus(): Promise<VaultRecoveryStatus>;
  changeVaultPassword(currentPassword: string, newPassword: string): Promise<void>;
}

export function AccountSecurityPanel({ api }: { api: AccountSecurityApi }) {
  const [status, setStatus] = useState<VaultRecoveryStatus | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { let active = true; void api.getVaultRecoveryStatus().then((value) => { if (active) setStatus(value); }).catch(() => { if (active) setFeedback("无法读取账户安全状态"); }); return () => { active = false; }; }, [api]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    if (newPassword !== confirmation) return setFeedback("两次输入的新主密码不一致");
    setSubmitting(true);
    try {
      await api.changeVaultPassword(currentPassword, newPassword);
      setFeedback("主密码已修改");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "主密码修改失败");
    } finally {
      setCurrentPassword(""); setNewPassword(""); setConfirmation(""); setSubmitting(false);
    }
  }

  const stateText = status?.state === "active" ? "已启用" : status?.state === "pending" ? "等待邮箱确认" : "尚未启用";
  return <section aria-labelledby="account-security-heading">
    <div className="settings-section-heading"><div className="card-icon violet"><Icon name="lock" /></div><div><h3 id="account-security-heading">账户与安全</h3><p>管理独立主密码与邮箱恢复状态</p></div><span className={`status-chip ${status?.state === "active" ? "" : "neutral"}`}>{stateText}</span></div>
    {status?.maskedEmail && <p>恢复邮箱：<strong>{status.maskedEmail}</strong></p>}
    <form onSubmit={submit}>
      <div className="form-grid three">
        <label>当前主密码<input aria-label="当前主密码" type="password" autoComplete="current-password" required minLength={12} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
        <label>新主密码<input aria-label="新主密码" type="password" autoComplete="new-password" required minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
        <label>确认新主密码<input aria-label="确认新主密码" type="password" autoComplete="new-password" required minLength={12} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      </div>
      <div className="form-actions"><button className="button-primary" type="submit" disabled={submitting}>{submitting ? "正在修改…" : "修改主密码"}</button></div>
      {feedback && <p role="status">{feedback}</p>}
    </form>
  </section>;
}
