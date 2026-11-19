import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { extractHotkeys, inLayer } from "../src/core/hotkeys.ts";
import { decodeExport } from "../src/core/decode.ts";
import {
  getExportPassword,
  promptExportPassword,
  saveExportPassword,
} from "../src/core/keychain.ts";
import {
  snapshot,
  waitForExport,
  readStableExport,
  EXPORT_DEEPLINK,
} from "../src/core/export.ts";

const exec = promisify(execFile);

async function main() {
  const fileIndex = process.argv.indexOf("--file");
  const directoryIndex = process.argv.indexOf("--directory");
  const directory = resolve(
    directoryIndex >= 0 ? process.argv[directoryIndex + 1] : "exports",
  );
  let candidate;
  if (fileIndex >= 0) {
    const file = resolve(process.argv[fileIndex + 1]);
    const { dirname } = await import("node:path");
    const files = await snapshot(dirname(file));
    const stamp = files.get(file);
    if (!stamp)
      throw new Error("The selected .rayconfig file could not be found.");
    candidate = { path: file, stamp };
  } else {
    const baseline = await snapshot(directory);
    console.log(`Confirm Raycast's export and save it in: ${directory}`);
    await exec("/usr/bin/open", [EXPORT_DEEPLINK]);
    candidate = await waitForExport(directory, baseline);
  }
  const bytes = await readStableExport(candidate);
  try {
    let password: string;
    let prompted = false;
    try {
      password = await getExportPassword();
    } catch {
      password = await promptExportPassword();
      prompted = true;
    }
    const { format, payload } = await decodeExport(bytes, password);
    const hotkeys = extractHotkeys(payload, candidate.path);
    if (prompted) await saveExportPassword(password);
    password = "";
    await mkdir("assets", { recursive: true });
    await writeFile(
      "assets/bootstrap.json",
      JSON.stringify({
        file: candidate.path,
        directory: (await import("node:path")).dirname(candidate.path),
      }),
      { mode: 0o600 },
    );
    // Print structure only. Never dump exports, preferences, or password errors.
    console.log(
      JSON.stringify(
        {
          validated: true,
          format,
          bytes: bytes.length,
          categories: Object.keys(payload),
          hotkeys: hotkeys.bindings.length,
          hyperHotkeys: inLayer(hotkeys, hotkeys.hyper).length,
          unreadableHotkeys: hotkeys.warnings.length,
        },
        null,
        2,
      ),
    );
    const shape = (value: unknown, depth = 0): unknown => {
      if (value === null) return "null";
      if (Array.isArray(value))
        return {
          array: value.length,
          example: depth < 9 ? shape(value[0], depth + 1) : "…",
        };
      if (typeof value === "object" && value && depth < 9) {
        return Object.fromEntries(
          Object.entries(value)
            .slice(0, 80)
            .map(([key, child]) => [key, shape(child, depth + 1)]),
        );
      }
      return typeof value;
    };
    const hotkeySamples: unknown[] = [];
    const walk = (value: unknown, path: string, depth: number) => {
      if (!value || typeof value !== "object" || depth > 6) return;
      for (const [key, child] of Object.entries(value)) {
        if (/hotkey|shortcut/i.test(key)) {
          console.log(
            JSON.stringify({
              path: `${path}.${key}`,
              type: Array.isArray(child) ? "array" : typeof child,
              count:
                child && typeof child === "object"
                  ? Object.keys(child).length
                  : undefined,
            }),
          );
        }
        if (key === "keyCode" || key === "modifiers")
          hotkeySamples.push({ path: `${path}.${key}`, value: child });
        walk(child, `${path}.${key}`, depth + 1);
      }
    };
    walk(payload.settings ?? payload, "settings", 0);
    await writeFile(
      "validation.local.json",
      JSON.stringify(
        {
          validated: true,
          validatedAt: new Date().toISOString(),
          file: candidate.path,
          format,
          bytes: bytes.length,
          categories: Object.keys(payload),
          settingsShape: shape(payload.settings ?? payload),
          hotkeySamples: hotkeySamples.slice(0, 100),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  } finally {
    bytes.fill(0);
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Export validation failed.",
  );
  process.exitCode = 1;
});
