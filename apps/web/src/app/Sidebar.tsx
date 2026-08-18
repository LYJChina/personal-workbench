import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import type { NavigationItem } from "@workbench/contracts";
import { SidebarEditor } from "../features/dashboard/SidebarEditor";
import { api } from "../lib/api";
import { Icon, type IconName } from "./Icon";

interface SidebarProps {
  initialItems?: NavigationItem[];
}

const fallbackItems: NavigationItem[] = [
  { id: "home", label: "我的主页", path: "/", position: 0, visible: true, disabled: false },
  { id: "ai-office", label: "AI 办公", path: "/ai-office", position: 1, visible: true, disabled: false },
  { id: "reminders", label: "提醒事项", path: "/reminders", position: 2, visible: true, disabled: false },
  { id: "vault-coming-soon", label: "密码保险箱", path: "/vault", position: 3, visible: true, disabled: true },
  { id: "settings", label: "设置", path: "/settings", position: 4, visible: true, disabled: false }
];

const navIcons: Record<string, IconName> = { home: "home", "ai-office": "sparkles", reminders: "bell", "vault-coming-soon": "lock", settings: "settings" };

export function Sidebar({ initialItems }: SidebarProps) {
  const [items, setItems] = useState<NavigationItem[]>(initialItems ?? fallbackItems);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialItems) {
      setItems(initialItems);
      return;
    }
    api.getNavigation().then(setItems).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "导航加载失败"));
  }, [initialItems]);

  async function save(itemsToSave: NavigationItem[]) {
    const saved = await api.updateNavigation(itemsToSave);
    setItems(saved);
  }

  if (editing) return <aside className="sidebar sidebar-editing"><SidebarEditor initialItems={items} onSave={save} onClose={() => setEditing(false)} /></aside>;

  return (
    <aside aria-label="主导航" className="sidebar">
      <div className="brand"><span className="brand-mark"><Icon name="grid" size={20} /></span><span><strong>LYJ</strong><small>PERSONAL WORKBENCH</small></span></div>
      {error && <p role="alert">{error}</p>}
      <nav>
        {items.filter((item) => item.visible).sort((a, b) => a.position - b.position).map((item) => {
          const icon = <Icon name={navIcons[item.id] ?? "grid"} />;
          if (item.id === "vault-coming-soon") return <span key={item.id} aria-disabled="true" className="disabled-nav-item">{icon}{item.label}<small>即将推出</small></span>;
          return <NavLink key={item.id} to={item.path} end={item.path === "/"} className={({ isActive }) => isActive ? "active" : undefined}>{icon}<span>{item.label}</span></NavLink>;
        })}
      </nav>
      <div className="sidebar-footer"><button className="button-ghost" type="button" onClick={() => setEditing(true)}><Icon name="edit" size={17} />编辑导航</button><p><span className="status-dot" /> 本地服务已连接</p></div>
    </aside>
  );
}
