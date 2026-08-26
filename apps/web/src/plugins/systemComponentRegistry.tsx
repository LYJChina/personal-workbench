import type { ComponentType } from "react";
import { AiChatCard } from "../features/ai-chat/AiChatCard";
import { AiPolishPage } from "../features/ai-polish/AiPolishPage";
import { WorkdayCalendarCard } from "../features/calendar/WorkdayCalendarCard";
import { DailyReportPage } from "../features/daily-report/DailyReportPage";
import { ReminderPage } from "../features/reminders/ReminderPage";
import { UpcomingRemindersCard } from "../features/reminders/UpcomingRemindersCard";
import { PasswordManagerPage } from "../features/password-manager/PasswordManagerPage";

export const systemComponentRegistry = {
  "system.ai-chat.dashboard": AiChatCard,
  "system.ai-polish.page": AiPolishPage,
  "system.daily-reports.page": DailyReportPage,
  "system.workday-calendar.dashboard": WorkdayCalendarCard,
  "system.reminders.page": ReminderPage,
  "system.reminders.dashboard": UpcomingRemindersCard,
  "system.password-manager.page": PasswordManagerPage
} satisfies Record<string, ComponentType>;

export type SystemComponentToken = keyof typeof systemComponentRegistry;

export function resolveSystemComponent(token: string): ComponentType | undefined {
  if (!Object.prototype.hasOwnProperty.call(systemComponentRegistry, token)) return undefined;
  return systemComponentRegistry[token as SystemComponentToken];
}
