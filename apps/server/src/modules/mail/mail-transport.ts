import nodemailer from "nodemailer";
import type { EnrollmentMailConfig, EnrollmentMailer, RecoveryMailInput } from "../vault/vault-enrollment.service.js";

function transportFor(mail: EnrollmentMailConfig) {
  return nodemailer.createTransport({
    host: mail.smtpHost,
    port: mail.smtpPort,
    secure: mail.transportMode === "tls",
    requireTLS: mail.transportMode === "starttls",
    auth: { user: mail.smtpUsername, pass: mail.smtpPassword },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 8_000,
    tls: { servername: mail.smtpHost }
  });
}

export const enrollmentMailer: EnrollmentMailer = {
  async verify(mail) {
    const transport = transportFor(mail);
    try { await transport.verify(); } finally { transport.close(); }
  },
  async send(input: RecoveryMailInput & { mail: EnrollmentMailConfig }) {
    const transport = transportFor(input.mail);
    try {
      await transport.sendMail({
        from: input.mail.fromAddress,
        to: input.to,
        subject: "LYJ Workbench 密码恢复信息",
        text: `邮箱确认码：${input.confirmationCode}\n\n一次性恢复码：${input.recoveryCode}\n\n请妥善保存。本邮件中的长恢复码只能成功使用一次。`
      });
    } finally { transport.close(); }
  }
};

export async function sendRotatedRecoveryCode(mail: EnrollmentMailConfig, to: string, recoveryCode: string): Promise<void> {
  const transport = transportFor(mail);
  try {
    await transport.sendMail({
      from: mail.fromAddress,
      to,
      subject: "LYJ Workbench 新的一次性恢复码",
      text: `新的恢复码：${recoveryCode}\n\n旧恢复码已经失效。此恢复码成功使用一次后也会立即失效。`
    });
  } finally { transport.close(); }
}
