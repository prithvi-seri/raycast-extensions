import { open, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname } from "node:path";
import { snapshot, type Candidate, type Snapshot } from "./export.ts";

const generatedName =
  /^(Raycast(?:-X)?)-(\d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2})\.rayconfig$/;
const same = (
  a: { size: number; mtime: number; inode: number },
  b: { size: number; mtime: number; inode: number },
) => a.size === b.size && a.mtime === b.mtime && a.inode === b.inode;

/** Call only after the replacement export has decrypted, parsed, and been saved successfully. */
export async function trashOlderExports(
  current: Candidate,
  baseline: Snapshot,
  trashFile: (path: string) => Promise<void>,
): Promise<{ removed: number; failed: number }> {
  const name = generatedName.exec(basename(current.path));
  if (!name) return { removed: 0, failed: 0 };
  const files = await snapshot(dirname(current.path));
  const currentStamp = files.get(current.path);
  if (!currentStamp || !same(currentStamp, current.stamp))
    return { removed: 0, failed: 0 };
  let removed = 0,
    failed = 0;
  for (const [path, before] of baseline) {
    const oldName = generatedName.exec(basename(path)),
      now = files.get(path);
    if (
      path === current.path ||
      dirname(path) !== dirname(current.path) ||
      !oldName ||
      oldName[1] !== name[1] ||
      oldName[2] >= name[2] ||
      !now ||
      !same(before, now) ||
      now.mtime > currentStamp.mtime
    )
      continue;
    try {
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      let recognized = false;
      try {
        const header = Buffer.alloc(8);
        await handle.read(header, 0, 8, 0);
        recognized = header.equals(Buffer.from("RAYCFG3\n"));
      } finally {
        await handle.close();
      }
      if (!recognized) continue;
      const latest = await lstat(path);
      if (
        !latest.isFile() ||
        !same(now, {
          size: latest.size,
          mtime: latest.mtimeMs,
          inode: latest.ino,
        })
      )
        continue;
      await trashFile(path);
      removed++;
    } catch {
      failed++;
    }
  }
  return { removed, failed };
}
