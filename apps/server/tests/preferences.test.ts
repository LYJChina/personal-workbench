import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";

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
      { id: "vault-coming-soon", label: "密码保险箱", path: "/vault", position: 4, visible: true, disabled: false }
    ]);
    const savedTheme = await request(app).put("/api/preferences/theme").send({ theme: "dark" });

    expect(savedLayout.body).toEqual([{ moduleId: "profile", x: 2, y: 1, w: 6, h: 5, enabled: true }]);
    expect(savedNavigation.status).toBe(200);
    expect(savedTheme.body).toEqual({ theme: "dark" });

    const persistedApp = createApp({ dataDir: tempDir });
    expect((await request(persistedApp).get("/api/preferences/layout")).body).toEqual(savedLayout.body);
    expect((await request(persistedApp).get("/api/preferences/navigation")).body[0]).toMatchObject({ id: "settings", position: 0 });
    expect((await request(persistedApp).get("/api/preferences/theme")).body).toEqual({ theme: "dark" });
  });

  it("normalizes a malicious vault enablement attempt on every navigation save", async () => {
    const response = await request(createApp({ dataDir: tempDir })).put("/api/preferences/navigation").send([
      { id: "home", label: "我的主页", path: "/", position: 0, visible: true, disabled: false },
      { id: "ai-office", label: "AI 办公", path: "/ai-office", position: 1, visible: true, disabled: false },
      { id: "reminders", label: "提醒事项", path: "/reminders", position: 2, visible: true, disabled: false },
      { id: "vault-coming-soon", label: "密码保险箱", path: "/vault", position: 3, visible: true, disabled: false },
      { id: "settings", label: "设置", path: "/settings", position: 4, visible: true, disabled: false }
    ]);

    expect(response.status).toBe(200);
    expect(response.body.find((item: { id: string }) => item.id === "vault-coming-soon")).toMatchObject({ disabled: true });
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
