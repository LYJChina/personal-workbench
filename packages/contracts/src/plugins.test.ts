import { describe, expect, it } from "vitest";
import { PluginManifestSchema, PluginSummarySchema } from "./plugins";

const validManifest = {
  manifestVersion: 1,
  id: "lyj.system.reminders",
  name: "提醒事项",
  version: "1.0.0",
  author: "LYJ Workbench",
  kind: "system",
  platforms: ["win32", "darwin"],
  permissions: ["reminders:read", "reminders:write", "mail:send"],
  contributions: [
    { type: "navigation", id: "reminders", label: "提醒事项", path: "/reminders", icon: "bell", position: 20 },
    { type: "route", id: "reminders-page", path: "/reminders", component: "system.reminders.page" },
    {
      type: "dashboard",
      id: "upcoming-reminders",
      title: "近期提醒",
      component: "system.reminders.dashboard",
      minW: 4,
      minH: 5
    }
  ]
};

function invalidManifest(overrides: Record<string, unknown>) {
  return PluginManifestSchema.safeParse({ ...validManifest, ...overrides });
}

const validSummary = {
  manifest: validManifest,
  enabled: true,
  required: true,
  runtimeStatus: "running",
  permissionsGranted: ["reminders:read", "reminders:write", "mail:send"],
  errorCode: null
};

describe("PluginManifestSchema", () => {
  it("accepts a complete valid system manifest", () => {
    expect(PluginManifestSchema.parse(validManifest)).toEqual(validManifest);
  });

  it("rejects duplicate permission strings", () => {
    expect(invalidManifest({ permissions: ["reminders:read", "reminders:read"] }).success).toBe(false);
  });

  it("rejects duplicate contribution type and id pairs", () => {
    expect(
      invalidManifest({
        contributions: [
          ...validManifest.contributions,
          { type: "navigation", id: "reminders", label: "另一个入口", path: "/other", icon: "bell", position: 30 }
        ]
      }).success
    ).toBe(false);
  });

  it("rejects duplicate route paths", () => {
    expect(
      invalidManifest({
        contributions: [
          ...validManifest.contributions,
          { type: "route", id: "another-page", path: "/reminders", component: "system.reminders.other" }
        ]
      }).success
    ).toBe(false);
  });

  it("rejects duplicate component tokens", () => {
    expect(
      invalidManifest({
        contributions: [
          ...validManifest.contributions,
          {
            type: "settings",
            id: "reminders-settings",
            title: "提醒设置",
            component: "system.reminders.page",
            position: 40
          }
        ]
      }).success
    ).toBe(false);
  });

  it.each([
    ["path traversal-like route paths", { contributions: [{ type: "route", id: "bad-route", path: "/../secrets", component: "system.secrets.page" }] }],
    ["contribution IDs longer than 100 characters", { contributions: [{ type: "navigation", id: "a".repeat(101), label: "Long", path: "/long", icon: "grid", position: 1 }] }],
    ["invalid semantic versions", { version: "1.0.0-beta" }],
    ["unknown permissions", { permissions: ["filesystem:read"] }],
    ["noncanonical plugin IDs", { id: "lyj.system.Reminders" }],
    ["unsupported manifest versions", { manifestVersion: 2 }]
  ])("rejects %s", (_, overrides) => {
    expect(invalidManifest(overrides).success).toBe(false);
  });
});

describe("PluginSummarySchema", () => {
  it.each([null, "PLUGIN_START_FAILED"])('accepts error code %j', (errorCode) => {
    expect(PluginSummarySchema.safeParse({ ...validSummary, errorCode }).success).toBe(true);
  });

  it.each(["PLUGIN_DISABLED", "PLUGIN_PERMISSION_DENIED", "PLUGIN_SAFE_MODE"])(
    "rejects error code %s",
    (errorCode) => {
      expect(PluginSummarySchema.safeParse({ ...validSummary, errorCode }).success).toBe(false);
    }
  );
});
