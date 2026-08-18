import { Link } from "react-router-dom";
import { Icon } from "../../app/Icon";

export function AiOfficePage() {
  return (
    <section className="ai-office-page">
      <header className="page-heading"><div><span className="eyebrow">AI OFFICE</span><h2>AI 办公</h2><p>把重复的文字工作交给 AI，把时间留给更重要的事情。</p></div></header>
      <div className="feature-hero ai-hero"><div className="feature-icon"><Icon name="sparkles" size={28} /></div><div><span className="status-chip">DeepSeek 驱动</span><h3>你的日常办公助手</h3><p>所有输入通过本机服务处理，API Key 使用 Windows 加密保护。</p></div></div>
      <div className="section-heading"><div><h3>可用工具</h3><p>首批工具已就绪，后续可继续扩展。</p></div><span className="count-badge">1 个工具</span></div>
      <div className="ai-tool-grid">
        <Link aria-label="日报填写" className="ai-tool-card" to="/ai-office/daily-report">
          <span className="tool-icon"><Icon name="file" size={24} /></span>
          <span className="tool-content"><strong>日报填写</strong><span>根据今日完成事项与风险，生成专业、清晰的工作日报。</span></span>
          <span className="tool-arrow">进入 <span aria-hidden="true">→</span></span>
        </Link>
        <div className="ai-tool-card coming-tool" aria-disabled="true"><span className="tool-icon muted"><Icon name="sparkles" size={24} /></span><span className="tool-content"><strong>更多 AI 工具</strong><span>会议纪要、邮件润色等功能正在规划中。</span></span><span className="status-chip neutral">即将推出</span></div>
      </div>
    </section>
  );
}
