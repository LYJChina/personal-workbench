import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  it("disables and stops only the exact running root task before approving a stopped server", async () => {
    const wrapper = join(tempDir, "running-task.ps1");
    const calls = join(tempDir, "calls.txt");
    await writeFile(wrapper, `
      param([string]$Script)
      $ErrorActionPreference = 'Stop'
      $script:Queries = 0
      function Get-ScheduledTask {
        param($TaskPath, $TaskName, $ErrorAction)
        Add-Content -LiteralPath $env:LYJ_CALLS -Value ("get|" + $TaskPath + "|" + $TaskName)
        if ($TaskName -eq 'LYJWorkBench-OutboundCheckin') { return $null }
        $script:Queries += 1
        if ($script:Queries -eq 1) { return [pscustomobject]@{ TaskPath = '\\'; TaskName = $TaskName; State = 'Running' } }
        return [pscustomobject]@{ TaskPath = '\\'; TaskName = $TaskName; State = 'Ready' }
      }
      function Disable-ScheduledTask { param($TaskPath, $TaskName) Add-Content -LiteralPath $env:LYJ_CALLS -Value ("disable|" + $TaskPath + "|" + $TaskName) }
      function Stop-ScheduledTask { param($TaskPath, $TaskName) Add-Content -LiteralPath $env:LYJ_CALLS -Value ("stop|" + $TaskPath + "|" + $TaskName) }
      function Get-NetTCPConnection {
        param($LocalAddress, $LocalPort, $State, $ErrorAction)
        Add-Content -LiteralPath $env:LYJ_CALLS -Value ("listener|" + $LocalAddress + "|" + $LocalPort + "|" + $State)
        return $null
      }
      & $Script
    `);

    const result = await execFileAsync("powershell", ["-NoProfile", "-File", wrapper, "-Script", script], {
      env: { ...process.env, LYJ_CALLS: calls }
    });

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Backup preparation complete");
    expect((await readFile(calls, "utf8")).trim().split(/\r?\n/)).toEqual([
      "get|\\|LYJWorkBench-ReminderRunner",
      "disable|\\|LYJWorkBench-ReminderRunner",
      "stop|\\|LYJWorkBench-ReminderRunner",
      "get|\\|LYJWorkBench-ReminderRunner",
      "get|\\|LYJWorkBench-OutboundCheckin",
      "listener|127.0.0.1|3001|Listen"
    ]);
  });

  it("refuses a same-name task returned from a foreign path without changing it", async () => {
    const wrapper = join(tempDir, "foreign-task.ps1");
    const actionMarker = join(tempDir, "action.txt");
    await writeFile(wrapper, `
      param([string]$Script)
      $ErrorActionPreference = 'Stop'
      function Get-ScheduledTask { param($TaskPath, $TaskName, $ErrorAction) return [pscustomobject]@{ TaskPath = '\\Foreign\\'; TaskName = $TaskName; State = 'Running' } }
      function Disable-ScheduledTask { Set-Content -LiteralPath $env:LYJ_ACTION -Value 'disabled' }
      function Stop-ScheduledTask { Set-Content -LiteralPath $env:LYJ_ACTION -Value 'stopped' }
      function Get-NetTCPConnection { return $null }
      & $Script
    `);

    await expect(execFileAsync("powershell", ["-NoProfile", "-File", wrapper, "-Script", script], {
      env: { ...process.env, LYJ_ACTION: actionMarker }
    })).rejects.toMatchObject({ code: 1 });
    await expect(readFile(actionMarker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses backup preparation while the exact loopback server port is listening", async () => {
    const wrapper = join(tempDir, "live-server.ps1");
    await writeFile(wrapper, `
      param([string]$Script)
      $ErrorActionPreference = 'Stop'
      function Get-ScheduledTask { return $null }
      function Get-NetTCPConnection { return [pscustomobject]@{ LocalAddress = '127.0.0.1'; LocalPort = 3001; State = 'Listen' } }
      & $Script
    `);

    await expect(execFileAsync("powershell", ["-NoProfile", "-File", wrapper, "-Script", script])).rejects.toMatchObject({ code: 1 });
  });
});
