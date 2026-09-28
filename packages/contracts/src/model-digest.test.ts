import { describe, expect, it } from "vitest";
import { ModelDigestSettingsSchema, ModelDigestSettingsUpdateSchema, StartModelDigestRunSchema } from "./model-digest";
import { ProfileEmailInputsSchema } from "./profile-emails";

const id = "123e4567-e89b-42d3-a456-426614174000";

describe("model digest contracts", () => {
  it("accepts enabled weekday settings and rejects duplicate recipient IDs", () => {
    const valid = ModelDigestSettingsSchema.safeParse({
      enabled: true, recipientIds: [id],
      schedule: { weekdays: [1, 2, 3, 4, 5], localTime: "09:00", timeZone: "Asia/Shanghai" }
    });
    expect(valid.success).toBe(true);
    expect(ModelDigestSettingsSchema.safeParse({
      enabled: true, recipientIds: [id, id],
      schedule: { weekdays: [1, 2, 3, 4, 5], localTime: "09:00", timeZone: "Asia/Shanghai" }
    }).success).toBe(false);
  });

  it("keeps schedule updates limited to enabled and recipients", () => {
    expect(ModelDigestSettingsUpdateSchema.parse({ enabled: false, recipientIds: [] })).toEqual({ enabled: false, recipientIds: [] });
    expect(ModelDigestSettingsUpdateSchema.safeParse({ enabled: false, recipientIds: [], schedule: {} }).success).toBe(false);
  });

  it("does not email a manual run by default", () => {
    expect(StartModelDigestRunSchema.parse({})).toEqual({ sendEmail: false, recipientIds: [] });
  });

  it("rejects duplicate saved profile email IDs", () => {
    const email = { id, label: "Work", address: "user@example.com" };
    expect(ProfileEmailInputsSchema.safeParse([email, { ...email, address: "other@example.com" }]).success).toBe(false);
  });
});
