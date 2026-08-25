import type { PasswordManagerEntryDetail, PasswordManagerEntrySummary } from "@workbench/contracts";

export function CredentialCard({ entry, revealed, onReveal, onCopy, onEdit, onDelete }: { entry: PasswordManagerEntrySummary; revealed?: PasswordManagerEntryDetail; onReveal(): void; onCopy(value: string): void; onEdit(): void; onDelete(): void }) {
  return <article className="credential-card"><h3>{entry.name}</h3><p>{entry.website}</p><label>用户名<input readOnly value={entry.username} /><button type="button" onClick={() => onCopy(entry.username)}>复制用户名 {entry.name}</button></label>
    {revealed ? <label>密码<input readOnly value={revealed.password} /><button type="button" onClick={() => onCopy(revealed.password)}>复制密码 {entry.name}</button></label> : <button type="button" onClick={onReveal}>显示密码 {entry.name}</button>}
    <p>{entry.notes}</p><button type="button" onClick={onEdit}>编辑 {entry.name}</button><button type="button" onClick={onDelete}>删除 {entry.name}</button></article>;
}
