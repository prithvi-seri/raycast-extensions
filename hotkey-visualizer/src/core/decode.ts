import { createDecipheriv, createHash, scrypt } from "node:crypto";
import { gunzipSync } from "node:zlib";

const MAGIC = Buffer.from("RAYCFG3\n");
const MAX_HEADER = 1024 * 1024;
export const MAX_EXPORT = 512 * 1024 * 1024;
export type Format = "raycfg3" | "legacy-cbc" | "legacy-gzip";
export type Decoded = { format: Format; payload: Record<string, unknown> };

function objectJSON(bytes: Buffer): Record<string, unknown> {
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Export JSON must be an object.");
  return value as Record<string, unknown>;
}
function unpack(bytes: Buffer) {
  const plain = gunzipSync(bytes, { maxOutputLength: MAX_EXPORT });
  try { return objectJSON(plain); } finally { plain.fill(0); }
}
function hex(value: unknown, name: string) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/i.test(value)) throw new Error(`Invalid ${name} in export header.`);
  return Buffer.from(value, "hex");
}
export function detectFormat(bytes: Buffer): Format {
  if (bytes.subarray(0, 8).equals(MAGIC)) return "raycfg3";
  if (bytes.subarray(0, 6).toString() === "RAYCFG") throw new Error("Unsupported Raycast export version.");
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return "legacy-gzip";
  if (bytes.length >= 32 && bytes.length % 16 === 0) return "legacy-cbc";
  throw new Error("Unrecognized or truncated Raycast export.");
}
export async function decodeExport(bytes: Buffer, password: string): Promise<Decoded> {
  if (bytes.length > MAX_EXPORT) throw new Error("Export exceeds the 512 MiB limit.");
  const format = detectFormat(bytes);
  if (format === "legacy-gzip") return { format, payload: unpack(bytes) };
  if (!password) throw new Error("An export password is required.");
  if (format === "raycfg3") {
    if (bytes.length < 28) throw new Error("Truncated export container.");
    const headerLength = bytes.readUInt32LE(8);
    const bodyOffset = 12 + headerLength;
    if (!headerLength || headerLength > MAX_HEADER || bodyOffset + 16 >= bytes.length) throw new Error("Invalid export header length.");
    const headerBytes = gunzipSync(bytes.subarray(12, bodyOffset), { maxOutputLength: MAX_HEADER });
    const header = objectJSON(headerBytes);
    if (header.schemaVersion !== 3) throw new Error("Unsupported Raycast schema version.");
    const encryption = header.encryption;
    if (!encryption || typeof encryption !== "object" || Array.isArray(encryption)) throw new Error("Missing export encryption metadata.");
    const metadata = encryption as Record<string, unknown>;
    const iv = hex(metadata.iv, "IV"), salt = hex(metadata.salt, "salt");
    const key = await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
    let compressed: Buffer | undefined;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(bytes.subarray(-16));
      try { compressed = Buffer.concat([decipher.update(bytes.subarray(bodyOffset, -16)), decipher.final()]); }
      catch { throw new Error("Incorrect password or damaged authenticated export."); }
      return { format, payload: unpack(compressed) };
    } finally { key.fill(0); compressed?.fill(0); }
  }
  // OpenSSL enc's unsalted EVP_BytesToKey SHA-256 derivation. No shell or password arguments.
  // Legacy community recipe discards the first 16 decrypted bytes before gunzip.
  const passwordBytes = Buffer.from(password, "utf8");
  const d1 = createHash("sha256").update(passwordBytes).digest();
  const d2 = createHash("sha256").update(d1).update(passwordBytes).digest();
  let plain: Buffer | undefined;
  try {
    const decipher = createDecipheriv("aes-256-cbc", d1, d2.subarray(0, 16));
    plain = Buffer.concat([decipher.update(bytes), decipher.final()]);
    return { format, payload: unpack(plain.subarray(16)) };
  } catch { throw new Error("Incorrect password, damaged export, or unsupported legacy format."); }
  finally { passwordBytes.fill(0); d1.fill(0); d2.fill(0); plain?.fill(0); }
}
