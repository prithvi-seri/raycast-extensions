import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractHotkeys,
  inLayer,
  parseShortcut,
  type Modifier,
} from "../src/core/hotkeys.ts";
import { availableKeys, KEYS, renderKeyboard } from "../src/core/keyboard.ts";
import { atomicJSON, readMap } from "../src/core/store.ts";
const hyper: Modifier[] = ["ctrl", "alt", "shift", "cmd"];
const shortcut = (key: string, mods = ["Meta", "Shift", "Alt", "Ctrl"]) => ({
  kind: {
    type: "shortcut",
    shortcut: {
      key: { type: "key", keyType: { type: "equivalent", equivalent: key } },
      modifiers: mods.map((modifier) => ({ modifier })),
    },
  },
  locality: "global",
});
const exported = () => ({
  settings: {
    general: {
      globalHotkey: shortcut(" ", ["Meta"]),
      hyperKeyIncludeShift: true,
    },
    commands: [
      {
        id: "left-half",
        extensionId: "window-management",
        enabled: true,
        macosHotkey: shortcut("h"),
      },
      { id: "disabled-command", enabled: false, macosHotkey: shortcut("j") },
      {
        id: "disabled-extension",
        extensionId: "off-extension",
        macosHotkey: shortcut("k"),
      },
      { id: "caps-toggle", macosHotkey: shortcut("c", ["Ctrl", "Alt"]) },
      { id: "no-shortcut", macosHotkey: { kind: { type: "none" } } },
    ],
    nodeExtensions: [{ id: "off-extension", enabled: false }],
  },
});
test("observed nested Raycast schema normalizes modifier order and special keys", () => {
  assert.deepEqual(parseShortcut(shortcut("h")), {
    key: "h",
    modifiers: hyper,
  });
  assert.equal(parseShortcut(shortcut(" "))?.key, "space");
  assert.equal(parseShortcut(shortcut("\uf702"))?.key, "arrowLeft");
  assert.equal(parseShortcut({ keyCode: 0, modifiers: 1 << 20 })?.key, "a");
  assert.equal(parseShortcut(shortcut("h", ["Meta", "Mystery"])), undefined);
  assert.equal(parseShortcut(shortcut("h", ["constructor"])), undefined);
});
test("disabled commands and extensions do not occupy a layer; global hotkey is preserved", () => {
  const map = extractHotkeys(exported(), "synthetic.rayconfig");
  assert.equal(map.bindings.length, 5);
  assert.deepEqual(
    inLayer(map, hyper).map((b) => b.key),
    ["h"],
  );
  assert.equal(inLayer(map, ["cmd"])[0].key, "space");
  assert.ok(availableKeys(map, hyper).includes("j"));
  assert.ok(availableKeys(map, hyper).includes("k"));
  assert.ok(!availableKeys(map, hyper).includes("h"));
  assert.equal(map.warnings.length, 0);
});
test("unreadable shortcuts produce visible warnings and a completely unreadable export is rejected", () => {
  const input = exported();
  input.settings.commands.push({
    id: "new-format",
    macosHotkey: shortcut("x", ["Mystery"]),
  } as (typeof input.settings.commands)[number]);
  const map = extractHotkeys(input, "synthetic.rayconfig");
  assert.equal(map.warnings.length, 1);
  assert.match(map.warnings[0], /New Format/);
  assert.throws(
    () =>
      extractHotkeys(
        { settings: { commands: [{ id: "broken", macosHotkey: {} }] } },
        "synthetic.rayconfig",
      ),
    /No readable/,
  );
  assert.throws(
    () => extractHotkeys({ settings: {} }, "synthetic.rayconfig"),
    /commands/,
  );
});
test("conflicts and selected keys remain visible without command captions", () => {
  const map = extractHotkeys(exported(), "synthetic.rayconfig");
  map.bindings.push({
    ...map.bindings[1],
    id: "conflicting",
    title: '<script> & "unsafe"',
  });
  assert.equal(inLayer(map, hyper).length, 2);
  const svg = renderKeyboard(map, hyper, "h");
  assert.ok(renderKeyboard(map, hyper).includes('stroke="#fbbf75"'));
  assert.ok(!svg.includes("<script>"));
  assert.match(svg, /stroke-width="3"/);
  map.bindings.pop();
  map.bindings[1].title = "<script>";
  assert.ok(!renderKeyboard(map, hyper).includes("script"));
  assert.equal(new Set(KEYS.map((k) => k.key)).size, KEYS.length);
});
test("atomic cache contains only the projected hotkeys and uses private file permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hotkey-store-"));
  try {
    const map = extractHotkeys(
      {
        ...exported(),
        clipboardHistory: "private clipboard",
        ai: { secret: "private token" },
      },
      "synthetic.rayconfig",
    );
    const path = join(dir, "hotkeys.json");
    await atomicJSON(path, map);
    assert.deepEqual(await readMap(dir), map);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.ok(!(await readFile(path, "utf8")).includes("private"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Raycast physical command keys use LayoutIndependent.code, including code zero", () => {
  const physical = (code: number) => ({
    kind: {
      type: "SingleStep",
      shortcut: {
        modifiers: ["Ctrl", "Alt", "Shift", "Meta"].map((modifier) => ({
          modifier,
        })),
        key: { type: "LayoutIndependent", code },
      },
    },
    locality: "Global",
  });
  const input = {
    settings: {
      general: { globalHotkey: shortcut(" ", ["Meta"]) },
      commands: [0, 8, 4, 37, 123].map((code, i) => ({
        id: `physical-${i}`,
        macosHotkey: physical(code),
      })),
    },
  };
  const map = extractHotkeys(input, "synthetic-physical.rayconfig");
  assert.equal(map.version, 2);
  assert.equal(map.bindings.length, 6);
  assert.deepEqual(
    inLayer(map, hyper).map((b) => b.key),
    ["a", "c", "h", "l", "arrowLeft"],
  );
  assert.equal(map.warnings.length, 0);
  assert.ok(!availableKeys(map, hyper).includes("a"));
  assert.equal(parseShortcut(physical(999)), undefined);
  assert.equal(
    parseShortcut({
      kind: {
        type: "SingleStep",
        shortcut: {
          modifiers: [],
          key: {
            type: "LayoutDependent",
            keyType: { type: "Control", key: "ArrowLeft" },
          },
        },
      },
    })?.key,
    "arrowLeft",
  );
});

test("a readable launcher alone cannot make an unreadable command import appear successful", () => {
  assert.throws(
    () =>
      extractHotkeys(
        {
          settings: {
            general: { globalHotkey: shortcut(" ", ["Meta"]) },
            commands: [{ id: "broken", macosHotkey: {} }],
          },
        },
        "synthetic.rayconfig",
      ),
    /No readable command hotkeys/,
  );
});

test("partial imports do not advertise unassigned keys and old parser caches are invalidated", async () => {
  const map = extractHotkeys(exported(), "synthetic.rayconfig");
  map.warnings.push("Unknown shortcut");
  assert.deepEqual(availableKeys(map, hyper), []);
  assert.match(renderKeyboard(map, hyper), /availability unknown/);
  const dir = await mkdtemp(join(tmpdir(), "hotkey-cache-migration-"));
  try {
    await atomicJSON(join(dir, "hotkeys.json"), { ...map, version: 1 });
    assert.equal(await readMap(dir), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("refresh replaces the cache so cleared, omitted, and deleted bindings become unassigned", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hotkey-cleared-binding-"));
  try {
    const initial = exported();
    await atomicJSON(
      join(dir, "hotkeys.json"),
      extractHotkeys(initial, "before.rayconfig"),
    );
    assert.ok(!availableKeys((await readMap(dir))!, hyper).includes("h"));
    const variants = [
      initial.settings.commands.map((c) =>
        c.id === "left-half" ? { ...c, macosHotkey: null } : c,
      ),
      initial.settings.commands.map((c) => {
        if (c.id !== "left-half") return c;
        const { macosHotkey, ...rest } = c;
        return rest;
      }),
      initial.settings.commands.filter((c) => c.id !== "left-half"),
    ];
    for (const commands of variants) {
      const map = extractHotkeys(
        { ...initial, settings: { ...initial.settings, commands } },
        "after.rayconfig",
      );
      await atomicJSON(join(dir, "hotkeys.json"), map);
      const refreshed = (await readMap(dir))!;
      assert.ok(availableKeys(refreshed, hyper).includes("h"));
      assert.ok(!refreshed.bindings.some((b) => b.id === "left-half"));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
