import { describe, expect, it } from "vitest";
import { smtpPresets } from "./smtpPresets";

describe("SMTP presets", () => {
  it("provides editable authorization-code presets without claiming Outlook password support", () => {
    expect(smtpPresets.gmail).toEqual({ host: "smtp.gmail.com", port: 465, transportMode: "tls" });
    expect(smtpPresets.qq).toEqual({ host: "smtp.qq.com", port: 465, transportMode: "tls" });
    expect(smtpPresets.netease163).toEqual({ host: "smtp.163.com", port: 465, transportMode: "tls" });
    expect(smtpPresets.custom).toBeNull();
    expect(smtpPresets).not.toHaveProperty("outlook");
  });
});
