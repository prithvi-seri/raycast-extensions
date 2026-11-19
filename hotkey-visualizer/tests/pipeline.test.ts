import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes, scryptSync, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtemp, writeFile, appendFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { decodeExport, detectFormat } from "../src/core/decode.ts";
import { snapshot, waitForExport, readStableExport } from "../src/core/export.ts";

const password = "synthetic-test-secret";
const payload = { settings: { hotkeys: [] } };
const salt = randomBytes(16), iv = randomBytes(16);
const key = scryptSync(password, salt, 32);
function fixture(schemaVersion = 3) {
  const header = gzipSync(JSON.stringify({ schemaVersion, encryption: { salt: salt.toString("hex"), iv: iv.toString("hex") } }));
  const length = Buffer.alloc(4); length.writeUInt32LE(header.length);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([Buffer.from("RAYCFG3\n"), length, header, cipher.update(gzipSync(JSON.stringify(payload))), cipher.final(), cipher.getAuthTag()]);
}

test("real-format framing decrypts nested encryption metadata", async () => {
  assert.deepEqual(await decodeExport(fixture(), password), { format: "raycfg3", payload });
});
test("wrong passwords and modified ciphertext fail authentication", async () => {
  await assert.rejects(decodeExport(fixture(), "wrong"), /Incorrect password/);
  const bytes = fixture(); bytes[bytes.length - 20] ^= 1;
  await assert.rejects(decodeExport(bytes, password), /damaged authenticated/);
});
test("malformed lengths, truncation and future formats fail before decryption", async () => {
  const bytes = fixture(); bytes.writeUInt32LE(0xffffffff, 8);
  await assert.rejects(decodeExport(bytes, password), /header length/);
  await assert.rejects(decodeExport(Buffer.from("RAYCFG3\n"), password), /Truncated/);
  assert.throws(() => detectFormat(Buffer.from("RAYCFG4\n")), /Unsupported/);
  await assert.rejects(decodeExport(fixture(4), password), /schema version/);
});
test("legacy gzip and community CBC format remain supported", async () => {
  const compressed = gzipSync(JSON.stringify(payload));
  assert.deepEqual((await decodeExport(compressed, "")).payload, payload);
  const d1 = createHash("sha256").update(password).digest();
  const d2 = createHash("sha256").update(d1).update(password).digest();
  const cipher = createCipheriv("aes-256-cbc", d1, d2.subarray(0, 16));
  const bytes = Buffer.concat([cipher.update(Buffer.concat([randomBytes(16), compressed])), cipher.final()]);
  assert.deepEqual((await decodeExport(bytes, password)).payload, payload);
});

test("watcher ignores old files and waits for chunked writes to settle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hotkey-watch-"));
  try {
    await writeFile(join(directory, "old.rayconfig"), "old");
    const baseline = await snapshot(directory);
    const waiting = waitForExport(directory, baseline, { intervalMs: 10, stableMs: 100, timeoutMs: 2000 });
    const file = join(directory, "new.rayconfig");
    await writeFile(file, "first"); await delay(40); await appendFile(file, "second");
    const result = await waiting;
    assert.equal(result.path, file);
    assert.equal((await readStableExport(result)).toString(), "firstsecond");
    await appendFile(file, "changed");
    await assert.rejects(readStableExport(result), /changed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("overwrites are detected, symlinks excluded, cancellation and timeout work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hotkey-watch-"));
  try {
    const file = join(directory, "same.rayconfig");
    await writeFile(file, "old");
    await symlink(file, join(directory, "link.rayconfig"));
    const baseline = await snapshot(directory);
    assert.equal(baseline.size, 1);
    await writeFile(file, "replacement");
    assert.equal((await waitForExport(directory, baseline, { intervalMs: 10, stableMs: 20 })).path, file);
    const current = await snapshot(directory);
    await assert.rejects(waitForExport(directory, current, { intervalMs: 10, timeoutMs: 35 }), /No completed export/);
    const controller = new AbortController();
    const waiting = waitForExport(directory, current, { signal: controller.signal, intervalMs: 10 });
    controller.abort(); await assert.rejects(waiting, { name: "AbortError" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
