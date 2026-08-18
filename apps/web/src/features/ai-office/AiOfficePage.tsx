import { Link } from "react-router-dom";
import { Icon } from "../../app/Icon";

export function AiOfficePage() {
  return (
    <section className="ai-office-page">
      <header className="page-heading"><div><span className="eyebrow">AI OFFICE</span><h2>AI 办公</h2><p>把重复的文字工作交给 AI，把时间留给更重要的事情。</p></div></header>
      <div className="section-heading"><div><h3>可用工具</h3><p>所有输入通过本机服务处理，API Key 使用 Windows 加密保护。</p></div><span className="count-badge">1 个工具</span></div>
      <div className="ai-tool-grid">
        <Link aria-label="AI 润色" className="ai-tool-card" to="/ai-office/polish">
          <span className="tool-icon"><Icon name="sparkles" size={24} /></span>
          <span className="tool-content"><strong>AI 润色</strong><span>日报、领导沟通、翻译和普通润色，按不同场景使用专属提示词。</span></span>
          <span className="tool-arrow">进入 <span aria-hidden="true">→</span></span>
        </Link>
      </div>
    </section>
  );
}
