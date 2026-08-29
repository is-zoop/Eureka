import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function base64url(value: Buffer) {
  return value.toString("base64url");
}

function key(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function seal(value: unknown, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${base64url(iv)}.${base64url(cipher.getAuthTag())}.${base64url(ciphertext)}`;
}

export function unseal<T>(value: string | undefined, secret: string): T | null {
  if (!value) return null;
  const [ivEncoded, tagEncoded, ciphertextEncoded, ...extra] = value.split(".");
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded || extra.length) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(ivEncoded, "base64url"));
    decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, "base64url")), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    return null;
  }
}
