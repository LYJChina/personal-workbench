import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { SurfaceLayoutItem } from "@workbench/contracts";
import { Icon, type IconName } from "../../app/Icon";
import { usePluginContributions } from "../../plugins/ContributionProvider";
import { EditableSurfaceGrid } from "../layout/EditableSurfaceGrid";

function iconName(value: string): IconName {
  const supported: IconName[] = ["home", "sparkles", "bell", "lock", "settings", "edit", "arrow", "user", "copy", "file", "palette", "mail", "check", "grid", "clock"];
  return supported.includes(value as IconName) ? value as IconName : "grid";
}

export interface AiOfficeTool { id: string; label: string; path: string; icon: string; description: string; }

interface AiOfficePageProps {
  initialLayout?: SurfaceLayoutItem[];
  onSave?: (layout: SurfaceLayoutItem[]) => Promise<void>;
  tools?: AiOfficeTool[];
}

const emptyLayout: SurfaceLayoutItem[] = [];

function defaultLayout(tool: AiOfficeTool, index: number): SurfaceLayoutItem {
  return { itemId: tool.id, surface: "ai-office", x: (index % 2) * 8, y: Math.floor(index / 2) * 4, w: 8, h: 4, enabled: true };
}

function mergeLayout(tools: AiOfficeTool[], initialLayout: SurfaceLayoutItem[]): SurfaceLayoutItem[] {
  const stored = initialLayout.filter((item) => item.surface === "ai-office");
  return [...stored, ...tools.filter((tool) => !stored.some((item) => item.itemId === tool.id)).map(defaultLayout)];
}

export function AiOfficePage({ initialLayout = emptyLayout, onSave, tools: toolsOverride }: AiOfficePageProps) {
  const { aiTools } = usePluginContributions();
  const tools = toolsOverride ?? aiTools;
  const [layout, setLayout] = useState(() => mergeLayout(tools, initialLayout));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!editing) setLayout(mergeLayout(tools, initialLayout)); }, [editing, initialLayout, tools]);
  const toolsById = useMemo(() => new Map(tools.map((tool) => [tool.id, tool])), [tools]);

  async function finishEditing() {
    setSaving(true);
    try { await onSave?.(layout); setEditing(false); } finally { setSaving(false); }
  }
  return (
    <section className="ai-office-page">
      <header className="page-heading"><div><span className="eyebrow">AI OFFICE</span><h2>AI 办公</h2><p>把重复的文字工作交给 AI，把时间留给更重要的事情。</p></div><button className="button-secondary" type="button" disabled={saving} onClick={() => editing ? void finishEditing() : setEditing(true)}>{editing ? "完成编辑" : "编辑工具"}</button></header>
      <div className="ai-tool-grid" data-testid="ai-office-grid" data-item-count={layout.length}>
        <EditableSurfaceGrid surface="ai-office" items={layout.filter((item) => toolsById.has(item.itemId))} editing={editing} onLayoutChange={setLayout} renderItem={(item) => {
          const tool = toolsById.get(item.itemId)!;
          return <Link aria-label={tool.label} className="ai-tool-card" to={tool.path}>
            <span className="tool-icon"><Icon name={iconName(tool.icon)} size={24} /></span>
            <span className="tool-content"><strong>{tool.label}</strong><span>{tool.description}</span></span>
            <span className="tool-arrow">进入 <span aria-hidden="true">→</span></span>
          </Link>;
        }} />
      </div>
      <aside className="ai-office-note" aria-label="可用工具说明"><Icon name="lock" size={15} /><span><strong>可用工具</strong><small>所有输入通过本机服务处理，API Key 保存在本地加密保险库中。</small></span></aside>
    </section>
  );
}
