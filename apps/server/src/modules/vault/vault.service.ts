import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
import { VaultRepository, type VaultMetadata, type VaultRepositoryProvider } from "./vault.repository.js";
import { generateDek, normalizeRecoveryCode, normalizeSmtpIdentity, unwrapDek, wrapDek, type WrapperKind } from "./vault-recovery.crypto.js";
import { InvalidRecoveryMaterialError } from "./vault.errors.js";

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
  private readonly withRepository: VaultRepositoryProvider;
  private readonly configuredScrypt: VaultScryptOptions;
  private key: Buffer | null = null;

  public constructor(database: Database.Database | VaultRepositoryProvider, options: VaultServiceOptions = {}) {
    this.withRepository = typeof database === "function"
      ? database
      : <T>(operation: (repository: VaultRepository) => T) => operation(new VaultRepository(database));
    this.configuredScrypt = { ...productionScrypt, ...options.scrypt };
    validateScryptParameters(this.configuredScrypt);
  }

  public status(): { configured: boolean; unlocked: boolean } {
    return { configured: this.withRepository((repository) => repository.isConfigured()), unlocked: this.key !== null };
  }

  public async setup(masterPassword: string, initialSecrets: Record<string, string>): Promise<void> {
    requireMasterPassword(masterPassword);
    if (this.withRepository((repository) => repository.isConfigured())) throw new Error("Vault is already configured");
    for (const [name, plaintext] of Object.entries(initialSecrets)) requireSecret(name, plaintext);

    const salt = randomBytes(16);
    const key = generateDek();
    try {
      const passwordWrapper = await wrapDek(key, masterPassword, this.configuredScrypt, "password", 1);
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
      this.withRepository((repository) => repository.initializeV2({ formatVersion: 2, salt, verifier, scrypt: this.configuredScrypt }, passwordWrapper, encryptedSecrets));
      this.replaceKey(key);
    } catch (error) {
      key.fill(0);
      throw error;
    }
  }

  public async unlock(masterPassword: string): Promise<void> {
    requireMasterPassword(masterPassword);
    const metadata = this.withRepository((repository) => repository.readMetadata());
    if (!metadata) throw new Error("Vault is not configured");
    this.validateMetadata(metadata);
    let key: Buffer | undefined;
    try {
      key = metadata.formatVersion === 2
        ? await this.withRepository((repository) => {
            const wrapper = repository.readWrapper("password");
            if (!wrapper) throw new InvalidMasterPasswordError();
            return unwrapDek(wrapper, masterPassword, "password");
          })
        : await deriveVaultKey(masterPassword, { salt: metadata.salt, ...metadata.scrypt });
      const verifier = decryptVaultValue(key, metadata.verifier, VAULT_VERIFIER_AAD);
      const valid = verifier.length === VAULT_VERIFIER.length && timingSafeEqual(verifier, VAULT_VERIFIER);
      verifier.fill(0);
      if (!valid) throw new InvalidMasterPasswordError();
      if (metadata.formatVersion === 1) {
        const legacyKey = key;
        const encryptedLegacySecrets = this.withRepository((repository) => repository.readAllSecrets());
        const dek = generateDek();
        const migratedSecrets = new Map<string, ReturnType<typeof encryptVaultValue>>();
        try {
          for (const [name, encrypted] of encryptedLegacySecrets) {
            const plaintext = decryptVaultValue(legacyKey, encrypted, secretAuthenticatedData(name));
            try {
              migratedSecrets.set(name, encryptVaultValue(dek, plaintext, secretAuthenticatedData(name)));
            } finally {
              plaintext.fill(0);
            }
          }
          const passwordWrapper = await wrapDek(dek, masterPassword, this.configuredScrypt, "password", 1);
          const migratedMetadata: VaultMetadata = {
            formatVersion: 2,
            salt: randomBytes(16),
            verifier: encryptVaultValue(dek, VAULT_VERIFIER, VAULT_VERIFIER_AAD),
            scrypt: this.configuredScrypt
          };
          this.withRepository((repository) => repository.migrateV1ToV2(migratedMetadata, passwordWrapper, migratedSecrets));
          legacyKey.fill(0);
          key = dek;
        } catch (error) {
          dek.fill(0);
          throw error;
        }
      }
      this.replaceKey(key);
    } catch (error) {
      key?.fill(0);
      if (error instanceof InvalidMasterPasswordError) throw error;
      throw new InvalidMasterPasswordError();
    }
  }

  public lock(): void {
    if (this.key) this.key.fill(0);
    this.key = null;
  }

  public async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    requireMasterPassword(currentPassword);
    requireMasterPassword(newPassword);
    const dek = this.requireKey();
    const currentWrapper = this.withRepository((repository) => repository.readWrapper("password"));
    if (!currentWrapper) throw new InvalidMasterPasswordError();
    let candidate: Buffer | undefined;
    try {
      candidate = await unwrapDek(currentWrapper, currentPassword, "password");
      if (candidate.length !== dek.length || !timingSafeEqual(candidate, dek)) throw new InvalidMasterPasswordError();
    } catch {
      throw new InvalidMasterPasswordError();
    } finally {
      candidate?.fill(0);
    }
    const replacement = await wrapDek(dek, newPassword, this.configuredScrypt, "password", currentWrapper.generation + 1);
    this.withRepository((repository) => repository.replaceWrapper(replacement));
  }

  public async enrollRecovery(input: { recoveryEmail: string; recoveryCode: string; smtpEmail: string; smtpPassword: string }): Promise<void> {
    const dek = this.requireKey();
    const recoveryCode = normalizeRecoveryCode(input.recoveryCode);
    const recoveryWrapper = await wrapDek(dek, recoveryCode, this.configuredScrypt, "recovery", 1);
    const smtpWrapper = await wrapDek(dek, normalizeSmtpIdentity(input.smtpEmail, input.smtpPassword), this.configuredScrypt, "smtp_recovery", 1);
    this.withRepository((repository) => repository.enrollRecovery(input.recoveryEmail.trim().toLowerCase(), recoveryWrapper, smtpWrapper));
  }

  public async enrollPendingRecovery(input: { recoveryEmail: string; recoveryCode: string; confirmationCode: string; confirmationExpiresAt: Date; smtpEmail: string; smtpPassword: string }): Promise<void> {
    const dek = this.requireKey();
    const recoveryWrapper = await wrapDek(dek, normalizeRecoveryCode(input.recoveryCode), this.configuredScrypt, "recovery", 1);
    const smtpWrapper = await wrapDek(dek, normalizeSmtpIdentity(input.smtpEmail, input.smtpPassword), this.configuredScrypt, "smtp_recovery", 1);
    const salt = randomBytes(16);
    const digest = Buffer.concat([salt, createHash("sha256").update(salt).update(input.confirmationCode).digest()]);
    this.withRepository((repository) => repository.enrollRecovery(
      input.recoveryEmail.trim().toLowerCase(), recoveryWrapper, smtpWrapper,
      { digest, expiresAt: input.confirmationExpiresAt.toISOString() }
    ));
    digest.fill(0);
  }

  public confirmRecovery(confirmationCode: string, now = new Date()): void {
    const recovery = this.withRepository((repository) => repository.readRecovery());
    if (recovery.state !== "pending" || !recovery.confirmation_digest || !recovery.confirmation_expires_at || now >= new Date(recovery.confirmation_expires_at)) {
      throw new InvalidRecoveryMaterialError();
    }
    const salt = recovery.confirmation_digest.subarray(0, 16);
    const expected = recovery.confirmation_digest.subarray(16);
    const candidate = createHash("sha256").update(salt).update(confirmationCode).digest();
    const valid = candidate.length === expected.length && timingSafeEqual(candidate, expected);
    candidate.fill(0);
    if (!valid) throw new InvalidRecoveryMaterialError();
    this.withRepository((repository) => repository.activateRecovery());
  }

  public recoveryStatus(): { state: "disabled" | "pending" | "active"; maskedEmail: string | null; smtpHealth: "unknown" | "valid" | "invalid" | "unreachable"; checkedAt: string | null } {
    const recovery = this.withRepository((repository) => repository.readRecovery());
    const maskedEmail = recovery.email ? recovery.email.replace(/^(.)([^@]*)(@.*)$/, (_match, first: string, _middle: string, domain: string) => `${first}***${domain}`) : null;
    return { state: recovery.state, maskedEmail, smtpHealth: recovery.smtp_health, checkedAt: recovery.smtp_checked_at };
  }

  public recordSmtpHealth(health: "unknown" | "valid" | "invalid" | "unreachable", checkedAt = new Date()): void {
    this.withRepository((repository) => repository.recordSmtpHealth(health, checkedAt.toISOString()));
  }

  public recoveryEmail(): string | null {
    return this.withRepository((repository) => repository.readRecovery().email);
  }

  public async rotateRecoveryCode(recoveryCode: string): Promise<void> {
    const dek = this.requireKey();
    const previous = this.withRepository((repository) => repository.readWrapper("recovery", false));
    const wrapper = await wrapDek(dek, normalizeRecoveryCode(recoveryCode), this.configuredScrypt, "recovery", (previous?.generation ?? 0) + 1);
    this.withRepository((repository) => repository.activateRotatedRecovery(wrapper));
  }

  public async updateSmtpCredentials(
    currentPassword: string,
    smtpEmail: string,
    smtpPassword: string,
    settings: { smtpHost: string; smtpPort: number; transportMode: "starttls" | "tls"; fromAddress: string }
  ): Promise<void> {
    const dek = this.requireKey();
    const passwordWrapper = this.withRepository((repository) => repository.readWrapper("password"));
    if (!passwordWrapper) throw new InvalidMasterPasswordError();
    let candidate: Buffer | undefined;
    try {
      candidate = await unwrapDek(passwordWrapper, currentPassword, "password");
      if (!timingSafeEqual(candidate, dek)) throw new InvalidMasterPasswordError();
    } catch { throw new InvalidMasterPasswordError(); }
    finally { candidate?.fill(0); }

    const previous = this.withRepository((repository) => repository.readWrapper("smtp_recovery", false));
    const wrapper = await wrapDek(dek, normalizeSmtpIdentity(smtpEmail, smtpPassword), this.configuredScrypt, "smtp_recovery", (previous?.generation ?? 0) + 1);
    const bytes = Buffer.from(smtpPassword, "utf8");
    try {
      const secret = encryptVaultValue(dek, bytes, secretAuthenticatedData("smtp-password"));
      this.withRepository((repository) => repository.updateSmtpRecovery(wrapper, secret, {
        "mail.smtp_host": settings.smtpHost,
        "mail.smtp_port": String(settings.smtpPort),
        "mail.transport_mode": settings.transportMode,
        "mail.smtp_username": smtpEmail,
        "mail.from_address": settings.fromAddress
      }));
    } finally { bytes.fill(0); }
  }

  public async resetWithRecoveryCode(recoveryCode: string, newPassword: string): Promise<void> {
    await this.resetWithMaterial("recovery", normalizeRecoveryCode(recoveryCode), newPassword);
  }

  public async resetWithSmtp(smtpEmail: string, smtpPassword: string, newPassword: string): Promise<void> {
    await this.resetWithMaterial("smtp_recovery", normalizeSmtpIdentity(smtpEmail, smtpPassword), newPassword, smtpPassword);
  }

  private async resetWithMaterial(kind: "recovery" | "smtp_recovery", material: string, newPassword: string, smtpPassword?: string): Promise<void> {
    requireMasterPassword(newPassword);
    const { wrapper, metadata } = this.withRepository((repository) => ({ wrapper: repository.readWrapper(kind), metadata: repository.readMetadata() }));
    if (!wrapper || !metadata || metadata.formatVersion !== 2) throw new InvalidRecoveryMaterialError();
    let dek: Buffer | undefined;
    try {
      dek = await unwrapDek(wrapper, material, kind);
      this.verifyRecoveredDek(dek, metadata);
      const passwordWrapper = await wrapDek(dek, newPassword, this.configuredScrypt, "password", wrapper.generation + 1);
      const smtpWrapper = kind === "smtp_recovery"
        ? await wrapDek(dek, material, this.configuredScrypt, "smtp_recovery", wrapper.generation + 1)
        : undefined;
      let smtpSecret: ReturnType<typeof encryptVaultValue> | undefined;
      let smtpBytes: Buffer | undefined;
      if (smtpPassword !== undefined) {
        smtpBytes = Buffer.from(smtpPassword, "utf8");
        smtpSecret = encryptVaultValue(dek, smtpBytes, secretAuthenticatedData("smtp-password"));
      }
      try {
        this.withRepository((repository) => repository.commitRecoveryReset(passwordWrapper, kind, smtpWrapper, smtpSecret));
      } finally {
        smtpBytes?.fill(0);
      }
      this.replaceKey(dek);
    } catch (error) {
      dek?.fill(0);
      if (error instanceof InvalidRecoveryMaterialError) throw error;
      throw new InvalidRecoveryMaterialError();
    }
  }

  private verifyRecoveredDek(dek: Buffer, metadata: VaultMetadata): void {
    try {
      const verifier = decryptVaultValue(dek, metadata.verifier, VAULT_VERIFIER_AAD);
      try {
        if (verifier.length !== VAULT_VERIFIER.length || !timingSafeEqual(verifier, VAULT_VERIFIER)) throw new InvalidRecoveryMaterialError();
      } finally {
        verifier.fill(0);
      }
    } catch (error) {
      if (error instanceof InvalidRecoveryMaterialError) throw error;
      throw new InvalidRecoveryMaterialError();
    }
  }

  public async protectSecret(name: string, plaintext: string): Promise<void> {
    const key = this.requireKey();
    requireSecret(name, plaintext);
    const bytes = Buffer.from(plaintext, "utf8");
    try {
      this.withRepository((repository) => repository.upsertSecret(name, encryptVaultValue(key, bytes, secretAuthenticatedData(name))));
    } finally {
      bytes.fill(0);
    }
  }

  public async readSecret(name: string): Promise<string | null> {
    const key = this.requireKey();
    requireSecret(name);
    const encrypted = this.withRepository((repository) => repository.readSecret(name));
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

  public async deleteSecret(name: string): Promise<void> {
    this.requireKey();
    requireSecret(name);
    this.withRepository((repository) => repository.deleteSecret(name));
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
