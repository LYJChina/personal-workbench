import { describe, expect, it } from "vitest";
import { AiOfficeOrderSchema, SurfaceLayoutItemSchema } from "./surfaces";

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

describe("AiOfficeOrderSchema", () => {
  it("accepts ordered plugin items", () => {
    const order = [
      { itemId: "lyj.system.ai-polish", position: 0 },
      { itemId: "lyj.system.daily-reports", position: 1 }
    ];

    expect(AiOfficeOrderSchema.parse(order)).toEqual(order);
  });

  it("rejects duplicate plugin IDs", () => {
    expect(AiOfficeOrderSchema.safeParse([
      { itemId: "lyj.system.ai-polish", position: 0 },
      { itemId: "lyj.system.ai-polish", position: 1 }
    ]).success).toBe(false);
  });
});
