import { describe, expect, it } from "vitest";
import { isModelDigestDue, modelDigestLocalDate, nextModelDigestRunAt } from "../src/modules/model-digest/model-digest.schedule";

describe("model digest weekday schedule", () => {
  it("becomes due at 09:00 Shanghai time on weekdays only", () => {
    expect(isModelDigestDue(new Date("2026-09-28T00:59:00.000Z"))).toBe(false);
    expect(isModelDigestDue(new Date("2026-09-28T01:00:00.000Z"))).toBe(true);
    expect(isModelDigestDue(new Date("2026-10-03T02:00:00.000Z"))).toBe(false);
  });

  it("uses the Shanghai calendar date and skips the weekend for the next run", () => {
    expect(modelDigestLocalDate(new Date("2026-10-02T17:30:00.000Z"))).toBe("2026-10-03");
    expect(nextModelDigestRunAt(new Date("2026-10-02T02:00:00.000Z"))).toBe("2026-10-05T01:00:00.000Z");
  });
});
