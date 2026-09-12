import crypto from "crypto";

// App-level encryption for the Google refresh token before it's written to
// Postgres ("encrypted at rest"). AES-256-GCM with a 32-byte key from env.
// Generate a key:  openssl rand -base64 32

function key(): Buffer {
  const b64 = process.env.APP_ENCRYPTION_KEY;
  if (!b64) throw new Error("APP_ENCRYPTION_KEY is not set");
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("APP_ENCRYPTION_KEY must decode to 32 bytes (use `openssl rand -base64 32`)");
  return k;
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64"); // iv(12) | tag(16) | ciphertext
}

export function decrypt(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
