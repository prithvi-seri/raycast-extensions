import {
  environment,
  launchCommand,
  LaunchType,
  PopToRootType,
  open,
  showHUD,
  trash,
} from "@raycast/api";
import {
  acquireRefreshLease,
  RefreshCancelled,
  type RefreshLease,
} from "./core/refresh-lock.ts";
import { trashOlderExports } from "./core/cleanup.ts";
import { mkdir } from "node:fs/promises";
import { loadConfig, importFile } from "./core/store.ts";
import { snapshot, waitForExport, EXPORT_DEEPLINK } from "./core/export.ts";

/** A no-view command awaits the whole workflow so opening Export cannot unload a view's watcher. */
export default async function RefreshExport() {
  const support = environment.supportPath,
    assets = environment.assetsPath;
  let lease: RefreshLease | undefined;
  try {
    // An explicit refresh always replaces the previous waiter, including one watching an old folder.
    lease = await acquireRefreshLease(support, { replaceActive: true });
    if (!lease) throw new RefreshCancelled();
    const config = await loadConfig(support, assets);
    await mkdir(config.directory, { recursive: true });
    const baseline = await snapshot(config.directory);
    await lease.check();
    await showHUD(`Save the Raycast export in ${config.directory}`, {
      popToRootType: PopToRootType.Suspended,
    });
    await lease.check();
    await open(EXPORT_DEEPLINK);
    const candidate = await waitForExport(config.directory, baseline, {
      signal: lease.signal,
      check: lease.check,
    });
    await lease.check();
    const map = await importFile(
      candidate.path,
      support,
      assets,
      false,
      lease.signal,
    );
    await lease.check();
    const cleanup = map.warnings.length
      ? { removed: 0, failed: 0 }
      : await trashOlderExports(candidate, baseline, trash, {
          check: lease.check,
        }).catch(() => ({
          removed: 0,
          failed: 1,
        }));
    await lease.check();
    // Switching commands may unload this command before its finally block can finish.
    await lease.release();
    const message = `Imported ${map.bindings.length} hotkeys${map.warnings.length ? " · Some shortcuts need review" : ""}${cleanup.removed ? ` · ${cleanup.removed} older exports moved to Trash` : ""}${cleanup.failed ? " · Some older exports could not be moved to Trash" : ""}`;
    // Completion feedback belongs to the reopened view. A HUD here would close it or reset navigation.
    await launchCommand({
      name: "visualize-hotkeys",
      type: LaunchType.UserInitiated,
      context: {
        refreshNotice: { kind: "success", title: "Hotkeys refreshed", message },
      },
    });
  } catch (error) {
    if (
      error instanceof RefreshCancelled ||
      lease?.signal.reason instanceof RefreshCancelled
    )
      return;
    const message =
      error instanceof Error ? error.message : "Export refresh failed.";
    await lease?.release();
    await launchCommand({
      name: "visualize-hotkeys",
      type: LaunchType.UserInitiated,
      context: { refreshError: message },
    });
  } finally {
    await lease?.release();
  }
}
