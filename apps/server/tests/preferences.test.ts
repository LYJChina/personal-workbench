import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import { PreferencesRepository } from "../src/modules/preferences/preferences.repository";

const coreNavigation = [
  { id: "home", label: "我的主页", path: "/", position: 0, visible: true, disabled: false },
  { id: "ai-office", label: "AI 办公", path: "/ai-office", position: 1, visible: true, disabled: false },
  { id: "vault-coming-soon", label: "密码保险箱", path: "/vault", position: 3, visible: true, disabled: true },
  { id: "settings", label: "设置", path: "/settings", position: 4, visible: true, disabled: false }
] as const;

function readRawPreferenceRows(dataDir: string) {
  const database = new Database(resolveAppPaths({ dataDir }).databasePath, { readonly: true });
  try {
    return {
      layout: database.prepare("SELECT * FROM dashboard_layouts ORDER BY module_id").all(),
      navigation: database.prepare("SELECT * FROM navigation_items ORDER BY id").all(),
      settings: database.prepare("SELECT * FROM app_settings ORDER BY key").all()
    };
  } finally {
    database.close();
  }
}

describe("workspace preferences API", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lyj-workbench-preferences-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("seeds dashboard, navigation, and a light theme", async () => {
    const app = createApp({ dataDir: tempDir });

    const [layout, navigation, theme] = await Promise.all([
      request(app).get("/api/preferences/layout"),
      request(app).get("/api/preferences/navigation"),
      request(app).get("/api/preferences/theme")
    ]);

    expect(layout.status).toBe(200);
    expect(layout.body).toEqual([
      { moduleId: "profile", x: 0, y: 0, w: 4, h: 5, enabled: true },
      { moduleId: "workday-calendar", x: 4, y: 0, w: 4, h: 5, enabled: true },
      { moduleId: "upcoming-reminders", x: 8, y: 0, w: 4, h: 5, enabled: true },
      { moduleId: "ai-chat", x: 12, y: 0, w: 4, h: 5, enabled: true }
    ]);
    expect(navigation.body.map((item: { id: string }) => item.id)).toEqual(["home", "ai-office", "reminders", "vault-coming-soon", "settings"]);
    expect(navigation.body.find((item: { id: string }) => item.id === "vault-coming-soon")).toMatchObject({ disabled: true, visible: true });
    expect(theme.body).toEqual({ theme: "light" });
  });

  it("keeps repository construction side-effect-free on a freshly migrated unseeded database", () => {
    const dataDir = join(tempDir, "inert-constructor");
    const database = openDatabase(resolveAppPaths({ dataDir }));
    const readRows = () => ({
      layout: database.prepare("SELECT * FROM dashboard_layouts ORDER BY module_id").all(),
      navigation: database.prepare("SELECT * FROM navigation_items ORDER BY id").all(),
      settings: database.prepare("SELECT * FROM app_settings ORDER BY key").all()
    });
    const before = readRows();

    new PreferencesRepository(database);

    expect(readRows()).toEqual(before);
    database.close();
  });

  it.each([
    ["malformed", { path: "/api/preferences/navigation", body: { id: "home" } }],
    ["unregistered", {
      path: "/api/preferences/layout",
      body: [{ moduleId: "unregistered-card", x: 0, y: 0, w: 4, h: 4, enabled: true }]
    }]
  ])("keeps raw preference rows unchanged after a %s first PUT", async (_case, attemptedWrite) => {
    const dataDir = join(tempDir, String(_case));
    openDatabase(resolveAppPaths({ dataDir })).close();
    const app = createApp({ dataDir });
    const before = readRawPreferenceRows(dataDir);

    await request(app).put(attemptedWrite.path).send(attemptedWrite.body).expect(400, {
      error: { message: "Preferences validation failed", code: "VALIDATION_ERROR" }
    });

    expect(readRawPreferenceRows(dataDir)).toEqual(before);
  });

  it("adds chat to a legacy customized layout without resetting its saved size", async () => {
    openDatabase(resolveAppPaths({ dataDir: tempDir })).close();
    const database = new Database(resolveAppPaths({ dataDir: tempDir }).databasePath);
    database.prepare("DELETE FROM dashboard_layouts").run();
    database.prepare("INSERT INTO dashboard_layouts (module_id, x, y, w, h, enabled) VALUES ('profile', 1, 2, 7, 8, 1)").run();
    database.prepare("DELETE FROM app_settings WHERE key = 'dashboard-v3-ai-chat-seeded'").run();
    database.close();

    const layout = (await request(createApp({ dataDir: tempDir })).get("/api/preferences/layout").expect(200)).body;

    expect(layout).toContainEqual({ moduleId: "profile", x: 1, y: 2, w: 7, h: 8, enabled: true });
    expect(layout).toContainEqual({ moduleId: "ai-chat", x: 12, y: 0, w: 4, h: 5, enabled: true });
  });

  it("migrates populated pre-kernel preferences and preserves exact values across plugin disable and re-enable", async () => {
    const paths = resolveAppPaths({ dataDir: tempDir });
    const legacy = new Database(paths.databasePath);
    legacy.exec(`
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE profile (
        id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL DEFAULT '', birthday TEXT NOT NULL DEFAULT '',
        employee_number TEXT NOT NULL DEFAULT '', photo_filename TEXT, photo_blob BLOB, photo_mime TEXT,
        photo_version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO profile (id) VALUES (1);
      CREATE TABLE dashboard_layouts (
        module_id TEXT PRIMARY KEY, x INTEGER NOT NULL, y INTEGER NOT NULL,
        w INTEGER NOT NULL, h INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE navigation_items (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, path TEXT NOT NULL,
        position INTEGER NOT NULL, visible INTEGER NOT NULL DEFAULT 1,
        disabled INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO app_settings (key, value) VALUES ('dashboard-v2-seeded', '1'), ('dashboard-v3-ai-chat-seeded', '1');
      INSERT INTO dashboard_layouts (module_id, x, y, w, h, enabled) VALUES
        ('profile', 0, 0, 5, 7, 1),
        ('ai-chat', 9, 2, 7, 11, 0),
        ('workday-calendar', 1, 5, 6, 9, 1),
        ('upcoming-reminders', 7, 5, 5, 8, 1);
      INSERT INTO navigation_items (id, label, path, position, visible, disabled) VALUES
        ('settings', '设置', '/settings', 0, 1, 0),
        ('home', '我的主页', '/', 1, 1, 0),
        ('reminders', '提醒事项', '/reminders', 2, 0, 0),
        ('ai-office', 'AI 办公', '/ai-office', 3, 1, 0),
        ('vault-coming-soon', '密码保险箱', '/vault', 4, 1, 1);
    `);
    legacy.pragma("user_version = 3");
    legacy.close();

    const app = createApp({ dataDir: tempDir });
    const expectedLayout = [
      { moduleId: "profile", x: 0, y: 0, w: 5, h: 7, enabled: true },
      { moduleId: "ai-chat", x: 9, y: 2, w: 7, h: 11, enabled: false },
      { moduleId: "workday-calendar", x: 1, y: 5, w: 6, h: 9, enabled: true },
      { moduleId: "upcoming-reminders", x: 7, y: 5, w: 5, h: 8, enabled: true }
    ];
    const expectedNavigation = [
      { id: "settings", label: "设置", path: "/settings", position: 0, visible: true, disabled: false },
      { id: "home", label: "我的主页", path: "/", position: 1, visible: true, disabled: false },
      { id: "reminders", label: "提醒事项", path: "/reminders", position: 2, visible: false, disabled: false },
      { id: "ai-office", label: "AI 办公", path: "/ai-office", position: 3, visible: true, disabled: false },
      { id: "vault-coming-soon", label: "密码保险箱", path: "/vault", position: 4, visible: true, disabled: true }
    ];

    const enabled = (await request(app).get("/api/plugins/contributions").expect(200)).body;
    expect(enabled.map((entry: { contribution: { id: string } }) => entry.contribution.id)).toEqual(expect.arrayContaining([
      "ai-chat", "workday-calendar", "upcoming-reminders", "reminders"
    ]));
    await request(app).get("/api/preferences/layout").expect(200, expectedLayout);
    await request(app).get("/api/preferences/navigation").expect(200, expectedNavigation);

    await request(app).put("/api/plugins/lyj.system.ai-chat/enabled").send({ enabled: false }).expect(200);
    await request(app).put("/api/plugins/lyj.system.reminders/enabled").send({ enabled: false }).expect(200);
    const disabled = (await request(app).get("/api/plugins/contributions").expect(200)).body;
    expect(disabled.map((entry: { contribution: { id: string } }) => entry.contribution.id)).not.toEqual(expect.arrayContaining([
      "ai-chat", "upcoming-reminders", "reminders"
    ]));
    await request(app).get("/api/preferences/layout").expect(200, expectedLayout);
    await request(app).get("/api/preferences/navigation").expect(200, expectedNavigation);

    await request(app).put("/api/plugins/lyj.system.ai-chat/enabled").send({ enabled: true }).expect(200);
    await request(app).put("/api/plugins/lyj.system.reminders/enabled").send({ enabled: true }).expect(200);
    await request(app).get("/api/preferences/layout").expect(200, expectedLayout);
    await request(app).get("/api/preferences/navigation").expect(200, expectedNavigation);
  });

  it("accepts installed disabled contribution IDs and preserves their stored rows when omitted from later saves", async () => {
    const app = createApp({ dataDir: tempDir });
    const database = new Database(resolveAppPaths({ dataDir: tempDir }).databasePath);
    const manifest = {
      manifestVersion: 1,
      id: "lyj.plugin.analytics",
      name: "Analytics",
      version: "1.0.0",
      author: "Local",
      kind: "third-party",
      platforms: ["win32"],
      permissions: [],
      contributions: [
        { type: "dashboard", id: "analytics-card", title: "Analytics", component: "system.analytics.dashboard", minW: 3, minH: 4 },
        { type: "navigation", id: "analytics-page", label: "Analytics", path: "/analytics", icon: "grid", position: 2 }
      ]
    };
    database.prepare(`INSERT INTO installed_plugins
      (plugin_id, manifest_json, version, kind, enabled, required, runtime_status)
      VALUES (?, ?, ?, ?, 0, 0, 'stopped')`)
      .run(manifest.id, JSON.stringify(manifest), manifest.version, manifest.kind);
    database.close();

    const pluginLayout = { moduleId: "analytics-card", x: 6, y: 7, w: 9, h: 12, enabled: false };
    const pluginNavigation = { id: "analytics-page", label: "Analytics", path: "/analytics", position: 100, visible: false, disabled: false };
    await request(app).put("/api/preferences/layout").send([pluginLayout]).expect(200);
    await request(app).put("/api/preferences/navigation").send([
      coreNavigation[0], coreNavigation[1], pluginNavigation, coreNavigation[2], coreNavigation[3]
    ]).expect(200);
    const sentinelDatabase = new Database(resolveAppPaths({ dataDir: tempDir }).databasePath);
    sentinelDatabase.prepare("UPDATE dashboard_layouts SET updated_at = '2000-01-03 00:00:00' WHERE module_id = ?")
      .run(pluginLayout.moduleId);
    sentinelDatabase.prepare("UPDATE navigation_items SET updated_at = '2000-01-04 00:00:00' WHERE id = ?")
      .run(pluginNavigation.id);
    sentinelDatabase.close();
    const storedBeforeOmission = readRawPreferenceRows(tempDir);
    const pluginRowsBeforeOmission = {
      layout: storedBeforeOmission.layout.find((row) => (row as { module_id: string }).module_id === pluginLayout.moduleId),
      navigation: storedBeforeOmission.navigation.find((row) => (row as { id: string }).id === pluginNavigation.id)
    };

    await request(app).put("/api/preferences/layout").send([
      { moduleId: "profile", x: 2, y: 1, w: 6, h: 5, enabled: true }
    ]).expect(200);
    await request(app).put("/api/preferences/navigation").send([...coreNavigation]).expect(200);

    expect((await request(app).get("/api/preferences/layout").expect(200)).body).toContainEqual(pluginLayout);
    expect((await request(app).get("/api/preferences/navigation").expect(200)).body).toContainEqual(pluginNavigation);
    const storedAfterOmission = readRawPreferenceRows(tempDir);
    expect({
      layout: storedAfterOmission.layout.find((row) => (row as { module_id: string }).module_id === pluginLayout.moduleId),
      navigation: storedAfterOmission.navigation.find((row) => (row as { id: string }).id === pluginNavigation.id)
    }).toEqual(pluginRowsBeforeOmission);
  });

  it("preserves an unchanged inactive sparse navigation row in a realistic full save", async () => {
    const app = createApp({ dataDir: tempDir });
    const database = new Database(resolveAppPaths({ dataDir: tempDir }).databasePath);
    const manifest = {
      manifestVersion: 1,
      id: "lyj.plugin.inactive-navigation",
      name: "Inactive navigation",
      version: "1.0.0",
      author: "Local",
      kind: "third-party",
      platforms: ["win32"],
      permissions: [],
      contributions: [
        { type: "navigation", id: "inactive-page", label: "Inactive", path: "/inactive", icon: "grid", position: 100 }
      ]
    };
    database.prepare(`INSERT INTO installed_plugins
      (plugin_id, manifest_json, version, kind, enabled, required, runtime_status)
      VALUES (?, ?, ?, ?, 0, 0, 'stopped')`)
      .run(manifest.id, JSON.stringify(manifest), manifest.version, manifest.kind);
    database.prepare(`INSERT INTO navigation_items
      (id, label, path, position, visible, disabled, updated_at)
      VALUES ('inactive-page', 'Inactive', '/inactive', 100, 0, 0, '2000-01-01 00:00:00')`).run();
    database.prepare("UPDATE navigation_items SET updated_at = '2000-01-02 00:00:00' WHERE id = 'home'").run();
    database.close();
    const before = readRawPreferenceRows(tempDir);
    const inactiveBefore = before.navigation.find((row) => (row as { id: string }).id === "inactive-page");

    await request(app).put("/api/preferences/navigation").send([
      { ...coreNavigation[1], position: 0 },
      { ...coreNavigation[0], position: 1 },
      { id: "reminders", label: "提醒事项", path: "/reminders", position: 2, visible: true, disabled: false },
      coreNavigation[2],
      coreNavigation[3],
      { id: "inactive-page", label: "Inactive", path: "/inactive", position: 100, visible: false, disabled: false }
    ]).expect(200);

    const after = readRawPreferenceRows(tempDir);
    expect(after.navigation.find((row) => (row as { id: string }).id === "inactive-page")).toEqual(inactiveBefore);
    expect(after.navigation.find((row) => (row as { id: string }).id === "home")).toMatchObject({
      position: 1,
      updated_at: expect.not.stringMatching(/^2000-01-02/)
    });
  });

  it("preserves an unchanged unavailable dashboard row in a realistic full save", async () => {
    const app = createApp({ dataDir: tempDir });
    const database = new Database(resolveAppPaths({ dataDir: tempDir }).databasePath);
    const manifest = {
      manifestVersion: 1,
      id: "lyj.plugin.unavailable-dashboard",
      name: "Unavailable dashboard",
      version: "1.0.0",
      author: "Local",
      kind: "third-party",
      platforms: ["win32"],
      permissions: [],
      contributions: [
        { type: "dashboard", id: "unavailable-card", title: "Unavailable", component: "system.unavailable.dashboard", minW: 3, minH: 4 }
      ]
    };
    database.prepare(`INSERT INTO installed_plugins
      (plugin_id, manifest_json, version, kind, enabled, required, runtime_status)
      VALUES (?, ?, ?, ?, 0, 0, 'stopped')`)
      .run(manifest.id, JSON.stringify(manifest), manifest.version, manifest.kind);
    database.prepare(`INSERT INTO dashboard_layouts
      (module_id, x, y, w, h, enabled, updated_at)
      VALUES ('unavailable-card', 13, 21, 7, 9, 0, '2000-01-01 00:00:00')`).run();
    database.prepare("UPDATE dashboard_layouts SET updated_at = '2000-01-02 00:00:00' WHERE module_id = 'profile'").run();
    database.close();
    const before = readRawPreferenceRows(tempDir);
    const unavailableBefore = before.layout.find((row) => (row as { module_id: string }).module_id === "unavailable-card");

    await request(app).put("/api/preferences/layout").send([
      { moduleId: "profile", x: 2, y: 1, w: 6, h: 5, enabled: true },
      { moduleId: "workday-calendar", x: 4, y: 0, w: 4, h: 5, enabled: true },
      { moduleId: "upcoming-reminders", x: 8, y: 0, w: 4, h: 5, enabled: true },
      { moduleId: "ai-chat", x: 12, y: 0, w: 4, h: 5, enabled: true },
      { moduleId: "unavailable-card", x: 13, y: 21, w: 7, h: 9, enabled: false }
    ]).expect(200);

    const after = readRawPreferenceRows(tempDir);
    expect(after.layout.find((row) => (row as { module_id: string }).module_id === "unavailable-card")).toEqual(unavailableBefore);
    expect(after.layout.find((row) => (row as { module_id: string }).module_id === "profile")).toMatchObject({
      x: 2,
      y: 1,
      w: 6,
      h: 5,
      updated_at: expect.not.stringMatching(/^2000-01-02/)
    });
  });

  it("authorizes strict installed manifests despite corrupt unrelated plugin metadata", async () => {
    const app = createApp({ dataDir: tempDir });
    const database = new Database(resolveAppPaths({ dataDir: tempDir }).databasePath);
    const manifest = {
      manifestVersion: 1,
      id: "lyj.plugin.preference-owner",
      name: "Preference owner",
      version: "1.0.0",
      author: "Local",
      kind: "third-party",
      platforms: ["win32"],
      permissions: [],
      contributions: [
        { type: "dashboard", id: "owner-card", title: "Owner", component: "system.owner.dashboard", minW: 3, minH: 4 },
        { type: "navigation", id: "owner-page", label: "Owner", path: "/owner", icon: "grid", position: 5 }
      ]
    };
    database.prepare(`INSERT INTO installed_plugins
      (plugin_id, manifest_json, version, kind, enabled, required, runtime_status, last_error_code)
      VALUES (?, ?, ?, ?, 0, 0, 'stopped', 'CORRUPT_INTERNAL_DETAIL')`)
      .run(manifest.id, JSON.stringify(manifest), manifest.version, manifest.kind);
    database.pragma("ignore_check_constraints = ON");
    database.prepare("UPDATE installed_plugins SET runtime_status = 'corrupt-runtime' WHERE plugin_id = ?").run(manifest.id);
    database.prepare("INSERT INTO plugin_permissions (plugin_id, permission, granted) VALUES (?, 'corrupt:permission', 1)")
      .run(manifest.id);
    database.close();

    await request(app).put("/api/preferences/layout").send([
      { moduleId: "owner-card", x: 5, y: 6, w: 7, h: 8, enabled: false }
    ]).expect(200);
    await request(app).put("/api/preferences/navigation").send([
      coreNavigation[0],
      coreNavigation[1],
      { id: "reminders", label: "提醒事项", path: "/reminders", position: 2, visible: true, disabled: false },
      coreNavigation[2],
      coreNavigation[3],
      { id: "owner-page", label: "Owner", path: "/owner", position: 5, visible: true, disabled: false }
    ]).expect(200);
  });

  it.each([
    ["malformed manifest", "lyj.plugin.malformed", "{", "malformed-card"],
    ["manifest identity mismatch", "lyj.plugin.claimed", JSON.stringify({
      manifestVersion: 1,
      id: "lyj.plugin.other",
      name: "Other",
      version: "1.0.0",
      author: "Local",
      kind: "third-party",
      platforms: ["win32"],
      permissions: [],
      contributions: [
        { type: "dashboard", id: "mismatch-card", title: "Mismatch", component: "system.mismatch.dashboard", minW: 3, minH: 4 }
      ]
    }), "mismatch-card"]
  ])("fails closed with a fixed response for a %s", async (_case, pluginId, manifestJson, moduleId) => {
    const app = createApp({ dataDir: tempDir });
    const database = new Database(resolveAppPaths({ dataDir: tempDir }).databasePath);
    database.prepare(`INSERT INTO installed_plugins
      (plugin_id, manifest_json, version, kind, enabled, required, runtime_status)
      VALUES (?, ?, '1.0.0', 'third-party', 0, 0, 'stopped')`)
      .run(pluginId, manifestJson);
    database.close();
    const before = readRawPreferenceRows(tempDir);

    await request(app).put("/api/preferences/layout").send([
      { moduleId, x: 0, y: 0, w: 4, h: 4, enabled: true }
    ]).expect(400, { error: { message: "Preferences validation failed", code: "VALIDATION_ERROR" } });

    expect(readRawPreferenceRows(tempDir)).toEqual(before);
  });

  it("rejects navigation and dashboard contribution IDs used as the opposite preference type", async () => {
    const app = createApp({ dataDir: tempDir });
    const database = new Database(resolveAppPaths({ dataDir: tempDir }).databasePath);
    const manifest = {
      manifestVersion: 1,
      id: "lyj.plugin.typed",
      name: "Typed",
      version: "1.0.0",
      author: "Local",
      kind: "third-party",
      platforms: ["win32"],
      permissions: [],
      contributions: [
        { type: "dashboard", id: "dashboard-only", title: "Dashboard", component: "system.typed.dashboard", minW: 3, minH: 4 },
        { type: "navigation", id: "navigation-only", label: "Navigation", path: "/typed", icon: "grid", position: 5 }
      ]
    };
    database.prepare(`INSERT INTO installed_plugins
      (plugin_id, manifest_json, version, kind, enabled, required, runtime_status)
      VALUES (?, ?, ?, ?, 0, 0, 'stopped')`)
      .run(manifest.id, JSON.stringify(manifest), manifest.version, manifest.kind);
    database.close();
    const before = readRawPreferenceRows(tempDir);
    const error = { error: { message: "Preferences validation failed", code: "VALIDATION_ERROR" } };

    await request(app).put("/api/preferences/layout").send([
      { moduleId: "navigation-only", x: 0, y: 0, w: 4, h: 4, enabled: true }
    ]).expect(400, error);
    await request(app).put("/api/preferences/navigation").send([
      coreNavigation[0],
      coreNavigation[1],
      { id: "reminders", label: "提醒事项", path: "/reminders", position: 2, visible: true, disabled: false },
      coreNavigation[2],
      coreNavigation[3],
      { id: "dashboard-only", label: "Wrong type", path: "/wrong", position: 5, visible: true, disabled: false }
    ]).expect(400, error);

    expect(readRawPreferenceRows(tempDir)).toEqual(before);
  });

  it("rejects duplicate submitted navigation positions atomically without renumbering stored rows", async () => {
    const error = { error: { message: "Preferences validation failed", code: "VALIDATION_ERROR" } };
    const duplicateDir = join(tempDir, "duplicate-submitted-positions");
    const duplicateApp = createApp({ dataDir: duplicateDir });
    const duplicateBefore = readRawPreferenceRows(duplicateDir);
    await request(duplicateApp).put("/api/preferences/navigation").send([
      { ...coreNavigation[0], position: 0 },
      { ...coreNavigation[1], position: 0 },
      { id: "reminders", label: "提醒事项", path: "/reminders", position: 2, visible: true, disabled: false },
      { ...coreNavigation[2], position: 3 },
      { ...coreNavigation[3], position: 4 }
    ]).expect(400, error);
    expect(readRawPreferenceRows(duplicateDir)).toEqual(duplicateBefore);
  });

  it("rejects a submitted position colliding with an omitted retained row atomically", async () => {
    const error = { error: { message: "Preferences validation failed", code: "VALIDATION_ERROR" } };
    const retainedDir = join(tempDir, "retained-position-collision");
    const retainedApp = createApp({ dataDir: retainedDir });
    const retainedDatabase = new Database(resolveAppPaths({ dataDir: retainedDir }).databasePath);
    const retainedManifest = {
      manifestVersion: 1,
      id: "lyj.plugin.sparse",
      name: "Sparse",
      version: "1.0.0",
      author: "Local",
      kind: "third-party",
      platforms: ["win32"],
      permissions: [],
      contributions: [
        { type: "navigation", id: "sparse-page", label: "Sparse", path: "/sparse", icon: "grid", position: 100 }
      ]
    };
    retainedDatabase.prepare(`INSERT INTO installed_plugins
      (plugin_id, manifest_json, version, kind, enabled, required, runtime_status)
      VALUES (?, ?, ?, ?, 0, 0, 'stopped')`)
      .run(retainedManifest.id, JSON.stringify(retainedManifest), retainedManifest.version, retainedManifest.kind);
    retainedDatabase.prepare(`INSERT INTO navigation_items
      (id, label, path, position, visible, disabled, updated_at)
      VALUES ('sparse-page', 'Sparse', '/sparse', 100, 0, 0, '2000-01-01 00:00:00')`).run();
    retainedDatabase.close();
    const retainedBefore = readRawPreferenceRows(retainedDir);

    await request(retainedApp).put("/api/preferences/navigation").send([
      { ...coreNavigation[0], position: 0 },
      { ...coreNavigation[1], position: 1 },
      { id: "reminders", label: "提醒事项", path: "/reminders", position: 2, visible: true, disabled: false },
      { ...coreNavigation[2], position: 3 },
      { ...coreNavigation[3], position: 100 }
    ]).expect(400, error);
    expect(readRawPreferenceRows(retainedDir)).toEqual(retainedBefore);
  });

  it("rejects unregistered IDs and forged core navigation atomically with a fixed error", async () => {
    const app = createApp({ dataDir: tempDir });
    const beforeLayout = (await request(app).get("/api/preferences/layout").expect(200)).body;
    const beforeNavigation = (await request(app).get("/api/preferences/navigation").expect(200)).body;
    const error = { error: { message: "Preferences validation failed", code: "VALIDATION_ERROR" } };

    await request(app).put("/api/preferences/layout").send([
      { moduleId: "profile", x: 8, y: 8, w: 8, h: 8, enabled: true },
      { moduleId: "unregistered-card", x: 0, y: 0, w: 4, h: 4, enabled: true }
    ]).expect(400, error);
    await request(app).put("/api/preferences/navigation").send([
      coreNavigation[0],
      coreNavigation[1],
      { id: "unregistered-page", label: "Unknown", path: "/unknown", position: 2, visible: true, disabled: false },
      coreNavigation[2],
      coreNavigation[3]
    ]).expect(400, error);
    await request(app).put("/api/preferences/navigation").send([
      { ...coreNavigation[0], label: "Forged home", path: "/forged" },
      coreNavigation[1],
      { id: "reminders", label: "提醒事项", path: "/reminders", position: 2, visible: true, disabled: false },
      coreNavigation[2],
      coreNavigation[3]
    ]).expect(400, error);

    await request(app).get("/api/preferences/layout").expect(200, beforeLayout);
    await request(app).get("/api/preferences/navigation").expect(200, beforeNavigation);
  });

  it("round trips validated preferences and persists them across app instances", async () => {
    const app = createApp({ dataDir: tempDir });
    const savedLayout = await request(app).put("/api/preferences/layout").send([
      { moduleId: "profile", x: 2, y: 1, w: 6, h: 5, enabled: true }
    ]);
    const savedNavigation = await request(app).put("/api/preferences/navigation").send([
      { id: "settings", label: "设置", path: "/settings", position: 0, visible: true, disabled: false },
      { id: "home", label: "我的主页", path: "/", position: 1, visible: true, disabled: false },
      { id: "ai-office", label: "AI 办公", path: "/ai-office", position: 2, visible: false, disabled: false },
      { id: "reminders", label: "提醒事项", path: "/reminders", position: 3, visible: true, disabled: false },
      { id: "vault-coming-soon", label: "密码保险箱", path: "/vault", position: 4, visible: true, disabled: true }
    ]);
    const savedTheme = await request(app).put("/api/preferences/theme").send({ theme: "dark" });

    expect(savedLayout.body).toContainEqual({ moduleId: "profile", x: 2, y: 1, w: 6, h: 5, enabled: true });
    expect(savedNavigation.status).toBe(200);
    expect(savedTheme.body).toEqual({ theme: "dark" });

    const persistedApp = createApp({ dataDir: tempDir });
    expect((await request(persistedApp).get("/api/preferences/layout")).body).toEqual(savedLayout.body);
    expect((await request(persistedApp).get("/api/preferences/navigation")).body[0]).toMatchObject({ id: "settings", position: 0 });
    expect((await request(persistedApp).get("/api/preferences/theme")).body).toEqual({ theme: "dark" });
  });

  it("round trips validated appearance in SQLite and distinguishes an unset legacy value", async () => {
    const app = createApp({ dataDir: tempDir });
    const absent = await request(app).get("/api/preferences/appearance");
    const saved = await request(app).put("/api/preferences/appearance").set("X-LYJ-Workbench-Request", "local-browser-v1").send({
      skin: "paper", density: "compact", radius: "subtle", glass: false
    });
    const persisted = await request(createApp({ dataDir: tempDir })).get("/api/preferences/appearance");

    expect(absent.body).toEqual({ appearance: null });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ skin: "paper", density: "compact", radius: "subtle", glass: false });
    expect(persisted.body).toEqual({ appearance: saved.body });
  });

  it("round trips AI Office order for enabled installed plugins and persists it across app instances", async () => {
    const app = createApp({ dataDir: tempDir });
    const order = [{ itemId: "lyj.system.ai-polish", position: 0 }];

    const saved = await request(app).put("/api/preferences/ai-office-order").send(order);
    const current = await request(app).get("/api/preferences/ai-office-order");
    const persisted = await request(createApp({ dataDir: tempDir })).get("/api/preferences/ai-office-order");

    expect(saved.status).toBe(200);
    expect(saved.body).toEqual(order);
    expect(current.body).toEqual(order);
    expect(persisted.body).toEqual(order);
  });

  it("filters stale or disabled AI Office order items on read while keeping eligible order stable", async () => {
    const app = createApp({ dataDir: tempDir });
    const database = new Database(resolveAppPaths({ dataDir: tempDir }).databasePath);
    database.prepare(`
      INSERT INTO app_settings (key, value)
      VALUES ('ai-office-order', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(JSON.stringify([
      { itemId: "lyj.system.ai-chat", position: 0 },
      { itemId: "lyj.system.ai-polish", position: 1 },
      { itemId: "lyj.system.unknown", position: 2 }
    ]));
    database.close();

    await request(app).put("/api/plugins/lyj.system.ai-chat/enabled").send({ enabled: false }).expect(200);
    await request(app).get("/api/preferences/ai-office-order").expect(200, [
      { itemId: "lyj.system.ai-polish", position: 0 }
    ]);
  });

  it.each([
    ["invalid", [{ itemId: "", position: 0 }]],
    ["duplicate", [
      { itemId: "lyj.system.ai-polish", position: 0 },
      { itemId: "lyj.system.ai-polish", position: 1 }
    ]],
    ["non-contiguous", [
      { itemId: "lyj.system.ai-polish", position: 1 }
    ]],
    ["uninstalled", [
      { itemId: "lyj.system.unknown", position: 0 }
    ]]
  ])("rejects %s AI Office order payloads", async (_case, body) => {
    const app = createApp({ dataDir: tempDir });
    const before = readRawPreferenceRows(tempDir);

    await request(app).put("/api/preferences/ai-office-order").send(body).expect(400, {
      error: { message: "Preferences validation failed", code: "VALIDATION_ERROR" }
    });

    expect(readRawPreferenceRows(tempDir)).toEqual(before);
  });

  it("rejects disabled AI Office order plugin IDs", async () => {
    const app = createApp({ dataDir: tempDir });
    const before = readRawPreferenceRows(tempDir);

    await request(app).put("/api/plugins/lyj.system.ai-polish/enabled").send({ enabled: false }).expect(200);
    await request(app).put("/api/preferences/ai-office-order").send([
      { itemId: "lyj.system.ai-polish", position: 0 }
    ]).expect(400, {
      error: { message: "Preferences validation failed", code: "VALIDATION_ERROR" }
    });

    expect(readRawPreferenceRows(tempDir)).toEqual(before);
  });

  it("rejects invalid appearance without storing it", async () => {
    const app = createApp({ dataDir: tempDir });
    await request(app).put("/api/preferences/appearance").set("X-LYJ-Workbench-Request", "local-browser-v1").send({ skin: "evil", density: "compact", radius: "subtle", glass: false }).expect(400);
    await request(app).get("/api/preferences/appearance").expect(200, { appearance: null });
  });

  it("rejects a malicious vault identity change without mutating navigation", async () => {
    const app = createApp({ dataDir: tempDir });
    const before = (await request(app).get("/api/preferences/navigation").expect(200)).body;
    const response = await request(app).put("/api/preferences/navigation").send([
      { id: "home", label: "我的主页", path: "/", position: 0, visible: true, disabled: false },
      { id: "ai-office", label: "AI 办公", path: "/ai-office", position: 1, visible: true, disabled: false },
      { id: "reminders", label: "提醒事项", path: "/reminders", position: 2, visible: true, disabled: false },
      { id: "vault-coming-soon", label: "密码保险箱", path: "/vault", position: 3, visible: true, disabled: false },
      { id: "settings", label: "设置", path: "/settings", position: 4, visible: true, disabled: false }
    ]);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { message: "Preferences validation failed", code: "VALIDATION_ERROR" } });
    await request(app).get("/api/preferences/navigation").expect(200, before);
  });

  it("rejects navigation saves that omit seeded optional items", async () => {
    const app = createApp({ dataDir: tempDir });
    const response = await request(app).put("/api/preferences/navigation").send([
      { id: "home", label: "我的主页", path: "/", position: 0, visible: true, disabled: false },
      { id: "reminders", label: "提醒事项", path: "/reminders", position: 1, visible: true, disabled: false },
      { id: "vault-coming-soon", label: "密码保险箱", path: "/vault", position: 2, visible: true, disabled: true },
      { id: "settings", label: "设置", path: "/settings", position: 3, visible: true, disabled: false }
    ]);

    expect(response.status).toBe(400);
    expect((await request(app).get("/api/preferences/navigation")).body.map((item: { id: string }) => item.id)).toEqual(["home", "ai-office", "reminders", "vault-coming-soon", "settings"]);
  });

  it("rejects unknown modules, duplicate navigation IDs, invalid coordinates, and unsupported themes", async () => {
    const app = createApp({ dataDir: tempDir });

    expect((await request(app).put("/api/preferences/layout").send([{ moduleId: "unknown", x: 0, y: 0, w: 4, h: 4, enabled: true }])).status).toBe(400);
    expect((await request(app).put("/api/preferences/layout").send([{ moduleId: "profile", x: -1, y: 0, w: 4, h: 4, enabled: true }])).status).toBe(400);
    expect((await request(app).put("/api/preferences/layout").send([{ moduleId: "profile", x: 0, y: 0, w: 0, h: 4, enabled: true }])).status).toBe(400);
    expect((await request(app).put("/api/preferences/navigation").send([
      { id: "home", label: "我的主页", path: "/", position: 0, visible: true, disabled: false },
      { id: "home", label: "重复主页", path: "/", position: 1, visible: true, disabled: false }
    ])).status).toBe(400);
    expect((await request(app).put("/api/preferences/theme").send({ theme: "violet" })).status).toBe(400);
  });
});
