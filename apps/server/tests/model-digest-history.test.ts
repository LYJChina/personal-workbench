import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import { ModelDigestRepository } from "../src/modules/model-digest/model-digest.repository";
import { ModelDigestService } from "../src/modules/model-digest/model-digest.service";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function repository() {
  const dataDir = await mkdtemp(join(tmpdir(), "digest-history-"));
  dirs.push(dataDir);
  const paths = resolveAppPaths({ dataDir });
  openDatabase(paths).close();
  return new ModelDigestRepository(() => openDatabase(paths));
}

describe("model digest history", () => {
  it("lists saved runs, keeps progress events, moves a finished result to trash, and restores it", async () => {
    const repo = await repository();
    const run = repo.createRun({ type: "manual", recipientIds: [], sendEmail: false,
      scheduledLocalDate: null, now: new Date("2026-09-28T01:00:00.000Z") });
    expect(run).not.toBeNull();
    const id = run!.id;

    repo.addProgressEvent(id, "fetching_huggingface", "正在读取 Hugging Face 趋势榜", new Date("2026-09-28T01:00:01.000Z"));
    repo.updateRun(id, { status: "succeeded", summary: "初稿", finishedAt: "2026-09-28T01:00:02.000Z" });
    expect(repo.getRun(id)?.progressEvents.map((event) => event.stage)).toEqual(["queued", "fetching_huggingface"]);
    expect(repo.listRuns(10, 0).items.map((item) => item.id)).toEqual([id]);

    expect(repo.deleteRun(id, new Date("2026-09-28T02:00:00.000Z"))).toBe(true);
    expect(repo.listRuns(10, 0).total).toBe(0);
    expect(repo.listDeletedRuns(10, 0).items.map((item) => item.id)).toEqual([id]);
    expect(repo.getRun(id)).toBeNull();
    expect(repo.getDeletedRun(id)?.summary).toBe("初稿");
    expect(repo.restoreRun(id)).toBe(true);
    expect(repo.getRun(id)?.summary).toBe("初稿");
    expect(repo.listDeletedRuns(10, 0).total).toBe(0);
  });

  it("protects an active run from editing or deletion", async () => {
    const repo = await repository();
    const run = repo.createRun({ type: "manual", recipientIds: [], sendEmail: false,
      scheduledLocalDate: null, now: new Date("2026-09-28T01:00:00.000Z") });
    expect(() => repo.deleteRun(run!.id, new Date())).toThrow("run_active");
  });

  it("keeps a failure step when a running task is interrupted by restart", async () => {
    const repo = await repository();
    const run = repo.createRun({ type: "manual", recipientIds: [], sendEmail: false,
      scheduledLocalDate: null, now: new Date("2026-09-28T01:00:00.000Z") });
    repo.markInterruptedRuns(new Date("2026-09-28T01:01:00.000Z"));
    expect(repo.getRun(run!.id)?.progressEvents.at(-1)?.stage).toBe("failed");
  });

  it("records each visible step of a successful fetch and summary", async () => {
    const repo = await repository();
    const fetchedAt = "2026-09-28T01:00:00.000Z";
    const item = { sourceId: "huggingface" as const, modelId: "test/model", name: "test/model",
      url: "https://huggingface.co/test/model", description: "一个文本模型。", category: "Text Generation",
      metrics: {}, updatedAt: null };
    const service = new ModelDigestService(repo,
      { complete: async () => ({ content: JSON.stringify({ descriptions: { "test/model": "一个文本模型。" }, overview: "本次摘要。" }), model: "test" }) },
      { send: async () => ({ status: "success" }) },
      { sources: {
        huggingface: async () => ({ sourceId: "huggingface", fetchedAt, items: [item] }),
        openrouter: async () => ({ sourceId: "openrouter", fetchedAt, items: [] })
      }, evidence: async () => [] });
    const id = await service.startManualRun({ sendEmail: false, recipientIds: [] });
    expect(id).not.toBeNull();
    let run = repo.getRun(id!);
    for (let attempt = 0; attempt < 40 && run?.status !== "succeeded"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      run = repo.getRun(id!);
    }
    expect(run?.status).toBe("succeeded");
    expect(run?.progressEvents.map((event) => event.stage)).toEqual([
      "queued", "fetching_huggingface", "fetching_openrouter", "searching_details", "generating_summary", "completed"
    ]);
  });
});
