import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, utimes, stat, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import {
  acquireRefreshLease,
  cancelRefresh,
} from "../src/core/refresh-lock.ts";
import { snapshot, waitForExport } from "../src/core/export.ts";

test("a live refresh blocks duplicates and release permits another refresh", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hotkey-lease-"));
  const first = await acquireRefreshLease(dir);
  assert.ok(first);
  try {
    assert.equal(await acquireRefreshLease(dir), undefined);
    await first.release();
    const second = await acquireRefreshLease(dir);
    assert.ok(second);
    await second.release();
  } finally {
    await first.release();
    await rm(dir, { recursive: true, force: true });
  }
});

test("stale locks from interrupted refreshes and the old timestamp format recover promptly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hotkey-stale-lease-"));
  try {
    const path = join(dir, "refresh.lock");
    await writeFile(path, String(Date.now() - 60_000));
    const old = new Date(Date.now() - 60_000);
    await utimes(path, old, old);
    const lease = await acquireRefreshLease(dir);
    assert.ok(lease);
    await lease.release();
    await assert.rejects(stat(path), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a normal refresh automatically replaces the previous watcher without its cleanup deleting the new lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hotkey-restart-lease-"));
  const exports = join(dir, "exports");
  await mkdir(exports);
  const first = await acquireRefreshLease(dir);
  assert.ok(first);
  let second;
  try {
    const waiting = assert.rejects(
      waitForExport(exports, await snapshot(exports), {
        intervalMs: 10,
        timeoutMs: 2000,
        signal: first.signal,
        check: first.check,
      }),
      { name: "AbortError" },
    );
    second = await acquireRefreshLease(dir, { replaceActive: true });
    assert.ok(second);
    await waiting;
    await first.release();
    await second.check();
    assert.equal(await acquireRefreshLease(dir), undefined);
  } finally {
    await first.release();
    await second?.release();
    await rm(dir, { recursive: true, force: true });
  }
});

test("automatic replacement propagates filesystem errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hotkey-replace-error-"));
  try {
    await mkdir(join(dir, "refresh.lock"));
    await assert.rejects(
      acquireRefreshLease(dir, { replaceActive: true }),
      (error: NodeJS.ErrnoException) =>
        error.code === "EISDIR" || error.code === "EPERM",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the lease heartbeat renews a live watcher", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hotkey-heartbeat-"));
  const lease = await acquireRefreshLease(dir);
  assert.ok(lease);
  try {
    const path = join(dir, "refresh.lock"),
      old = new Date(Date.now() - 60_000);
    await utimes(path, old, old);
    await delay(2200);
    assert.ok((await stat(path)).mtimeMs > old.getTime() + 30_000);
    assert.equal(await acquireRefreshLease(dir), undefined);
  } finally {
    await lease.release();
    await rm(dir, { recursive: true, force: true });
  }
});

test("filesystem errors are propagated instead of mislabeled as a busy refresh", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hotkey-lock-error-"));
  try {
    const blocked = join(dir, "not-a-directory");
    await writeFile(blocked, "file");
    await assert.rejects(acquireRefreshLease(blocked), { code: "EEXIST" });
    assert.equal(await cancelRefresh(dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
