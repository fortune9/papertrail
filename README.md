# Papertrail

A local research paper library. Recursively import text-based PDFs, store extracted pages in SQLite, and search offline with ranked passages and links to the matching PDF page. The optional assistant uses the OpenWorker Harness SDK to answer questions from retrieved excerpts.

## Run locally

Requires **Node.js 24+** and **Poppler** (`pdftotext` on PATH).

```bash
# Ubuntu / Debian
sudo apt install poppler-utils
# macOS: brew install poppler

npm ci
npm start
```

Open **http://127.0.0.1:3210**. Click **Add a folder** and paste a folder path. Subfolders are included automatically. For this machine, the test library is:

```text
/mnt/windows/Data/Literature_and_book/Cancer/cfDNA
```

On WSL, use paths like `/mnt/c/Users/you/Papers`. On Windows, install Poppler and use the path as seen by Node, such as `C:\Users\you\Papers`. Linux x64 is the exercised runtime platform; other platforms have not been tested here.

## Use the library

- Use the checkboxes under search to choose **Case-insensitive**, **Fuzzy search**, and any combination of **Title**, **Abstract**, **Authors**, or **Full text**. Defaults are case-insensitive whole words, fuzzy off, title + full text. Choices persist in this browser. Selected fields and multiple query terms use OR; selecting no fields returns no results.
- With fuzzy off, there is no stemming or prefix expansion: `transformer` does not match `transformation`, `transformed`, or `transformers`. Fuzzy search permits one insertion, deletion, substitution, or adjacent letter swap for words of five or more characters. Short words stay exact. Unchecking Case-insensitive enforces original letter case even with fuzzy on. This is keyword retrieval, not embedding-based semantic search.
- Matching words are highlighted in result titles and excerpts. Highlights follow the selected fields, case setting and fuzzy spelling rules; fuzzy matches highlight the actual source spelling. Original PDFs are not modified.
- Open a result to inspect extracted text by page, or **Open PDF** to view its original file at the matching page. Your browser must support PDF viewing and page fragments.
- **Rescan folder** indexes new and modified PDFs and removes database entries for files no longer in a fully scanned folder. Originals are never edited. Unchanged files are skipped using size and modification time; failed files are retried.
- Stop an import after its current PDF. Scanned PDFs are marked **Needs OCR**. OCR is intentionally not included.
- Titles come from filenames. Authors and labeled abstracts/summaries are detected heuristically from the first three pages; detection may miss text or include incomplete bylines. Open a paper's **Authors and abstract** section to review and save corrections, which survive rescans. Missing fields do not match field-only searches. Publication years and DOIs are not parsed separately.

The database lives in `data/library.sqlite` and persists across restarts. Back up the `data/` directory while the app is stopped. PDFs remain at their original paths, so keep those files available. Symlinks are skipped. Extraction is limited to 100 MB per PDF, 32 MB of extracted output and 60 seconds per PDF; failures are shown per file. Imports run one at a time and must be restarted after a process restart. Duplicate files at distinct paths appear as separate papers. Search considers up to 4,000 ranked page matches and displays a capped count if reached.

## Optional AI assistant

Offline import and search require neither credentials nor a model. To enable the assistant:

```bash
cp .env.example .env
# Edit .env, then restart npm start.
```

For OpenAI, set `OPENAI_API_KEY` and `AI_MODEL` to an exact model ID available in your account. For Ollama, set `AI_BASE_URL=http://127.0.0.1:11434/v1`, `AI_API=chat-completions`, and `AI_MODEL` to an installed model ID; no OpenAI key is required.

Search with topic keywords, then ask a question in the companion panel. It receives up to six matching papers, with one page excerpt per paper (10,000 characters maximum each). If the search box is empty, the question supplies the search terms. Each question creates an isolated session. Answers stream with a Stop button and links to the source pages. Answers cover retrieved excerpts, not every page in the library, and model-written citations should be checked against those pages.

OpenWorker owns the model loop in its managed Rust subprocess. The pinned SDK is `@openworkerai/harness-sdk@0.1.0-beta.4`; its manifest selects matching native runtime packages at `0.1.0-beta.3`. Keep npm optional dependencies enabled. Credentials stay in the Node process and memory-only provider configuration. Retrieved excerpts are sent to your configured provider only when you ask a question. Harness session history, including excerpts and answers, persists in `data/harness/`. Use a local provider if you want all inference on your device.

The server binds to loopback only and checks the Host and Origin headers. This is a single-user local app; do not expose it to a network or put it behind a public proxy.

Configuration: `PORT` (default `3210`), `DATA_DIR` (default `./data`), and `PDFTOTEXT_PATH` (optional path to the executable) can also be set in `.env`.

## Implementation documentation

Start at [development/README.md](development/README.md) for the architecture, recursive indexing pipeline, database schema, search behavior, HTTP/UI and AI integration, and verification notes. Keep the affected documents updated alongside implementation changes, following [development/maintenance.md](development/maintenance.md).

Older databases automatically migrate to version 2 on startup, backfilling author/abstract fields from stored pages and rebuilding the search index. Paper IDs and extracted pages are preserved; no PDF reimport is needed. Restart the app after updating the code.

## Verification

```bash
npm test
```

Tests exercise recursive extraction, matching page numbers, corrupt and blank PDFs, symlink exclusion, rescans, changed/deleted files, restart persistence, cancellation, local HTTP guards, UI serving, literal/case/fuzzy/field search options, metadata corrections and version-0/version-1 migration, and assistant streaming/error/cancellation control with deterministic fixtures. These fixtures do not establish live model answer quality.

The supplied cfDNA directory was imported successfully: **7 PDFs, 150 pages**, with no extraction errors. A second scan skipped all seven unchanged PDFs. OpenWorker's installed Linux x64 runtime was started, configured, used to register an agent and create a session, shut down, and restarted against the same state directory. The execution sandbox disallows listening on local sockets, so a browser preview and full HTTP/live-model end-to-end run could not be exercised in this session. Run `npm start` in your local terminal to use the app.
