import nodemailer from "nodemailer";
import type { MailSettings, ReminderFailureCategory } from "@workbench/contracts";
import type { SecretStore } from "../../platform/secret-store.js";
import type { DeliveryResult, NotificationChannel, NotificationMessage } from "./notification-channel.js";

const smtpSecretName = "smtp-password";

export interface MailTransportConfiguration {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth: { user: string; pass: string } | undefined;
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  tls: { servername: string };
}

export interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
  close(): void;
}

export type MailTransportFactory = (configuration: MailTransportConfiguration) => MailTransport;

export interface EmailNotificationChannelDependencies {
  secretStore: SecretStore;
  loadSettings(passwordConfigured: boolean): MailSettings;
  transportFactory?: MailTransportFactory;
  timeoutMs?: number;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function complete(settings: MailSettings, password: string | null, message: NotificationMessage): password is string {
  return Boolean(
    password?.trim()
    && settings.smtpHost.trim()
    && Number.isInteger(settings.smtpPort)
    && settings.smtpPort >= 1
    && settings.smtpPort <= 65_535
    && (settings.transportMode === "starttls" || settings.transportMode === "tls")
    && isEmail(settings.fromAddress)
    && isEmail(message.to)
    && message.subject.trim()
    && message.body.trim()
  );
}

function failureCategory(error: unknown): ReminderFailureCategory {
  const candidate = error as { name?: string; code?: string } | null;
  if (candidate?.name === "AbortError" || candidate?.code === "ETIMEDOUT" || candidate?.code === "ESOCKET") return "timeout";
  if (candidate?.code === "EAUTH" || candidate?.code === "EENVELOPE") return "auth_failure";
  if (["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"].includes(candidate?.code ?? "")) return "unreachable_host";
  return "unknown";
}

const defaultTransportFactory: MailTransportFactory = (configuration) => nodemailer.createTransport(configuration) as MailTransport;

export class EmailNotificationChannel implements NotificationChannel {
  public constructor(private readonly dependencies: EmailNotificationChannelDependencies) {}

  public async send(message: NotificationMessage): Promise<DeliveryResult> {
    const password = await this.dependencies.secretStore.readSecret(smtpSecretName);
    const settings = this.dependencies.loadSettings(Boolean(password));
    if (!complete(settings, password, message)) return { status: "failure", category: "not_configured" };

    const timeoutMs = this.dependencies.timeoutMs ?? 8_000;
    const transport = (this.dependencies.transportFactory ?? defaultTransportFactory)({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.transportMode === "tls",
      requireTLS: settings.transportMode === "starttls",
      auth: settings.smtpUsername ? { user: settings.smtpUsername, pass: password } : undefined,
      connectionTimeout: timeoutMs,
      greetingTimeout: timeoutMs,
      socketTimeout: timeoutMs,
      tls: { servername: settings.smtpHost }
    });
    try {
      await transport.sendMail({
        from: settings.fromAddress,
        to: message.to,
        subject: message.subject,
        text: message.body
      });
      return { status: "success" };
    } catch (error) {
      return { status: "failure", category: failureCategory(error) };
    } finally {
      transport.close();
    }
  }
}
