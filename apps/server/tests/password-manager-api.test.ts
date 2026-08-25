import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKBENCH_MUTATION_HEADER_NAME, WORKBENCH_MUTATION_HEADER_VALUE } from "@workbench/contracts";
import Database from "better-sqlite3";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPasswordManagerRouter,
  passwordManagerNoStore
} from "../src/modules/password-manager/password-manager.routes";
import { PasswordManagerService } from "../src/modules/password-manager/password-manager.service";
import { enforceLocalRequestBoundary } from "../src/security/request-boundary";

const migration = readFileSync(new URL("../src/db/migrations/007_password_manager.sql", import.meta.url), "utf8");
const mutationHeaders = { [WORKBENCH_MUTATION_HEADER_NAME]: WORKBENCH_MUTATION_HEADER_VALUE };
const password = "password-manager-master";
const credential = {
  name: "Example account",
  website: "https://example.test",
  username: "person@example.test",
  password: "credential-secret",
  notes: "private note",
  customFields: [{ label: "PIN", value: "2468" }]
};

describe("password-manager API", () => {
  const databases: Database.Database[] = [];
  const temporaryDirectories: string[] = [];
  const services: PasswordManagerService[] = [];

  function createFixture(options: {
    idleTimeoutMinutes?: number;
    monotonicNow?: () => number;
    scheduleIdleExpiry?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    cancelIdleExpiry?: (handle: ReturnType<typeof setTimeout>) => void;
  } = {}) {
    const database = new Database(":memory:");
    databases.push(database);
    database.pragma("foreign_keys = ON");
    database.exec(migration);
    const passwordManager = new PasswordManagerService(database, {
      crypto: { scrypt: { n: 16, r: 1, p: 1, maxmem: 16 * 1024 * 1024 } },
      idleTimeoutMinutes: options.idleTimeoutMinutes,
      monotonicNow: options.monotonicNow,
      scheduleIdleExpiry: options.scheduleIdleExpiry,
      cancelIdleExpiry: options.cancelIdleExpiry
    });
    services.push(passwordManager);
    const app = express();
    app.use(passwordManagerNoStore);
    app.use(enforceLocalRequestBoundary);
    app.use(express.json());
    app.use("/api", createPasswordManagerRouter({ passwordManager, monotonicNow: options.monotonicNow }));
    return { app, database, passwordManager };
  }

  afterEach(async () => {
    for (const service of services.splice(0)) service.shutdown();
    for (const database of databases.splice(0)) database.close();
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function setupAgent(app: express.Express) {
    const agent = request.agent(app);
    const response = await agent.post("/api/password-manager/setup")
      .set(mutationHeaders)
      .send({ password })
      .expect(201);
    return { agent, response };
  }

  it("keeps password-manager lock state independent and returns a hardened session cookie", async () => {
    const { app } = createFixture();

    await request(app).get("/api/password-manager/status").expect(200, {
      configured: false,
      unlocked: false,
      idleTimeoutMinutes: 10
    });
    const { agent, response } = await setupAgent(app);

    expect(response.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]?.[0]).toContain("SameSite=Strict");
    expect(response.headers["set-cookie"]?.[0]).toContain("Path=/api/password-manager");
    await agent.get("/api/password-manager/status").expect(200, {
      configured: true,
      unlocked: true,
      idleTimeoutMinutes: 10
    });
    await request(app).get("/api/password-manager/status").expect(200, {
      configured: true,
      unlocked: false,
      idleTimeoutMinutes: 10
    });
  });

  it("locks explicitly, clears the session cookie, and returns one fixed locked error", async () => {
    const { app } = createFixture();
    const { agent } = await setupAgent(app);

    const locked = await agent.post("/api/password-manager/lock").set(mutationHeaders).expect(204);

    expect(locked.headers["set-cookie"]?.[0]).toContain("Max-Age=0");
    await agent.get("/api/password-manager/entries").expect(423, {
      error: { message: "Password manager is locked", code: "PASSWORD_MANAGER_LOCKED" }
    });
  });

  it("replaces prior sessions on unlock and explicit lock invalidates the whole password manager", async () => {
    const { app } = createFixture();
    const { agent, response: setup } = await setupAgent(app);
    const oldCookie = setup.headers["set-cookie"][0].split(";", 1)[0];

    const unlocked = await agent.post("/api/password-manager/unlock")
      .set(mutationHeaders)
      .send({ password })
      .expect(200);
    const currentCookie = unlocked.headers["set-cookie"][0].split(";", 1)[0];

    await request(app).get("/api/password-manager/entries").set("Cookie", oldCookie).expect(423);
    await request(app).get("/api/password-manager/entries").set("Cookie", currentCookie).expect(200);
    await agent.post("/api/password-manager/lock").set(mutationHeaders).expect(204);
    await request(app).get("/api/password-manager/entries").set("Cookie", currentCookie).expect(423);
  });

  it("rate limits consecutive unlock failures without leaking the password", async () => {
    let now = 0;
    const { app } = createFixture({ monotonicNow: () => now });
    const { agent } = await setupAgent(app);
    await agent.post("/api/password-manager/lock").set(mutationHeaders).expect(204);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await agent.post("/api/password-manager/unlock")
        .set(mutationHeaders)
        .send({ password: "wrong-password-value" })
        .expect(401);
      expect(JSON.stringify(response.body)).not.toContain("wrong-password-value");
    }
    await agent.post("/api/password-manager/unlock")
      .set(mutationHeaders)
      .send({ password })
      .expect(429, { error: { message: "Too many attempts; try again later", code: "TOO_MANY_ATTEMPTS" } });

    now += 30_001;
    await agent.post("/api/password-manager/unlock").set(mutationHeaders).send({ password }).expect(200, {
      configured: true,
      unlocked: true,
      idleTimeoutMinutes: 10
    });
  });

  it("expires and zeroes the in-memory DEK after the configured idle timeout", async () => {
    let now = 100;
    let expire!: () => void;
    const { app, passwordManager } = createFixture({
      idleTimeoutMinutes: 1,
      monotonicNow: () => now,
      scheduleIdleExpiry: (callback) => {
        expire = callback;
        return { unref: () => undefined } as unknown as ReturnType<typeof setTimeout>;
      },
      cancelIdleExpiry: () => undefined
    });
    const { agent } = await setupAgent(app);
    const sessions = (passwordManager as unknown as { sessions: Map<string, { dek: Buffer }> }).sessions;
    const heldDek = [...sessions.values()][0].dek;
    expect(heldDek.some((byte) => byte !== 0)).toBe(true);

    now += 60_001;
    expire();

    expect(heldDek.every((byte) => byte === 0)).toBe(true);
    await agent.get("/api/password-manager/status").expect(200, {
      configured: true,
      unlocked: false,
      idleTimeoutMinutes: 1
    });
    await agent.get("/api/password-manager/entries").expect(423);
  });

  it("rolls the idle deadline forward on authenticated activity", async () => {
    let now = 0;
    type FakeTimer = { canceled: boolean; callback: () => void; unref(): void };
    const timers: FakeTimer[] = [];
    const { app } = createFixture({
      idleTimeoutMinutes: 1,
      monotonicNow: () => now,
      scheduleIdleExpiry: (callback) => {
        const timer: FakeTimer = { canceled: false, callback, unref: () => undefined };
        timers.push(timer);
        return timer as unknown as ReturnType<typeof setTimeout>;
      },
      cancelIdleExpiry: (handle) => { (handle as unknown as FakeTimer).canceled = true; }
    });
    const { agent } = await setupAgent(app);

    now = 50_000;
    await agent.get("/api/password-manager/entries").expect(200);
    now = 70_000;
    for (const timer of timers.filter((candidate) => !candidate.canceled)) timer.callback();
    await agent.get("/api/password-manager/status").expect(200, {
      configured: true,
      unlocked: true,
      idleTimeoutMinutes: 1
    });

    now = 110_001;
    for (const timer of timers.filter((candidate) => !candidate.canceled)) timer.callback();
    await agent.get("/api/password-manager/status").expect(200, {
      configured: true,
      unlocked: false,
      idleTimeoutMinutes: 1
    });
  });

  it("supports encrypted CRUD, explicit reveal, layout updates, and optimistic conflicts", async () => {
    const { app, database } = createFixture();
    const { agent } = await setupAgent(app);

    const created = await agent.post("/api/password-manager/entries")
      .set(mutationHeaders)
      .send(credential)
      .expect(201);
    const { password: _omittedPassword, ...summaryFields } = credential;
    expect(created.body).toMatchObject(summaryFields);
    expect(created.body).not.toHaveProperty("password");
    expect(created.headers.etag).toBe('"1"');

    const rawRows = database.prepare("SELECT * FROM password_manager_entries").all();
    const rawDatabaseView = JSON.stringify(rawRows, (_key, value) => Buffer.isBuffer(value) ? value.toString("hex") : value);
    for (const secret of Object.values(credential).flatMap((value) =>
      typeof value === "string" ? [value] : value.map((field) => field.value))) {
      expect(rawDatabaseView).not.toContain(secret);
    }

    const listed = await agent.get("/api/password-manager/entries").expect(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).toMatchObject({ id: created.body.id, name: credential.name });
    expect(listed.body.versions).toEqual({ [created.body.id]: 1 });
    expect(JSON.stringify(listed.body)).not.toContain("credential-secret");

    const revealed = await agent.post(`/api/password-manager/entries/${created.body.id}/reveal`)
      .set(mutationHeaders)
      .send({})
      .expect(200);
    expect(revealed.body).toMatchObject({ id: created.body.id, password: "credential-secret" });
    expect(revealed.headers.etag).toBe('"1"');

    const changed = { ...credential, name: "Changed account", password: "new-secret" };
    const updated = await agent.put(`/api/password-manager/entries/${created.body.id}`)
      .set(mutationHeaders)
      .set("If-Match", `"${listed.body.versions[created.body.id]}"`)
      .send(changed)
      .expect(200);
    expect(updated.body).toMatchObject({ name: "Changed account" });
    expect(updated.body).not.toHaveProperty("password");
    expect(updated.headers.etag).toBe('"2"');

    await agent.put(`/api/password-manager/entries/${created.body.id}`)
      .set(mutationHeaders)
      .set("If-Match", '"1"')
      .send(changed)
      .expect(409, { error: { message: "Entry was modified", code: "VERSION_CONFLICT" } });

    await agent.put("/api/password-manager/layout")
      .set(mutationHeaders)
      .send({ items: [{ id: created.body.id, x: 4, y: 5, w: 6, h: 7 }] })
      .expect(204);
    expect((await agent.get("/api/password-manager/entries")).body.layouts)
      .toEqual([{ id: created.body.id, x: 4, y: 5, w: 6, h: 7 }]);

    await agent.put("/api/password-manager/layout")
      .set(mutationHeaders)
      .send({ items: [{ itemId: created.body.id, surface: "dashboard", x: 1, y: 2, w: 8, h: 3, enabled: true }] })
      .expect(204);
    expect((await agent.get("/api/password-manager/entries")).body.layouts)
      .toEqual([{ id: created.body.id, x: 1, y: 2, w: 8, h: 3 }]);

    await agent.delete(`/api/password-manager/entries/${created.body.id}`)
      .set(mutationHeaders)
      .expect(204);
    expect((await agent.get("/api/password-manager/entries")).body.items).toEqual([]);
  });

  it("uses strict validation and sanitized not-found, integrity, and internal errors", async () => {
    const { app, database } = createFixture();
    const { agent } = await setupAgent(app);

    await agent.post("/api/password-manager/entries")
      .set(mutationHeaders)
      .send({ ...credential, unexpected: "credential-secret" })
      .expect(400, { error: { message: "Invalid request", code: "VALIDATION_ERROR" } });
    await agent.post("/api/password-manager/entries/11111111-1111-4111-8111-111111111111/reveal")
      .set(mutationHeaders)
      .send({})
      .expect(404, { error: { message: "Entry not found", code: "ENTRY_NOT_FOUND" } });

    const created = await agent.post("/api/password-manager/entries").set(mutationHeaders).send(credential).expect(201);
    database.prepare("UPDATE password_manager_entries SET auth_tag = ? WHERE id = ?")
      .run(Buffer.alloc(16), created.body.id);
    const corrupted = await agent.get("/api/password-manager/entries").expect(500, {
      error: { message: "Password-manager data could not be verified", code: "PASSWORD_MANAGER_INTEGRITY_ERROR" }
    });
    expect(JSON.stringify(corrupted.body)).not.toContain("credential-secret");
  });

  it("keeps known credential plaintext out of both SQLite and a database backup", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-password-manager-storage-"));
    temporaryDirectories.push(dataDir);
    const databasePath = join(dataDir, "workbench.sqlite");
    const backupPath = join(dataDir, "backup.sqlite");
    const database = new Database(databasePath);
    databases.push(database);
    database.pragma("foreign_keys = ON");
    database.exec(migration);
    const passwordManager = new PasswordManagerService(database, {
      crypto: { scrypt: { n: 16, r: 1, p: 1, maxmem: 16 * 1024 * 1024 } }
    });
    const token = await passwordManager.setup("storage-master-password");
    passwordManager.createEntry(token, credential);
    database.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);

    const sensitive = ["storage-master-password", credential.name, credential.website,
      credential.username, credential.password, credential.notes, credential.customFields[0].label,
      credential.customFields[0].value].map((value) => Buffer.from(value, "utf8"));
    for (const bytes of [await readFile(databasePath), await readFile(backupPath)]) {
      for (const plaintext of sensitive) expect(bytes.includes(plaintext)).toBe(false);
    }
    passwordManager.shutdown();
  });

  it("sets private no-store headers on success and error responses", async () => {
    const { app } = createFixture();
    const status = await request(app).get("/api/password-manager/status").expect(200);
    const forbidden = await request(app).post("/api/password-manager/setup")
      .set(WORKBENCH_MUTATION_HEADER_NAME, "")
      .send({ password })
      .expect(403);
    const invalid = await request(app).post("/api/password-manager/setup")
      .set(mutationHeaders)
      .send({ password: "short" })
      .expect(400);

    expect(status.headers["cache-control"]).toContain("no-store");
    expect(invalid.headers["cache-control"]).toContain("no-store");
    expect(forbidden.headers["cache-control"]).toContain("no-store");
  });

  it("zeroes all active session DEKs during service shutdown", async () => {
    const { app, passwordManager } = createFixture();
    await setupAgent(app);
    const sessions = (passwordManager as unknown as { sessions: Map<string, { dek: Buffer }> }).sessions;
    const heldDek = [...sessions.values()][0].dek;

    passwordManager.shutdown();

    expect(heldDek.every((byte) => byte === 0)).toBe(true);
    expect(sessions.size).toBe(0);
  });
});
