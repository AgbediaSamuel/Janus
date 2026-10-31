import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const value = Buffer.from(process.env.JANUS_ENCRYPTION_KEY || "", "base64");
  if (value.length !== 32)
    throw new Error(
      "JANUS_ENCRYPTION_KEY must encode 32 random bytes in base64",
    );
  return value;
}

export function encryptCredentials(
  credentials: Record<string, string>,
  organizationId: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(organizationId));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64"))
    .join(".");
}

export function decryptCredentials(
  value: string,
  organizationId: string,
): Record<string, string> {
  const [iv, tag, ciphertext] = value
    .split(".")
    .map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAAD(Buffer.from(organizationId));
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8",
    ),
  );
}
