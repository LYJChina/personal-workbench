import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SERVER_DIST_DIRECTORY,
  cleanServerDist,
  type RemoveDirectory
} from "../../../scripts/clean-server-dist.mjs";

const execFileAsync = promisify(execFile);
const staleEntry = join(SERVER_DIST_DIRECTORY, "reminder-entry.js");
const staleRunner = join(SERVER_DIST_DIRECTORY, "modules", "reminders", "reminder.runner.js");

afterEach(async () => {
  await rm(staleEntry, { force: true });
  await rm(staleRunner, { force: true });
});

describe("server build cleanup", () => {
  it("always passes the repository server dist to its injected remover", async () => {
    const remove = vi.fn<RemoveDirectory>().mockResolvedValue(undefined);

    await cleanServerDist({ remove });

    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(SERVER_DIST_DIRECTORY, { recursive: true, force: true });
    expect(SERVER_DIST_DIRECTORY).toBe(resolve(process.cwd(), "dist"));
  });

  it("rejects every CLI target override without touching that target", async () => {
    const maliciousTarget = resolve(process.cwd(), "do-not-delete.txt");
    const script = resolve(process.cwd(), "../../scripts/clean-server-dist.mjs");
    await writeFile(maliciousTarget, "keep me");

    await expect(execFileAsync(process.execPath, [script, "--dist-dir", maliciousTarget])).rejects.toMatchObject({ code: 1 });
    await expect(readFile(maliciousTarget, "utf8")).resolves.toBe("keep me");
    await rm(maliciousTarget, { force: true });
  });

  it("removes stale fixed-target reminder output before the next emit", async () => {
    await mkdir(dirname(staleRunner), { recursive: true });
    await writeFile(staleEntry, "stale");
    await writeFile(staleRunner, "stale");

    await execFileAsync(process.execPath, [resolve(process.cwd(), "../../scripts/clean-server-dist.mjs")]);

    await expect(readFile(staleEntry, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(staleRunner, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("wires the cleanup before server compilation", async () => {
    const serverPackage = JSON.parse(await readFile(resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(serverPackage.scripts.build).toMatch(/^node \.\.\/\.\.\/scripts\/clean-server-dist\.mjs && /);
  });
});
