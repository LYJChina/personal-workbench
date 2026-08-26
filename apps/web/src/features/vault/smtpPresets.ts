export const smtpPresets = {
  gmail: { host: "smtp.gmail.com", port: 465, transportMode: "tls" },
  qq: { host: "smtp.qq.com", port: 465, transportMode: "tls" },
  netease163: { host: "smtp.163.com", port: 465, transportMode: "tls" },
  custom: null
} as const;

export type SmtpPresetId = keyof typeof smtpPresets;
