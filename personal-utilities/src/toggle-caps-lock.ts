import { environment, closeMainWindow, showHUD } from "@raycast/api";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

export default async function Command() {
  const executable = join(
    environment.assetsPath,
    "toggle-caps-lock"
  );

  try {
    await execFileAsync(executable);
    await closeMainWindow();
  } catch (error) {
    console.error(error);
    await showHUD("Failed to toggle Caps Lock");
  }
}