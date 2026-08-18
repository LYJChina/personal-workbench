import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { NavigationItem } from "@workbench/contracts";
import { SidebarEditor } from "../features/dashboard/SidebarEditor";
import { api } from "../lib/api";

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

  if (editing) return <SidebarEditor initialItems={items} onSave={save} onClose={() => setEditing(false)} />;

  return (
    <aside aria-label="主导航" className="sidebar">
      <h1>LYJ Workbench</h1>
      {error && <p role="alert">{error}</p>}
      <nav>
        {items.filter((item) => item.visible).sort((a, b) => a.position - b.position).map((item) => {
          if (item.id === "vault-coming-soon") return <span key={item.id} aria-disabled="true" className="disabled-nav-item">{item.label} <small>即将推出</small></span>;
          return <Link key={item.id} to={item.path}>{item.label}</Link>;
        })}
      </nav>
      <button type="button" onClick={() => setEditing(true)}>编辑导航</button>
    </aside>
  );
}
