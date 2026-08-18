import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { SchedulerStatusSchema, type SchedulerStatus } from "@workbench/contracts";

export interface ReminderScheduler {
  status(): Promise<SchedulerStatus>;
  sync(): Promise<SchedulerStatus>;
}

export type SchedulerCommandRunner = (
  executable: string,
  arguments_: string[]
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);
const defaultRunner: SchedulerCommandRunner = async (executable, arguments_) => {
  const result = await execFileAsync(executable, arguments_, { encoding: "utf8", timeout: 30_000, windowsHide: true });
  return { stdout: result.stdout, stderr: result.stderr };
};

export class ReminderSchedulerService implements ReminderScheduler {
  public constructor(private readonly projectRoot: string, private readonly run: SchedulerCommandRunner = defaultRunner) {}

  public static fromCurrentModule(): ReminderSchedulerService {
    const moduleDirectory = dirname(fileURLToPath(import.meta.url));
    return new ReminderSchedulerService(resolve(moduleDirectory, "../../../../.."));
  }

  public async status(): Promise<SchedulerStatus> {
    return this.invoke(["-StatusOnly"]);
  }

  public async sync(): Promise<SchedulerStatus> {
    return this.invoke([]);
  }

  private async invoke(extraArguments: string[]): Promise<SchedulerStatus> {
    const script = join(this.projectRoot, "scripts", "sync-reminder-task.ps1");
    const arguments_ = [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
      "-ProjectRoot", this.projectRoot,
      ...extraArguments
    ];
    const { stdout } = await this.run("powershell.exe", arguments_);
    const line = stdout.trim().split(/\r?\n/).at(-1);
    if (!line) throw new Error("Scheduler returned no status");
    const status = SchedulerStatusSchema.parse(JSON.parse(line));
    return {
      ...status,
      message: status.synchronized
        ? "系统计划已同步"
        : status.installed
          ? "系统计划同步未完成"
          : "系统计划尚未同步"
    };
  }
}
