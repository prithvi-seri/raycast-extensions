import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = "swift/Keychain.swift";
const output = "assets/keychain-helper";
try { if (statSync(output).mtimeMs > statSync(source).mtimeMs) process.exit(0); } catch {}
const cache = join(tmpdir(), "hotkey-visualizer-swift-cache");
mkdirSync(cache, { recursive: true });
mkdirSync("assets", { recursive: true });
execFileSync("/usr/bin/swiftc", ["-O", "-module-cache-path", cache, source, "-o", output], {
  stdio: "inherit", env: { ...process.env, CLANG_MODULE_CACHE_PATH: cache },
});
