import { createHash, randomBytes, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  PasswordManagerEntryInputSchema,
  type PasswordManagerEntryDetail,
  type PasswordManagerEntryInput,
  type PasswordManagerEntrySummary,
  type PasswordManagerStatus
} from "@workbench/contracts";
import {
  PasswordManagerCrypto,
  PasswordManagerIntegrityError,
  PasswordManagerInvalidPasswordError,
  type PasswordManagerCryptoOptions,
  type PasswordManagerEncryptedValue
} from "./password-manager.crypto.js";
import {
  PasswordManagerEntryNotFoundError,
  PasswordManagerRepository,
  type PasswordManagerEntryLayout,
  type PasswordManagerEntryRow,
  type PasswordManagerLayoutUpdate,
  type PasswordManagerRepositoryProvider
} from "./password-manager.repository.js";

export {
  PasswordManagerIntegrityError,
  PasswordManagerInvalidPasswordError,
  PasswordManagerEntryNotFoundError
};
export { PasswordManagerVersionConflictError } from "./password-manager.repository.js";

export class PasswordManagerLockedError extends Error {
  public constructor() {
    super("Password manager is locked");
    this.name = "PasswordManagerLockedError";
  }
}

export class PasswordManagerAlreadyConfiguredError extends Error {
  public constructor() {
    super("Password manager is already configured");
    this.name = "PasswordManagerAlreadyConfiguredError";
  }
}

export class PasswordManagerNotConfiguredError extends Error {
  public constructor() {
    super("Password manager is not configured");
    this.name = "PasswordManagerNotConfiguredError";
  }
}

export interface PasswordManagerServiceOptions {
  crypto?: PasswordManagerCryptoOptions;
  idleTimeoutMinutes?: number;
  monotonicNow?: () => number;
  scheduleIdleExpiry?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelIdleExpiry?: (handle: ReturnType<typeof setTimeout>) => void;
}

interface Session {
  dek: Buffer;
  lastActive: number;
  expiry: ReturnType<typeof setTimeout> | null;
}

interface StoredCredential {
  name: string;
  website: string;
  username: string;
  password: string;
  notes: string;
  customFields: Array<{ label: string; value: string }>;
}

export interface PasswordManagerEntryResult {
  summary: PasswordManagerEntrySummary;
  layout: PasswordManagerEntryLayout;
  version: number;
}

export interface PasswordManagerRevealResult extends PasswordManagerEntryResult {
  detail: PasswordManagerEntryDetail;
}

function canonicalCredential(input: PasswordManagerEntryInput): StoredCredential {
  return {
    name: input.name,
    website: input.website ?? "",
    username: input.username,
    password: input.password,
    notes: input.notes ?? "",
    customFields: input.customFields?.map((field) => ({ ...field })) ?? []
  };
}

function sessionDigest(token: string): string {
  return createHash("sha256")
    .update("LYJ_WORKBENCH_PASSWORD_MANAGER_SESSION_V1\0", "utf8")
    .update(token, "utf8")
    .digest("hex");
}

export class PasswordManagerService {
  private readonly withRepository: PasswordManagerRepositoryProvider;
  private readonly crypto: PasswordManagerCrypto;
  private readonly idleTimeoutMs: number;
  private readonly now: () => number;
  private readonly scheduleIdleExpiry: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly cancelIdleExpiry: (handle: ReturnType<typeof setTimeout>) => void;
  private readonly sessions = new Map<string, Session>();

  public constructor(database: Database.Database | PasswordManagerRepositoryProvider, options: PasswordManagerServiceOptions = {}) {
    this.withRepository = typeof database === "function"
      ? database
      : <T>(operation: (repository: PasswordManagerRepository) => T) => operation(new PasswordManagerRepository(database));
    this.crypto = new PasswordManagerCrypto(options.crypto);
    const idleTimeoutMinutes = options.idleTimeoutMinutes ?? 10;
    if (!Number.isInteger(idleTimeoutMinutes) || idleTimeoutMinutes < 1 || idleTimeoutMinutes > 1_440) {
      throw new PasswordManagerIntegrityError();
    }
    this.idleTimeoutMs = idleTimeoutMinutes * 60_000;
    this.now = options.monotonicNow ?? (() => performance.now());
    this.scheduleIdleExpiry = options.scheduleIdleExpiry ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelIdleExpiry = options.cancelIdleExpiry ?? ((handle) => clearTimeout(handle));
  }

  public status(sessionToken?: string): PasswordManagerStatus {
    this.removeExpiredSessions();
    return {
      configured: this.withRepository((repository) => repository.isConfigured()),
      unlocked: sessionToken ? this.sessions.has(sessionDigest(sessionToken)) : false,
      idleTimeoutMinutes: this.idleTimeoutMs / 60_000
    };
  }

  public async setup(password: string): Promise<string> {
    if (this.withRepository((repository) => repository.isConfigured())) {
      throw new PasswordManagerAlreadyConfiguredError();
    }
    const wrapper = await this.crypto.createVault(password);
    this.withRepository((repository) => repository.initialize(wrapper));
    const dek = await this.crypto.unlockVault(password, wrapper);
    return this.createSession(dek);
  }

  public async unlock(password: string): Promise<string> {
    const wrapper = this.withRepository((repository) => repository.readWrapper());
    if (!wrapper) throw new PasswordManagerNotConfiguredError();
    const dek = await this.crypto.unlockVault(password, wrapper);
    return this.createSession(dek);
  }

  public lock(_sessionToken?: string): void {
    this.shutdown();
  }

  public shutdown(): void {
    for (const session of this.sessions.values()) {
      if (session.expiry) this.cancelIdleExpiry(session.expiry);
      session.dek.fill(0);
    }
    this.sessions.clear();
  }

  public listEntries(sessionToken?: string): PasswordManagerEntryResult[] {
    const dek = this.requireSession(sessionToken);
    return this.withRepository((repository) => repository.listEntries())
      .map((row) => this.toSummary(dek, row));
  }

  public createEntry(sessionToken: string | undefined, input: PasswordManagerEntryInput): PasswordManagerEntryResult {
    const dek = this.requireSession(sessionToken);
    const id = randomUUID();
    const existingCount = this.withRepository((repository) => repository.listEntries().length);
    const layout = { x: (existingCount % 3) * 4, y: Math.floor(existingCount / 3) * 4, w: 4, h: 4 };
    const encrypted = this.encryptCredential(dek, id, canonicalCredential(input));
    const row = this.withRepository((repository) => repository.createEntry({ id, formatVersion: 1, ...encrypted }, layout));
    return this.toSummary(dek, row);
  }

  public updateEntry(
    sessionToken: string | undefined,
    id: string,
    input: PasswordManagerEntryInput,
    expectedVersion: number
  ): PasswordManagerEntryResult {
    const dek = this.requireSession(sessionToken);
    const encrypted = this.encryptCredential(dek, id, canonicalCredential(input));
    const row = this.withRepository((repository) => repository.updateEntry(
      id,
      { id, formatVersion: 1, ...encrypted },
      expectedVersion
    ));
    return this.toSummary(dek, row);
  }

  public deleteEntry(sessionToken: string | undefined, id: string): void {
    this.requireSession(sessionToken);
    this.withRepository((repository) => repository.deleteEntry(id));
  }

  public revealEntry(sessionToken: string | undefined, id: string): PasswordManagerRevealResult {
    const dek = this.requireSession(sessionToken);
    const row = this.withRepository((repository) => repository.readEntry(id));
    if (!row) throw new PasswordManagerEntryNotFoundError();
    const credential = this.decryptCredential(dek, row);
    const summary = this.summaryFrom(row, credential);
    return { summary, detail: { ...summary, password: credential.password }, layout: row.layout, version: row.version };
  }

  public updateLayouts(sessionToken: string | undefined, layouts: readonly PasswordManagerLayoutUpdate[]): void {
    this.requireSession(sessionToken);
    this.withRepository((repository) => repository.updateLayouts(layouts));
  }

  private createSession(dek: Buffer): string {
    this.shutdown();
    const token = randomBytes(32).toString("base64url");
    const digest = sessionDigest(token);
    const session = { dek, lastActive: this.now(), expiry: null };
    this.sessions.set(digest, session);
    this.scheduleSessionExpiry(digest, session);
    return token;
  }

  private requireSession(sessionToken?: string): Buffer {
    this.removeExpiredSessions();
    if (!sessionToken) throw new PasswordManagerLockedError();
    const session = this.sessions.get(sessionDigest(sessionToken));
    if (!session) throw new PasswordManagerLockedError();
    session.lastActive = this.now();
    this.scheduleSessionExpiry(sessionDigest(sessionToken), session);
    return session.dek;
  }

  private removeExpiredSessions(): void {
    const currentTime = this.now();
    for (const [digest, session] of this.sessions) {
      if (currentTime - session.lastActive < this.idleTimeoutMs) continue;
      if (session.expiry) this.cancelIdleExpiry(session.expiry);
      session.dek.fill(0);
      this.sessions.delete(digest);
    }
  }

  private scheduleSessionExpiry(digest: string, session: Session): void {
    if (session.expiry) this.cancelIdleExpiry(session.expiry);
    const elapsed = Math.max(0, this.now() - session.lastActive);
    session.expiry = this.scheduleIdleExpiry(
      () => this.expireSession(digest),
      Math.max(0, this.idleTimeoutMs - elapsed)
    );
    session.expiry.unref?.();
  }

  private expireSession(digest: string): void {
    const session = this.sessions.get(digest);
    if (!session) return;
    if (this.now() - session.lastActive < this.idleTimeoutMs) {
      this.scheduleSessionExpiry(digest, session);
      return;
    }
    session.dek.fill(0);
    this.sessions.delete(digest);
  }

  private encryptCredential(dek: Buffer, id: string, credential: StoredCredential): PasswordManagerEncryptedValue {
    const plaintext = Buffer.from(JSON.stringify(credential), "utf8");
    try {
      return this.crypto.encryptRecord(dek, id, 1, plaintext);
    } finally {
      plaintext.fill(0);
    }
  }

  private decryptCredential(dek: Buffer, row: PasswordManagerEntryRow): StoredCredential {
    const plaintext = this.crypto.decryptRecord(dek, row.id, row.formatVersion, row);
    try {
      const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
      const result = PasswordManagerEntryInputSchema.safeParse(parsed);
      if (!result.success) throw new PasswordManagerIntegrityError();
      return canonicalCredential(result.data);
    } catch (error) {
      if (error instanceof PasswordManagerIntegrityError) throw error;
      throw new PasswordManagerIntegrityError();
    } finally {
      plaintext.fill(0);
    }
  }

  private toSummary(dek: Buffer, row: PasswordManagerEntryRow): PasswordManagerEntryResult {
    const credential = this.decryptCredential(dek, row);
    return { summary: this.summaryFrom(row, credential), layout: row.layout, version: row.version };
  }

  private summaryFrom(row: PasswordManagerEntryRow, credential: StoredCredential): PasswordManagerEntrySummary {
    return {
      id: row.id,
      name: credential.name,
      website: credential.website,
      username: credential.username,
      notes: credential.notes,
      customFields: credential.customFields,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
