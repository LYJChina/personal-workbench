import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";

export interface PasswordManagerScryptParameters {
  n: number;
  r: number;
  p: number;
  maxmem: number;
}

export interface WrappedCredentialDek {
  formatVersion: 1;
  salt: Buffer;
  scrypt: PasswordManagerScryptParameters;
  nonce: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
}

export interface PasswordManagerEncryptedValue {
  nonce: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
}

export interface PasswordManagerCryptoOptions {
  scrypt?: Partial<PasswordManagerScryptParameters>;
}

export class PasswordManagerInvalidPasswordError extends Error {
  public constructor() {
    super("Invalid password-manager password");
    this.name = "PasswordManagerInvalidPasswordError";
  }
}

export class PasswordManagerIntegrityError extends Error {
  public constructor() {
    super("Password-manager data failed integrity verification");
    this.name = "PasswordManagerIntegrityError";
  }
}

const productionScrypt: PasswordManagerScryptParameters = {
  n: 65_536,
  r: 8,
  p: 1,
  maxmem: 128 * 1024 * 1024
};
const kdfNamespace = "LYJ_WORKBENCH_PASSWORD_MANAGER_KDF_V1";
const wrapperAad = Buffer.from("LYJ_WORKBENCH_PASSWORD_MANAGER_DEK_WRAPPER_V1", "utf8");
const memorySafetyMargin = 1024 * 1024;

function validateScrypt(parameters: PasswordManagerScryptParameters): void {
  const { n, r, p, maxmem } = parameters;
  const validN = Number.isSafeInteger(n) && n >= 2 && n <= 131_072 && (n & (n - 1)) === 0;
  const validR = Number.isSafeInteger(r) && r >= 1 && r <= 16;
  const validP = Number.isSafeInteger(p) && p >= 1 && p <= 4;
  const requiredMemory = (128 * n * r) + (128 * r * p) + memorySafetyMargin;
  const validMemory = Number.isSafeInteger(maxmem)
    && maxmem >= 16 * 1024 * 1024
    && maxmem <= 256 * 1024 * 1024
    && Number.isSafeInteger(requiredMemory)
    && maxmem >= requiredMemory;
  if (!validN || !validR || !validP || !validMemory) throw new PasswordManagerIntegrityError();
}

function deriveKey(password: string, salt: Buffer, parameters: PasswordManagerScryptParameters): Promise<Buffer> {
  if (typeof password !== "string" || password.length === 0 || !Buffer.isBuffer(salt) || salt.length !== 16) {
    throw new PasswordManagerIntegrityError();
  }
  validateScrypt(parameters);
  const material = Buffer.from(`${kdfNamespace}\0${password}`, "utf8");
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(material, salt, 32, {
      N: parameters.n,
      r: parameters.r,
      p: parameters.p,
      maxmem: parameters.maxmem
    }, (error, key) => error ? reject(error) : resolve(key));
  }).finally(() => material.fill(0));
}

function requireKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new PasswordManagerIntegrityError();
}

function requireEnvelope(value: PasswordManagerEncryptedValue, ciphertextLength?: number): void {
  if (!Buffer.isBuffer(value.nonce) || value.nonce.length !== 12
    || !Buffer.isBuffer(value.authTag) || value.authTag.length !== 16
    || !Buffer.isBuffer(value.ciphertext) || value.ciphertext.length === 0
    || (ciphertextLength !== undefined && value.ciphertext.length !== ciphertextLength)) {
    throw new PasswordManagerIntegrityError();
  }
}

function encrypt(key: Buffer, plaintext: Buffer, aad: Buffer): PasswordManagerEncryptedValue {
  requireKey(key);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { nonce, ciphertext, authTag: cipher.getAuthTag() };
}

function decrypt(key: Buffer, value: PasswordManagerEncryptedValue, aad: Buffer): Buffer {
  requireKey(key);
  requireEnvelope(value);
  const decipher = createDecipheriv("aes-256-gcm", key, value.nonce, { authTagLength: 16 });
  decipher.setAAD(aad);
  decipher.setAuthTag(value.authTag);
  return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]);
}

function recordAad(id: string, formatVersion: number): Buffer {
  return Buffer.from(`LYJ_WORKBENCH_PASSWORD_MANAGER_RECORD\0${formatVersion}\0${id}`, "utf8");
}

export class PasswordManagerCrypto {
  private readonly scrypt: PasswordManagerScryptParameters;

  public constructor(options: PasswordManagerCryptoOptions = {}) {
    this.scrypt = { ...productionScrypt, ...options.scrypt };
    validateScrypt(this.scrypt);
  }

  public async createVault(password: string): Promise<WrappedCredentialDek> {
    if (typeof password !== "string" || password.length === 0) throw new PasswordManagerInvalidPasswordError();
    const salt = randomBytes(16);
    const dek = randomBytes(32);
    let wrappingKey: Buffer | undefined;
    try {
      wrappingKey = await deriveKey(password, salt, this.scrypt);
      const wrapped = encrypt(wrappingKey, dek, wrapperAad);
      return { formatVersion: 1, salt, scrypt: { ...this.scrypt }, ...wrapped };
    } finally {
      dek.fill(0);
      wrappingKey?.fill(0);
    }
  }

  public async unlockVault(password: string, wrapper: WrappedCredentialDek): Promise<Buffer> {
    let wrappingKey: Buffer | undefined;
    try {
      if (wrapper.formatVersion !== 1) throw new PasswordManagerIntegrityError();
      requireEnvelope(wrapper, 32);
      wrappingKey = await deriveKey(password, wrapper.salt, wrapper.scrypt);
      const dek = decrypt(wrappingKey, wrapper, wrapperAad);
      requireKey(dek);
      return dek;
    } catch {
      throw new PasswordManagerInvalidPasswordError();
    } finally {
      wrappingKey?.fill(0);
    }
  }

  public encryptRecord(
    dek: Buffer,
    id: string,
    formatVersion: number,
    plaintext: Buffer
  ): PasswordManagerEncryptedValue {
    if (!Buffer.isBuffer(plaintext) || plaintext.length === 0) throw new PasswordManagerIntegrityError();
    return encrypt(dek, plaintext, recordAad(id, formatVersion));
  }

  public decryptRecord(
    dek: Buffer,
    id: string,
    formatVersion: number,
    encrypted: PasswordManagerEncryptedValue
  ): Buffer {
    try {
      return decrypt(dek, encrypted, recordAad(id, formatVersion));
    } catch {
      throw new PasswordManagerIntegrityError();
    }
  }
}
