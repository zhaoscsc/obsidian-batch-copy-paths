# Batch Copy Names and Paths

Copy the names, vault-relative paths, absolute paths, wiki links, Markdown links, and Obsidian URIs of multiple selected notes to the clipboard in one go.

Obsidian's file explorer has no copy action for a multi-selection: right-click a selection and the context menu offers only *New folder* and *Delete*. The native *Copy current file path* commands act on the active note only. This plugin fills that gap.

## Installation

**From Obsidian (once listed in the community directory)**

Open this link, or search for *Batch Copy Names and Paths* under **Settings → Community plugins → Browse**:

```
obsidian://show-plugin?id=batch-copy-paths
```

**Manually**

Download `main.js` and `manifest.json` from the [latest release](https://github.com/zhaoscsc/obsidian-batch-copy-paths/releases/latest) into `<vault>/.obsidian/plugins/batch-copy-paths/`, then enable the plugin under **Settings → Community plugins**.

**With BRAT**

Add `zhaoscsc/obsidian-batch-copy-paths` as a beta plugin.

## Usage

1. In the file explorer, **Option-click** (macOS) or **Alt-click** (Windows/Linux) to select individual notes, or **Shift-click** to select a range.
2. Right-click any item **inside the selection**.
3. Pick a format. Each item is copied on its own line by default.

| Format | Example |
| --- | --- |
| Vault-relative path | `Notes/meeting-notes.md` |
| Note name | `meeting-notes` |
| File name | `meeting-notes.md` |
| Absolute path | `/Users/you/Vault/Notes/meeting-notes.md` |
| `file://` URL | `file:///Users/you/Vault/Notes/meeting-notes.md` |
| Wiki link | `[[meeting-notes]]` |
| Markdown link | `[meeting-notes](Notes/meeting-notes.md)` |
| `obsidian://` URI | `obsidian://open?vault=Vault&file=Notes%2Fmeeting-notes.md` |

Right-clicking an item that is *not* part of the selection falls back to Obsidian's single-file menu, so only that one item is copied. That is native behaviour.

## Folders

Folders deliberately do not get these options. If the selection contains no files at all, no menu entries are added. In a mixed selection, folders are filtered out — see *Skip folders* below.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Menu layout | Flat | Show every format directly, or nest them under one *Batch copy* submenu. |
| Show item count | On | Append `(N items)` to the menu labels. |
| Formats | Vault-relative path, note name, absolute path | Which formats appear in the context menu. |
| Separator | New line | Also comma, ideographic comma, space, or custom. |
| Sort | Selection order | Or by name, or by path (Chinese collation aware). |
| Skip folders | On | Drop folders from mixed selections. |
| Normalize to NFC | On | Avoids the macOS NFD/NFC mismatch on non-ASCII filenames. |
| Show notice | On | Confirm after copying. |

This plugin registers **no command palette commands**. Everything lives in the file explorer context menu.

## Requirements

- Obsidian **1.4.10** or later (`files-menu`, the event for a multi-selection context menu, was added in that version).
- Desktop only. Copying uses Electron's clipboard, which keeps working when the window is not focused.

## Implementation notes

- The selection is read from the file explorer's internal `tree.selectedDoms` set, falling back to a DOM query. Cost stays proportional to the selection rather than to the vault size, and rows scrolled out of view are still included.
- Absolute paths come from `adapter.getFullPath()`, not from string-concatenating `basePath`.
- `tree.selectedDoms` and `MenuItem.setSubmenu()` are not part of the public API. Both are feature-detected, and the plugin degrades gracefully (DOM fallback, flat menu) if they change.
- No network access, no telemetry.

## Privacy

Everything happens locally. The plugin makes no network requests and collects no telemetry, and it does not read your notes. Its only interaction outside Obsidian is writing to the system clipboard, which is the entire point of the plugin: it writes only the strings you explicitly asked it to copy, and it never reads existing clipboard contents.

## Known limitations

- **Settings are not indexed by settings search on Obsidian 1.13.0 and later.** The settings tab uses the classic `display()` API, so it does not implement the declarative `getSettingDefinitions()` API that search relies on. Adopting it requires Obsidian 1.13.0+, which is above this plugin's `minAppVersion` (1.4.10), and would mean maintaining a second representation of the same settings that cannot yet be tested against a real host. Deferred until 1.13.x is a stable baseline; the settings tab itself works normally.

## Development

```bash
npm install
npm run build       # builds main.js into the repository root
npm run typecheck
```

Set `VAULT` to also deploy the build into a vault for local testing:

```bash
VAULT="/path/to/vault" npm run deploy
```

`main.js` is a build artifact and is **not committed**. It is attached to each GitHub release, which is what Obsidian downloads.

Source layout:

```
main.ts      plugin entry: event wiring, menu construction
formats.ts   format registry — a new format is one entry here
settings.ts  settings type, defaults, and the settings tab
```

## License

MIT. See [LICENSE](LICENSE).

---

## 中文速览

在文件列表里 **Option/Shift 多选笔记** → 在选中范围内右键 → 一次性把所有选中项的名称或路径复制到剪贴板。

- **8 种格式**：相对路径、笔记名、文件名、绝对路径、`file://` 链接、双链、Markdown 链接、Obsidian URI
- **文件夹不出这些选项**：选中集里没有文件时整个菜单不挂条目；混选时文件夹按设置被过滤
- **不注册任何命令面板命令**，功能只在右键菜单里
- **它的用途**：以前要让 AI 处理一批笔记得挨个复制文件名/路径，现在多选一次拿到整批清单，粘给 AI 就能让它调子 agent 批量并行处理——本质是「人 → AI 的批量接口」
- 仅桌面端，需要 Obsidian 1.4.10+；无联网、无遥测
