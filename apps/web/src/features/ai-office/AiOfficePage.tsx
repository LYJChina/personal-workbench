import { Link } from "react-router-dom";

export function AiOfficePage() {
  return (
    <section className="ai-office-page">
      <h2>AI 办公</h2>
      <p>选择一个工具开始处理日常办公任务。</p>
      <div className="ai-tool-grid">
        <Link aria-label="日报填写" className="ai-tool-card" to="/ai-office/daily-report">
          <strong>日报填写</strong>
          <span>根据今日完成事项与风险生成简洁日报</span>
        </Link>
      </div>
    </section>
  );
}
