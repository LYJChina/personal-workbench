import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import type { NavigationItem } from "@workbench/contracts";
import { SidebarEditor } from "../features/dashboard/SidebarEditor";
import { api } from "../lib/api";
import { usePluginContributions } from "../plugins/ContributionProvider";
import { Icon, type IconName } from "./Icon";

interface SidebarProps {
  initialItems?: NavigationItem[];
}

const fallbackPreferences: NavigationItem[] = [
  { id: "home", label: "我的主页", path: "/", position: 0, visible: true, disabled: false },
  { id: "ai-office", label: "AI 办公", path: "/ai-office", position: 1, visible: true, disabled: false },
  { id: "reminders", label: "提醒事项", path: "/reminders", position: 2, visible: true, disabled: false },
  { id: "vault-coming-soon", label: "密码保险箱", path: "/vault", position: 3, visible: true, disabled: true },
  { id: "settings", label: "设置", path: "/settings", position: 4, visible: true, disabled: false }
];

const navIcons: Record<string, IconName> = { home: "home", "ai-office": "sparkles", reminders: "bell", "vault-coming-soon": "lock", settings: "settings" };
const iconNames = new Set<IconName>(["home", "sparkles", "bell", "lock", "settings", "edit", "arrow", "user", "copy", "file", "palette", "mail", "check", "grid", "clock"]);

function iconName(value: string | undefined): IconName {
  return value && iconNames.has(value as IconName) ? value as IconName : "grid";
}

export function Sidebar({ initialItems }: SidebarProps) {
  const { navigation } = usePluginContributions();
  const [preferences, setPreferences] = useState<NavigationItem[]>(initialItems ?? fallbackPreferences);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialItems) {
      setPreferences(initialItems);
      return;
    }
    api.getNavigation().then(setPreferences).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "导航加载失败"));
  }, [initialItems]);

  const coreIds = new Set<NavigationItem["id"]>(["home", "ai-office", "vault-coming-soon", "settings"]);
  const preferenceById = new Map(preferences.map((item) => [item.id, item]));
  const contributionById = new Map(navigation.map((item) => [item.id, item]));
  const items = preferences
    .filter((item) => coreIds.has(item.id) || contributionById.has(item.id))
    .map((item) => {
      const contribution = contributionById.get(item.id);
      return contribution ? { ...item, label: contribution.label, path: contribution.path } : item;
    });
  for (const contribution of navigation) {
    if (!preferenceById.has(contribution.id)) {
      items.push({
        id: contribution.id,
        label: contribution.label,
        path: contribution.path,
        position: contribution.position,
        visible: true,
        disabled: false
      });
    }
  }

  async function save(itemsToSave: NavigationItem[]) {
    const active = [...itemsToSave].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
    const activeIds = new Set(active.map((item) => item.id));
    const queue = [...active];
    const payload = [...preferences]
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
      .map((item) => activeIds.has(item.id) ? queue.shift()! : item);
    payload.push(...queue);
    const normalized = payload.map((item, position) => ({ ...item, position }));
    setPreferences(await api.updateNavigation(normalized));
  }

  if (editing) return <aside className="sidebar sidebar-editing"><SidebarEditor initialItems={items} onSave={save} onClose={() => setEditing(false)} /></aside>;

  return (
    <aside aria-label="主导航" className="sidebar">
      <div className="brand"><span className="brand-mark"><Icon name="grid" size={20} /></span><span><strong>LYJ</strong><small>PERSONAL WORKBENCH</small></span></div>
      {error && <p role="alert">{error}</p>}
      <nav>
        {items.filter((item) => item.visible).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map((item) => {
          const contributionIcon = contributionById.get(item.id)?.icon;
          const icon = <Icon name={navIcons[item.id] ?? iconName(contributionIcon)} />;
          if (item.id === "vault-coming-soon") return <span key={item.id} aria-disabled="true" className="disabled-nav-item">{icon}{item.label}<small>即将推出</small></span>;
          return <NavLink key={item.id} to={item.path} end={item.path === "/"} className={({ isActive }) => isActive ? "active" : undefined}>{icon}<span>{item.label}</span></NavLink>;
        })}
      </nav>
      <div className="sidebar-footer"><button className="button-ghost" type="button" onClick={() => setEditing(true)}><Icon name="edit" size={17} />编辑导航</button><p><span className="status-dot" /> 本地服务已连接</p></div>
    </aside>
  );
}
