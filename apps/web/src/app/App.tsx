import { useEffect, useState } from "react";
import { Outlet, Route, Routes } from "react-router-dom";
import type { DashboardLayout } from "@workbench/contracts";
import { EditableDashboard } from "../features/dashboard/EditableDashboard";
import { api } from "../lib/api";
import { Sidebar } from "./Sidebar";
import { ThemeProvider, useTheme } from "./ThemeProvider";

function Shell() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main>
        <Outlet />
      </main>
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

  return <>{error && <p role="alert">{error}</p>}{layout.length > 0 && <EditableDashboard initialLayout={layout} onSave={saveLayout} />}</>;
}

function SettingsPage() {
  const { theme, setTheme } = useTheme();
  return <section><h2>设置</h2><label>主题 <select value={theme} onChange={(event) => void setTheme(event.target.value as typeof theme)}><option value="light">浅色</option><option value="dark">深色</option></select></label></section>;
}

function Page({ title }: { title: string }) {
  return <h2>{title}</h2>;
}

export function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<HomePage />} />
          <Route path="ai-office" element={<Page title="AI 办公" />} />
          <Route path="ai-office/daily-report" element={<Page title="每日报告" />} />
          <Route path="reminders" element={<Page title="提醒事项" />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </ThemeProvider>
  );
}
