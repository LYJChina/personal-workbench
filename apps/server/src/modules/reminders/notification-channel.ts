import type { ReminderFailureCategory } from "@workbench/contracts";

export interface NotificationMessage {
  to: string;
  subject: string;
  body: string;
}

export type DeliveryResult =
  | { status: "success" }
  | { status: "failure"; category: ReminderFailureCategory };

export interface NotificationChannel {
  send(message: NotificationMessage): Promise<DeliveryResult>;
}
