import { lstat, readdir, open } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MAX_EXPORT } from "./decode.ts";

export const EXPORT_DEEPLINK = "raycast://extensions/raycast/raycast/export-settings-data";
type Stamp = { size: number; mtime: number; inode: number };
export type Candidate = { path: string; stamp: Stamp };
export type Snapshot = Map<string, Stamp>;
async function scan(directory: string): Promise<Candidate[]> {
  const files = await readdir(directory, { withFileTypes: true });
  const found = await Promise.all(files.filter(f => f.isFile() && /\.rayconfig$/i.test(f.name)).map(async file => {
    const path = join(resolve(directory), file.name);
    try { const s = await lstat(path); return s.isFile() ? { path, stamp: { size: s.size, mtime: s.mtimeMs, inode: s.ino } } : undefined; }
    catch { return undefined; }
  }));
  return found.filter((f): f is Candidate => !!f);
}
export async function snapshot(directory: string): Promise<Snapshot> {
  return new Map((await scan(directory)).map(f => [f.path, f.stamp]));
}
function equal(a: Stamp | undefined, b: Stamp) { return !!a && a.size === b.size && a.mtime === b.mtime && a.inode === b.inode; }
export async function waitForExport(directory: string, baseline: Snapshot, options: { signal?: AbortSignal; timeoutMs?: number; intervalMs?: number; stableMs?: number } = {}): Promise<Candidate> {
  const { signal, timeoutMs = 300_000, intervalMs = 350, stableMs = 1400 } = options;
  const deadline = Date.now() + timeoutMs;
  const stable = new Map<string, { stamp: Stamp; since: number }>();
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const candidates = (await scan(directory)).filter(f => !equal(baseline.get(f.path), f.stamp));
    for (const f of candidates.sort((a, b) => b.stamp.mtime - a.stamp.mtime)) {
      if (f.stamp.size > MAX_EXPORT) throw new Error("Export exceeds the 512 MiB limit.");
      if (!f.stamp.size) continue;
      const previous = stable.get(f.path);
      if (!previous || !equal(previous.stamp, f.stamp)) stable.set(f.path, { stamp: f.stamp, since: Date.now() });
      else if (Date.now() - previous.since >= stableMs) return f;
    }
    for (const path of stable.keys()) if (!candidates.some(f => f.path === path)) stable.delete(path);
    await delay(intervalMs, undefined, { signal });
  }
  throw new Error("No completed export detected within five minutes. Check the selected export folder, or retry after canceling the export dialog.");
}
export async function readStableExport(candidate: Candidate): Promise<Buffer> {
  const handle = await open(candidate.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer | undefined;
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_EXPORT || !equal(candidate.stamp, { size: before.size, mtime: before.mtimeMs, inode: before.ino })) throw new Error("Export changed before it could be read; retry.");
    bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error("Export changed while reading; retry.");
      offset += bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(candidate.path);
    if (!current.isFile() || !equal(candidate.stamp, { size: current.size, mtime: current.mtimeMs, inode: current.ino }) || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("Export is still being written; retry.");
    return bytes;
  } catch (error) { bytes?.fill(0); throw error; }
  finally { await handle.close(); }
}
