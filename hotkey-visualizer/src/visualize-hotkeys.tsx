import {
  Action,
  ActionPanel,
  Detail,
  environment,
  Form,
  Icon,
  launchCommand,
  LaunchType,
  type LaunchProps,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import {
  importFile,
  loadConfig,
  readMap,
  atomicJSON,
  expandPath,
} from "./core/store.ts";
import {
  inLayer,
  keyLabel,
  layerId,
  layerLabel,
  MODIFIERS,
  shortcutLabel,
  type HotkeyMap,
  type Modifier,
} from "./core/hotkeys.ts";
import { availableKeys, KEYS, renderKeyboard } from "./core/keyboard.ts";

const md = (text: string) =>
  text.replace(/[\\`*_{}\[\]<>|]/g, "\\$&").replace(/[\r\n]/g, " ");
async function keyboardURL(map: HotkeyMap, layer: Modifier[], key?: string) {
  const svg = renderKeyboard(map, layer, key, environment.appearance),
    hash = createHash("sha256").update(svg).digest("hex").slice(0, 24);
  const dir = join(environment.supportPath, "keyboards");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${hash}.svg`);
  await writeFile(path, svg, { mode: 0o600 });
  return pathToFileURL(path).href;
}
function Layers({
  map,
  select,
}: {
  map: HotkeyMap;
  select: (m: Modifier[]) => void;
}) {
  const { pop } = useNavigation();
  const all = Array.from({ length: 16 }, (_, mask) =>
    MODIFIERS.slice(0, 4).filter((_, i) => mask & (1 << i)),
  );
  const unique = new Map(
    [map.hyper, ...map.bindings.map((b) => b.modifiers), ...all].map((m) => [
      layerId(m),
      m,
    ]),
  );
  return (
    <List searchBarPlaceholder="Choose a modifier combination">
      {[...unique.values()].map((layer) => (
        <List.Item
          key={layerId(layer) || "none"}
          title={`${layerId(layer) === layerId(map.hyper) ? "Hyper · " : ""}${layerLabel(layer)}`}
          subtitle={`${inLayer(map, layer).length} active bindings`}
          actions={
            <ActionPanel>
              <Action
                title="Show Layer"
                onAction={() => {
                  select(layer);
                  pop();
                }}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
function Browse({ map, layer }: { map: HotkeyMap; layer: Modifier[] }) {
  const [filter, setFilter] = useState("all");
  const bindings = inLayer(map, layer);
  const extras = bindings.filter((b) => !KEYS.some((k) => k.key === b.key));
  return (
    <List
      searchBarPlaceholder="Search keys and commands"
      searchBarAccessory={
        <List.Dropdown tooltip="Filter keys" onChange={setFilter}>
          <List.Dropdown.Item title="All Keys" value="all" />
          <List.Dropdown.Item title="Assigned" value="assigned" />
          {!map.warnings.length && (
            <List.Dropdown.Item title="Available" value="available" />
          )}
        </List.Dropdown>
      }
    >
      <List.Section title={`${layerLabel(layer)} · Keyboard keys`}>
        {KEYS.map((k) => {
          const found = bindings.filter((b) => b.key === k.key);
          if (
            (filter === "assigned" && !found.length) ||
            (filter === "available" && found.length)
          )
            return null;
          const label = found.length
            ? found.map((b) => b.title).join(" · ")
            : map.warnings.length
              ? "Not mapped; import is incomplete"
              : "Unassigned in this export";
          return (
            <List.Item
              key={k.key}
              icon={
                found.length > 1
                  ? Icon.Warning
                  : found.length
                    ? Icon.CheckCircle
                    : Icon.Circle
              }
              title={keyLabel(k.key)}
              subtitle={label}
              keywords={[k.key, ...found.map((b) => b.title)]}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="Inspect Key"
                    target={
                      <KeyboardView
                        map={map}
                        initialLayer={layer}
                        selected={k.key}
                      />
                    }
                  />
                  <Action.CopyToClipboard
                    title="Copy Shortcut"
                    content={`${layerLabel(layer)} ${keyLabel(k.key)}`}
                  />
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
      {filter !== "available" && (
        <List.Section title="Keys outside this layout">
          {extras.map((b) => (
            <List.Item key={b.id} title={shortcutLabel(b)} subtitle={b.title} />
          ))}
        </List.Section>
      )}
    </List>
  );
}
function AllBindings({ map }: { map: HotkeyMap }) {
  return (
    <List searchBarPlaceholder="Search all shortcut assignments">
      <List.Section title="Exported shortcuts">
        {map.bindings.map((b, i) => (
          <List.Item
            key={`${b.id}-${i}`}
            title={b.title}
            subtitle={b.extension}
            accessories={[
              { text: shortcutLabel(b) },
              ...(b.unavailableReason
                ? [{ tag: b.unavailableReason }]
                : !b.enabled
                  ? [{ tag: "Disabled" }]
                  : []),
            ]}
            keywords={[b.key, layerLabel(b.modifiers), b.extension]}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Show on Keyboard"
                  target={
                    <KeyboardView
                      map={map}
                      initialLayer={b.modifiers}
                      selected={b.key}
                    />
                  }
                />
                <Action.CopyToClipboard
                  title="Copy Shortcut"
                  content={shortcutLabel(b)}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
function ImportForm({
  onImport,
}: {
  onImport: (file: string, force?: boolean) => Promise<void>;
}) {
  const { pop } = useNavigation();
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Import Export"
            onSubmit={async (values: { files: string[] }) => {
              if (values.files?.[0]) {
                try {
                  await onImport(values.files[0]);
                  pop();
                } catch {
                  /* The import action already showed its error. */
                }
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Choose an encrypted .rayconfig export. Only hotkey assignments are cached; the password stays in Keychain." />
      <Form.FilePicker
        id="files"
        title="Raycast Export"
        allowMultipleSelection={false}
        canChooseDirectories={false}
      />
    </Form>
  );
}
function FolderForm() {
  const [folder, setFolder] = useState<string[]>([]);
  const { pop } = useNavigation();
  useEffect(() => {
    void loadConfig(environment.supportPath, environment.assetsPath).then((c) =>
      setFolder([c.directory]),
    );
  }, []);
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Export Folder"
            onSubmit={async () => {
              if (folder[0]) {
                const c = await loadConfig(
                  environment.supportPath,
                  environment.assetsPath,
                );
                await atomicJSON(join(environment.supportPath, "config.json"), {
                  ...c,
                  directory: expandPath(folder[0]),
                });
                pop();
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Refresh watches this folder. Select the same folder in Raycast's export dialog." />
      <Form.FilePicker
        id="folder"
        title="Export Folder"
        canChooseFiles={false}
        canChooseDirectories
        allowMultipleSelection={false}
        value={folder}
        onChange={setFolder}
      />
    </Form>
  );
}
function KeyboardView({
  map,
  initialLayer,
  selected,
  onImport,
}: {
  map: HotkeyMap;
  initialLayer: Modifier[];
  selected?: string;
  onImport?: (file: string, force?: boolean) => Promise<void>;
}) {
  const [layer, setLayer] = useState(initialLayer),
    [url, setURL] = useState(""),
    [imageError, setImageError] = useState("");
  useEffect(() => {
    let active = true;
    setURL("");
    void keyboardURL(map, layer, selected)
      .then((url) => {
        if (active) setURL(url);
      })
      .catch(() => {
        if (active) setImageError("Could not render keyboard image.");
      });
    return () => {
      active = false;
    };
  }, [map, layer, selected]);
  const bindings = inLayer(map, layer),
    found = selected ? bindings.filter((b) => b.key === selected) : [];
  const offLayout = bindings.filter((b) => !KEYS.some((k) => k.key === b.key));
  const lines = [
    url
      ? `![Keyboard map](${url}?raycast-width=750)`
      : imageError || "Rendering keyboard…",
  ];
  if (selected)
    lines.push(
      `## ${md(layerLabel(layer))} ${md(keyLabel(selected))}`,
      found.length
        ? found
            .map((b) => `- **${md(b.title)}** · ${md(b.extension)}`)
            .join("\n")
        : "Unassigned in this export.",
    );
  else
    lines.push(
      `**${md(layerId(layer) === layerId(map.hyper) ? "Hyper" : layerLabel(layer))}** · ${bindings.length} active assignments · Imported ${md(new Date(map.importedAt).toLocaleString())}`,
    );
  if (offLayout.length)
    lines.push(
      `${offLayout.length} assignments use keys outside this layout. Open Browse Keys to inspect them.`,
    );
  const missingApps = map.bindings.filter((b) => b.unavailableReason).length;
  if (missingApps)
    lines.push(
      `${missingApps} saved app shortcuts refer to missing apps and are excluded. See Search All Assignments for details.`,
    );
  if (map.warnings.length)
    lines.push(
      `**Import needs review:** ${map.warnings.length} shortcuts could not be read; availability may be incomplete.\n\n${map.warnings.map((w) => `- ${md(w)}`).join("\n")}`,
    );
  lines.push(
    "Unassigned means absent from this Raycast export. macOS and other apps may use the same combination.",
  );
  return (
    <Detail
      navigationTitle="Hotkey Visualizer"
      markdown={lines.join("\n\n")}
      isLoading={!url && !imageError}
      actions={
        <ActionPanel>
          <Action.Push
            title="Switch Modifier Layer"
            icon={Icon.Layers}
            target={<Layers map={map} select={setLayer} />}
          />
          <Action.Push
            title="Browse Keys"
            icon={Icon.MagnifyingGlass}
            target={<Browse map={map} layer={layer} />}
          />
          <Action.Push
            title="Search All Assignments"
            target={<AllBindings map={map} />}
          />
          <Action
            title="Refresh from Raycast Export"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={() =>
              launchCommand({
                name: "refresh-export",
                type: LaunchType.UserInitiated,
              })
            }
          />
          {onImport && (
            <Action.Push
              title="Import Export"
              icon={Icon.Download}
              target={<ImportForm onImport={onImport} />}
            />
          )}
          {onImport && (
            <Action
              title="Unlock and Reimport Export"
              onAction={async () => {
                try {
                  await onImport(map.source, true);
                } catch {}
              }}
            />
          )}
          <Action.Push
            title="Choose Export Folder"
            icon={Icon.Folder}
            target={<FolderForm />}
          />
          <Action.CopyToClipboard
            title={
              map.warnings.length
                ? "Copy Import Warning"
                : "Copy Available Keys"
            }
            content={
              map.warnings.length
                ? "Availability is unknown because some exported shortcuts could not be read."
                : availableKeys(map, layer)
                    .map((key) => `${layerLabel(layer)} ${keyLabel(key)}`)
                    .join("\n")
            }
          />
        </ActionPanel>
      }
    />
  );
}
type VisualizerContext = { refreshError?: string };
export default function VisualizeHotkeys(
  props: LaunchProps<{ launchContext: VisualizerContext }>,
) {
  const [map, setMap] = useState<HotkeyMap>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const doImport = async (file: string, force = false) => {
    setLoading(true);
    try {
      setMap(
        await importFile(
          file,
          environment.supportPath,
          environment.assetsPath,
          force,
        ),
      );
      setError("");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not import export.";
      setError(message);
      await showToast({
        style: Toast.Style.Failure,
        title: "Import failed",
        message,
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (props.launchContext?.refreshError)
          await showToast({
            style: Toast.Style.Failure,
            title: "Refresh did not finish",
            message: props.launchContext?.refreshError,
          });
        const cached = await readMap(environment.supportPath);
        if (cached) {
          if (alive) setMap(cached);
          return;
        }
        const c = await loadConfig(
          environment.supportPath,
          environment.assetsPath,
        );
        if (c.file) {
          const imported = await importFile(
            c.file,
            environment.supportPath,
            environment.assetsPath,
          );
          if (alive) setMap(imported);
        } else if (alive)
          setError("Import a .rayconfig export to get started.");
      } catch (error) {
        if (alive)
          setError(
            error instanceof Error ? error.message : "Could not load hotkeys.",
          );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  if (map)
    return (
      <KeyboardView
        key={map.importedAt}
        map={map}
        initialLayer={map.hyper}
        onImport={doImport}
      />
    );
  return (
    <Detail
      isLoading={loading}
      markdown={`# Hotkey Visualizer\n\n${md(error || "Loading saved keyboard map…")}\n\nChoose Import Export or Refresh from Raycast Export in the action menu.`}
      actions={
        <ActionPanel>
          <Action.Push
            title="Import Export"
            target={<ImportForm onImport={doImport} />}
          />
          <Action
            title="Unlock Export and Retry"
            onAction={async () => {
              try {
                const c = await loadConfig(
                  environment.supportPath,
                  environment.assetsPath,
                );
                if (c.file) await doImport(c.file, true);
                else
                  await showToast({
                    style: Toast.Style.Failure,
                    title: "Choose Import Export first",
                  });
              } catch {}
            }}
          />
          <Action
            title="Refresh from Raycast Export"
            onAction={() =>
              launchCommand({
                name: "refresh-export",
                type: LaunchType.UserInitiated,
              })
            }
          />
          <Action.Push title="Choose Export Folder" target={<FolderForm />} />
        </ActionPanel>
      }
    />
  );
}
