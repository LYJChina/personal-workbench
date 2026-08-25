import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import { ContributionRegistry } from "../src/kernel/contribution-registry";
import type { PluginLifecycle } from "../src/kernel/plugin-lifecycle";
import {
  createPluginRouteGuard,
  createPluginStartupReadiness
} from "../src/kernel/plugin-route-guard";
import { createPluginRouter } from "../src/modules/plugins/plugin.routes";
import { PluginRepository } from "../src/modules/plugins/plugin.repository";
import { compiledSystemPluginManifests } from "../src/system-plugins/manifests";

const pluginIds = [
  "lyj.system.ai-chat",
  "lyj.system.ai-polish",
  "lyj.system.daily-reports",
  "lyj.system.reminders",
  "lyj.system.workday-calendar"
] as const;

const expectedContributions = [
  {
    pluginId: "lyj.system.ai-chat",
    contribution: {
      type: "dashboard", id: "ai-chat", title: "大模型对话",
      component: "system.ai-chat.dashboard", minW: 4, minH: 5
    }
  },
  {
    pluginId: "lyj.system.ai-polish",
    contribution: {
      type: "route", id: "ai-polish-page", path: "/ai-office/polish",
      component: "system.ai-polish.page"
    }
  },
  {
    pluginId: "lyj.system.ai-polish",
    contribution: {
      type: "ai-tool", id: "ai-polish", label: "AI 润色",
      description: "日报、领导沟通、翻译和普通润色，按不同场景使用专属提示词。",
      path: "/ai-office/polish", icon: "sparkles", position: 10
    }
  },
  {
    pluginId: "lyj.system.daily-reports",
    contribution: {
      type: "route", id: "daily-report-page", path: "/ai-office/daily-report",
      component: "system.daily-reports.page"
    }
  },
  {
    pluginId: "lyj.system.daily-reports",
    contribution: {
      type: "ai-tool", id: "daily-report", label: "日报生成",
      description: "整理工作进展、风险和下一步计划。",
      path: "/ai-office/daily-report", icon: "file", position: 20
    }
  },
  {
    pluginId: "lyj.system.reminders",
    contribution: {
      type: "navigation", id: "reminders", label: "提醒事项",
      path: "/reminders", icon: "bell", position: 20
    }
  },
  {
    pluginId: "lyj.system.reminders",
    contribution: {
      type: "route", id: "reminders-page", path: "/reminders",
      component: "system.reminders.page"
    }
  },
  {
    pluginId: "lyj.system.reminders",
    contribution: {
      type: "dashboard", id: "upcoming-reminders", title: "近期提醒",
      component: "system.reminders.dashboard", minW: 4, minH: 5
    }
  },
  {
    pluginId: "lyj.system.workday-calendar",
    contribution: {
      type: "dashboard", id: "workday-calendar", title: "中国工作日日历",
      component: "system.workday-calendar.dashboard", minW: 4, minH: 5
    }
  }
] as const;

const disabledBody = { error: { message: "Plugin disabled", code: "PLUGIN_DISABLED" } };

describe("compiled system plugin API", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "lyj-plugin-api-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("exports five deeply immutable validated manifests in stable plugin-ID order", () => {
    expect(compiledSystemPluginManifests.map((manifest) => manifest.id)).toEqual(pluginIds);
    expect(compiledSystemPluginManifests).toHaveLength(5);
    expect(Object.isFrozen(compiledSystemPluginManifests)).toBe(true);
    for (const manifest of compiledSystemPluginManifests) {
      expect(manifest).toMatchObject({
        manifestVersion: 1,
        version: "1.0.0",
        author: "LYJ Workbench",
        kind: "system",
        platforms: ["win32", "darwin"]
      });
      expect(Object.isFrozen(manifest)).toBe(true);
      expect(Object.isFrozen(manifest.platforms)).toBe(true);
      expect(Object.isFrozen(manifest.permissions)).toBe(true);
      expect(Object.isFrozen(manifest.contributions)).toBe(true);
      for (const contribution of manifest.contributions) expect(Object.isFrozen(contribution)).toBe(true);
    }
  });

  it("reconciles and starts exactly the five compiled manifests before the first guarded response", async () => {
    const app = createApp({ dataDir });

    const response = await request(app).get("/api/plugins").expect(200);

    expect(response.body.map((summary: { manifest: { id: string } }) => summary.manifest.id)).toEqual(pluginIds);
    expect(response.body).toEqual(compiledSystemPluginManifests.map((manifest) => ({
      manifest,
      enabled: true,
      required: false,
      runtimeStatus: "running",
      permissionsGranted: [...manifest.permissions].sort(),
      errorCode: null
    })));
  });

  it("returns exact running contributions in deterministic order", async () => {
    const app = createApp({ dataDir });

    const response = await request(app).get("/api/plugins/contributions").expect(200);

    expect(response.body).toEqual(expectedContributions);
  });

  it("does not retain a SQLite handle that locks the application data directory between requests", async () => {
    const app = createApp({ dataDir });
    await request(app).get("/api/plugins").expect(200);

    await expect(rm(dataDir, { recursive: true, force: true })).resolves.toBeUndefined();
    dataDir = await mkdtemp(join(tmpdir(), "lyj-plugin-api-"));
  });

  it("runs canonical database initialization once across repeated plugin operations", async () => {
    let initializationCount = 0;
    const app = createApp({
      dataDir,
      pluginDatabaseInitializer: (paths) => {
        initializationCount += 1;
        return openDatabase(paths);
      }
    });

    await request(app).get("/api/plugins").expect(200);
    await request(app).get("/api/plugins/contributions").expect(200);
    await request(app)
      .put("/api/plugins/lyj.system.ai-chat/enabled")
      .send({ enabled: false })
      .expect(200);
    await request(app)
      .put("/api/plugins/lyj.system.ai-chat/enabled")
      .send({ enabled: true })
      .expect(200);

    expect(initializationCount).toBe(1);
  });

  it("does not make later core or plugin-lookalike routes wait for plugin readiness", async () => {
    const app = express();
    const pendingReadiness = createPluginStartupReadiness(
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
      1_000
    );
    const lifecycle = { status: () => [] } as unknown as PluginLifecycle;
    app.use("/api", createPluginRouter({
      lifecycle,
      registry: new ContributionRegistry(),
      readiness: pendingReadiness
    }));
    app.get("/api/core-after-plugin-router", (_request, response) => response.json({ route: "core" }));
    app.get("/api/plugins-extra", (_request, response) => response.json({ route: "lookalike" }));

    const startedAt = performance.now();
    const [core, lookalike] = await Promise.all([
      request(app).get("/api/core-after-plugin-router").expect(200, { route: "core" }),
      request(app).get("/api/plugins-extra").expect(200, { route: "lookalike" })
    ]);

    expect(core.status).toBe(200);
    expect(lookalike.status).toBe(200);
    expect(performance.now() - startedAt).toBeLessThan(250);
  });

  it("bounds one shared never-resolving startup for plugin endpoints and owned routes", async () => {
    const app = express();
    const neverStarts = new Promise<void>(() => undefined);
    const readiness = createPluginStartupReadiness(neverStarts, 20);
    const lifecycle = {
      status: () => [{
        manifest: { id: "lyj.system.ai-chat" },
        enabled: true,
        runtimeStatus: "starting"
      }]
    } as unknown as PluginLifecycle;
    const unavailable = {
      error: { message: "Internal Server Error", code: "INTERNAL_ERROR" }
    };
    app.use("/api", createPluginRouter({
      lifecycle,
      registry: new ContributionRegistry(),
      readiness
    }));
    app.use("/api", createPluginRouteGuard({
      lifecycle,
      pluginId: "lyj.system.ai-chat",
      ownership: [{ path: "/owned", descendants: true }],
      readiness
    }), (_request, response) => response.json({ reached: true }));

    const startedAt = performance.now();
    await Promise.all([
      request(app).get("/api/plugins").expect(500, unavailable),
      request(app).get("/api/owned").expect(404, disabledBody)
    ]);
    expect(performance.now() - startedAt).toBeLessThan(150);
  });

  it("recovers plugin management, safe-mode reset, and owned routes after late startup settlement", async () => {
    const app = express();
    let releaseStartup!: () => void;
    let startupSettled = false;
    const startup = new Promise<void>((resolve) => {
      releaseStartup = () => {
        startupSettled = true;
        resolve();
      };
    });
    const readiness = createPluginStartupReadiness(startup, 20);
    const resetSafeMode = vi.fn();
    const startAll = vi.fn().mockResolvedValue(undefined);
    const lifecycle = {
      status: () => [{
        manifest: { id: "lyj.system.ai-chat" },
        enabled: true,
        runtimeStatus: startupSettled ? "running" : "starting"
      }],
      resetSafeMode,
      startAll
    } as unknown as PluginLifecycle;
    const unavailable = {
      error: { message: "Internal Server Error", code: "INTERNAL_ERROR" }
    };
    app.use("/api", createPluginRouter({
      lifecycle,
      registry: new ContributionRegistry(),
      readiness
    }));
    app.use("/api", createPluginRouteGuard({
      lifecycle,
      pluginId: "lyj.system.ai-chat",
      ownership: [{ path: "/owned", descendants: true }],
      readiness
    }), (_request, response) => response.json({ reached: true }));

    await request(app).get("/api/plugins").expect(500, unavailable);
    await request(app).get("/api/owned").expect(404, disabledBody);

    releaseStartup();
    await startup;

    await request(app).get("/api/plugins").expect(200);
    await request(app).post("/api/plugins/safe-mode/reset").expect(200);
    await request(app).get("/api/owned").expect(200, { reached: true });
    expect(resetSafeMode).toHaveBeenCalledOnce();
    expect(startAll).toHaveBeenCalledOnce();
  });

  it("matches owned paths with Express case-insensitive and non-strict routing semantics", async () => {
    const app = express();
    const lifecycle = {
      status: () => [
        {
          manifest: { id: "lyj.system.reminders" },
          enabled: false,
          runtimeStatus: "stopped"
        },
        {
          manifest: { id: "lyj.system.workday-calendar" },
          enabled: false,
          runtimeStatus: "stopped"
        }
      ]
    } as unknown as PluginLifecycle;
    const readiness = createPluginStartupReadiness(Promise.resolve(), 20);
    app.use("/api", createPluginRouteGuard({
      lifecycle,
      pluginId: "lyj.system.workday-calendar",
      ownership: [{ path: "/calendar", descendants: true }],
      readiness
    }));
    app.use("/api", createPluginRouteGuard({
      lifecycle,
      pluginId: "lyj.system.reminders",
      ownership: [{ path: "/dashboard/upcoming-reminders", descendants: false }],
      readiness
    }));
    app.get("/api/calendar", (_request, response) => response.json({ reached: "calendar" }));
    app.get("/api/dashboard/upcoming-reminders", (_request, response) => response.json({ reached: "dashboard" }));
    app.get("/api/calendar-evil", (_request, response) => response.json({ reached: "lookalike" }));
    app.get("/api/dashboard/upcoming-reminders/extra", (_request, response) => response.json({ reached: "descendant" }));

    await request(app).get("/api/CALENDAR").expect(404, disabledBody);
    await request(app).get("/api/DASHBOARD/UPCOMING-REMINDERS/").expect(404, disabledBody);
    await request(app).get("/api/CALENDAR-EVIL").expect(200, { reached: "lookalike" });
    await request(app).get("/api/DASHBOARD/UPCOMING-REMINDERS/EXTRA")
      .expect(200, { reached: "descendant" });
  });

  it("disables only owned paths, removes contributions, and leaves core and lookalike paths usable", async () => {
    const app = createApp({ dataDir });
    const ownership = [
      ["lyj.system.ai-chat", ["/api/ai-chat/messages"]],
      ["lyj.system.ai-polish", ["/api/ai-polish"]],
      ["lyj.system.daily-reports", ["/api/daily-reports"]],
      ["lyj.system.workday-calendar", ["/api/calendar"]],
      ["lyj.system.reminders", [
        "/api/reminders", "/api/reminder-attempts", "/api/dashboard/upcoming-reminders"
      ]]
    ] as const;

    for (const [pluginId, paths] of ownership) {
      const toggled = await request(app)
        .put(`/api/plugins/${pluginId}/enabled`)
        .send({ enabled: false })
        .expect(200);
      expect(toggled.body).toMatchObject({
        manifest: { id: pluginId }, enabled: false, runtimeStatus: "stopped"
      });
      for (const path of paths) await request(app).get(path).expect(404, disabledBody);

      const contributions = await request(app).get("/api/plugins/contributions").expect(200);
      expect(contributions.body).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ pluginId })
      ]));
    }

    await request(app).get("/api/health").expect(200, { status: "ok" });
    await request(app).get("/api/profile").expect(200);
    await request(app).get("/api/preferences/theme").expect(200);
    await request(app).get("/api/vault/status").expect(200);
    await request(app).get("/api/calendar-evil").expect(404, {
      error: { message: "Not Found", code: "NOT_FOUND" }
    });
    await request(app).get("/api/reminders-evil").expect(404, {
      error: { message: "Not Found", code: "NOT_FOUND" }
    });
    await request(app).get("/api/dashboard/upcoming-reminders/extra").expect(404, {
      error: { message: "Not Found", code: "NOT_FOUND" }
    });
  });

  it("retains reminder business data across disable and restores contributions and API access on re-enable", async () => {
    const app = createApp({ dataDir, now: () => new Date("2026-08-25T09:00:00+08:00") });
    const input = {
      name: "保留的数据", enabled: true, lifecycle: "once", scheduleType: "once",
      startDate: "2026-08-26", localTime: "09:30", weekdays: [], monthDay: null,
      totalOccurrences: null, recipient: "me@example.com", subject: "测试", body: "正文"
    };
    const created = await request(app).post("/api/reminders").send(input).expect(201);

    await request(app).put("/api/plugins/lyj.system.reminders/enabled").send({ enabled: false }).expect(200);
    await request(app).get("/api/reminders").expect(404, disabledBody);
    await request(app).put("/api/plugins/lyj.system.reminders/enabled").send({ enabled: true }).expect(200);

    const restored = await request(app).get("/api/reminders").expect(200);
    expect(restored.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.body.id, name: input.name })
    ]));
    expect((await request(app).get("/api/plugins/contributions")).body).toEqual(expect.arrayContaining([
      expect.objectContaining({ pluginId: "lyj.system.reminders" })
    ]));
  });

  it("persists disabled state through a fresh app instance using the same data directory", async () => {
    const firstApp = createApp({ dataDir });
    await request(firstApp)
      .put("/api/plugins/lyj.system.daily-reports/enabled")
      .send({ enabled: false })
      .expect(200);

    const freshApp = createApp({ dataDir });
    const list = await request(freshApp).get("/api/plugins").expect(200);
    expect(list.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        manifest: expect.objectContaining({ id: "lyj.system.daily-reports" }),
        enabled: false,
        runtimeStatus: "stopped"
      })
    ]));
    await request(freshApp).get("/api/daily-reports").expect(404, disabledBody);

    await request(freshApp)
      .put("/api/plugins/lyj.system.daily-reports/enabled")
      .send({ enabled: true })
      .expect(200);
    await request(freshApp).get("/api/daily-reports").expect(200);
  });

  it("rejects malformed toggles, unknown IDs, required disables, and uninstall attempts with fixed errors", async () => {
    const app = createApp({ dataDir });
    await request(app).get("/api/plugins").expect(200);

    await request(app)
      .put("/api/plugins/lyj.system.ai-chat/enabled")
      .send({ enabled: false, extra: true })
      .expect(400, { error: { message: "Plugin enablement validation failed", code: "VALIDATION_ERROR" } });
    await request(app)
      .put("/api/plugins/lyj.system.unknown/enabled")
      .send({ enabled: true })
      .expect(404, { error: { message: "Plugin not found", code: "PLUGIN_NOT_FOUND" } });
    await request(app)
      .put("/api/plugins/not-canonical/enabled")
      .send({ enabled: true })
      .expect(404, { error: { message: "Plugin not found", code: "PLUGIN_NOT_FOUND" } });

    const database = openDatabase(resolveAppPaths({ dataDir }));
    try {
      database.prepare("UPDATE installed_plugins SET required = 1 WHERE plugin_id = ?")
        .run("lyj.system.ai-chat");
    } finally {
      database.close();
    }
    await request(app)
      .put("/api/plugins/lyj.system.ai-chat/enabled")
      .send({ enabled: false })
      .expect(409, { error: { message: "Required plugin cannot be disabled", code: "PLUGIN_REQUIRED" } });
    await request(app).delete("/api/plugins/lyj.system.ai-chat").expect(404, {
      error: { message: "Not Found", code: "NOT_FOUND" }
    });
  });

  it("pauses optional plugins in persistent safe mode and starts them only after reset", async () => {
    const firstApp = createApp({ dataDir });
    await request(firstApp).get("/api/plugins").expect(200);
    const database = openDatabase(resolveAppPaths({ dataDir }));
    try {
      const repository = new PluginRepository(database);
      repository.beginStartup();
      repository.beginStartup();
      repository.beginStartup();
      repository.beginStartup();
      expect(repository.getStartupState().safeMode).toBe(true);
    } finally {
      database.close();
    }

    const safeApp = createApp({ dataDir });
    const paused = await request(safeApp).get("/api/plugins").expect(200);
    expect(paused.body).toHaveLength(5);
    expect(paused.body.every((summary: { enabled: boolean; runtimeStatus: string }) =>
      summary.enabled && summary.runtimeStatus === "safe-mode"
    )).toBe(true);
    await request(safeApp).get("/api/plugins/contributions").expect(200, []);
    await request(safeApp).get("/api/calendar").expect(404, disabledBody);

    const reset = await request(safeApp).post("/api/plugins/safe-mode/reset").expect(200);
    expect(reset.body.every((summary: { runtimeStatus: string }) => summary.runtimeStatus === "running")).toBe(true);
    await request(safeApp).get("/api/plugins/contributions").expect(200, expectedContributions);
    await request(safeApp).get("/api/calendar?from=2026-08-25&to=2026-08-25").expect(200);
  });
});
