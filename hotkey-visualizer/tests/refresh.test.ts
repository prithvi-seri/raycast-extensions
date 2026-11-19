import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rename,
  rm,
  symlink,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveAppAvailability } from "../src/core/availability.ts";
import { inLayer, type Binding, type HotkeyMap } from "../src/core/hotkeys.ts";
import { snapshot } from "../src/core/export.ts";
import { trashOlderExports } from "../src/core/cleanup.ts";

const hyper: Binding["modifiers"] = ["ctrl", "alt", "shift", "cmd"];
const binding = (id: string, title: string, key: string): Binding => ({
  id,
  title,
  key,
  extension: "Applications",
  enabled: true,
  modifiers: hyper,
});
const exportBytes = Buffer.from("RAYCFG3\nsynthetic-old-export");
const exportName = (time: string, prefix = "Raycast-X") =>
  `${prefix}-2026-11-19 ${time}.rayconfig`;

test("missing app records do not create conflicts; restored apps become available without reexporting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hotkey-app-availability-"));
  try {
    const live = join(dir, "Live.app"),
      old = join(dir, "Old.app");
    await mkdir(live);
    const map: HotkeyMap = {
      version: 2,
      source: "synthetic",
      importedAt: new Date().toISOString(),
      hyper,
      warnings: [],
      bindings: [
        binding(`c:r:applications::*::application::=::${live}`, "Live", "e"),
        binding(`c:r:applications::*::application::=::${old}`, "Old", "e"),
        binding(
          "c:r:quicklinks::*::quicklink::=::not-an-app",
          "Quicklink",
          "y",
        ),
      ],
    };
    const checked = await resolveAppAvailability(map);
    assert.deepEqual(
      inLayer(checked, hyper).map((b) => b.title),
      ["Live", "Quicklink"],
    );
    assert.equal(checked.bindings[1].unavailableReason, "App missing");
    assert.equal(checked.bindings[1].enabled, true);
    assert.equal(map.bindings[1].unavailableReason, undefined);
    await mkdir(old);
    assert.equal(
      inLayer(await resolveAppAvailability(checked), hyper).filter(
        (b) => b.key === "e",
      ).length,
      2,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cleanup trashes only older unchanged generated exports and keeps the new export and unrelated files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hotkey-export-cleanup-"));
  try {
    const old = join(dir, exportName("12.00.00")),
      current = join(dir, exportName("13.00.00"));
    const custom = join(dir, "personal-backup.rayconfig"),
      other = join(dir, exportName("11.00.00", "Raycast")),
      invalid = join(dir, exportName("10.00.00"));
    await writeFile(old, exportBytes);
    await writeFile(custom, exportBytes);
    await writeFile(other, exportBytes);
    await writeFile(invalid, "not-an-export");
    await symlink(old, join(dir, exportName("09.00.00")));
    const baseline = await snapshot(dir);
    await writeFile(current, exportBytes);
    const stamp = (await snapshot(dir)).get(current)!;
    const trashed: string[] = [];
    const result = await trashOlderExports(
      { path: current, stamp },
      baseline,
      async (path) => {
        trashed.push(path);
        await rename(path, `${path}.trashed`);
      },
    );
    assert.deepEqual(result, { removed: 1, failed: 0 });
    assert.deepEqual(trashed, [old]);
    for (const path of [current, custom, other, invalid])
      assert.ok((await stat(path)).isFile());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cleanup leaves files written during refresh alone and stops if the validated replacement changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hotkey-export-concurrent-"));
  try {
    const old = join(dir, exportName("12.00.00")),
      current = join(dir, exportName("13.00.00"));
    await writeFile(old, exportBytes);
    const baseline = await snapshot(dir);
    await writeFile(current, exportBytes);
    const stamp = (await snapshot(dir)).get(current)!;
    await writeFile(old, Buffer.concat([exportBytes, Buffer.from("changed")]));
    let calls = 0;
    assert.deepEqual(
      await trashOlderExports({ path: current, stamp }, baseline, async () => {
        calls++;
      }),
      { removed: 0, failed: 0 },
    );
    await writeFile(
      current,
      Buffer.concat([exportBytes, Buffer.from("changed")]),
    );
    assert.deepEqual(
      await trashOlderExports({ path: current, stamp }, baseline, async () => {
        calls++;
      }),
      { removed: 0, failed: 0 },
    );
    assert.equal(calls, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Trash failures preserve the successfully imported replacement and are reported separately", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hotkey-export-trash-error-"));
  try {
    const old = join(dir, exportName("12.00.00")),
      current = join(dir, exportName("13.00.00"));
    await writeFile(old, exportBytes);
    const baseline = await snapshot(dir);
    await writeFile(current, exportBytes);
    const stamp = (await snapshot(dir)).get(current)!;
    assert.deepEqual(
      await trashOlderExports({ path: current, stamp }, baseline, async () => {
        throw new Error("Trash unavailable");
      }),
      { removed: 0, failed: 1 },
    );
    assert.ok((await stat(current)).isFile());
    assert.ok((await stat(old)).isFile());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
