import { randomUUID } from "node:crypto";
import type { ReminderFailureCategory } from "@workbench/contracts";
import type { NotificationChannel } from "./notification-channel.js";
import { chinaLocalDate, chinaParts, type ReminderRepository } from "./reminder.repository.js";

export interface ReminderRunSummary {
  checked: number;
  sent: number;
  failed: number;
}

export interface ReminderHeartbeatTimers {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface ReminderRunnerDependencies {
  repository: ReminderRepository;
  channel: NotificationChannel;
  claimToken?: () => string;
  claimLeaseMs?: number;
  heartbeatIntervalMs?: number;
  clock?: () => Date;
  timers?: ReminderHeartbeatTimers;
}

const defaultHeartbeatTimers: ReminderHeartbeatTimers = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>)
};

function isDue(now: Date, weekday: number, localTime: string): boolean {
  const parts = chinaParts(now);
  const [hour, minute] = localTime.split(":").map(Number);
  return parts.weekday === weekday && (parts.hour > hour || (parts.hour === hour && parts.minute >= minute));
}

export async function runDueReminders(now: Date, dependencies: ReminderRunnerDependencies): Promise<ReminderRunSummary> {
  const summary: ReminderRunSummary = { checked: 1, sent: 0, failed: 0 };
  const reminder = dependencies.repository.get("outbound-checkin", now);
  const localDate = chinaLocalDate(now);
  if (!reminder.enabled || !isDue(now, reminder.weekday, reminder.localTime) || dependencies.repository.wasDelivered(reminder.id, localDate)) {
    return summary;
  }

  const token = (dependencies.claimToken ?? randomUUID)();
  const claimLeaseMs = dependencies.claimLeaseMs ?? 5 * 60_000;
  const heartbeatIntervalMs = dependencies.heartbeatIntervalMs
    ?? Math.max(1, Math.min(60_000, Math.floor(claimLeaseMs / 3)));
  const clock = dependencies.clock ?? (() => new Date());
  const timers = dependencies.timers ?? defaultHeartbeatTimers;
  const leaseExpiresAt = new Date(now.getTime() + claimLeaseMs);
  if (!dependencies.repository.acquireDeliveryClaim(reminder.id, localDate, token, now, leaseExpiresAt)) return summary;

  let claimOwnershipLost = false;
  let renewalInProgress = false;
  let heartbeatStopped = false;
  let heartbeatHandle: unknown;
  const stopHeartbeat = () => {
    if (heartbeatStopped) return;
    heartbeatStopped = true;
    timers.clearInterval(heartbeatHandle);
  };
  heartbeatHandle = timers.setInterval(() => {
    if (claimOwnershipLost || renewalInProgress) return;
    renewalInProgress = true;
    const renewedAt = clock();
    try {
      const renewed = dependencies.repository.renewClaim(
        reminder.id,
        localDate,
        token,
        renewedAt,
        new Date(renewedAt.getTime() + claimLeaseMs)
      );
      if (!renewed) {
        claimOwnershipLost = true;
        stopHeartbeat();
      }
    } catch {
      // A renewal exception leaves ownership unknown; only a token mismatch proves loss.
    } finally {
      renewalInProgress = false;
    }
  }, heartbeatIntervalMs);

  let result;
  try {
    result = await dependencies.channel.send({ to: reminder.recipient, subject: reminder.subject, body: reminder.body });
  } catch {
    result = { status: "failure" as const, category: "unknown" as ReminderFailureCategory };
  } finally {
    stopHeartbeat();
  }
  if (claimOwnershipLost) {
    summary.failed = 1;
    return summary;
  }
  const completedAt = clock();
  if (result.status === "success") {
    if (dependencies.repository.completeDeliverySuccess(reminder.id, localDate, token, completedAt)) summary.sent = 1;
    else summary.failed = 1;
  } else {
    dependencies.repository.completeDeliveryFailure(reminder.id, localDate, token, result.category, completedAt);
    summary.failed = 1;
  }
  return summary;
}
