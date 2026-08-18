import { useEffect, useState } from "react";
import { Outlet, Route, Routes } from "react-router-dom";
import type { DashboardLayout } from "@workbench/contracts";
import { EditableDashboard } from "../features/dashboard/EditableDashboard";
import { AiOfficePage } from "../features/ai-office/AiOfficePage";
import { DailyReportPage } from "../features/daily-report/DailyReportPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { ReminderPage } from "../features/reminders/ReminderPage";
import { api } from "../lib/api";
import { Sidebar } from "./Sidebar";
import { ThemeProvider } from "./ThemeProvider";
import { Icon } from "./Icon";
import { AppearanceProvider } from "./AppearanceProvider";
import { AiPolishPage } from "../features/ai-polish/AiPolishPage";

function Shell() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <Sidebar />
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-context"><span className="status-dot" />本地工作台</div>
          <div className="privacy-badge"><Icon name="lock" size={15} /> 数据仅保存在此电脑</div>
        </header>
        <main id="main-content"><Outlet /></main>
      </div>
    </div>
  );
}

function HomePage() {
  const [layout, setLayout] = useState<DashboardLayout[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getLayout().then(setLayout).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "工作台加载失败"));
  }, []);

  async function saveLayout(nextLayout: DashboardLayout[]) {
    setLayout(await api.updateLayout(nextLayout));
  }

  if (error) return <div className="empty-state" role="alert"><strong>工作台暂时无法加载</strong><span>{error}</span></div>;
  if (layout.length === 0) return <div className="page-loading" role="status"><span className="spinner" />正在准备你的工作台…</div>;
  return <EditableDashboard initialLayout={layout} onSave={saveLayout} />;
}

export function App() {
  return (
    <AppearanceProvider>
      <ThemeProvider>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<HomePage />} />
            <Route path="ai-office" element={<AiOfficePage />} />
            <Route path="ai-office/polish" element={<AiPolishPage />} />
            <Route path="ai-office/daily-report" element={<DailyReportPage />} />
            <Route path="reminders" element={<ReminderPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </ThemeProvider>
    </AppearanceProvider>
  );
}
