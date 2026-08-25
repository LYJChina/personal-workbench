import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("system-plugin user documentation", () => {
  it("documents the complete foundation-to-kernel operating contract", async () => {
    const readme = await readFile(new URL("../../../README.md", import.meta.url), "utf8");
    const start = readme.indexOf("## System plugins");
    const end = readme.indexOf("## Reminders");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const plugins = readme.slice(start, end);

    for (const name of ["大模型对话", "AI 润色", "日报生成", "中国工作日日历", "提醒事项"]) {
      expect(plugins).toContain(name);
    }
    expect(plugins).toMatch(/设置.*系统插件/s);
    expect(plugins).toMatch(/停用.*不.*删除.*数据/s);
    expect(plugins).toMatch(/布局.*偏好/s);
    expect(plugins).toMatch(/安全模式/s);
    expect(plugins).toMatch(/core.*profile.*appearance.*vault.*backup.*SMTP.*plugin management/is);
    expect(plugins).toMatch(/third-party folder installation.*Plan 3/is);
    expect(plugins).toMatch(/no install.*update.*uninstall/is);
  });

  it("states the cross-platform, backup, manual-mail, and one-time DPAPI boundaries", async () => {
    const readme = await readFile(new URL("../../../README.md", import.meta.url), "utf8");

    expect(readme).toContain("Use the same project commands on Windows and macOS");
    expect(readme).toContain("pnpm install");
    expect(readme).toContain("pnpm dev");
    expect(readme).toContain("pnpm build");
    expect(readme).toContain("pnpm local:start");
    expect(readme).toMatch(/exported database includes[\s\S]*installed_plugins[\s\S]*plugin_permissions[\s\S]*plugin_audit_events[\s\S]*plugin_runtime_state/i);
    expect(readme).toMatch(/Email is sent only when you explicitly use[\s\S]*manual/);
    expect(readme).toMatch(/no automatic reminder-delivery scheduler/i);
    expect(readme).toMatch(/one-time Windows DPAPI adapter/i);
  });
});
