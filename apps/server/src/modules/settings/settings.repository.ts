import type Database from "better-sqlite3";
import type { DeepSeekSettings, MailSettings } from "@workbench/contracts";

type SettingsValues = Record<string, string>;

const defaults = {
  deepseekBaseUrl: "https://api.deepseek.com",
  deepseekModel: "deepseek-chat",
  smtpHost: "",
  smtpPort: "587",
  mailTransportMode: "starttls" as const,
  smtpUsername: "",
  fromAddress: ""
};

export class SettingsRepository {
  public constructor(private readonly database: Database.Database) {}

  public getDeepSeekSettings(apiKeyConfigured: boolean): DeepSeekSettings {
    const values = this.read([
      "deepseek.base_url",
      "deepseek.model"
    ]);
    return {
      baseUrl: values["deepseek.base_url"] ?? defaults.deepseekBaseUrl,
      model: values["deepseek.model"] ?? defaults.deepseekModel,
      apiKeyConfigured
    };
  }

  public saveDeepSeekSettings(input: Pick<DeepSeekSettings, "baseUrl" | "model">, apiKeyConfigured: boolean): DeepSeekSettings {
    this.write({
      "deepseek.base_url": input.baseUrl,
      "deepseek.model": input.model
    });
    return this.getDeepSeekSettings(apiKeyConfigured);
  }

  public getMailSettings(smtpPasswordConfigured: boolean): MailSettings {
    const values = this.read([
      "mail.smtp_host",
      "mail.smtp_port",
      "mail.transport_mode",
      "mail.smtp_username",
      "mail.from_address"
    ]);
    return {
      smtpHost: values["mail.smtp_host"] ?? defaults.smtpHost,
      smtpPort: Number(values["mail.smtp_port"] ?? defaults.smtpPort),
      transportMode: values["mail.transport_mode"] === "tls" ? "tls" : defaults.mailTransportMode,
      smtpUsername: values["mail.smtp_username"] ?? defaults.smtpUsername,
      fromAddress: values["mail.from_address"] ?? defaults.fromAddress,
      smtpPasswordConfigured
    };
  }

  public saveMailSettings(input: Omit<MailSettings, "smtpPasswordConfigured">, smtpPasswordConfigured: boolean): MailSettings {
    this.write({
      "mail.smtp_host": input.smtpHost,
      "mail.smtp_port": String(input.smtpPort),
      "mail.transport_mode": input.transportMode,
      "mail.smtp_username": input.smtpUsername,
      "mail.from_address": input.fromAddress
    });
    return this.getMailSettings(smtpPasswordConfigured);
  }

  private read(keys: string[]): SettingsValues {
    const statement = this.database.prepare("SELECT value FROM app_settings WHERE key = ?");
    return Object.fromEntries(keys.flatMap((key) => {
      const row = statement.get(key) as { value: string } | undefined;
      return row ? [[key, row.value]] : [];
    }));
  }

  private write(values: SettingsValues): void {
    const save = this.database.transaction((entries: Array<[string, string]>) => {
      const statement = this.database.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP");
      entries.forEach(([key, value]) => statement.run(key, value));
    });
    save(Object.entries(values));
  }
}
