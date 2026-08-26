import type Database from "better-sqlite3";
import { AiOfficeOrderSchema, AppearanceSettingsSchema, PluginManifestSchema, type AiOfficeOrder, type AppearanceSettings, type DashboardLayout, type NavigationItem, type Theme } from "@workbench/contracts";

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

const coreDashboardIds = new Set(["profile"]);
const coreNavigation = new Map(defaultNavigation
  .filter((item) => item.id !== "reminders")
  .map((item) => [item.id, item]));

export class PreferencesValidationError extends Error {
  public constructor() {
    super("Preferences validation failed");
    this.name = "PreferencesValidationError";
  }
}

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
  public constructor(private readonly database: Database.Database) {}

  public initializeDefaults(): void {
    this.seed();
  }

  public getLayout(): DashboardLayout[] {
    return (this.database.prepare("SELECT module_id, x, y, w, h, enabled FROM dashboard_layouts ORDER BY y, x").all() as LayoutRow[])
      .map((row) => ({ moduleId: row.module_id, x: row.x, y: row.y, w: row.w, h: row.h, enabled: Boolean(row.enabled) }));
  }

  public saveLayout(layout: DashboardLayout[]): DashboardLayout[] {
    const save = this.database.transaction((items: DashboardLayout[]) => {
      const allowed = this.installedPreferenceContributionIds().dashboard;
      for (const item of items) {
        if (!allowed.has(item.moduleId)) throw new PreferencesValidationError();
      }
      const insert = this.database.prepare(`
        INSERT INTO dashboard_layouts (module_id, x, y, w, h, enabled) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(module_id) DO UPDATE SET
          x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h,
          enabled = excluded.enabled, updated_at = CURRENT_TIMESTAMP
        WHERE dashboard_layouts.x IS NOT excluded.x
          OR dashboard_layouts.y IS NOT excluded.y
          OR dashboard_layouts.w IS NOT excluded.w
          OR dashboard_layouts.h IS NOT excluded.h
          OR dashboard_layouts.enabled IS NOT excluded.enabled
      `);
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
    const save = this.database.transaction((items: NavigationItem[]) => {
      const allowed = this.installedPreferenceContributionIds().navigation;
      for (const item of items) {
        if (!allowed.has(item.id)) throw new PreferencesValidationError();
      }
      for (const [id, identity] of coreNavigation) {
        const item = items.find((candidate) => candidate.id === id);
        if (!item || item.label !== identity.label || item.path !== identity.path || item.disabled !== identity.disabled) {
          throw new PreferencesValidationError();
        }
      }
      const submittedIds = new Set(items.map((item) => item.id));
      const positions = new Set<number>();
      for (const item of items) {
        if (positions.has(item.position)) throw new PreferencesValidationError();
        positions.add(item.position);
      }
      const retained = this.database.prepare("SELECT id, position FROM navigation_items").all() as Array<{ id: string; position: number }>;
      for (const item of retained) {
        if (submittedIds.has(item.id)) continue;
        if (positions.has(item.position)) throw new PreferencesValidationError();
        positions.add(item.position);
      }
      const insert = this.database.prepare(`
        INSERT INTO navigation_items (id, label, path, position, visible, disabled) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label, path = excluded.path, position = excluded.position,
          visible = excluded.visible, disabled = excluded.disabled, updated_at = CURRENT_TIMESTAMP
        WHERE navigation_items.label IS NOT excluded.label
          OR navigation_items.path IS NOT excluded.path
          OR navigation_items.position IS NOT excluded.position
          OR navigation_items.visible IS NOT excluded.visible
          OR navigation_items.disabled IS NOT excluded.disabled
      `);
      items.forEach((item) => insert.run(item.id, item.label, item.path, item.position, Number(item.visible), Number(item.disabled)));
    });
    save(navigation);
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

  public getAiOfficeOrder(): AiOfficeOrder {
    const row = this.database.prepare("SELECT value FROM app_settings WHERE key = 'ai-office-order'").get() as { value: string } | undefined;
    if (!row) return [];
    try {
      const parsed = AiOfficeOrderSchema.safeParse(JSON.parse(row.value));
      if (!parsed.success) return [];
      return this.filterEligibleAiOfficeOrder(parsed.data);
    } catch {
      return [];
    }
  }

  public saveAiOfficeOrder(order: AiOfficeOrder): AiOfficeOrder {
    const eligible = this.enabledInstalledPluginIds();
    for (const item of order) {
      if (!eligible.has(item.itemId)) throw new PreferencesValidationError();
    }
    this.database.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('ai-office-order', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(JSON.stringify(order));
    return this.getAiOfficeOrder();
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

  private installedPreferenceContributionIds(): { dashboard: Set<string>; navigation: Set<string> } {
    const dashboard = new Set(coreDashboardIds);
    const navigation = new Set(coreNavigation.keys());
    const rows = this.database.prepare("SELECT plugin_id, manifest_json FROM installed_plugins ORDER BY plugin_id")
      .all() as Array<{ plugin_id: string; manifest_json: string }>;
    for (const row of rows) {
      let manifest;
      try {
        manifest = PluginManifestSchema.parse(JSON.parse(row.manifest_json));
      } catch {
        throw new PreferencesValidationError();
      }
      if (manifest.id !== row.plugin_id) throw new PreferencesValidationError();
      for (const contribution of manifest.contributions) {
        if (contribution.type === "dashboard") dashboard.add(contribution.id);
        if (contribution.type === "navigation") navigation.add(contribution.id);
      }
    }
    return { dashboard, navigation };
  }

  private enabledInstalledPluginIds(): Set<string> {
    return new Set((this.database.prepare(`
      SELECT plugin_id
      FROM installed_plugins
      WHERE enabled = 1
      ORDER BY plugin_id
    `).all() as Array<{ plugin_id: string }>).map((row) => row.plugin_id));
  }

  private filterEligibleAiOfficeOrder(order: AiOfficeOrder): AiOfficeOrder {
    const eligible = this.enabledInstalledPluginIds();
    return order
      .filter((item) => eligible.has(item.itemId))
      .map((item, position) => ({ itemId: item.itemId, position }));
  }
}
