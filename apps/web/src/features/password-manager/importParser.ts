import type { PasswordManagerEntryInput, PasswordManagerImportPreview } from "@workbench/contracts";

const MAX_IMPORT_CHARS = 1_000_000;
const MAX_ITEMS = 10_000;
const required = ["name", "username", "password"] as const;

type TaggedEntry = Record<string, string>;

function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }

function entry(value: Record<string, unknown>): PasswordManagerEntryInput | null {
  const candidate = {
    name: text(value.name ?? value.title), website: text(value.website ?? value.url),
    username: text(value.username ?? value.user ?? value.email), password: text(value.password ?? value.pass),
    notes: text(value.notes), customFields: Array.isArray(value.customFields) ? value.customFields : undefined
  };
  if (!candidate.name || !candidate.username || !candidate.password) return null;
  return {
    name: candidate.name.slice(0, 100), website: candidate.website.slice(0, 2_000), username: candidate.username.slice(0, 320), password: candidate.password.slice(0, 1_024),
    ...(candidate.notes ? { notes: candidate.notes.slice(0, 20_000) } : {}), ...(candidate.customFields ? { customFields: candidate.customFields as PasswordManagerEntryInput["customFields"] } : {})
  };
}

function delimited(textValue: string, separator: string): Record<string, string>[] {
  const rows = textValue.split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) return [];
  const values = (row: string) => row.split(separator).map((part) => part.trim().replace(/^"|"$/g, ""));
  const headings = values(rows[0]).map((heading) => heading.toLowerCase());
  return rows.slice(1).map((row) => Object.fromEntries(values(row).map((value, index) => [headings[index] ?? "", value])));
}

function tagged(textValue: string): TaggedEntry[] {
  const record: TaggedEntry = {};
  for (const line of textValue.split(/\r?\n/)) {
    const match = line.match(/^\s*(name|title|website|url|username|user|email|password|pass|notes)\s*:\s*(.*)$/i);
    if (match) record[match[1].toLowerCase()] = match[2];
  }
  return Object.keys(record).length ? [record] : [];
}

export function parseLocalImport(raw: string): PasswordManagerImportPreview {
  if (raw.length > MAX_IMPORT_CHARS) return { items: [], duplicates: [], warnings: ["导入文本过大"], source: "local" };
  const source = raw.trim();
  if (!source) return { items: [], duplicates: [], warnings: ["没有可导入的内容"], source: "local" };
  let records: Record<string, unknown>[] = [];
  let malformed = false;
  if (source.startsWith("[") || source.startsWith("{")) {
    try { const parsed = JSON.parse(source) as unknown; records = (Array.isArray(parsed) ? parsed : [parsed]).filter((item): item is Record<string, unknown> => !!item && typeof item === "object"); }
    catch { malformed = true; }
  } else if (source.includes("\t")) records = delimited(source, "\t");
  else if (source.includes(",")) records = delimited(source, ",");
  else records = tagged(source);
  const invalid = records.filter((record) => !entry(record)).length;
  const items = records.map(entry).filter((item): item is PasswordManagerEntryInput => !!item).slice(0, MAX_ITEMS);
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
  const warnings = [malformed ? "导入格式不正确" : "", invalid ? `有 ${invalid} 条记录缺少名称、用户名或密码` : "", records.length > MAX_ITEMS ? "导入记录过多" : ""].filter(Boolean);
  return { items, duplicates: [...counts].filter(([, count]) => count > 1).map(([name]) => name), warnings, source: "local" };
}

export function redactImportForAi(preview: PasswordManagerImportPreview): { redactedText: string; placeholders: Map<string, string> } {
  const placeholders = new Map<string, string>();
  let next = 1;
  const replace = (value: string) => { const token = `[CREDENTIAL_${next++}]`; placeholders.set(token, value); return token; };
  const redacted = preview.items.map((item) => ({ name: item.name, website: item.website, username: replace(item.username), password: replace(item.password), notes: item.notes ? "[REDACTED_NOTE]" : undefined, customFields: item.customFields?.map((field) => ({ label: field.label, value: "[REDACTED_FIELD]" })) }));
  return { redactedText: JSON.stringify(redacted), placeholders };
}

export function restoreRedactedAiResult(result: PasswordManagerImportPreview, placeholders: Map<string, string>): PasswordManagerImportPreview {
  const restore = (value: string | undefined) => value ? placeholders.get(value) ?? value : value;
  return { ...result, items: result.items.map((item) => ({ ...item, username: restore(item.username) ?? "", password: restore(item.password) ?? "" })) };
}
