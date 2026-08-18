import { useEffect, useState } from "react";
import { Link, Outlet, Route, Routes } from "react-router-dom";
import type { ProfileResponse, ProfileUpdate } from "@workbench/contracts";
import { ProfileCard } from "../features/profile/ProfileCard";
import { api } from "../lib/api";

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

const emptyProfile: ProfileResponse = {
  name: "",
  birthday: "",
  employeeNumber: "",
  customFields: [],
  photoFilename: null
};

function HomePage() {
  const [profile, setProfile] = useState<ProfileResponse>(emptyProfile);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getProfile().then(setProfile).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "个人信息加载失败"));
  }, []);

  async function saveProfile(input: ProfileUpdate) {
    const saved = await api.updateProfile(input);
    setProfile(saved);
  }

  async function uploadPhoto(photo: File) {
    const saved = await api.uploadProfilePhoto(photo);
    setProfile(saved);
    return saved;
  }

  return <>{error && <p role="alert">{error}</p>}<ProfileCard initialProfile={profile} onSave={saveProfile} onUploadPhoto={uploadPhoto} /></>;
}

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<HomePage />} />
        <Route path="ai-office" element={<Page title="AI 办公" />} />
        <Route path="ai-office/daily-report" element={<Page title="每日报告" />} />
        <Route path="reminders" element={<Page title="提醒事项" />} />
        <Route path="settings" element={<Page title="设置" />} />
      </Route>
    </Routes>
  );
}
