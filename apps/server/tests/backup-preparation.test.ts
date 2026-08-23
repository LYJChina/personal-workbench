import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("backup preparation", () => {
  let tempDir: string;
  const script = resolve(process.cwd(), "../../scripts/prepare-backup.ps1");

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lyj-workbench-backup-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("checks only the stopped loopback server and reports the data path", async () => {
    const wrapper = join(tempDir, "stopped-server.ps1");
    await writeFile(wrapper, `
      param([string]$Script)
      $ErrorActionPreference = 'Stop'
      function Get-ScheduledTask { throw 'scheduled tasks must not be queried' }
      function Disable-ScheduledTask { throw 'scheduled tasks must not be disabled' }
      function Stop-ScheduledTask { throw 'scheduled tasks must not be stopped' }
      function Get-NetTCPConnection { return $null }
      & $Script
    `);

    const result = await execFileAsync("powershell", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", wrapper, "-Script", script
    ], { env: { ...process.env, LOCALAPPDATA: tempDir } });

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Backup preparation complete");
    expect(result.stdout).toContain(join(tempDir, "LYJWorkBench"));
    expect(result.stdout).not.toMatch(/task|计划任务|re-enable/i);
  });

  it("refuses backup preparation while the loopback server is listening", async () => {
    const wrapper = join(tempDir, "live-server.ps1");
    await writeFile(wrapper, `
      param([string]$Script)
      $ErrorActionPreference = 'Stop'
      function Get-ScheduledTask { throw 'scheduled tasks must not be queried' }
      function Get-NetTCPConnection { return [pscustomobject]@{ LocalAddress = '127.0.0.1'; LocalPort = 3001; State = 'Listen' } }
      & $Script
    `);

    await expect(execFileAsync("powershell", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", wrapper, "-Script", script
    ], { env: { ...process.env, LOCALAPPDATA: tempDir } })).rejects.toMatchObject({ code: 1 });
  });
});
