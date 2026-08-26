import { randomInt } from "node:crypto";
import { generateRecoveryCode } from "./vault-recovery.crypto.js";
import type { VaultService } from "./vault.service.js";

export interface EnrollmentMailConfig {
  smtpHost: string;
  smtpPort: number;
  transportMode: "starttls" | "tls";
  smtpUsername: string;
  fromAddress: string;
  smtpPassword: string;
}

export interface RecoveryMailInput {
  to: string;
  recoveryCode: string;
  confirmationCode: string;
}

export interface EnrollmentMailer {
  verify(mail: EnrollmentMailConfig): Promise<void>;
  send(input: RecoveryMailInput & { mail: EnrollmentMailConfig }): Promise<void>;
}

export class VaultEnrollmentService {
  public constructor(
    private readonly vault: VaultService,
    private readonly mailer: EnrollmentMailer,
    private readonly options: { now?: () => Date; persistMail?: (mail: EnrollmentMailConfig) => void } = {}
  ) {}

  public async setup(input: { masterPassword: string; recoveryEmail: string; mail: EnrollmentMailConfig }): Promise<string> {
    await this.mailer.verify(input.mail);
    const generated = generateRecoveryCode();
    const confirmationCode = randomInt(0, 1_000_000).toString().padStart(6, "0");
    try {
      await this.vault.setup(input.masterPassword, { "smtp-password": input.mail.smtpPassword });
      const now = this.options.now?.() ?? new Date();
      await this.vault.enrollPendingRecovery({
        recoveryEmail: input.recoveryEmail,
        recoveryCode: generated.display,
        confirmationCode,
        confirmationExpiresAt: new Date(now.getTime() + 15 * 60_000),
        smtpEmail: input.mail.smtpUsername,
        smtpPassword: input.mail.smtpPassword
      });
      this.options.persistMail?.(input.mail);
      await this.mailer.send({ mail: input.mail, to: input.recoveryEmail, recoveryCode: generated.display, confirmationCode });
      return confirmationCode;
    } finally {
      generated.entropy.fill(0);
    }
  }

  public async confirm(confirmationCode: string): Promise<void> {
    this.vault.confirmRecovery(confirmationCode, this.options.now?.() ?? new Date());
  }
}
