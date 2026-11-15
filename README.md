# Papertrail

A local research paper library. Recursively import text-based PDFs, store extracted pages in SQLite, and search offline with ranked passages and links to the matching PDF page. The optional assistant uses the OpenWorker Harness SDK to answer questions from retrieved excerpts.

## Install the desktop app — Linux preview

The first desktop installer targets **Ubuntu/Debian Linux x64** (Ubuntu 22.04+ / Debian 12+ with a graphical desktop). Windows and macOS installers are not implemented yet. This is a preview build: packaged components are checked, but a normal desktop installation and complete graphical sign-in still need verification outside the restricted development session.

1. Download the provided `papertrail_1.3.0_amd64.deb` installer and open it with your system's graphical package installer.
2. Choose **Install**. It installs Papertrail with Electron and asks the package manager to install Poppler and desktop libraries. Codex, OpenWorker native tools and npm are not included in the base installer. An internet connection may be needed to obtain missing system dependencies. Git, npm and a separate Node/Codex installation are not needed by end users.
3. Open **Papertrail** from the applications menu.
4. Click **Add a folder**, choose your PDF directory and confirm **Index folder**.
5. AI is optional. Open **Settings → AI components**. Papertrail detects an existing Codex **0.169.0** executable on PATH and under nvm’s version folders. Use **Find existing Codex**, **Choose Codex executable…**, or paste its full path and click **Use this Codex path**. Linux file pickers may hide dot folders; pasting the path bypasses that limitation. npm-installed launchers are resolved to their native Codex executable, so the desktop app does not require Node on its PATH. If absent, click **Download Codex**. Other versions have not been qualified with the pinned SDK; the matching download can coexist with your installed version. Then select **Local Codex (ChatGPT)** and click **Sign in with ChatGPT**. Finish in your browser; no terminal, npm or API key is needed for this route.
6. For API/Ollama instead, click **Download OpenWorker** in Settings and save your provider configuration. Download only the backend you need.

**Settings** provides API/Ollama configuration and **Import an existing library**. API keys can be remembered with the desktop keyring; if secure storage is unavailable, leave Remember key unchecked to use a key for the current session only. Optional downloads require internet, show progress/cancellation, verify a pinned SHA-512 checksum and are stored under the application-data directory. No AI tool is downloaded at startup. Setup shows separate download, extraction, executable-check and connection stages; stalled transfers fail with a retry message after 60 seconds without data. Once OpenWorker is installed, set the model/provider below and save; downloading alone does not configure a model. Existing Codex installations are used in place and never replaced. Enabling AI adds its runtime disk usage later; the smaller installer does not reduce that backend’s eventual disk requirements. The installed app has its own Codex sign-in, separate from an existing terminal login, even when reusing the executable.

Desktop data is stored in the operating system's application-data directory (normally `~/.config/Papertrail` on Linux), shown in Settings. To bring an earlier web library across, select its `data/library.sqlite` while the desktop library is empty. The app snapshots the database, keeps the source untouched and restarts. Original PDFs must remain at their recorded paths. App updates preserve this user-data directory; uninstalling the program does not erase it.

A source/browser server on `http://127.0.0.1:3210` can run alongside the desktop app: the desktop uses a separate automatically assigned loopback port and its own data directory by default. Settings shows the desktop server address. Avoid deliberately configuring both versions to write the same database simultaneously.

There is no automatic updater in this preview. Install a newer `.deb` when supplied. No public binary release has been published by this development task; maintainers can produce the installer using [the Linux build guide](development/operations/linux-release.md).

## Run locally from source

This guide starts with a computer that has no development tools installed. You need an internet connection for setup, a terminal, **Git** to download the source, **Node.js 24** (which includes npm), and **Poppler** to read PDF text. Importing and searching then work offline. You do not need Python, Rust, Docker, a database server or an AI account.

### 1. Install Git and clone the repository

Open Terminal on macOS/Linux. On Windows, use Ubuntu under WSL as described below. Commands in Bash blocks run in that terminal; lines beginning with `#` are comments.

**Ubuntu/Debian:** install Git and the download tools:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
```

Enter your login password when `sudo` asks; the terminal may not display password characters.

**macOS:** install Apple's command-line tools, which include Git, and finish the installer before continuing:

```bash
xcode-select --install
```

See the [Git installation guide](https://git-scm.com/install/) for other operating systems or alternative installers.

**Windows:** the documented route uses [Microsoft WSL](https://learn.microsoft.com/en-us/windows/wsl/install). Open PowerShell as Administrator, run the following, then restart if prompted:

```powershell
wsl --install -d Ubuntu
```

Open **Ubuntu** from the Start menu, create its Linux username/password when prompted, and run the Ubuntu/Debian commands above. Perform the remaining installation and app commands inside Ubuntu, rather than mixing Windows and Linux versions of Node.

Now clone Papertrail into a new folder and enter it:

```bash
git clone https://github.com/fortune9/papertrail.git
cd papertrail
```

Cloning creates the `papertrail` directory under your terminal's current directory. If it already exists from an earlier clone, open that folder instead of cloning over it.

### 2. Install Node.js and Poppler

**Ubuntu/Debian and Windows WSL:** install Poppler's PDF utilities, then Node 24 using [nvm's official installation instructions](https://github.com/nvm-sh/nvm#installing-and-updating):

```bash
sudo apt install -y poppler-utils
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.41.0/install.sh -o /tmp/papertrail-install-nvm.sh
bash /tmp/papertrail-install-nvm.sh
```

Close and reopen the terminal after the installer finishes. Return to your cloned `papertrail` directory, then run:

```bash
nvm install 24
nvm use 24
nvm alias default 24
```

If `nvm` is not found, follow the installer's shell-profile instructions before continuing. Node's own [download page](https://nodejs.org/en/download) also provides installation choices; select version **24.x** for the version exercised by this project.

**macOS:** install the Node **24.x macOS Installer (.pkg)** from the [official Node.js download page](https://nodejs.org/en/download), following the installer prompts. Install [Homebrew](https://brew.sh/) by following its installation instructions, including its printed PATH setup steps. Then install [Poppler](https://formulae.brew.sh/formula/poppler):

```bash
brew install poppler
```

Open a new terminal if an installed command is not yet available. From the cloned project folder, verify the tools:

```bash
git --version
node --version
npm --version
pdftotext -v
```

Node should report `v24.x` (the app requires at least 24). The other commands should print version information. Only Linux x64 has been exercised in this development environment; the macOS instructions are provided but have not been tested here. Native Windows installation is not covered by this walkthrough.

### 3. Install the app and start it

From inside the cloned `papertrail` directory:

```bash
npm ci
npm start
```

`npm ci` installs the exact dependencies in the lockfile, including the native OpenWorker runtime. Keep optional dependencies enabled. Run it once after cloning, and again when an update changes dependencies. No `.env` file is needed for offline use.

Leave the terminal running. Open **http://127.0.0.1:3210** in your web browser. If the terminal reports that port 3210 is occupied, stop the other app or create `.env` with `PORT=3211`, restart, and use `http://127.0.0.1:3211`.

### 4. Add papers and use the app

Click **＋ Add a folder**, enter an absolute folder path on the machine running the app, and click **Index folder →**. For example:

| System | Example PDF folder |
| --- | --- |
| Linux | `/home/alex/Documents/Papers` |
| macOS | `/Users/alex/Documents/Papers` |
| Windows files accessed from WSL | `/mnt/c/Users/Alex/Documents/Papers` |

Replace these examples with your own folder path. Subfolders are included automatically; add more roots using the same button. Wait for import progress to finish, then search. PDFs remain in their original folders; extracted text and the search index are stored in the project's `data/` directory.

Stop the app with **Ctrl+C** in its terminal. To run it again, open a terminal, enter the same cloned project folder and run `npm start`. The index survives restarts. Use **Rescan folder** in the sidebar after adding or changing PDFs; no automatic folder watcher is installed.

## Use the library

- Use the checkboxes under search to choose **Case-insensitive**, **Prefix search**, **Fuzzy search**, and any combination of **Title**, **Abstract**, **Authors**, or **Full text**. Defaults are case-insensitive whole words, prefix and fuzzy off, title + full text. Choices persist in this browser (or in the desktop preferences). Unquoted words and quoted phrases are combined with OR across selected fields; selecting no fields returns no results.
- Enable **Prefix search** to keep papers visible while typing a word beginning: `p`, `perf`, and `perform` match `Performance`. Prefixes apply to unquoted words and respect the case checkbox. This can also match longer words/plurals; turn it off for strict whole words.
- Use **double quotes** for an exact token phrase: `"foundational model"` requires adjacent words in that order in one selected field/page. Unquoted `foundational model` still means either word. Quoted phrases respect the case setting and ignore prefix/fuzzy expansion. Punctuation separates tokens, so hyphens and spaces can separate phrase words. Paired curly quotes also work; an unfinished quote is treated as ordinary words while typing. Queries support up to 24 words; longer queries show an error.
- With prefix and fuzzy off, there is no stemming or prefix expansion: `transformer` does not match `transformation`, `transformed`, or `transformers`. Fuzzy search permits one insertion, deletion, substitution, or adjacent letter swap for words of five or more characters. Short words stay exact. Unchecking Case-insensitive enforces original letter case even with fuzzy on. This is keyword retrieval, not embedding-based semantic search.
- Matching words are highlighted in result titles and excerpts. Highlights follow selected fields and case/prefix/fuzzy rules. A prefix highlights the matching source word, and a quoted phrase highlights the whole matched phrase; fuzzy matches highlight the actual source spelling. Original PDFs are not modified.
- Open a result to inspect extracted text by page, or **Open PDF** to view its original file at the matching page. Your browser must support PDF viewing and page fragments.
- **Rescan folder** indexes new and modified PDFs and removes database entries for files no longer in a fully scanned folder. Originals are never edited. Unchanged files are skipped using size and modification time; failed files are retried.
- Stop an import after its current PDF. Scanned PDFs are marked **Needs OCR**. OCR is intentionally not included.
- Titles come from PDF metadata verified against opening page text, or from the PDF's page layout/text when metadata is missing or stale. Filenames are not used as titles; undetectable titles appear as **Untitled paper**. Extraction is heuristic, so open **Title, authors and abstract** in paper details to review or correct it. Saved corrections survive rescans. Authors and labeled abstracts/summaries are detected from the first three pages; missing fields do not match field-only searches. Publication years and DOIs are not parsed separately.

In the source/browser version, the database lives in `data/library.sqlite`; the desktop app uses its application-data directory. Both persist across restarts. Back up the appropriate directory while the app is stopped. PDFs remain at their original paths, so keep those files available. Symlinks are skipped. Extraction is limited to 100 MB per PDF, 32 MB of extracted output and 60 seconds per PDF; failures are shown per file. Imports run one at a time and must be restarted after a process restart. Duplicate files at distinct paths appear as separate papers. Search considers up to 4,000 ranked page matches and displays a capped count if reached.

## Optional AI assistant

Offline import and search require neither credentials nor a model. The **Answer with** selector in the companion panel offers two independent options. The source/browser version defaults to OpenWorker; the desktop defaults to Codex. Selecting Codex does not change your API/Ollama configuration.

### Local Codex with ChatGPT sign-in (source/browser version)

Install the branch's dependencies, then sign in using the bundled local Codex CLI:

```bash
npm ci
npm run codex:login
npm run codex:status
npm start
```

Complete the browser sign-in using your ChatGPT account. `codex:status` should report **Logged in using ChatGPT**. In Papertrail, select **Local Codex (ChatGPT)**, click **Check connection**, search for a topic and ask a question. If already running, restart the app after installing the new dependencies. An existing ChatGPT login can be reused; no `.env` or OpenAI API key is required for this option. This integration intentionally refuses API-key-only Codex authentication. Account eligibility and Codex usage limits still apply. See [Codex authentication](https://learn.chatgpt.com/docs/auth) and the [official SDK](https://learn.chatgpt.com/docs/codex-sdk).

The pinned `@openai/codex-sdk@0.169.0` controls a local Codex executable. `npm start` finds the matching CLI installed with it. To use a different installed executable, set `CODEX_PATH` to its path in `.env`; use that executable's `login`/`login status` commands with the same Codex home as the server. Authentication remains managed by Codex; Papertrail never copies or displays your login tokens.

Optional Codex settings: `AI_BACKEND=codex` changes the default selector, `CODEX_MODEL` selects an exact model available to your account (otherwise Codex uses its default), and `CODEX_TIMEOUT_MS` sets the answer timeout (1,000–600,000 ms; default 180,000). Browser selection is remembered and takes precedence over the default. After signing in, **Check connection** refreshes the cached login status. A status check confirms sign-in, not a successful model request.

Codex runs locally but calls OpenAI for inference. Only explicit questions send retrieved excerpts to it. Each question uses a fresh thread and a temporary working directory, requests read-only execution with tools/web search disabled, and streams the answer with the same source links and Stop button. Codex may store thread history under its own local home. Keep that home writable; a read-only execution session can allow login checks yet prevent answers.

### OpenWorker with an API provider or Ollama

The original option remains available. In the desktop app, download the OpenWorker component from Settings first; its model, URL, API format and key are configured there. For the source/browser version, if `.env` does not exist yet, create it:

```bash
cp .env.example .env
# Edit .env, then restart npm start.
```

For OpenAI, set `OPENAI_API_KEY` and `AI_MODEL` to an exact model ID available in your account. For Ollama, set `AI_BASE_URL=http://127.0.0.1:11434/v1`, `AI_API=chat-completions`, and `AI_MODEL` to an installed model ID; no OpenAI key is required.

Search with topic keywords, then ask a question in the companion panel. It receives up to six matching papers, with one page excerpt per paper (10,000 characters maximum each). If the search box is empty, the question supplies the search terms. Each question creates an isolated session. Answers stream with a Stop button and links to the source pages. Answers cover retrieved excerpts, not every page in the library, and model-written citations should be checked against those pages.

For the OpenWorker option, OpenWorker owns the model loop in its managed Rust subprocess. The pinned SDK is `@openworkerai/harness-sdk@0.1.0-beta.4`; its manifest selects matching native runtime packages at `0.1.0-beta.3`. These versions and the original agent definition are unchanged. Keep npm optional dependencies enabled. Credentials stay in the Node process and memory-only provider configuration. Retrieved excerpts are sent to your configured provider only when you ask a question. Harness session history, including excerpts and answers, persists in `data/harness/`. Use a local provider if you want all inference on your device.

The server binds to loopback only and checks the Host and Origin headers. This is a single-user local app; do not expose it to a network or put it behind a public proxy.

Configuration: `PORT` (default `3210`), `DATA_DIR` (default `./data`), and `PDFTOTEXT_PATH` (optional path to the executable) can also be set in `.env`.

## Implementation documentation

Start at [development/README.md](development/README.md) for the architecture, recursive indexing pipeline, database schema, search behavior, HTTP/UI and AI integration, and verification notes. Keep the affected documents updated alongside implementation changes, following [development/maintenance.md](development/maintenance.md).

Older databases automatically migrate to version 3 on startup. Paper IDs, extracted pages and saved metadata corrections are preserved. For an existing library, click **Rescan folder** once for each indexed folder to replace legacy filename titles with PDF-derived titles. For unchanged PDFs, this reads only the opening-page layout and updates the title index, without extracting all page text again. Later rescans skip unchanged papers as usual. Restart the app after updating the code.

## Verification

```bash
npm test
```

Tests exercise recursive extraction, PDF title metadata/layout/text fallbacks, matching page numbers, corrupt and blank PDFs, symlink exclusion, rescans, changed/deleted files, restart persistence, cancellation, local HTTP guards, UI serving, literal/case/fuzzy/field search options, metadata corrections and version-0/version-1/version-2 migration, and assistant streaming/error/cancellation control with deterministic fixtures. These fixtures do not establish live model answer quality.

Extraction was checked against a seven-paper, 150-page sample library, including unchanged rescans and PDF-derived titles. OpenWorker's installed Linux x64 runtime was started, configured, used to register an agent and create a session, shut down, and restarted against the same state directory. The execution sandbox disallows listening on local sockets, so a browser preview and full HTTP/live-model end-to-end run could not be exercised in this session. The first-time operating-system installers above were checked against their linked documentation, not executed on a clean machine here.

The Codex feature adds real-SDK subprocess tests using a deterministic POSIX CLI fixture for answer streaming, terminal failures, cancellation, timeout, restrictions and backend routing. Local Codex 0.169.0 confirmed an existing ChatGPT login. A live synthetic-question attempt stopped before inference because this development session made Codex state read-only. Live answer quality and browser rendering remain unverified; use the steps above in a normal local terminal to complete that check.
