export type Modifier = "ctrl" | "alt" | "shift" | "cmd" | "fn";
export type Binding = {
  id: string;
  title: string;
  extension: string;
  key: string;
  modifiers: Modifier[];
  enabled: boolean;
  unavailableReason?: string;
};
export type HotkeyMap = {
  version: 2;
  importedAt: string;
  source: string;
  bindings: Binding[];
  warnings: string[];
  hyper: Modifier[];
};
export const MODIFIERS: Modifier[] = ["ctrl", "alt", "shift", "cmd", "fn"];
export const SYMBOLS: Record<Modifier, string> = {
  ctrl: "⌃",
  alt: "⌥",
  shift: "⇧",
  cmd: "⌘",
  fn: "fn",
};
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.length ? value : undefined;
export function layerId(modifiers: Modifier[]) {
  return MODIFIERS.filter((m) => modifiers.includes(m)).join("+");
}
export function layerLabel(modifiers: Modifier[]) {
  return modifiers.length
    ? MODIFIERS.filter((m) => modifiers.includes(m))
        .map((m) => SYMBOLS[m])
        .join("")
    : "No modifiers";
}
export function keyLabel(key: string) {
  return (
    (
      {
        space: "Space",
        return: "Return",
        tab: "Tab",
        escape: "Esc",
        delete: "Delete",
        deleteForward: "Del ⌦",
        arrowUp: "↑",
        arrowDown: "↓",
        arrowLeft: "←",
        arrowRight: "→",
        pageUp: "PgUp",
        pageDown: "PgDn",
        home: "Home",
        end: "End",
      } as Record<string, string>
    )[key] ?? key.toUpperCase()
  );
}
export function shortcutLabel(b: Pick<Binding, "key" | "modifiers">) {
  return `${layerLabel(b.modifiers)} ${keyLabel(b.key)}`;
}
const keyCodes: Record<number, string> = Object.fromEntries([
  [0, "a"],
  [1, "s"],
  [2, "d"],
  [3, "f"],
  [4, "h"],
  [5, "g"],
  [6, "z"],
  [7, "x"],
  [8, "c"],
  [9, "v"],
  [11, "b"],
  [12, "q"],
  [13, "w"],
  [14, "e"],
  [15, "r"],
  [16, "y"],
  [17, "t"],
  [18, "1"],
  [19, "2"],
  [20, "3"],
  [21, "4"],
  [22, "6"],
  [23, "5"],
  [24, "="],
  [25, "9"],
  [26, "7"],
  [27, "-"],
  [28, "8"],
  [29, "0"],
  [30, "]"],
  [31, "o"],
  [32, "u"],
  [33, "["],
  [34, "i"],
  [35, "p"],
  [36, "return"],
  [37, "l"],
  [38, "j"],
  [39, "'"],
  [40, "k"],
  [41, ";"],
  [42, "\\"],
  [43, ","],
  [44, "/"],
  [45, "n"],
  [46, "m"],
  [47, "."],
  [48, "tab"],
  [49, "space"],
  [50, "`"],
  [51, "delete"],
  [53, "escape"],
  [96, "f5"],
  [97, "f6"],
  [98, "f7"],
  [99, "f3"],
  [100, "f8"],
  [101, "f9"],
  [103, "f11"],
  [109, "f10"],
  [111, "f12"],
  [115, "home"],
  [116, "pageUp"],
  [117, "deleteForward"],
  [118, "f4"],
  [119, "end"],
  [120, "f2"],
  [121, "pageDown"],
  [122, "f1"],
  [123, "arrowLeft"],
  [124, "arrowRight"],
  [125, "arrowDown"],
  [126, "arrowUp"],
]);
const aliases: Record<string, string> = {
  " ": "space",
  "\r": "return",
  "\n": "return",
  "\t": "tab",
  "\u001b": "escape",
  "\u007f": "delete",
  "\b": "delete",
  "\uf700": "arrowUp",
  "\uf701": "arrowDown",
  "\uf702": "arrowLeft",
  "\uf703": "arrowRight",
  "\uf728": "deleteForward",
  "\uf729": "home",
  "\uf72b": "end",
  "\uf72c": "pageUp",
  "\uf72d": "pageDown",
  spacebar: "space",
  enter: "return",
  esc: "escape",
  backspace: "delete",
  forwarddelete: "deleteForward",
  deleteforward: "deleteForward",
  arrowup: "arrowUp",
  uparrow: "arrowUp",
  up: "arrowUp",
  arrowdown: "arrowDown",
  downarrow: "arrowDown",
  down: "arrowDown",
  arrowleft: "arrowLeft",
  leftarrow: "arrowLeft",
  left: "arrowLeft",
  arrowright: "arrowRight",
  rightarrow: "arrowRight",
  right: "arrowRight",
  pageup: "pageUp",
  pagedown: "pageDown",
};
export function normalizeKey(value: unknown): string | undefined {
  if (typeof value === "number") return keyCodes[value];
  if (typeof value !== "string") return undefined;
  if (Object.hasOwn(aliases, value)) return aliases[value];
  if (value.length === 1) {
    const code = value.charCodeAt(0);
    if (code >= 0xf704 && code <= 0xf717) return `f${code - 0xf703}`;
    if (code < 32 || code >= 0xf700) return undefined;
    return value.toLowerCase();
  }
  const key = value.toLowerCase().replace(/[ _-]/g, "");
  return (
    (Object.hasOwn(aliases, key) ? aliases[key] : undefined) ??
    (/^(?:f(?:[1-9]|1[0-9]|2[0-4])|space|return|tab|escape|delete|home|end)$/.test(
      key,
    )
      ? key
      : undefined)
  );
}
function parseModifiers(value: unknown): Modifier[] | undefined {
  const aliases: Record<string, Modifier> = {
    ctrl: "ctrl",
    control: "ctrl",
    alt: "alt",
    option: "alt",
    opt: "alt",
    meta: "cmd",
    command: "cmd",
    cmd: "cmd",
    shift: "shift",
    fn: "fn",
    function: "fn",
  };
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
      return undefined;
    // NSEvent.ModifierFlags: reject flags we do not understand.
    const mask = (1 << 17) | (1 << 18) | (1 << 19) | (1 << 20) | (1 << 23);
    if ((value & ~mask) !== 0) return undefined;
    return MODIFIERS.filter(
      (m) =>
        (value &
          {
            shift: 1 << 17,
            ctrl: 1 << 18,
            alt: 1 << 19,
            cmd: 1 << 20,
            fn: 1 << 23,
          }[m]) !==
        0,
    );
  }
  if (!Array.isArray(value)) return undefined;
  const parsed = value
    .map((m) => text(record(m).modifier) ?? text(m))
    .map((m) =>
      m && Object.hasOwn(aliases, m.toLowerCase())
        ? aliases[m.toLowerCase()]
        : undefined,
    );
  return parsed.some((m) => !m)
    ? undefined
    : MODIFIERS.filter((m) => parsed.includes(m));
}
export function parseShortcut(
  value: unknown,
): { key: string; modifiers: Modifier[] } | undefined {
  const hotkey = record(value),
    kind = record(hotkey.kind);
  const shortcut = record(kind.shortcut ?? hotkey.shortcut ?? value);
  const keyObject = record(shortcut.key),
    keyType = record(keyObject.keyType);
  const key = normalizeKey(
    (keyObject.type === "LayoutIndependent" ? keyObject.code : undefined) ??
      keyType.key ??
      keyType.equivalent ??
      keyObject.equivalent ??
      keyObject.keyCode ??
      shortcut.keyCode ??
      (typeof shortcut.key === "string" ? shortcut.key : undefined) ??
      keyType.type,
  );
  const modifiers = parseModifiers(shortcut.modifiers);
  return key && modifiers ? { key, modifiers } : undefined;
}
export function humanize(id: string) {
  const command = id.includes("::-::") ? id.split("::-::").at(-1)! : id;
  const last = (command.split("/").filter(Boolean).at(-1) ?? command).replace(
    /\.app$/i,
    "",
  );
  return last
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_.:]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
export function extractHotkeys(
  payload: Record<string, unknown>,
  source: string,
  titles: Map<string, string> = new Map(),
): HotkeyMap {
  const settings = record(payload.settings ?? payload),
    general = record(settings.general);
  if (!Array.isArray(settings.commands))
    throw new Error("Export has no recognized settings.commands array.");
  const bindings: Binding[] = [],
    warnings: string[] = [];
  const disabledExtensions = new Set(
    [...array(settings.internalExtensions), ...array(settings.nodeExtensions)]
      .map(record)
      .filter((e) => e.enabled === false)
      .map((e) => e.id),
  );
  const add = (
    value: unknown,
    id: string,
    title: string,
    extension: string,
    enabled: boolean,
  ) => {
    if (value === null || value === undefined) return;
    const kind = record(record(value).kind);
    if (
      ["none", "unassigned", "disabled"].includes(
        String(kind.type).toLowerCase(),
      )
    )
      return;
    const shortcut = parseShortcut(value);
    if (!shortcut) {
      warnings.push(`Could not read shortcut for ${title}.`);
      return;
    }
    bindings.push({ id, title, extension, enabled, ...shortcut });
  };
  add(general.globalHotkey, "raycast-global", "Open Raycast", "Raycast", true);
  for (const [i, raw] of settings.commands.entries()) {
    const command = record(raw),
      id = text(command.id) ?? `command-${i}`,
      extension = text(command.extensionId) ?? "Raycast";
    const title =
      text(command.title) ??
      text(command.name) ??
      titles.get(`${extension}/${id}`) ??
      titles.get(id) ??
      humanize(id);
    add(
      command.macosHotkey,
      id,
      title,
      titles.get(extension) ?? humanize(extension),
      command.enabled !== false && !disabledExtensions.has(extension),
    );
  }
  const parsedCommands = bindings.filter((b) => b.id !== "raycast-global");
  if (!parsedCommands.length && warnings.length)
    throw new Error(
      "No readable command hotkeys found. Import is incomplete; the previous map was kept.",
    );
  if (!bindings.length)
    throw new Error(
      "No readable hotkeys found. The export schema may have changed; the previous map was kept.",
    );
  return {
    version: 2,
    importedAt: new Date().toISOString(),
    source,
    bindings,
    warnings,
    hyper:
      general.hyperKeyIncludeShift === false
        ? ["ctrl", "alt", "cmd"]
        : ["ctrl", "alt", "shift", "cmd"],
  };
}
export function inLayer(map: HotkeyMap, modifiers: Modifier[]) {
  return map.bindings.filter(
    (b) =>
      b.enabled &&
      !b.unavailableReason &&
      layerId(b.modifiers) === layerId(modifiers),
  );
}
