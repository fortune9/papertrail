# Linux desktop application

The first desktop target is Linux x64 with Debian-style package installation. The current preview produces a `.deb`; native Windows/macOS packaging is deferred. Shared indexing/search/database modules remain the same as the browser app, and `npm start` still runs that app independently.

## Source map

| File | Responsibility |
| --- | --- |
| [desktop/main.cjs](../../desktop/main.cjs) | Electron main process, window/session lifecycle, native dialogs, trusted IPC, assistant setup and shutdown |
| [desktop/preload.cjs](../../desktop/preload.cjs) | Narrow context-isolated bridge for folder selection, settings, sign-in, preferences and library import |
| [desktop/tools.js](../../desktop/tools.js), [desktop/tools.json](../../desktop/tools.json) | Existing Codex detection, checksum-pinned optional downloads, install state and missing-backend adapters |
| [desktop/security.js](../../desktop/security.js) | Main-frame IPC checks and allowed PDF-window URLs |
| [desktop/settings.js](../../desktop/settings.js) | Validated provider settings, encrypted key persistence and serialized preferences |
| [desktop/login.js](../../desktop/login.js) | Structured Codex app-server browser authentication |
| [desktop/library-import.js](../../desktop/library-import.js) | Consistent SQLite snapshots and installation of a staged library |
| [desktop/runtime.json](../../desktop/runtime.json) | Pinned Electron release and Linux x64 archive checksum |
| [desktop/smoke.mjs](../../desktop/smoke.mjs) | Packaged-runtime integration check without a global Node installation |

## Processes and private transport

Electron's main process owns SQLite, filesystem operations, both assistant SDKs and provider credentials. It starts the existing HTTP handler on `127.0.0.1` with an automatically assigned port. A random per-launch token is required for every desktop HTTP request, including assets. The Electron session injects it only for that private server; the token is not exposed through IPC, query parameters or API responses. Host/Origin validation and the existing restrictive CSP still apply.

The renderer has `nodeIntegration: false`, `contextIsolation: true` and `sandbox: true`. Its preload exposes specific actions, not arbitrary paths, shell commands, SDK requests or external URLs. Main-process IPC accepts only the main application frame, its webContents and the current server origin. Other frames/PDF viewers do not receive the preload bridge. New windows are limited to numeric indexed-paper PDF endpoints on the private origin; external navigation and webviews are blocked.

`startLocalServer()` in [src/server.js](../../src/server.js) provides the shared lifecycle. It closes HTTP connections, cancels assistants/imports and waits for an in-flight paper transaction before closing SQLite. Electron uses a ten-second exit fallback so an unresponsive native task cannot keep the app open forever. Single-instance handling focuses the existing window rather than opening two writers.

## Storage and settings

User data uses Electron's `app.getPath('userData')`, normally `~/.config/Papertrail`. The directory is restricted to its owner. The library is `library.sqlite`, OpenWorker state is `harness/`, and the desktop-specific Codex home is `codex/`. These files are outside installed program resources and survive upgrades. No database, key or cached login is embedded in an installer.

Provider settings contain model ID, HTTP(S) base URL and Responses/Chat Completions format. API credentials stay in main-process memory. Remembering a key requires Electron's asynchronous OS-backed `safeStorage`; only encrypted bytes are written to `settings.json`. If secure storage is unavailable, session-only keys are supported. Public settings report presence of a key, not its value. Saving a new configuration stops the old OpenWorker runtime and creates an agent/provider identity hashed from the endpoint/API/model, respecting immutable durable definitions. The browser version keeps its existing default identities.

Search choices and backend selection are saved to `preferences.json`. They are restored through the preload because an ephemeral HTTP port would otherwise give a different localStorage origin after each launch. Writes are serialized and atomic. `PAPERTRAIL_DESKTOP_DATA_DIR` is a development/test override; installed users use the normal application-data location.

## Native folder and PDF workflows

Add a folder uses Electron's native directory dialog, fills the existing import confirmation and runs the same recursive importer. The source/browser version retains manual paths. PDF links open in a separate Electron PDF viewer at the requested page; it has no Node integration or desktop bridge. This viewer still needs a graphical runtime check in the target environment.

An empty desktop library can import an existing Papertrail `library.sqlite`. The source is opened read-only, checked for the expected tables and SQLite integrity, then snapshotted through `node:sqlite.backup`, including committed WAL content. A staged copy is migrated/validated. After native confirmation, the empty desktop backend closes, its prior database is retained as `.before-import`, the snapshot is installed and the app relaunches. The source database, PDFs, and existing source-app credentials remain untouched. Nonempty desktop libraries cannot be replaced through this action.

## Optional AI tools and existing Codex

`ToolManager` starts with no network request. It checks versioned downloads under `userData/tools/`, then prefers a user-selected Codex executable, `CODEX_PATH`, PATH entries, `~/.local/bin/codex`, `/usr/local/bin/codex` and `/usr/bin/codex`. Each candidate must be executable and report exactly 0.169.0 with `--version` within ten seconds. Version probes use the allowlisted environment and Papertrail’s private Codex home, keeping provider credentials and terminal auth state separate. Other releases are deliberately not assumed compatible with the pinned SDK. A desktop launcher may have a different PATH from a terminal; the native executable picker handles additional locations. The selection is stored atomically in `userData/tools.json`. Existing tools are never copied, modified or uninstalled. The executable is reused, but authentication still uses Papertrail’s private Codex home.

Settings exposes Find existing Codex, Choose executable, Download Codex and Download OpenWorker. Downloads begin only after an explicit click and use [Electron `net.fetch`](https://www.electronjs.org/docs/latest/api/net#netfetchinput-init) with the system network/proxy configuration. The immutable Linux x64 manifest pins the official npm tarball URL, version and SHA-512 integrity from the lockfile. No npm command, package installation script or registry metadata lookup runs. Redirects are rejected. Streaming downloads are capped at 512 MiB, show byte progress and support cancellation. After checksum verification, archive paths are checked, system `tar` extracts into a private staging directory, and the executable/version is checked before moving into its versioned directory. Codex’s native vendor tree and notices remain together; OpenWorker retains its matching native package. Failed/cancelled downloads clean staging and never replace a global installation.

A missing component uses an unavailable-backend adapter, so startup, status, indexing and search never depend on native AI tools. The OpenWorker SDK is started only after its component is available and an explicit question is asked. Existing settings can be saved before installation. Download/detection/selection changes block new AI requests while the engines are replaced; search and indexing remain available. Shutdown cancels and awaits a download. Downloaded runtimes persist across app upgrades, outside `/opt/papertrail`, and a restart revalidates their versions. Interrupted staging directories are ignored; downloads can be retried. Downloading all backends later still uses their full disk space.

## ChatGPT sign-in

After detecting or downloading Codex, the app launches that executable’s `app-server --stdio` with its own Codex home, initializes the JSONL connection, and requests `account/login/start` with type `chatgpt`. It validates the returned authorization URL against HTTPS OpenAI/ChatGPT hosts and opens it through the OS browser. Completion arrives through `account/login/completed`. The app neither scrapes terminal output nor exchanges/copies auth tokens itself. Cancellation asks Codex to cancel the login and terminates this short-lived process; a five-minute limit also stops abandoned attempts.

The sign-in process is separate from the SDK process used for each answer. Successful completion refreshes the existing backend status check. The user's prior terminal Codex login is not reused or overwritten. An authorization URL is transiently exposed to the trusted renderer for a retry link; raw diagnostics/token responses are not shown or persisted by the bridge. See [Codex backend](codex.md) for answer streaming and model restrictions.

## Packaging and next platforms

The manual Electron packaging path copies the existing app rather than introducing another frontend framework. Electron and the small JavaScript SDKs are bundled outside ASAR. Native AI tools are excluded from the installer and configured on demand; npm and the Codex JavaScript CLI wrapper are excluded too. Poppler is a package-manager dependency, so installation can obtain it without asking users to install CLI tools separately. This is a dependency-resolving installer, not an offline all-dependencies archive. See [Linux releases](../operations/linux-release.md) for the build and test boundary.

Windows/macOS work can reuse the UI, bridge and service modules. They still need native runtime path/architecture selection, appropriate installers, OS credential/login validation and real target-machine tests. Signing/notarization and automatic updates are not implemented in the Linux preview. No cross-platform support is implied by the shared Electron code alone.
