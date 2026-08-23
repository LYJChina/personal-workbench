import { randomBytes, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import type { SecretStore } from "../../platform/secret-store.js";
import {
  decryptVaultValue,
  deriveVaultKey,
  encryptVaultValue,
  secretAuthenticatedData,
  validateScryptParameters,
  VAULT_VERIFIER,
  VAULT_VERIFIER_AAD
} from "./vault.crypto.js";
import {
  InvalidMasterPasswordError,
  VaultIntegrityError,
  VaultLockedError,
  VaultMetadataIntegrityError
} from "./vault.errors.js";
import { VaultRepository, type VaultMetadata } from "./vault.repository.js";

export { InvalidMasterPasswordError, VaultIntegrityError, VaultLockedError, VaultMetadataIntegrityError } from "./vault.errors.js";

export interface VaultScryptOptions { n: number; r: number; p: number; maxmem: number; }
export interface VaultServiceOptions { scrypt?: VaultScryptOptions; }

const productionScrypt: VaultScryptOptions = {
  n: 65_536,
  r: 8,
  p: 1,
  maxmem: 128 * 1024 * 1024
};

function requireMasterPassword(password: string): void {
  if (password.trim().length === 0) throw new Error("Master password must not be empty");
}

function requireSecret(name: string, plaintext?: string): void {
  if (name.trim().length === 0) throw new Error("Secret name must not be empty");
  if (plaintext !== undefined && plaintext.length === 0) throw new Error("Secret plaintext must not be empty");
}

export class VaultService implements SecretStore {
  private readonly repository: VaultRepository;
  private readonly configuredScrypt: VaultScryptOptions;
  private key: Buffer | null = null;

  public constructor(database: Database.Database, options: VaultServiceOptions = {}) {
    this.repository = new VaultRepository(database);
    this.configuredScrypt = { ...productionScrypt, ...options.scrypt };
    validateScryptParameters(this.configuredScrypt);
  }

  public status(): { configured: boolean; unlocked: boolean } {
    return { configured: this.repository.isConfigured(), unlocked: this.key !== null };
  }

  public async setup(masterPassword: string, initialSecrets: Record<string, string>): Promise<void> {
    requireMasterPassword(masterPassword);
    if (this.repository.isConfigured()) throw new Error("Vault is already configured");
    for (const [name, plaintext] of Object.entries(initialSecrets)) requireSecret(name, plaintext);

    const salt = randomBytes(16);
    const key = await deriveVaultKey(masterPassword, { salt, ...this.configuredScrypt });
    try {
      const verifier = encryptVaultValue(key, VAULT_VERIFIER, VAULT_VERIFIER_AAD);
      const encryptedSecrets = new Map<string, ReturnType<typeof encryptVaultValue>>();
      for (const [name, plaintext] of Object.entries(initialSecrets)) {
        const bytes = Buffer.from(plaintext, "utf8");
        try {
          encryptedSecrets.set(name, encryptVaultValue(key, bytes, secretAuthenticatedData(name)));
        } finally {
          bytes.fill(0);
        }
      }
      this.repository.initialize({ salt, verifier, scrypt: this.configuredScrypt }, encryptedSecrets);
      this.replaceKey(key);
    } catch (error) {
      key.fill(0);
      throw error;
    }
  }

  public async unlock(masterPassword: string): Promise<void> {
    requireMasterPassword(masterPassword);
    const metadata = this.repository.readMetadata();
    if (!metadata) throw new Error("Vault is not configured");
    this.validateMetadata(metadata);
    const key = await deriveVaultKey(masterPassword, { salt: metadata.salt, ...metadata.scrypt });
    try {
      const verifier = decryptVaultValue(key, metadata.verifier, VAULT_VERIFIER_AAD);
      const valid = verifier.length === VAULT_VERIFIER.length && timingSafeEqual(verifier, VAULT_VERIFIER);
      verifier.fill(0);
      if (!valid) throw new InvalidMasterPasswordError();
      this.replaceKey(key);
    } catch (error) {
      key.fill(0);
      if (error instanceof InvalidMasterPasswordError) throw error;
      throw new InvalidMasterPasswordError();
    }
  }

  public lock(): void {
    if (this.key) this.key.fill(0);
    this.key = null;
  }

  public async protectSecret(name: string, plaintext: string): Promise<void> {
    const key = this.requireKey();
    requireSecret(name, plaintext);
    const bytes = Buffer.from(plaintext, "utf8");
    try {
      this.repository.upsertSecret(name, encryptVaultValue(key, bytes, secretAuthenticatedData(name)));
    } finally {
      bytes.fill(0);
    }
  }

  public async readSecret(name: string): Promise<string | null> {
    const key = this.requireKey();
    requireSecret(name);
    const encrypted = this.repository.readSecret(name);
    if (!encrypted) return null;
    if (encrypted.nonce.length !== 12 || encrypted.authTag.length !== 16 || encrypted.ciphertext.length === 0) {
      throw new VaultIntegrityError();
    }
    try {
      const plaintext = decryptVaultValue(key, encrypted, secretAuthenticatedData(name));
      try { return plaintext.toString("utf8"); }
      finally { plaintext.fill(0); }
    } catch {
      throw new VaultIntegrityError();
    }
  }

  private requireKey(): Buffer {
    if (!this.key) throw new VaultLockedError();
    return this.key;
  }

  private replaceKey(key: Buffer): void {
    if (this.key && this.key !== key) this.key.fill(0);
    this.key = key;
  }

  private validateMetadata(metadata: VaultMetadata): void {
    if (!Buffer.isBuffer(metadata.salt) || metadata.salt.length !== 16 ||
        !Buffer.isBuffer(metadata.verifier.nonce) || metadata.verifier.nonce.length !== 12 ||
        !Buffer.isBuffer(metadata.verifier.authTag) || metadata.verifier.authTag.length !== 16 ||
        !Buffer.isBuffer(metadata.verifier.ciphertext) || metadata.verifier.ciphertext.length !== VAULT_VERIFIER.length) {
      throw new VaultMetadataIntegrityError();
    }
    validateScryptParameters(metadata.scrypt);
  }
}
