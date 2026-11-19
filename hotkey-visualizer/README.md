# Hotkey Visualizer

A local TypeScript Raycast extension, continued from the original draft in
`~/Documents/ChatGPT/Projects/raycast-hotkey-visualizer`.

## Validate an export

Requires macOS, Node.js 22.18+ (or newer with native TypeScript support), and Xcode
Command Line Tools. Dependencies are pinned in `package-lock.json`.

```sh
npm install
npm run setup -- --file '/absolute/path/to/export.rayconfig'
```

The setup command builds a small Swift helper, reads the export password from
macOS Keychain or presents an `NSSecureTextField`, authenticates and decrypts the
export, then saves a newly entered password only after successful decryption.
It does not put passwords in command arguments, preferences, environment variables,
or log messages. The password is stored under service
`dev.prithvi.hotkey-visualizer`, account `export-passphrase`. The helper can also
read Raycast's existing `Raycast` / `export_passphrase` item when accessible.

The ignored `validation.local.json` report contains format, category names,
structural types, and keyboard-code/modifier samples. It does not contain the
password or full decrypted configuration. Exports and diagnostic reports are
ignored by Git. Plaintext buffers are cleared where possible; JavaScript strings
and parsed objects are managed by the runtime and cannot be reliably zeroed.

## Validate the export automation

```sh
npm run setup -- --directory '/absolute/path/to/export-folder'
```

The validator snapshots the folder **before** opening Raycast's built-in
`raycast://extensions/raycast/raycast/export-settings-data` command. Confirm the
export yourself and save it in that folder. The watcher detects new files and
overwrites, ignores existing unchanged exports, and waits for file size,
modification time and inode to stabilize. It times out after five minutes.
Reading uses `O_NOFOLLOW`, a bounded allocation, and checks before and after the
read to reject symlinks or files that change mid-read.

## Format research

- [Tinycast's Raycast import documentation](https://github.com/abue-ammar/tinycast/blob/main/docs/features/raycast-import.md)
  documents modern `RAYCFG3` exports: an eight-byte signature, little-endian
  header length, gzip JSON header, AES-256-GCM ciphertext and a 16-byte tag.
  The key uses scrypt (`N=16384`, `r=8`, `p=1`, 32 bytes). The observed export
  nests its hex IV and salt under `encryption` in the header.
- [Chris Tippett's Export Explorer](https://raycast.christippett.dev/) and the
  [community export decoding discussion](https://gist.github.com/jeremy-code/50117d5b4f29e04fcbbb1f55e301b893)
  describe the older AES-CBC and gzip formats already supported by the draft.
  The export is never sent to these sites.
- [Raycast command lifecycle](https://developers.raycast.com/information/lifecycle)
  explains command unloading. A refresh must keep its watcher alive when
  switching to Raycast's built-in export command.
- [Raycast Detail](https://developers.raycast.com/api-reference/user-interface/detail)
  supports locally generated SVG illustrations for a keyboard view.

The decoder uses Node's built-in cryptography and zlib; no decoder package or
online decryptor is needed. Header and payload decompression are bounded.
GCM authentication is checked before parsing the modern export payload.
Legacy CBC exports have no authentication guarantee.

## Checks

```sh
npm test
npm run typecheck
```

Tests generate their own exports. Never commit a real export as a fixture.

## Keyboard visualization

After setup, Raycast provides **Visualize Hotkeys** and **Refresh Hotkey Export**.
Opening Visualize Hotkeys displays the saved map immediately, without an export
prompt. Press `⌘R` only when you want to refresh after changing shortcuts. The
view opens on your configured Hyper modifier combination and renders a shaded
SVG keyboard using native Raycast Detail. The canvas and unassigned keys are
transparent; assigned keys use a translucent red gradient. Labels and outlines
adapt to Raycast’s light or dark appearance. The action menu lets you switch
modifier layers, search commands, inspect assigned or available keys, import an
existing export, choose an export folder, or refresh.

- Red keys have active assignments; an amber outline marks multiple assignments
  on the same modifier layer. Disabled commands and disabled extensions are listed but
  do not occupy a key.
- The image uses a US ANSI QWERTY layout. Keys outside that layout remain in the
  searchable list. Command names are in Browse Keys and Search All Assignments.
  Keycaps display only their key labels, with assignment status shown by color. Installed extension manifests supply labels
  when their identifiers match; other identifiers are converted to readable text.
- “Unassigned” means absent from this Raycast export. Other apps and macOS can
  still register the same shortcut. Unreadable export entries produce a visible
  warning instead of silently implying complete coverage.
- Setup saves the encrypted export's path in ignored `assets/bootstrap.json` so
  first launch can find it. The extension itself saves only a projection of hotkey
  assignments, modifier settings, import time and source path in its support
  directory, plus generated SVGs. These files use owner-only permissions. The full
  export payload, clipboard history, tokens and other settings are never cached.
- Use **Unlock and Reimport Export** if the export password changes. It replaces
  the Keychain password only after successful decryption and parsing.

### Refresh workflow

Pressing `⌘R` in the keyboard view starts a no-view command that takes a folder
snapshot and opens
the built-in export command, and awaits the export watcher. Confirm the dialog,
use your export password, and save in the configured folder. New files and
replacements are detected automatically; successful import reopens the keyboard
and displays its result as an in-window toast. Completion does not show a HUD
that could close the view or reset navigation to Root Search.
Opening the visualizer always uses the saved map. A pending refresh times out
after five minutes. Each explicit refresh automatically replaces any pending refresh, so there is
no separate restart action or busy-refresh toast. A heartbeat lease recovers
within approximately 15 seconds if the watcher is interrupted. **Cancel Pending
Refresh** stops waiting without starting another export; an older watcher cannot
clear the lock of its replacement. The lock is released
before returning to the keyboard command, so command unloading cannot strand it. Importing an existing export also selects its parent folder for future
refreshes. Choosing another folder changes the watcher without moving any export.

### Local development

```sh
npm run dev
```

Setup runs this automatically once the visualization entry point exists. Raycast
registers both commands and opens the development UI. `npm run build` produces a
local `dist` directory without installing it. The pipeline and parser tests use
synthetic data. Real Keychain access, initial import, SVG rendering in Raycast,
and the complete export-dialog round trip must be checked on the Mac outside a
restricted execution sandbox.

### Export key formats

The parser handles both Raycast physical keys (`LayoutIndependent.code`, using
macOS virtual key codes) and character/control keys (`LayoutDependent.keyType`).
Parser caches use version 2 so the earlier incomplete map is reimported. If all
command shortcuts fail to parse, the launcher shortcut alone cannot make the
import succeed. Partial imports show unknown availability and do not advertise
free keys. Tests cover physical key code zero, Hyper combinations, control keys,
partial imports, and cache migration.

### Missing app entries and export cleanup

Raycast exports can retain shortcut records for applications that have been moved
or deleted. Each time a map is loaded or imported, application command paths are
checked. Missing applications are tagged **App missing** in Search All Assignments
and excluded from active key counts and conflict badges. Entries are retained
for inspection and become active again if the application returns to its saved
path. Non-application entries, such as Quicklinks, are not filtered by path.

After a manual refresh fully imports and saves a new export, older matching
timestamped exports in that folder are moved to macOS Trash. Only files that
existed before the refresh and stayed unchanged are eligible. The current export,
custom-named backups, other filename families, symlinks, and files that do not
start with the modern Raycast export signature are preserved. Cleanup is skipped
if import fails or produces parsing warnings. Trash failures do not discard the
new map and are reported in the result.

### If a refresh appears stuck

The watcher and the Save dialog must use the same folder. After moving an export,
use **Import Export** to select its new location; that also updates the watched
folder. Alternatively use **Choose Export Folder** before refreshing. If a pending
refresh is waiting for the wrong folder, update the folder and press `⌘R` again.
The same Refresh action cancels the existing watcher and starts a fresh export. Interrupted watchers release automatically after their
heartbeat expires; filesystem errors are reported separately from a busy watcher.
