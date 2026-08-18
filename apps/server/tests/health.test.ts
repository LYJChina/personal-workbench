import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

describe("GET /api/health", () => {
  it("returns the healthy service contract", async () => {
    const response = await request(createApp()).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-lyj-workbench-instance"]).toBeUndefined();
  });

  it("echoes a configured launch instance token only in the dedicated health header", async () => {
    const token = "0123456789abcdef0123456789abcdef";

    const response = await request(createApp({ instanceToken: token })).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-lyj-workbench-instance"]).toBe(token);
  });
});
