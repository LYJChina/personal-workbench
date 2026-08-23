import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  LEGACY_REMINDER_TASKS,
  LEGACY_TASK_RETIREMENT_ERROR,
  retireLegacyReminderTasks,
  type TaskCommandRunner
} from "../../../scripts/retire-legacy-reminder-tasks.mjs";

describe("legacy Windows reminder task retirement", () => {
  it("does nothing outside Windows", async () => {
    const run = vi.fn<TaskCommandRunner>();
    await expect(retireLegacyReminderTasks({ platform: "darwin", run })).resolves.toEqual({ retired: [] });
    expect(run).not.toHaveBeenCalled();
  });

  it("continues after a successful enumeration with no exact matches", async () => {
    const run = vi.fn<TaskCommandRunner>().mockResolvedValue({
      exitCode: 0,
      stdout: '"\\OtherTask","N/A","Ready"\r\n"\\Folder\\LYJWorkBench-ReminderRunner","N/A","Ready"\r\n'
    });

    await expect(retireLegacyReminderTasks({ platform: "win32", run })).resolves.toEqual({ retired: [] });

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith("schtasks.exe", ["/Query", "/FO", "CSV", "/NH"], { windowsHide: true });
  });

  it("parses quoted CSV and deletes only both exact root task paths", async () => {
    const calls: Array<{ file: string; args: string[]; windowsHide: boolean | undefined }> = [];
    const run: TaskCommandRunner = async (file, args, options) => {
      calls.push({ file, args, windowsHide: options.windowsHide });
      if (args[0] === "/Query") {
        return {
          exitCode: 0,
          stdout: [
            '"\\Other, Task","N/A","Ready"',
            '"\\LYJWorkBench-ReminderRunner","N/A","Ready"',
            '"\\Folder\\LYJWorkBench-OutboundCheckin","N/A","Ready"',
            '"\\LYJWorkBench-OutboundCheckin","N/A","Ready"',
            '"\\Quoted ""Task""","N/A","Ready"'
          ].join("\r\n")
        };
      }
      return { exitCode: 0, stdout: "" };
    };

    await expect(retireLegacyReminderTasks({ platform: "win32", run })).resolves.toEqual({
      retired: [...LEGACY_REMINDER_TASKS]
    });

    expect(calls).toEqual([
      { file: "schtasks.exe", args: ["/Query", "/FO", "CSV", "/NH"], windowsHide: true },
      { file: "schtasks.exe", args: ["/Delete", "/TN", LEGACY_REMINDER_TASKS[0], "/F"], windowsHide: true },
      { file: "schtasks.exe", args: ["/Delete", "/TN", LEGACY_REMINDER_TASKS[1], "/F"], windowsHide: true }
    ]);
    expect(calls.flatMap(({ args }) => args)).not.toContain("/Create");
  });

  it.each([
    { name: "enumeration permission failure", result: { exitCode: 5, stdout: "", stderr: "secret access denied" } },
    { name: "scheduler service failure", result: { exitCode: 1, stdout: "", stderr: "service unavailable" } },
    { name: "process execution failure", result: { exitCode: 1, stdout: "", stderr: "spawn ENOENT secret" } }
  ])("blocks startup on $name without exposing dependency text", async ({ result }) => {
    const run = vi.fn<TaskCommandRunner>().mockResolvedValue(result);

    await expect(retireLegacyReminderTasks({ platform: "win32", run })).rejects.toThrow(LEGACY_TASK_RETIREMENT_ERROR);
    await retireLegacyReminderTasks({ platform: "win32", run }).catch((error: unknown) => {
      expect(String(error)).not.toContain(result.stderr);
    });
  });

  it("blocks startup when successful enumeration returns malformed CSV", async () => {
    const run = vi.fn<TaskCommandRunner>().mockResolvedValue({ exitCode: 0, stdout: '"unterminated task name' });
    await expect(retireLegacyReminderTasks({ platform: "win32", run })).rejects.toThrow(LEGACY_TASK_RETIREMENT_ERROR);
  });

  it("blocks startup with a fixed sanitized error when deletion fails", async () => {
    const dependencyText = "Access denied for DOMAIN\\secret-user";
    const run: TaskCommandRunner = async (_file, args) => args[0] === "/Query"
      ? { exitCode: 0, stdout: `"${LEGACY_REMINDER_TASKS[0]}","N/A","Ready"` }
      : { exitCode: 5, stdout: "", stderr: dependencyText };

    await expect(retireLegacyReminderTasks({ platform: "win32", run })).rejects.toThrow(LEGACY_TASK_RETIREMENT_ERROR);
    await retireLegacyReminderTasks({ platform: "win32", run }).catch((error: unknown) => {
      expect(String(error)).not.toContain(dependencyText);
    });
  });

  it("runs automatically before root development and local startup", async () => {
    const rootPackage = JSON.parse(await readFile(resolve(process.cwd(), "../../package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts.predev).toBe("node scripts/retire-legacy-reminder-tasks.mjs");
    expect(rootPackage.scripts["prelocal:start"]).toBe("node scripts/retire-legacy-reminder-tasks.mjs");
  });
});
