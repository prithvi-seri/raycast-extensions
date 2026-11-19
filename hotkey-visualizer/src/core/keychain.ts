import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const exec = promisify(execFile);
const defaultHelper = resolve("assets/keychain-helper");

/** Read Raycast's existing export secret directly into memory; never log stdout. */
export async function getExportPassword(helper = defaultHelper): Promise<string> {
  try {
    const { stdout } = await exec(helper, ["get"], { encoding: "utf8", maxBuffer: 64 * 1024 });
    return stdout;
  } catch {
    throw new Error("No accessible export password in macOS Keychain. Use Unlock Export to enter it securely.");
  }
}

export async function promptExportPassword(helper = defaultHelper): Promise<string> {
  try {
    const { stdout } = await exec(helper, ["prompt"], { encoding: "utf8", maxBuffer: 64 * 1024 });
    return stdout;
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 2) throw new Error("Export unlock canceled.");
    throw new Error("Could not display the secure password prompt. Run setup in macOS Terminal, outside the execution sandbox.");
  }
}

/** Secrets travel through pipes, never shell strings, argv, preferences, or logs. */
export async function saveExportPassword(password: string, helper = defaultHelper): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(helper, ["set"], { stdio: ["pipe", "ignore", "ignore"] });
    child.once("error", () => reject(new Error("Could not start the Keychain helper.")));
    child.stdin.on("error", () => reject(new Error("Could not send the password to Keychain.")));
    child.once("exit", code => code === 0 ? resolve() : reject(new Error("Could not save the password in macOS Keychain.")));
    child.stdin.end(password);
  });
}

export async function forgetExportPassword(helper = defaultHelper): Promise<void> {
  try { await exec(helper, ["delete"]); }
  catch { throw new Error("Could not remove the saved export password."); }
}
