import {
  environment,
  launchCommand,
  LaunchType,
  open,
  showHUD,
  trash,
} from "@raycast/api";
import { mkdir, open as openFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { trashOlderExports } from "./core/cleanup.ts";
import { loadConfig, importFile } from "./core/store.ts";
import { snapshot, waitForExport, EXPORT_DEEPLINK } from "./core/export.ts";

/** A no-view command awaits the whole workflow so opening Export cannot unload a view's watcher. */
export default async function RefreshExport() {
  const support = environment.supportPath,
    assets = environment.assetsPath;
  await mkdir(support, { recursive: true, mode: 0o700 });
  const lock = join(support, "refresh.lock");
  let owned = false;
  try {
    // Remove only a stale lock left by an interrupted watcher.
    try {
      const started = Number(await readFile(lock, "utf8"));
      if (Number.isFinite(started) && Date.now() - started > 360_000)
        await rm(lock, { force: true });
    } catch {}
    try {
      const handle = await openFile(lock, "wx", 0o600);
      owned = true;
      try {
        await handle.writeFile(String(Date.now()));
      } finally {
        await handle.close();
      }
    } catch {
      await showHUD("A refresh is already waiting; showing the saved map.");
      await launchCommand({
        name: "visualize-hotkeys",
        type: LaunchType.UserInitiated,
      });
      return;
    }
    const config = await loadConfig(support, assets);
    await mkdir(config.directory, { recursive: true });
    const baseline = await snapshot(config.directory);
    await showHUD(`Save the Raycast export in ${config.directory}`);
    await open(EXPORT_DEEPLINK);
    const candidate = await waitForExport(config.directory, baseline);
    const map = await importFile(candidate.path, support, assets);
    const cleanup = map.warnings.length
      ? { removed: 0, failed: 0 }
      : await trashOlderExports(candidate, baseline, trash).catch(() => ({
          removed: 0,
          failed: 1,
        }));
    await showHUD(
      `Imported ${map.bindings.length} hotkeys${map.warnings.length ? " · Some shortcuts need review" : ""}${cleanup.removed ? ` · ${cleanup.removed} older exports moved to Trash` : ""}${cleanup.failed ? " · Some older exports could not be moved to Trash" : ""}`,
    );
    await launchCommand({
      name: "visualize-hotkeys",
      type: LaunchType.UserInitiated,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Export refresh failed.";
    await showHUD(message);
    await launchCommand({
      name: "visualize-hotkeys",
      type: LaunchType.UserInitiated,
      context: { refreshError: message },
    });
  } finally {
    if (owned) await rm(lock, { force: true });
  }
}
