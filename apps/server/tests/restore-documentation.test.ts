import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("backup restore documentation", () => {
  it("preserves and restores the database with any WAL/SHM sidecars as one recoverable set", async () => {
    const readme = await readFile(new URL("../../../README.md", import.meta.url), "utf8");
    const restore = readme.slice(readme.indexOf("## Restore or migrate"), readme.indexOf("## Verification"));

    expect(restore).toContain("Stop `pnpm dev` or `pnpm local:start`");
    expect(restore).toContain("workbench.sqlite-wal");
    expect(restore).toContain("workbench.sqlite-shm");
    expect(restore).toMatch(/same recoverable set|together as a set/i);
    expect(restore).toMatch(/before (?:copying|placing) the exported database/i);
    const rollback = restore.slice(restore.indexOf("If verification fails"));
    expect(rollback).toMatch(/roll back/i);
    expect(rollback).toContain("workbench.sqlite-wal");
    expect(rollback).toContain("workbench.sqlite-shm");
    expect(rollback).toMatch(/(?:set|together)/i);
  });
});
