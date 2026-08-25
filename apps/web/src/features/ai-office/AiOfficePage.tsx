import { Link } from "react-router-dom";
import { Icon, type IconName } from "../../app/Icon";
import { usePluginContributions } from "../../plugins/ContributionProvider";

function iconName(value: string): IconName {
  const supported: IconName[] = ["home", "sparkles", "bell", "lock", "settings", "edit", "arrow", "user", "copy", "file", "palette", "mail", "check", "grid", "clock"];
  return supported.includes(value as IconName) ? value as IconName : "grid";
}

export function AiOfficePage() {
  const { aiTools } = usePluginContributions();
  return (
    <section className="ai-office-page">
      <header className="page-heading"><div><span className="eyebrow">AI OFFICE</span><h2>AI 办公</h2><p>把重复的文字工作交给 AI，把时间留给更重要的事情。</p></div></header>
      <div className="ai-tool-grid">
        {aiTools.map((tool) => (
          <Link aria-label={tool.label} className="ai-tool-card" to={tool.path} key={tool.id}>
            <span className="tool-icon"><Icon name={iconName(tool.icon)} size={24} /></span>
            <span className="tool-content"><strong>{tool.label}</strong><span>{tool.description}</span></span>
            <span className="tool-arrow">进入 <span aria-hidden="true">→</span></span>
          </Link>
        ))}
      </div>
      <aside className="ai-office-note" aria-label="可用工具说明"><Icon name="lock" size={15} /><span><strong>可用工具</strong><small>所有输入通过本机服务处理，API Key 保存在本地加密保险库中。</small></span></aside>
    </section>
  );
}
