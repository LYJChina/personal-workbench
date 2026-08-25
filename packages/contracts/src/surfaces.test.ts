import { describe, expect, it } from "vitest";
import { SurfaceLayoutItemSchema } from "./surfaces";

const validItem = {
  itemId: "profile-card",
  surface: "dashboard",
  x: 0,
  y: 1,
  w: 4,
  h: 3,
  enabled: true
};

describe("SurfaceLayoutItemSchema", () => {
  it("accepts a bounded dashboard layout item", () => {
    expect(SurfaceLayoutItemSchema.parse(validItem)).toEqual(validItem);
  });

  it("rejects unknown fields and invalid bounds", () => {
    expect(SurfaceLayoutItemSchema.safeParse({ ...validItem, extra: true }).success).toBe(false);
    expect(SurfaceLayoutItemSchema.safeParse({ ...validItem, x: -1 }).success).toBe(false);
    expect(SurfaceLayoutItemSchema.safeParse({ ...validItem, w: 17 }).success).toBe(false);
    expect(SurfaceLayoutItemSchema.safeParse({ ...validItem, h: 0 }).success).toBe(false);
  });
});
