import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const LEGACY_REMINDER_TASKS = Object.freeze([
  "\\LYJWorkBench-ReminderRunner",
  "\\LYJWorkBench-OutboundCheckin"
]);

export const LEGACY_TASK_RETIREMENT_ERROR =
  "旧版提醒任务清理失败，请在 Windows 任务计划程序中删除 LYJ Workbench 的旧提醒任务后重试。";

/**
 * @typedef {(file: string, args: string[], options: { windowsHide: boolean }) => Promise<{ exitCode: number, stdout: string, stderr?: string }>} TaskCommandRunner
 */

/** @type {TaskCommandRunner} */
export function runTaskCommand(file, args, options) {
  return new Promise((complete) => {
    execFile(file, args, { windowsHide: options.windowsHide }, (error, stdout) => {
      complete({
        exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
        stdout: typeof stdout === "string" ? stdout : ""
      });
    });
  });
}

function parseCsvFirstField(line) {
  if (!line.startsWith('"')) throw new Error(LEGACY_TASK_RETIREMENT_ERROR);
  let value = "";
  for (let index = 1; index < line.length; index += 1) {
    const character = line[index];
    if (character !== '"') {
      value += character;
      continue;
    }
    if (line[index + 1] === '"') {
      value += '"';
      index += 1;
      continue;
    }
    const remainder = line.slice(index + 1);
    if (remainder !== "" && !remainder.startsWith(",")) throw new Error(LEGACY_TASK_RETIREMENT_ERROR);
    return value;
  }
  throw new Error(LEGACY_TASK_RETIREMENT_ERROR);
}

function enumeratedTaskNames(stdout) {
  return new Set(stdout.replace(/^\uFEFF/, "").split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvFirstField));
}

/**
 * @param {{ platform?: NodeJS.Platform | string, run?: TaskCommandRunner }} options
 */
export async function retireLegacyReminderTasks({ platform = process.platform, run = runTaskCommand } = {}) {
  if (platform !== "win32") return { retired: [] };
  const enumeration = await run("schtasks.exe", ["/Query", "/FO", "CSV", "/NH"], { windowsHide: true });
  if (enumeration.exitCode !== 0) throw new Error(LEGACY_TASK_RETIREMENT_ERROR);
  let taskNames;
  try {
    taskNames = enumeratedTaskNames(enumeration.stdout ?? "");
  } catch {
    throw new Error(LEGACY_TASK_RETIREMENT_ERROR);
  }
  const retired = [];
  for (const taskName of LEGACY_REMINDER_TASKS) {
    if (!taskNames.has(taskName)) continue;
    const deletion = await run("schtasks.exe", ["/Delete", "/TN", taskName, "/F"], { windowsHide: true });
    if (deletion.exitCode !== 0) throw new Error(LEGACY_TASK_RETIREMENT_ERROR);
    retired.push(taskName);
  }
  return { retired };
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  retireLegacyReminderTasks().catch(() => {
    console.error(LEGACY_TASK_RETIREMENT_ERROR);
    process.exitCode = 1;
  });
}
