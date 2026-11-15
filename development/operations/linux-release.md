# Building and checking the Linux installer

## Target and prerequisites

The preview targets Linux x64, initially Ubuntu 22.04+/Debian 12+ desktops. The `.deb` declares GTK/NSS/audio/graphics dependencies, OpenSSL 3, glibc 2.35+ and `poppler-utils`/`tar`. Package-manager installation resolves these system dependencies; an internet connection may be required. End users do not need Git, Node, npm or a global Codex installation. A normal desktop session is required for Chromium, the OS keyring and browser authentication.

Build on Linux x64 with Node 24+, Git, `unzip`, and `dpkg-deb` (`dpkg` package). Install source dependencies with `npm ci`; optional native packages must remain enabled. Poppler is also needed for tests. There is no Electron dev dependency installed by npm: the build helper downloads a pinned official runtime and verifies its committed SHA-256.

```bash
npm ci
npm test
npm run build:linux
npm run check:package
```

Output: `dist/papertrail_1.3.0_amd64.deb` (approximately 89 MiB in the development build, compared with 206 MiB before removing native AI tools). The root tree is staged in a temporary native Linux directory under `os.tmpdir()` and removed after the build. This avoids Debian control-directory permission failures in Windows-mounted checkouts. File modes are normalized to 0644, directory modes to 0755, with executable launchers and the sandbox helper set explicitly; the archive check rejects world-writable entries. If TMPDIR points to a Windows mount without Linux permissions, set it to a native Linux temporary directory before building. Build caches are under `.build/`; both directories are ignored by Git. `ELECTRON_ARCHIVE=/path/to/electron-v45.3.2-linux-x64.zip` uses an existing archive, still enforcing the pinned checksum. Developer preview uses `npm run desktop`; it downloads the same runtime when necessary. Do not disable Chromium's sandbox in a distributed launcher.

## What is packaged

[scripts/build-linux.mjs](../../scripts/build-linux.mjs) copies Electron 45.3.2 (embedded Node 24.22.2), application source/assets and only the OpenWorker/Codex JavaScript SDKs. Native AI executables, the Codex CLI wrapper and npm are excluded. The app detects a matching existing Codex or offers explicit checksum-pinned component downloads from Settings. See [optional tools](../architecture/desktop.md#optional-ai-tools-and-existing-codex). The Electron runtime (Chromium and embedded Node) remains necessary for the current architecture.

The package installs under `/opt/papertrail`, a launcher under `/usr/bin`, and a desktop entry/icon under `/usr/share`. `dpkg-deb --root-owner-group` records root ownership without requiring root during the build. The Chromium sandbox helper is recorded as root-owned/setuid for systems that need it. Installing the package requires the normal OS package-manager authorization; the app itself runs as the user.

Only an explicit source/SDK allowlist is copied. `.env`, databases, Git metadata, downloaded papers, credential stores and build caches are excluded. Electron/Chromium notices and Codex/OpenWorker license texts are included. Poppler remains distribution-managed and carries its own distro-provided license/source information. No cloud publication, system-wide installation or signing is performed by the build command.

## Automated package check

[scripts/check-package.mjs](../../scripts/check-package.mjs) checks Debian metadata, required dependencies, installed launch paths, Chromium helper ownership/mode, private-file exclusion and absence of native AI tools/npm. This is an archive inspection, not a graphical install test.

After extracting the `.deb` to a temporary directory with `dpkg-deb -x`, the packaged executable can run the integration check in Electron's Node mode:

```bash
ELECTRON_RUN_AS_NODE=1 /path/to/extracted/opt/papertrail/papertrail \
  /path/to/extracted/opt/papertrail/resources/app/desktop/smoke.mjs
```

This uses no global Node or Codex installation. It exercises embedded SQLite, missing-AI component state, and generated-PDF extraction/title/search/database reopening with no AI runtime installed. It uses temporary data and no live model request. Poppler must be available as declared by the package dependency.

## Qualification before public release

In a normal target desktop, install through the graphical package installer, launch from the application menu, select/index a folder, search complete words, enable Prefix search while typing a partial word, search a quoted phrase, inspect highlighted results and open a PDF without AI tools. Test matching existing Codex detection (including nvm and a desktop PATH without Node), native executable selection and full-path entry through hidden folders, missing/incompatible versions, both optional downloads, cancellation, network/checksum failure, installation-stage/activation progress and restart persistence. Confirm a running source server on port 3210 does not interfere with the desktop’s assigned port. Confirm no startup download and no changes to global executables. Test Settings with an available keyring and with session-only keys. Complete ChatGPT browser sign-in, ask a cited question and exercise Stop. Restart, import an existing library into an empty app, and install an updated package to confirm data/preferences are retained.

The restricted development session blocks Chromium sandbox initialization, so graphical installation, native dialogs, PDF viewing and full browser sign-in cannot be qualified there. Do not describe a successful component smoke check as a successful GUI release. Windows/macOS installers, arm64, automatic updates and distribution signing remain future platform work.
