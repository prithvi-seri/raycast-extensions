import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
execFileSync(process.execPath, ["scripts/build-helper.mjs"], { stdio: "inherit" });
const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage: npm run setup -- --file /path/to/export.rayconfig, or --directory /path/to/export-folder");
  process.exit(1);
}
execFileSync(process.execPath, ["scripts/validate.ts", ...args], { stdio: "inherit" });
console.log("Export validated. Your password is saved in macOS Keychain; only structural diagnostics were written.");
if (existsSync("src/visualize-hotkeys.tsx")) {
  execFileSync(process.execPath, ["node_modules/@raycast/api/bin/run.js", "develop"], { stdio: "inherit" });
}
