import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "../..");

async function productionFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    if (entry.isDirectory()) return productionFiles(path);
    return entry.isFile() ? [path] : [];
  }));
  return nested.flat().sort();
}

async function sourceText(root: string): Promise<string> {
  const files = (await productionFiles(root)).filter((file) => /\.(?:ts|tsx|mts|mjs)$/.test(file));
  return (await Promise.all(files.map(async (file) =>
    `\n/* ${relative(repositoryRoot, file).replaceAll("\\", "/")} */\n${await readFile(file, "utf8")}`
  ))).join("");
}

describe("system-plugin production security scans", () => {
  it("keeps manifest components behind the compiled resolver without dynamic evaluation", async () => {
    const pluginSources = await sourceText(resolve(repositoryRoot, "apps/web/src/plugins"));

    expect(pluginSources).not.toMatch(/\bimport\s*\(/);
    expect(pluginSources).not.toMatch(/\beval\s*\(/);
    expect(pluginSources).not.toMatch(/\bnew\s+Function\s*\(/);
    expect(pluginSources).toContain("systemComponentRegistry");
  });

  it("keeps automatic reminder execution and scheduler creation out of production", async () => {
    const reminderSources = await sourceText(resolve(repositoryRoot, "apps/server/src/modules/reminders"));
    const retirement = await readFile(resolve(repositoryRoot, "scripts/retire-legacy-reminder-tasks.mjs"), "utf8");

    expect(reminderSources).not.toMatch(/setInterval|node-cron|scheduleJob|ReminderRunner|schtasks/i);
    expect(retirement).not.toMatch(/["']\/Create["']/i);
    expect(retirement).not.toMatch(/["']\/Change["']/i);
  });

  it("keeps PowerShell and VBScript out of production except for the one-time DPAPI adapter", async () => {
    const roots = ["apps", "packages", "scripts"].map((path) => resolve(repositoryRoot, path));
    const files = (await Promise.all(roots.map(productionFiles))).flat();
    expect(files.filter((file) => [".ps1", ".vbs", ".vbscript"].includes(extname(file).toLowerCase()))).toEqual([]);

    const offenders: string[] = [];
    for (const file of files.filter((candidate) =>
      /\.(?:ts|tsx|mts|mjs)$/.test(candidate)
      && !candidate.includes(`${join("tests", "")}`)
      && !/\.test\.[^.]+$/.test(candidate)
    )) {
      if (file.endsWith(join("platform", "legacy-windows-dpapi.ts"))) continue;
      const contents = await readFile(file, "utf8");
      if (/powershell(?:\.exe)?|pwsh(?:\.exe)?|vbscript|wscript(?:\.exe)?|cscript(?:\.exe)?/i.test(contents)) {
        offenders.push(relative(repositoryRoot, file).replaceAll("\\", "/"));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps third-party lifecycle controls out of the system-plugin UI and API", async () => {
    const manager = await readFile(resolve(repositoryRoot, "apps/web/src/features/plugins/PluginManager.tsx"), "utf8");
    const routes = await readFile(resolve(repositoryRoot, "apps/server/src/modules/plugins/plugin.routes.ts"), "utf8");
    const visibleControls = manager.match(/<(?:button|input)[\s\S]*?>/g)?.join("\n") ?? "";

    expect(visibleControls).not.toMatch(/安装|卸载|更新|配额|批准|授权|install|uninstall|update|quota|approv/i);
    expect(routes).not.toMatch(/plugins\/(?:install|uninstall|update|quota|approv)/i);
    expect(routes).not.toMatch(/router\.(?:delete|patch)\s*\(/i);
  });
});
