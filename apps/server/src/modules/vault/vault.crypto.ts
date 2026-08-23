import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { VaultIntegrityError, VaultMetadataIntegrityError } from "./vault.errors.js";

export interface ScryptParameters {
  salt: Buffer;
  n: number;
  r: number;
  p: number;
  maxmem: number;
}

export interface EncryptedValue {
  nonce: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
}

export const VAULT_VERIFIER = Buffer.from("LYJ_WORKBENCH_VAULT_VERIFIER_V1", "utf8");
export const VAULT_VERIFIER_AAD = Buffer.from("LYJ_WORKBENCH_VAULT_VERIFIER_AAD_V1", "utf8");

const MIN_SCRYPT_MAXMEM = 16 * 1024 * 1024;
const MAX_SCRYPT_MAXMEM = 256 * 1024 * 1024;
const SCRYPT_MEMORY_SAFETY_MARGIN = 1024 * 1024;

function safeProduct(...values: number[]): number | null {
  let product = 1;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || product > Number.MAX_SAFE_INTEGER / value) return null;
    product *= value;
  }
  return product;
}

export function validateScryptParameters(parameters: Omit<ScryptParameters, "salt">): void {
  const { n, r, p, maxmem } = parameters;
  const validN = Number.isSafeInteger(n) && n >= 2 && n <= 131_072 && (n & (n - 1)) === 0;
  const validR = Number.isSafeInteger(r) && r >= 1 && r <= 16;
  const validP = Number.isSafeInteger(p) && p >= 1 && p <= 4;
  const validMaxmem = Number.isSafeInteger(maxmem) && maxmem >= MIN_SCRYPT_MAXMEM && maxmem <= MAX_SCRYPT_MAXMEM;
  if (!validN || !validR || !validP || !validMaxmem) throw new VaultMetadataIntegrityError();

  const mainMemory = safeProduct(128, n, r);
  const parallelMemory = safeProduct(128, r, p);
  if (mainMemory === null || parallelMemory === null ||
      mainMemory > Number.MAX_SAFE_INTEGER - parallelMemory - SCRYPT_MEMORY_SAFETY_MARGIN ||
      maxmem < mainMemory + parallelMemory + SCRYPT_MEMORY_SAFETY_MARGIN) {
    throw new VaultMetadataIntegrityError();
  }
}

function requireKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new VaultIntegrityError();
}

function requireEnvelope(value: EncryptedValue): void {
  if (!Buffer.isBuffer(value.nonce) || value.nonce.length !== 12 ||
      !Buffer.isBuffer(value.authTag) || value.authTag.length !== 16 ||
      !Buffer.isBuffer(value.ciphertext)) throw new VaultIntegrityError();
}

export function deriveVaultKey(password: string, parameters: ScryptParameters): Promise<Buffer> {
  if (!Buffer.isBuffer(parameters.salt) || parameters.salt.length !== 16) throw new VaultMetadataIntegrityError();
  validateScryptParameters(parameters);
  return new Promise((resolve, reject) => {
    scrypt(password, parameters.salt, 32, {
      N: parameters.n,
      r: parameters.r,
      p: parameters.p,
      maxmem: parameters.maxmem
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export function encryptVaultValue(key: Buffer, plaintext: Buffer, authenticatedData?: Buffer): EncryptedValue {
  requireKey(key);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  if (authenticatedData) cipher.setAAD(authenticatedData);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { nonce, ciphertext, authTag: cipher.getAuthTag() };
}

export function decryptVaultValue(key: Buffer, value: EncryptedValue, authenticatedData?: Buffer): Buffer {
  requireKey(key);
  requireEnvelope(value);
  const decipher = createDecipheriv("aes-256-gcm", key, value.nonce, { authTagLength: 16 });
  if (authenticatedData) decipher.setAAD(authenticatedData);
  decipher.setAuthTag(value.authTag);
  return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]);
}

export function secretAuthenticatedData(name: string): Buffer {
  return Buffer.from(`LYJ_WORKBENCH_VAULT_SECRET_V1\0${name}`, "utf8");
}
