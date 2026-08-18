import { Link, Outlet, Route, Routes } from "react-router-dom";

const navigation = [
  { to: "/", label: "我的主页" },
  { to: "/ai-office", label: "AI 办公" },
  { to: "/reminders", label: "提醒事项" },
  { to: "/settings", label: "设置" }
];

function Shell() {
  return (
    <div className="app-shell">
      <aside aria-label="主导航" className="sidebar">
        <h1>LYJ Workbench</h1>
        <nav>
          {navigation.map((item) => (
            <Link key={item.to} to={item.to}>
              {item.label}
            </Link>
          ))}
          <span aria-disabled="true" className="disabled-nav-item">
            密码保险箱 <small>即将推出</small>
          </span>
        </nav>
      </aside>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

function Page({ title }: { title: string }) {
  return <h2>{title}</h2>;
}

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Page title="我的主页" />} />
        <Route path="ai-office" element={<Page title="AI 办公" />} />
        <Route path="ai-office/daily-report" element={<Page title="每日报告" />} />
        <Route path="reminders" element={<Page title="提醒事项" />} />
        <Route path="settings" element={<Page title="设置" />} />
      </Route>
    </Routes>
  );
}
