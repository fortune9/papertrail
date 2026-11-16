# Running and verification

## Local execution

The root [README](../../README.md#run-locally-from-source) covers installing Git and cloning, Node 24, Poppler, dependencies, first launch and adding folders for the source/browser version. Its separate Linux desktop section covers installing the provided `.deb` and graphical setup. Fresh OS installation and macOS/Windows runtime behavior have not been exercised here. With source tools installed, run `npm ci` and `npm start` from the cloned project and visit `http://127.0.0.1:3210`.

| Variable | Meaning |
| --- | --- |
| `PORT` | Local HTTP port; default 3210 |
| `DATA_DIR` | Database/state directory; default project `data/` |
| `PDFTOTEXT_PATH` | Alternate path to the Poppler executable |
| `AI_MODEL` | Exact model ID; required to enable AI |
| `OPENAI_API_KEY` | Optional provider secret; required for default OpenAI endpoint |
| `AI_BASE_URL` | Custom compatible provider endpoint, e.g. local Ollama |
| `AI_API` | Provider API override; defaults to Responses or Chat Completions according to endpoint configuration |
| `AI_BACKEND` | Initial assistant selection: `openworker` (default) or `codex`; explicit browser selection takes precedence |
| `CODEX_PATH` | Local Codex executable; default `codex` found through npm's PATH |
| `CODEX_MODEL` | Optional exact Codex model ID; otherwise uses Codex's configured/default model |
| `CODEX_TIMEOUT_MS` | Codex answer timeout; default 180,000, allowed 1,000–600,000 |

`npm start` loads `.env` from the current working directory. Restart after changing code or configuration; there is no development hot-reload server.

## Automated checks

Run `npm test`. The suite uses Node's test runner with `--test-isolation=none`, generated minimal PDFs, temporary SQLite databases, and direct HTTP-handler requests without opening sockets.

| Coverage | What is verified |
| --- | --- |
| Import integration | Recursive uppercase PDF discovery, page text, matching page numbers, blank/corrupt PDF isolation, symlink exclusion |
| Rescans and persistence | Unchanged skips, error retries, changed-text replacement, deleted-file cleanup, cancellation, database reopening |
| HTTP handlers | Local Host/Origin restrictions, input validation, missing paper and unknown route responses, UI serving, source/answer stream errors |
| Assistant fixtures | Stream reconciliation, terminal status failure, cancellation and busy-state cleanup |
| Search regression and migration | Legacy Porter false match reproduced; literal matching excludes related stems, plurals and prefixes; case folding, hyphenated word matches, title-only recovery, page numbers and metadata preservation, repeat startup, HTTP search behavior |
| Search controls and metadata | Title/abstract/author/full-text isolation, original-case filtering, fuzzy insertion/deletion/substitution/transposition, exact short words, case-sensitive fuzzy behavior, invalid controls, API propagation, editable metadata, corrections surviving rescans, AI honoring field scope |
| Version 1 backfill | Stored-text metadata inference with missing original PDFs, original page preservation, metadata-aware FTS and repeat startup |
| Result highlighting | Whole-word/case/fuzzy spans, multiple terms, selected-field isolation, combining marks and UTF-16 offsets, safe text-node rendering, invalid range handling, full-word snippet boundaries and HTTP highlight payloads/assets |
| PDF titles and version 2 upgrade | Misleading filenames ignored, verified metadata, stale-metadata rejection, page-layout fallback, multiline/entity handling, recurring header rejection, unreadable-title fallback, title-only rescans preserving page rows/corrections, saved title validation and persistence |
| Codex SDK | Actual pinned SDK driving a deterministic POSIX CLI subprocess; stdin/source bounds, JSONL streaming, completion/failure/early-end, unexpected tool cancellation, user abort, shutdown, timeout, repeat questions, scratch cleanup and credential filtering |
| Backend selection | OpenWorker retained as default, explicit Codex route, status caching/refresh, ChatGPT-only authentication, invalid/missing/busy selections, original OpenWorker control fixtures |
| Desktop settings and state | Validated provider URLs, encrypted/session-only key contract, no public key values, lazy keyring initialization, persistent preferences and serialized writes |
| Desktop login and transport | Structured Codex authentication handshake/completion/cancellation, chunked responses, authorization URL allowlist, main-frame IPC checks and per-launch HTTP token/port checks |
| Desktop library import | Read-only SQLite source, committed WAL snapshot, preserved paper IDs/text and invalid/self-import rejection |

These are integration and deterministic control-flow checks. They do not prove visual quality in a browser or live model answer accuracy. A passing fixture does not establish a working remote provider.

## Supplied cfDNA library evidence

The initial test used a seven-paper sample supplied by the user. A generic equivalent location would be `/home/alex/Documents/Papers`; machine-specific paths are intentionally omitted from the documentation.

- Initial import: 7 PDFs, 150 pages, all `ready`, zero extraction errors.
- Second scan: all 7 PDFs unchanged, no re-extraction required.
- Index version 1 migration: all 7 paper records and 150 stored pages retained; no PDF reimport.
- Before correction, `transformer` returned 6 papers through stemming. “Liquid biopsy in cancer current status challenges” matched `transformation` on PDF page 10; its stored pages contained no literal `transformer` token.
- After correction, `transformer` returns 3 papers with literal matches: DNAmBERT (best page 3), the cfDNA language-model paper (page 4), and “Liquid Biopsy: The Challenges of a Revolutionary Approach in Oncology” (page 21, bibliography). Every selected result was checked against its title and stored matching page text.
- Version 2 retains 7 papers/150 pages and detects nonempty abstract fields for 4 papers and nonempty author fields for all 7. These counts measure field presence, not metadata accuracy or completeness.
- `Maryam` in Authors returns DNAmBERT; `transformer` in Abstract or Title alone also returns DNAmBERT. `transfomer` with fuzzy enabled returns the same three default transformer matches. Case-sensitive `Transformer` returns DNAmBERT and the oncology review; all six automated test groups pass.

After the result-highlighting change, all nine automated tests pass. Highlight rendering is tested against a small DOM contract fixture; this checks text/mark construction and text preservation, not visual browser appearance.

After the PDF-title change, all eleven tests pass. All seven initial sample titles come from embedded PDF metadata verified against opening page text. The user's expanded library was also refreshed: 32 paper records and all 532 stored pages were preserved; 27 titles came from verified PDF metadata and 5 from page layout. A repeated “Think again” banner was rejected in favor of the actual article title. These checks establish the exercised examples, not perfect extraction across arbitrary layouts.

The installed OpenWorker Linux x64 runtime was separately started, configured, used to register an agent and create a session, shut down, and restarted using the same state directory. That check did not send a live model question.

## Codex branch verification

The experimental branch `feature/local-codex-assistant` was developed in an isolated local clone because this execution session cannot write the original checkout's `.git` metadata. The existing main checkout and its database were left untouched. The feature does not change the database schema, OpenWorker version or original agent definition.

The installed Codex CLI and pinned SDK both use version 0.169.0. `codex login status` reported an existing ChatGPT login. A live SDK question used only synthetic study text, but Codex failed before model inference because the session made its local state read-only. This is an environment limitation; authentication detection is not a successful answer test. No credentials were copied and no login was changed.

The suite now contains 17 tests. The Codex transport tests use the real JavaScript SDK and a POSIX shell fixture rather than a mocked SDK. They verify the subprocess contract and control flow without a model or network connection. They do not establish native Codex answer quality. Native Windows fixture execution and browser rendering are untested; the documented Windows path remains WSL.

To finish the live check in a normal terminal: install this branch's dependencies, run `npm run codex:login` if needed, check `npm run codex:status`, start the app, select **Local Codex (ChatGPT)**, click **Check connection**, and ask about a retrieved paper. Confirm a completed cited answer and try Stop. A writable Codex home and account allowance are required.

The execution environment disallows listening on local sockets, so browser preview and full network/live-model end-to-end tests were not available. Run the server in your local terminal for those checks; Linux x64 is the exercised native-runtime platform.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Related words appear for `transformer` | Restart the updated app and turn Fuzzy search off. Current database version is 3, queries omit `*`, and the tokenizer has no Porter stemmer. Fuzzy mode intentionally permits single-edit spellings. |
| Abstract/author search misses a paper | Open paper details and inspect Title, authors and abstract. Detection is heuristic; unlabeled abstracts and incomplete bylines may need manual correction. |
| Title still looks like a filename | A **Title needs rescan** badge indicates legacy data. Rescan that folder once to run the PDF-title pass. |
| Title is wrong or unavailable | Review the source shown in paper details and correct the Title field. PDF layout and text-layer quality can defeat heuristics; manual titles survive rescans. |
| Case-sensitive results seem different | Unchecking Case-insensitive enforces original token case in selected fields. Try the spelling/capitalization shown in the source or title. |
| Search term missing from the excerpt | Check the title and full matching page. Titles and bibliography text are searchable; a snippet is only a portion of a page. |
| `pdftotext` missing | Install Poppler or configure `PDFTOTEXT_PATH`, restart and rescan. Error records are retried. |
| PDF needs OCR | This version extracts only an existing text layer. View the original or provide a text-layer PDF. |
| Import seems stopped after pressing Stop | The active PDF can take up to the extraction timeout to finish; cancellation is checked between files. |
| AI disabled | Set `AI_MODEL` plus a provider endpoint or key, then restart. |
| Codex disabled | Run `npm ci` and `npm run codex:login`, choose ChatGPT sign-in, then click **Check connection**. The OpenWorker API key does not configure Codex. |
| Codex reports read-only state | Run outside the restricted session with a writable Codex home; sign in through Codex there if necessary. Papertrail does not move auth files. |
| Codex run fails after successful login check | Check account limits, model availability, connectivity and local CLI/SDK compatibility. Login status alone is not a model-health test. |
| Library missing after moving files | Rescan their new folder; originals are referenced by absolute paths. |

## Linux desktop preview

The desktop branch adds six tests to the existing suite (23 total). These exercise desktop service boundaries without creating real GUI windows or starting a live sign-in. The current Codex binary's generated protocol schema was checked for the ChatGPT login result shape used by the bridge.

Electron 45.3.2's Linux x64 archive was checked against the pinned upstream SHA-256. Its embedded runtime reports Node 24.22.2 and exposes `node:sqlite`. The `.deb` archive is checked for launcher/native runtime paths, declared Poppler/OpenSSL/desktop dependencies, the Chromium sandbox helper's root ownership/setuid mode and exclusion of private source state.

A normal GUI launch was attempted with the sandbox enabled. This environment rejected Chromium sandbox initialization with `Operation not permitted`; a separate private-server check also returned `EPERM` for loopback listening. Neither restriction was bypassed. These failures prevent a graphical installation/dialog/login/PDF-viewer qualification here. The installer remains a preview pending the normal-desktop steps in [Linux release qualification](linux-release.md#qualification-before-public-release).

The [packaged smoke check](linux-release.md#automated-package-check) uses the extracted installer and Electron's own Node runtime to test SQLite, unavailable-AI state and PDF extraction/search, without global Node/Codex or a model request. Its results must be reported separately from GUI verification.

Optional AI-component tests use deterministic archives and native executable fixtures: no-network startup, existing Codex reuse, saved selection, exact-version checks, lockfile/manifest integrity, verified extraction, restart persistence, corruption rejection, cancellation cleanup and retry. The suite now contains 27 tests. Actual network and graphical checks are reported separately from fixture results.

For the 1.2.0 change, all 27 tests passed. Official npm archives for both backends were downloaded with curl, then replayed as streaming Responses through the actual installer pipeline. Both passed integrity/extraction/version checks and restart discovery; the downloaded OpenWorker also created a real harness/agent/session and shut down, and the packaged Codex SDK accepted the downloaded executable override. This verifies the archives and installation pipeline, not Electron network transport: Node fetch was blocked by sandbox DNS, and Chromium GUI/network execution remains restricted. The 1.2.0 installer is approximately 89 MiB versus 206 MiB for 1.1.0 (about 57% smaller); the base installed tree is about 275 MiB.

For 1.2.1, the reported nvm launcher failed under `/usr/bin:/bin` because `/usr/bin/env node` was absent. The new resolver found the same installation’s native Codex 0.169.0 and detected the already-installed OpenWorker 0.1.0-beta.3 with that minimal PATH. All probes used a disposable Codex home and did not copy credentials or change the user’s library. The suite now has 31 tests, including nvm launcher resolution, diagnostic messages, setup phases/activation timeouts and stalled stream cleanup. Graphical file-picker behavior remains platform-dependent; Settings supports direct path entry. Parallel-server behavior follows the desktop’s explicit port-zero/default separate-database configuration; real concurrent GUI/server verification remains outside the restricted session.

A reported failure for the opening word of “Performance and safety of a multi-cancer early detection test” was investigated against a read-only snapshot of the desktop database. Both the FTS title query and Library.search returned the paper with case-insensitivity enabled; the title highlight starts at UTF-16 offset zero. Title-only lowercase search correctly returned no hit in case-sensitive mode. The installed 1.2.1 library implementation matches the working source. A new generated-PDF/API regression covers lowercase, original-case and uppercase queries, field scoping, case-sensitive rejection, exact-token behavior, offset-zero highlighting and restart persistence. All 32 tests pass. Later clarification identified partial-word input as the issue; the subsequent Prefix search option addresses it without changing whole-word defaults. No index repair, PDF reimport or search behavior change was applied.

Version 1.3.0 covers 38 regression tests, including real renderer-module execution against a DOM/desktop-bridge fixture and the actual HTTP/SQLite implementation. Cases include prefix-by-prefix typing, preference restoration, stale responses, exact quoted phrases, word order/adjacency, same-field/page constraints, case control, Unicode/overlapping highlights, prefix/fuzzy exclusion inside quotes and a 24-word validation error. Full GUI interaction remains unverified in this restricted session. Existing database/page text are preserved; no reindex is required.

Release automation is covered by `test/release.test.js`: explicit semantic bumps/package-lock synchronization, comparison against a real temporary Git history, versioned asset filtering, multi-platform collection, corruption/duplicate/source rejection, main-only publication, draft/upload ordering, retry and tag-collision handling. GitHub publication uses mocked API/CLI calls. The helper uses asynchronous Git subprocesses, including the local base-SHA check. The actual hosted runner invocation and publication remain part of the first GitHub workflow run. See [GitHub release automation](github-release.md) for workflow linting and end-to-end limits.

For the 1.4.0 release automation change, all 42 tests passed, actionlint 1.7.12 accepted the workflow, and local checks verified the main/PR trigger and token-permission boundaries. The 1.4.0 `.deb` was built and inspected, its extracted Electron executable passed the application smoke check, and actual installer staging/collection produced valid release-wide checksums. Version validation against the real 1.3.0 Git base passed. Publication/retry tests remain mocked; no hosted workflow or remote release has run from this session.

The hosted 1.4.0 log (commit 78181d14, 2026-11-16 UTC) confirms build/asset collection passed, then publication failed when a draft was retrieved by tag. Version 1.4.1 fixes that endpoint mismatch. The 43-test suite now models drafts as absent from the published-by-tag endpoint and checks creation-response IDs, paginated draft recovery, source mismatches and draft verification by ID before publication. These are local API/CLI fixtures; the corrected hosted publication still requires a new main push.
