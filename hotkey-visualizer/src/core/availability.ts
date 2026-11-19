import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { HotkeyMap } from "./hotkeys.ts";
const APP_PREFIX = "c:r:applications::*::application::=::";

/** The export retains commands for deleted/moved applications. Check their exact saved paths. */
export async function resolveAppAvailability(
  map: HotkeyMap,
): Promise<HotkeyMap> {
  const bindings = await Promise.all(
    map.bindings.map(async (original) => {
      const { unavailableReason: previousReason, ...binding } = original;
      if (!binding.id.startsWith(APP_PREFIX)) return binding;
      const path = binding.id.slice(APP_PREFIX.length);
      if (!isAbsolute(path) || !path.endsWith(".app")) return binding;
      try {
        if (!(await stat(path)).isDirectory())
          return { ...binding, unavailableReason: "App missing" };
      } catch (error) {
        // A permission failure does not prove the app is absent. Keep the binding occupied.
        if (
          ["ENOENT", "ENOTDIR"].includes(
            String((error as NodeJS.ErrnoException).code),
          )
        )
          return { ...binding, unavailableReason: "App missing" };
      }
      return binding;
    }),
  );
  return { ...map, bindings };
}
