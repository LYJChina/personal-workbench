import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createModelDigestRouter } from "../src/modules/model-digest/model-digest.routes";
import type { ModelDigestService } from "../src/modules/model-digest/model-digest.service";

const id = "123e4567-e89b-42d3-a456-426614174001";

describe("model digest history routes", () => {
  it("lists history and trash, moves a finished record to trash, and restores it", async () => {
    const service = {
      listRuns: vi.fn().mockReturnValue({ items: [{ id }], total: 1, limit: 20, offset: 0 }),
      listDeletedRuns: vi.fn().mockReturnValue({ items: [], total: 0, limit: 20, offset: 0 }),
      deleteRun: vi.fn().mockReturnValue(true),
      restoreRun: vi.fn().mockReturnValue(true),
      getRun: vi.fn().mockReturnValue({ id }),
      getDeletedRun: vi.fn().mockReturnValue({ id })
    };
    const app = express();
    app.use(createModelDigestRouter(service as unknown as ModelDigestService));

    expect((await request(app).get("/model-digest/runs")).body.total).toBe(1);
    expect((await request(app).get("/model-digest/trash")).body.total).toBe(0);
    expect((await request(app).get(`/model-digest/trash/${id}`)).body.id).toBe(id);
    expect((await request(app).delete(`/model-digest/runs/${id}`)).status).toBe(204);
    expect((await request(app).post(`/model-digest/trash/${id}/restore`)).status).toBe(200);
    expect(service.deleteRun).toHaveBeenCalledWith(id);
    expect(service.restoreRun).toHaveBeenCalledWith(id);
  });

  it("rejects deletion of a running record", async () => {
    const app = express();
    app.use(createModelDigestRouter({ deleteRun: () => { throw new Error("run_active"); } } as unknown as ModelDigestService));
    expect((await request(app).delete(`/model-digest/runs/${id}`)).status).toBe(409);
  });
});
