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
  { id: "plugins", label: "插件中心", path: "/plugins", position: 3, visible: true, disabled: false },
  { id: "password-manager", label: "密码保险箱", path: "/password-vault", position: 4, visible: true, disabled: false },
  { id: "settings", label: "设置", path: "/settings", position: 5, visible: true, disabled: false }
];

const navIcons: Record<string, IconName> = { home: "home", "ai-office": "sparkles", reminders: "bell", "password-manager": "lock", plugins: "grid", settings: "settings" };
const iconNames = new Set<IconName>(["home", "sparkles", "bell", "lock", "settings", "edit", "arrow", "user", "copy", "file", "palette", "mail", "check", "grid", "clock"]);

function iconName(value: string | undefined): IconName {
  return value && iconNames.has(value as IconName) ? value as IconName : "grid";
}

export function Sidebar({ initialItems }: SidebarProps) {
  const { navigation } = usePluginContributions();
  const [preferences, setPreferences] = useState<NavigationItem[]>(initialItems ?? fallbackPreferences);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("LYJ");

  useEffect(() => {
    if (initialItems) {
      setPreferences(initialItems);
      return;
    }
    api.getNavigation().then(setPreferences).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "导航加载失败"));
  }, [initialItems]);
  useEffect(() => { void api.getProfile().then((profile) => setProfileName(profile.name.trim() || "LYJ")).catch(() => undefined); }, []);

  const coreIds = new Set<NavigationItem["id"]>(["home", "ai-office", "plugins", "password-manager", "settings"]);
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
    const storedById = new Map(preferences.map((item) => [item.id, item]));
    const activePositionSlots = preferences
      .filter((item) => activeIds.has(item.id))
      .map((item) => item.position)
      .sort((left, right) => left - right);
    const occupiedPositions = new Set(preferences.map((item) => item.position));
    let activeSlot = 0;
    const mergedActive = active.map((item) => {
      if (storedById.has(item.id)) return { ...item, position: activePositionSlots[activeSlot++]! };
      let position = item.position;
      while (occupiedPositions.has(position)) position += 1;
      occupiedPositions.add(position);
      return { ...item, position };
    });
    const inactive = preferences.filter((item) => item.id !== "plugins" && !activeIds.has(item.id));
    const payload = [...inactive, ...mergedActive]
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
    setPreferences(await api.updateNavigation(payload));
  }

  if (editing) return <aside className="sidebar sidebar-editing"><SidebarEditor initialItems={items.filter((item) => item.id !== "plugins")} onSave={save} onClose={() => setEditing(false)} /></aside>;

  const visibleItems = items
    .filter((item) => item.visible)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  const workspaceItems = visibleItems.filter((item) => item.id !== "settings" && item.id !== "plugins");
  const pluginItem = visibleItems.find((item) => item.id === "plugins") ?? fallbackPreferences.find((item) => item.id === "plugins")!;

  function renderLink(item: NavigationItem) {
    const contributionIcon = contributionById.get(item.id)?.icon;
    const icon = <Icon name={navIcons[item.id] ?? iconName(contributionIcon)} />;
    return <NavLink key={item.id} to={item.path} end={item.path === "/"} className={({ isActive }) => isActive ? "active" : undefined}>{icon}<span>{item.label}</span></NavLink>;
  }

  return (
    <aside aria-label="主导航" className="sidebar">
      <div className="brand"><span className="brand-mark"><Icon name="grid" size={20} /></span><span><strong>{profileName}</strong><small>PERSONAL WORKBENCH</small></span></div>
      {error && <p role="alert">{error}</p>}
      <div className="sidebar-navigation">
        <nav aria-label="工作区">{workspaceItems.map(renderLink)}</nav>
        <section className="sidebar-plugin-section"><p className="sidebar-section-label">插件</p><nav aria-label="插件">{renderLink(pluginItem)}</nav></section>
      </div>
      <div className="sidebar-footer"><NavLink to="/settings" className={({ isActive }) => `sidebar-settings-link${isActive ? " active" : ""}`}><Icon name="settings" /><span>设置</span></NavLink><button className="button-ghost" type="button" onClick={() => setEditing(true)}><Icon name="edit" size={17} />编辑导航</button><p><span className="status-dot" /> 本地服务已连接</p></div>
    </aside>
  );
}
