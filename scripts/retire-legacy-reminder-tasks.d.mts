export type TaskCommandResult = {
  exitCode: number;
  stdout: string;
  stderr?: string;
};

export type TaskCommandRunner = (
  file: string,
  args: string[],
  options: { windowsHide: boolean }
) => Promise<TaskCommandResult>;

export const LEGACY_REMINDER_TASKS: readonly [
  "\\LYJWorkBench-ReminderRunner",
  "\\LYJWorkBench-OutboundCheckin"
];
export const LEGACY_TASK_RETIREMENT_ERROR: string;
export function runTaskCommand(
  file: string,
  args: string[],
  options: { windowsHide: boolean }
): Promise<TaskCommandResult>;
export function retireLegacyReminderTasks(options?: {
  platform?: string;
  run?: TaskCommandRunner;
}): Promise<{ retired: string[] }>;
