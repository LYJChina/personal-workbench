import { useEffect, useState } from "react";
import { Outlet, Route, Routes } from "react-router-dom";
import type { DashboardLayout } from "@workbench/contracts";
import { EditableDashboard } from "../features/dashboard/EditableDashboard";
import { AiOfficePage } from "../features/ai-office/AiOfficePage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { api } from "../lib/api";
import { ContributionProvider, usePluginContributions } from "../plugins/ContributionProvider";
import { PluginRoutes } from "../plugins/PluginRoutes";
import { Sidebar } from "./Sidebar";
import { ThemeProvider } from "./ThemeProvider";
import { Icon } from "./Icon";
import { AppearanceProvider } from "./AppearanceProvider";
import { VaultGate } from "../features/vault/VaultGate";
import { PasswordManagerPage } from "../features/password-manager/PasswordManagerPage";
import { PluginCenterPage } from "../features/plugins/PluginCenterPage";

function Shell() {
  const { loading, error } = usePluginContributions();
  const [smtpWarning, setSmtpWarning] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    api.getVaultRecoveryStatus().then((status) => {
      if (!active) return;
      if (status.smtpHealth === "invalid") setSmtpWarning("SMTP 授权已失效，请前往设置更新");
      else if (status.smtpHealth === "unreachable") setSmtpWarning("暂时无法检测 SMTP，稍后会再次检测");
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <Sidebar />
      <div className="app-main">
        <header className="topbar" aria-label="本地数据状态">
          <div className="privacy-badge"><Icon name="lock" size={15} /> 数据仅保存在此电脑</div>
        </header>
        {loading && <p className="info-banner" role="status">正在加载插件功能…</p>}
        {error && <p className="info-banner" role="alert">{error}</p>}
        {smtpWarning && <p className="info-banner" role="status">{smtpWarning}</p>}
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
        <VaultGate>
          <ContributionProvider>
            <Routes>
              <Route element={<Shell />}>
                <Route index element={<HomePage />} />
                <Route path="ai-office" element={<AiOfficePage />} />
                <Route path="password-vault" element={<PasswordManagerPage />} />
                <Route path="plugins" element={<PluginCenterPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<PluginRoutes />} />
              </Route>
            </Routes>
          </ContributionProvider>
        </VaultGate>
      </ThemeProvider>
    </AppearanceProvider>
  );
}
