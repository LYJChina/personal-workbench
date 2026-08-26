import { randomBytes } from "node:crypto";
import { decryptVaultValue, deriveVaultKey, encryptVaultValue, type EncryptedValue } from "./vault.crypto.js";
import { InvalidRecoveryMaterialError } from "./vault.errors.js";

export type WrapperKind = "password" | "recovery" | "smtp_recovery";

export interface WrapperScryptOptions {
  n: number;
  r: number;
  p: number;
  maxmem: number;
}

export interface DekWrapper extends EncryptedValue {
  kind: WrapperKind;
  generation: number;
  salt: Buffer;
  scrypt: WrapperScryptOptions;
}

const recoveryAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function wrapperAuthenticatedData(kind: WrapperKind, generation: number): Buffer {
  return Buffer.from(`lyj-vault-wrapper:${kind}:v${generation}`, "utf8");
}

function encodeRecoveryEntropy(entropy: Buffer): string {
  let accumulator = 0;
  let bits = 0;
  let encoded = "";
  for (const byte of entropy) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += recoveryAlphabet[(accumulator >>> bits) & 31];
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits > 0) encoded += recoveryAlphabet[(accumulator << (5 - bits)) & 31];
  return encoded;
}

export function generateDek(): Buffer {
  return randomBytes(32);
}

export function generateRecoveryCode(): { display: string; entropy: Buffer } {
  const entropy = randomBytes(20);
  const encoded = encodeRecoveryEntropy(entropy);
  const groups = encoded.match(/.{4}/g);
  if (!groups || groups.length !== 8) {
    entropy.fill(0);
    throw new Error("Recovery code generation failed");
  }
  return { display: `LYJ-${groups.join("-")}`, entropy };
}

export function normalizeRecoveryCode(value: string): string {
  const compact = value.trim().toUpperCase().replaceAll("-", "").replaceAll(" ", "");
  const body = compact.startsWith("LYJ") ? compact.slice(3) : compact;
  return `LYJ-${body.match(/.{1,4}/g)?.join("-") ?? ""}`;
}

export function normalizeSmtpIdentity(email: string, authorizationCode: string): string {
  return `${email.trim().toLowerCase()}\0${authorizationCode.trim()}`;
}

export async function wrapDek(
  dek: Buffer,
  material: string,
  scrypt: WrapperScryptOptions,
  kind: WrapperKind,
  generation: number
): Promise<DekWrapper> {
  const salt = randomBytes(16);
  const key = await deriveVaultKey(material, { salt, ...scrypt });
  try {
    return { kind, generation, salt, scrypt: { ...scrypt }, ...encryptVaultValue(key, dek, wrapperAuthenticatedData(kind, generation)) };
  } finally {
    key.fill(0);
  }
}

export async function unwrapDek(wrapper: DekWrapper, material: string, expectedKind: WrapperKind): Promise<Buffer> {
  if (wrapper.kind !== expectedKind || !Number.isSafeInteger(wrapper.generation) || wrapper.generation < 1) {
    throw new InvalidRecoveryMaterialError();
  }
  let key: Buffer | undefined;
  try {
    key = await deriveVaultKey(material, { salt: wrapper.salt, ...wrapper.scrypt });
    const dek = decryptVaultValue(key, wrapper, wrapperAuthenticatedData(expectedKind, wrapper.generation));
    if (dek.length !== 32) {
      dek.fill(0);
      throw new InvalidRecoveryMaterialError();
    }
    return dek;
  } catch (error) {
    if (error instanceof InvalidRecoveryMaterialError) throw error;
    throw new InvalidRecoveryMaterialError();
  } finally {
    key?.fill(0);
  }
}
