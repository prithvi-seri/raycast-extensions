import {
  inLayer,
  keyLabel,
  layerLabel,
  type HotkeyMap,
  type Modifier,
} from "./hotkeys.ts";
export type Key = {
  key: string;
  label?: string;
  width?: number;
  modifier?: Modifier;
};
const row = (keys: string): Key[] => keys.split(" ").map((key) => ({ key }));
export const ROWS: Key[][] = [
  [
    { key: "escape", width: 1.5 },
    ...Array.from({ length: 12 }, (_, i) => ({
      key: `f${i + 1}`,
      width: 1.125,
    })),
  ],
  [...row("` 1 2 3 4 5 6 7 8 9 0 - ="), { key: "delete", width: 2 }],
  [
    { key: "tab", width: 1.5 },
    ...row("q w e r t y u i o p [ ]"),
    { key: "\\", width: 1.5 },
  ],
  [
    { key: "caps", label: "Caps / Hyper", width: 1.8 },
    ...row("a s d f g h j k l ; '"),
    { key: "return", width: 2.2 },
  ],
  [
    { key: "shiftLeft", label: "⇧", modifier: "shift", width: 2.3 },
    ...row("z x c v b n m , . /"),
    { key: "shiftRight", label: "⇧", modifier: "shift", width: 2.7 },
  ],
  [
    { key: "fn", label: "fn", modifier: "fn" },
    { key: "ctrl", label: "⌃", modifier: "ctrl" },
    { key: "alt", label: "⌥", modifier: "alt" },
    { key: "cmd", label: "⌘", modifier: "cmd", width: 1.25 },
    { key: "space", width: 4.5 },
    { key: "cmdRight", label: "⌘", modifier: "cmd", width: 1.25 },
    { key: "altRight", label: "⌥", modifier: "alt" },
    ...row("arrowLeft arrowUp arrowDown arrowRight"),
  ],
];
export const KEYS = ROWS.flat().filter((k) => !k.modifier && k.key !== "caps");
export function xml(value: string) {
  return value.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
}
export function renderKeyboard(
  map: HotkeyMap,
  modifiers: Modifier[],
  selected?: string,
  appearance: "dark" | "light" = "dark",
): string {
  const bindings = inLayer(map, modifiers),
    assigned = new Set(bindings.map((b) => b.key));
  const visibleAssigned = KEYS.filter((k) => assigned.has(k.key)).length;
  const light = appearance === "light";
  const foreground = light ? "#27272a" : "#f4f4f5";
  const secondary = light ? "#65656e" : "#b4b4bd";
  const red = light ? "#d74249" : "#ff6363";
  const svg: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="650" viewBox="0 0 1200 650"><defs><linearGradient id="used" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ff6363" stop-opacity="0.85"/><stop offset="1" stop-color="#ad303e" stop-opacity="0.88"/></linearGradient></defs><text x="38" y="48" fill="${foreground}" font-family="-apple-system,Arial" font-size="26" font-weight="600">${xml(layerLabel(modifiers))} · Keyboard map</text><text x="38" y="80" fill="${secondary}" font-family="-apple-system,Arial" font-size="17">${visibleAssigned} assigned · ${map.warnings.length ? "availability unknown (incomplete import)" : `${KEYS.length - visibleAssigned} unassigned in export`} · US ANSI layout</text>`,
  ];
  for (const [r, keys] of ROWS.entries()) {
    let unitX = 0;
    for (const k of keys) {
      const x = 38 + unitX * 75,
        y = 128 + r * 70,
        w = (k.width ?? 1) * 75 - 8,
        h = r === 0 ? 49 : 57;
      const matches = bindings.filter((b) => b.key === k.key),
        conflict = matches.length > 1;
      const active = k.modifier && modifiers.includes(k.modifier);
      const color = matches.length ? "url(#used)" : "none";
      const stroke =
        selected === k.key
          ? foreground
          : conflict
            ? "#fbbf75"
            : matches.length || active
              ? red
              : secondary;
      const textColor = matches.length ? "#fff7f7" : active ? red : foreground;
      // Unassigned keys have no fill or shadow; only assigned keys have a raised red body.
      svg.push(`<g>`);
      if (matches.length)
        svg.push(
          `<rect x="${x}" y="${y + 6}" width="${w}" height="${h}" rx="9" fill="#7b2433" fill-opacity="0.6"/>`,
        );
      svg.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${color}" stroke="${stroke}" stroke-opacity="${selected === k.key || matches.length || active ? 1 : 0.3}" stroke-width="${selected === k.key ? 3 : 1}"/><text x="${x + w / 2}" y="${y + h / 2 + 7}" fill="${textColor}" fill-opacity="${matches.length || active ? 1 : 0.8}" text-anchor="middle" font-family="-apple-system,Arial" font-size="${k.key === "caps" ? 13 : 19}" font-weight="500">${xml(k.label ?? keyLabel(k.key))}</text>`,
      );
      svg.push("</g>");
      unitX += k.width ?? 1;
    }
  }
  svg.push(
    `<text x="38" y="620" fill="${red}" font-family="-apple-system,Arial" font-size="16">● Assigned</text><text x="220" y="620" fill="${secondary}" font-family="-apple-system,Arial" font-size="16">● ${map.warnings.length ? "Unknown" : "Unassigned"}</text><text x="425" y="620" fill="#fbbf75" font-family="-apple-system,Arial" font-size="16">● Multiple bindings</text><text x="690" y="620" fill="${secondary}" font-family="-apple-system,Arial" font-size="16">⌘K · Layers, search, import, refresh</text></svg>`,
  );
  return svg.join("");
}
export function availableKeys(map: HotkeyMap, modifiers: Modifier[]) {
  if (map.warnings.length) return [];
  const assigned = new Set(inLayer(map, modifiers).map((b) => b.key));
  return KEYS.filter((k) => !assigned.has(k.key)).map((k) => k.key);
}
