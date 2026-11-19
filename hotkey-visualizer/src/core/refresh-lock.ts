import { mkdir, open, lstat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const LEASE_MS = 15_000;
export class RefreshCancelled extends Error {
  constructor() {
    super("Refresh canceled or replaced by a newer refresh.");
    this.name = "AbortError";
  }
}
export type RefreshLease = {
  signal: AbortSignal;
  check: () => Promise<void>;
  release: () => Promise<void>;
};
const absent = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

/** An open handle renews its own inode, so an old watcher cannot renew/delete a newer owner's lock. */
export async function acquireRefreshLease(
  support: string,
  options: { replaceActive?: boolean } = {},
): Promise<RefreshLease | undefined> {
  await mkdir(support, { recursive: true, mode: 0o700 });
  const path = join(support, "refresh.lock");
  let handle;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      handle = await open(path, "wx", 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const stale = await lstat(path);
        if (!options.replaceActive && Date.now() - stale.mtimeMs < LEASE_MS)
          return undefined;
        const latest = await lstat(path);
        if (
          latest.ino === stale.ino &&
          latest.dev === stale.dev &&
          latest.mtimeMs === stale.mtimeMs
        )
          await unlink(path);
      } catch (error) {
        if (!absent(error)) throw error;
      }
    }
  }
  if (!handle) return undefined;
  const owned = await handle.stat(),
    controller = new AbortController();
  let released = false,
    timer: ReturnType<typeof setInterval> | undefined;
  const sameOwner = async () => {
    try {
      const current = await lstat(path);
      return current.ino === owned.ino && current.dev === owned.dev;
    } catch (error) {
      if (absent(error)) return false;
      throw error;
    }
  };
  const check = async () => {
    controller.signal.throwIfAborted();
    if (released || !(await sameOwner())) {
      const error = new RefreshCancelled();
      controller.abort(error);
      throw error;
    }
  };
  const release = async () => {
    if (released) return;
    released = true;
    if (timer) clearInterval(timer);
    try {
      if (await sameOwner()) await unlink(path);
    } finally {
      await handle.close();
    }
  };
  try {
    await handle.writeFile(
      JSON.stringify({
        version: 1,
        token: randomUUID(),
        startedAt: Date.now(),
      }),
    );
    let renewing = false;
    timer = setInterval(() => {
      if (renewing || released) return;
      renewing = true;
      void (async () => {
        try {
          await check();
          const now = new Date();
          await handle.utimes(now, now);
        } catch (error) {
          if (!controller.signal.aborted) controller.abort(error);
        } finally {
          renewing = false;
        }
      })();
    }, 2000);
    timer.unref();
    return { signal: controller.signal, check, release };
  } catch (error) {
    await release();
    throw error;
  }
}

/** Canceling removes the marker; the watcher checks ownership on its next poll. */
export async function cancelRefresh(support: string): Promise<boolean> {
  try {
    await unlink(join(support, "refresh.lock"));
    return true;
  } catch (error) {
    if (absent(error)) return false;
    throw error;
  }
}
