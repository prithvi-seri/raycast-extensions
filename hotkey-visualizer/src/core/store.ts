import {
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
  readdir,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { resolveAppAvailability } from "./availability.ts";
import { decodeExport } from "./decode.ts";
import {
  getExportPassword,
  promptExportPassword,
  saveExportPassword,
} from "./keychain.ts";
import { readStableExport, snapshot } from "./export.ts";
import {
  extractHotkeys,
  record,
  MODIFIERS,
  type HotkeyMap,
} from "./hotkeys.ts";
export type Config = { file?: string; directory: string };
export const expandPath = (path: string) =>
  resolve(
    path === "~"
      ? homedir()
      : path.startsWith("~/")
        ? join(homedir(), path.slice(2))
        : path,
  );
export async function readJSON(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}
export async function atomicJSON(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temp, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temp, { force: true });
  }
}
export async function loadConfig(
  support: string,
  assets: string,
): Promise<Config> {
  for (const file of [
    join(support, "config.json"),
    join(assets, "bootstrap.json"),
  ]) {
    try {
      const value = record(await readJSON(file));
      if (typeof value.directory === "string")
        return {
          directory: expandPath(value.directory),
          file:
            typeof value.file === "string" ? expandPath(value.file) : undefined,
        };
    } catch {
      /* A new installation has no configuration yet. */
    }
  }
  return { directory: join(homedir(), "Code/projects") };
}
export async function readMap(support: string): Promise<HotkeyMap | undefined> {
  try {
    const map = (await readJSON(join(support, "hotkeys.json"))) as HotkeyMap;
    if (
      map &&
      map.version === 2 &&
      typeof map.source === "string" &&
      typeof map.importedAt === "string" &&
      Number.isFinite(Date.parse(map.importedAt)) &&
      Array.isArray(map.bindings) &&
      Array.isArray(map.hyper) &&
      map.hyper.every((m) => MODIFIERS.includes(m)) &&
      Array.isArray(map.warnings) &&
      map.warnings.every((w) => typeof w === "string") &&
      map.bindings.every(
        (b) =>
          b &&
          typeof b.id === "string" &&
          typeof b.title === "string" &&
          typeof b.extension === "string" &&
          typeof b.key === "string" &&
          typeof b.enabled === "boolean" &&
          Array.isArray(b.modifiers) &&
          b.modifiers.every((m) => MODIFIERS.includes(m)),
      )
    )
      return await resolveAppAvailability(map);
  } catch {
    /* Import from the configured encrypted export instead. */
  }
}
export async function installedTitles(): Promise<Map<string, string>> {
  const titles = new Map<string, string>(),
    root = join(homedir(), ".config/raycast/extensions");
  try {
    const folders = await readdir(root, { withFileTypes: true });
    await Promise.all(
      folders
        .filter((f) => f.isDirectory())
        .map(async (folder) => {
          try {
            const manifest = record(
              await readJSON(join(root, folder.name, "package.json")),
            );
            if (!Array.isArray(manifest.commands)) return;
            if (typeof manifest.title === "string") {
              titles.set(`e:n:${folder.name}`, manifest.title);
              titles.set(folder.name, manifest.title);
            }
            for (const raw of manifest.commands) {
              const command = record(raw);
              if (
                typeof command.name !== "string" ||
                typeof command.title !== "string"
              )
                continue;
              for (const id of [
                `c:n:${folder.name}::-::${command.name}`,
                `${folder.name}/${command.name}`,
                `${manifest.name}/${command.name}`,
                `${manifest.author}/${manifest.name}/${command.name}`,
                `extensions/${manifest.author}/${manifest.name}/${command.name}`,
              ])
                titles.set(id, command.title);
            }
          } catch {
            /* Missing or non-extension manifest. */
          }
        }),
    );
  } catch {
    /* Command identifiers remain available as a fallback. */
  }
  return titles;
}
export async function importFile(
  file: string,
  support: string,
  assets: string,
  forcePrompt = false,
): Promise<HotkeyMap> {
  file = expandPath(file);
  const stamp = (await snapshot(dirname(file))).get(file);
  if (!stamp)
    throw new Error(
      "The selected .rayconfig file could not be found. Choose Import Export.",
    );
  const bytes = await readStableExport({ path: file, stamp }),
    helper = join(assets, "keychain-helper");
  let password = "",
    prompted = forcePrompt;
  try {
    if (forcePrompt) password = await promptExportPassword(helper);
    else {
      try {
        password = await getExportPassword(helper);
      } catch {
        password = await promptExportPassword(helper);
        prompted = true;
      }
    }
    const { payload } = await decodeExport(bytes, password);
    const map = await resolveAppAvailability(
      extractHotkeys(payload, file, await installedTitles()),
    );
    if (prompted) await saveExportPassword(password, helper);
    await atomicJSON(join(support, "hotkeys.json"), map);
    await atomicJSON(join(support, "config.json"), {
      file,
      directory: dirname(file),
    });
    return map;
  } finally {
    password = "";
    bytes.fill(0);
  }
}
