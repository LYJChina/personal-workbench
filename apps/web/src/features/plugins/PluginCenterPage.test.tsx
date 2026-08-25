import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PluginSummary } from "@workbench/contracts";
import { PluginCenterPage } from "./PluginCenterPage";

const plugin = (id: string, kind: "system" | "third-party"): PluginSummary => ({
  manifest: { id, name: kind === "system" ? "系统日历" : "天气工具", version: "1.0.0", manifestVersion: 1, author: "测试", kind, platforms: ["win32", "darwin"], permissions: ["storage:own"], contributions: [] },
  enabled: true,
  required: false,
  permissionsGranted: ["storage:own"],
  runtimeStatus: "running",
  errorCode: null
});

describe("PluginCenterPage", () => {
  it("separates system and third-party plugins using the existing plugin list API", async () => {
    const api = { getPlugins: vi.fn(async () => [plugin("lyj.system.calendar", "system"), plugin("lyj.plugin.weather", "third-party")]), setPluginEnabled: vi.fn(), resetPluginSafeMode: vi.fn() };
    render(<PluginCenterPage api={api} refreshContributions={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "系统插件" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "第三方插件" })).toBeVisible();
    expect(screen.getByRole("article", { name: "系统日历" })).toBeVisible();
    expect(screen.getByRole("article", { name: "天气工具" })).toBeVisible();
  });
});
