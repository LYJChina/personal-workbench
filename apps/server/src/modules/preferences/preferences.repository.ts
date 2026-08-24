import type Database from "better-sqlite3";
import { AppearanceSettingsSchema, type AppearanceSettings, type DashboardLayout, type NavigationItem, type Theme } from "@workbench/contracts";

const defaultLayout: DashboardLayout[] = [
  { moduleId: "profile", x: 0, y: 0, w: 4, h: 5, enabled: true },
  { moduleId: "workday-calendar", x: 4, y: 0, w: 4, h: 5, enabled: true },
  { moduleId: "upcoming-reminders", x: 8, y: 0, w: 4, h: 5, enabled: true },
  { moduleId: "ai-chat", x: 12, y: 0, w: 4, h: 5, enabled: true }
];

const defaultNavigation: NavigationItem[] = [
  { id: "home", label: "我的主页", path: "/", position: 0, visible: true, disabled: false },
  { id: "ai-office", label: "AI 办公", path: "/ai-office", position: 1, visible: true, disabled: false },
  { id: "reminders", label: "提醒事项", path: "/reminders", position: 2, visible: true, disabled: false },
  { id: "vault-coming-soon", label: "密码保险箱", path: "/vault", position: 3, visible: true, disabled: true },
  { id: "settings", label: "设置", path: "/settings", position: 4, visible: true, disabled: false }
];

interface LayoutRow {
  module_id: DashboardLayout["moduleId"];
  x: number;
  y: number;
  w: number;
  h: number;
  enabled: number;
}

interface NavigationRow {
  id: NavigationItem["id"];
  label: string;
  path: string;
  position: number;
  visible: number;
  disabled: number;
}

export class PreferencesRepository {
  public constructor(private readonly database: Database.Database) {
    this.seed();
  }

  public getLayout(): DashboardLayout[] {
    return (this.database.prepare("SELECT module_id, x, y, w, h, enabled FROM dashboard_layouts ORDER BY y, x").all() as LayoutRow[])
      .map((row) => ({ moduleId: row.module_id, x: row.x, y: row.y, w: row.w, h: row.h, enabled: Boolean(row.enabled) }));
  }

  public saveLayout(layout: DashboardLayout[]): DashboardLayout[] {
    const save = this.database.transaction((items: DashboardLayout[]) => {
      this.database.prepare("DELETE FROM dashboard_layouts").run();
      const insert = this.database.prepare("INSERT INTO dashboard_layouts (module_id, x, y, w, h, enabled) VALUES (?, ?, ?, ?, ?, ?)");
      items.forEach((item) => insert.run(item.moduleId, item.x, item.y, item.w, item.h, Number(item.enabled)));
    });
    save(layout);
    return this.getLayout();
  }

  public getNavigation(): NavigationItem[] {
    return (this.database.prepare("SELECT id, label, path, position, visible, disabled FROM navigation_items ORDER BY position").all() as NavigationRow[])
      .map((row) => ({ id: row.id, label: row.label, path: row.path, position: row.position, visible: Boolean(row.visible), disabled: Boolean(row.disabled) }));
  }

  public saveNavigation(navigation: NavigationItem[]): NavigationItem[] {
    const normalized = navigation.map((item) => item.id === "vault-coming-soon" ? { ...item, disabled: true } : item);
    const save = this.database.transaction((items: NavigationItem[]) => {
      this.database.prepare("DELETE FROM navigation_items").run();
      const insert = this.database.prepare("INSERT INTO navigation_items (id, label, path, position, visible, disabled) VALUES (?, ?, ?, ?, ?, ?)");
      items.forEach((item) => insert.run(item.id, item.label, item.path, item.position, Number(item.visible), Number(item.disabled)));
    });
    save(normalized);
    return this.getNavigation();
  }

  public getTheme(): Theme {
    const row = this.database.prepare("SELECT value FROM app_settings WHERE key = 'theme'").get() as { value: Theme } | undefined;
    return row?.value ?? "light";
  }

  public saveTheme(theme: Theme): Theme {
    this.database.prepare("INSERT INTO app_settings (key, value) VALUES ('theme', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").run(theme);
    return this.getTheme();
  }

  public getAppearance(): AppearanceSettings | null {
    const row = this.database.prepare("SELECT value FROM app_settings WHERE key = 'appearance'").get() as { value: string } | undefined;
    if (!row) return null;
    try {
      const parsed = AppearanceSettingsSchema.safeParse(JSON.parse(row.value));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  public saveAppearance(appearance: AppearanceSettings): AppearanceSettings {
    this.database.prepare("INSERT INTO app_settings (key, value) VALUES ('appearance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP")
      .run(JSON.stringify(appearance));
    return appearance;
  }

  private seed(): void {
    const seed = this.database.transaction(() => {
      const layoutSeeded = this.database.prepare("SELECT 1 FROM app_settings WHERE key = 'dashboard-v2-seeded'").get();
      if (!layoutSeeded) {
        const insertLayout = this.database.prepare("INSERT OR IGNORE INTO dashboard_layouts (module_id, x, y, w, h, enabled) VALUES (?, ?, ?, ?, ?, ?)");
        defaultLayout.forEach((item) => insertLayout.run(item.moduleId, item.x, item.y, item.w, item.h, Number(item.enabled)));
        this.database.prepare("INSERT INTO app_settings (key, value) VALUES ('dashboard-v2-seeded', '1')").run();
      }
      const chatLayoutSeeded = this.database.prepare("SELECT 1 FROM app_settings WHERE key = 'dashboard-v3-ai-chat-seeded'").get();
      if (!chatLayoutSeeded) {
        const rows = this.database.prepare("SELECT module_id, x, y, w, h, enabled FROM dashboard_layouts ORDER BY y, x").all() as LayoutRow[];
        const usesLegacyDefault = rows.length === 3
          && rows.some((row) => row.module_id === "profile" && row.x === 0 && row.y === 0 && row.w === 4 && row.h === 4 && row.enabled === 1)
          && rows.some((row) => row.module_id === "workday-calendar" && row.x === 4 && row.y === 0 && row.w === 4 && row.h === 5 && row.enabled === 1)
          && rows.some((row) => row.module_id === "upcoming-reminders" && row.x === 8 && row.y === 0 && row.w === 4 && row.h === 5 && row.enabled === 1);
        const insertLayout = this.database.prepare("INSERT OR REPLACE INTO dashboard_layouts (module_id, x, y, w, h, enabled) VALUES (?, ?, ?, ?, ?, ?)");
        if (usesLegacyDefault) {
          defaultLayout.forEach((item) => insertLayout.run(item.moduleId, item.x, item.y, item.w, item.h, Number(item.enabled)));
        } else {
          const chat = defaultLayout.find((item) => item.moduleId === "ai-chat")!;
          this.database.prepare("INSERT OR IGNORE INTO dashboard_layouts (module_id, x, y, w, h, enabled) VALUES (?, ?, ?, ?, ?, ?)")
            .run(chat.moduleId, chat.x, chat.y, chat.w, chat.h, Number(chat.enabled));
        }
        this.database.prepare("INSERT INTO app_settings (key, value) VALUES ('dashboard-v3-ai-chat-seeded', '1')").run();
      }
      const insertNavigation = this.database.prepare("INSERT OR IGNORE INTO navigation_items (id, label, path, position, visible, disabled) VALUES (?, ?, ?, ?, ?, ?)");
      defaultNavigation.forEach((item) => insertNavigation.run(item.id, item.label, item.path, item.position, Number(item.visible), Number(item.disabled)));
      this.database.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('theme', 'light')").run();
      this.database.prepare("UPDATE navigation_items SET disabled = 1 WHERE id = 'vault-coming-soon'").run();
    });
    seed();
  }
}
