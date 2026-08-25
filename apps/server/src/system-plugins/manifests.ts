import { PluginManifestSchema, type PluginManifest } from "@workbench/contracts";

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const compiledManifestInputs = [
  {
    manifestVersion: 1,
    id: "lyj.system.ai-chat",
    name: "大模型对话",
    version: "1.0.0",
    author: "LYJ Workbench",
    kind: "system",
    platforms: ["win32", "darwin"],
    permissions: ["ai:use"],
    contributions: [
      {
        type: "dashboard",
        id: "ai-chat",
        title: "大模型对话",
        component: "system.ai-chat.dashboard",
        minW: 4,
        minH: 5
      }
    ]
  },
  {
    manifestVersion: 1,
    id: "lyj.system.ai-polish",
    name: "AI 润色",
    version: "1.0.0",
    author: "LYJ Workbench",
    kind: "system",
    platforms: ["win32", "darwin"],
    permissions: ["ai:use"],
    contributions: [
      {
        type: "route",
        id: "ai-polish-page",
        path: "/ai-office/polish",
        component: "system.ai-polish.page"
      },
      {
        type: "ai-tool",
        id: "ai-polish",
        label: "AI 润色",
        description: "日报、领导沟通、翻译和普通润色，按不同场景使用专属提示词。",
        path: "/ai-office/polish",
        icon: "sparkles",
        position: 10
      }
    ]
  },
  {
    manifestVersion: 1,
    id: "lyj.system.daily-reports",
    name: "日报生成",
    version: "1.0.0",
    author: "LYJ Workbench",
    kind: "system",
    platforms: ["win32", "darwin"],
    permissions: ["ai:use"],
    contributions: [
      {
        type: "route",
        id: "daily-report-page",
        path: "/ai-office/daily-report",
        component: "system.daily-reports.page"
      },
      {
        type: "ai-tool",
        id: "daily-report",
        label: "日报生成",
        description: "整理工作进展、风险和下一步计划。",
        path: "/ai-office/daily-report",
        icon: "file",
        position: 20
      }
    ]
  },
  {
    manifestVersion: 1,
    id: "lyj.system.reminders",
    name: "提醒事项",
    version: "1.0.0",
    author: "LYJ Workbench",
    kind: "system",
    platforms: ["win32", "darwin"],
    permissions: ["reminders:read", "reminders:write", "mail:send"],
    contributions: [
      {
        type: "navigation",
        id: "reminders",
        label: "提醒事项",
        path: "/reminders",
        icon: "bell",
        position: 20
      },
      {
        type: "route",
        id: "reminders-page",
        path: "/reminders",
        component: "system.reminders.page"
      },
      {
        type: "dashboard",
        id: "upcoming-reminders",
        title: "近期提醒",
        component: "system.reminders.dashboard",
        minW: 4,
        minH: 5
      }
    ]
  },
  {
    manifestVersion: 1,
    id: "lyj.system.workday-calendar",
    name: "中国工作日日历",
    version: "1.0.0",
    author: "LYJ Workbench",
    kind: "system",
    platforms: ["win32", "darwin"],
    permissions: [],
    contributions: [
      {
        type: "dashboard",
        id: "workday-calendar",
        title: "中国工作日日历",
        component: "system.workday-calendar.dashboard",
        minW: 4,
        minH: 5
      }
    ]
  }
] as const;

export const compiledSystemPluginManifests: readonly PluginManifest[] = Object.freeze(
  compiledManifestInputs.map((manifest) => deepFreeze(PluginManifestSchema.parse(manifest)))
);
