# Running and verification

## Local execution

Install Node.js 24+ and Poppler (`pdftotext` on PATH), then run `npm ci` and `npm start`. Visit `http://127.0.0.1:3210`. The root [README](../../README.md) covers platform setup and optional AI provider configuration.

| Variable | Meaning |
| --- | --- |
| `PORT` | Local HTTP port; default 3210 |
| `DATA_DIR` | Database/state directory; default project `data/` |
| `PDFTOTEXT_PATH` | Alternate path to the Poppler executable |
| `AI_MODEL` | Exact model ID; required to enable AI |
| `OPENAI_API_KEY` | Optional provider secret; required for default OpenAI endpoint |
| `AI_BASE_URL` | Custom compatible provider endpoint, e.g. local Ollama |
| `AI_API` | Provider API override; defaults to Responses or Chat Completions according to endpoint configuration |

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

These are integration and deterministic control-flow checks. They do not prove visual quality in a browser or live model answer accuracy. A passing fixture does not establish a working remote provider.

## Supplied cfDNA library evidence

The authorized test folder is `/mnt/windows/Data/Literature_and_book/Cancer/cfDNA`.

- Initial import: 7 PDFs, 150 pages, all `ready`, zero extraction errors.
- Second scan: all 7 PDFs unchanged, no re-extraction required.
- Index version 1 migration: all 7 paper records and 150 stored pages retained; no PDF reimport.
- Before correction, `transformer` returned 6 papers through stemming. “Liquid biopsy in cancer current status challenges” matched `transformation` on PDF page 10; its stored pages contained no literal `transformer` token.
- After correction, `transformer` returns 3 papers with literal matches: DNAmBERT (best page 3), the cfDNA language-model paper (page 4), and “Liquid Biopsy: The Challenges of a Revolutionary Approach in Oncology” (page 21, bibliography). Every selected result was checked against its title and stored matching page text.
- Version 2 retains 7 papers/150 pages and detects nonempty abstract fields for 4 papers and nonempty author fields for all 7. These counts measure field presence, not metadata accuracy or completeness.
- `Maryam` in Authors returns DNAmBERT; `transformer` in Abstract or Title alone also returns DNAmBERT. `transfomer` with fuzzy enabled returns the same three default transformer matches. Case-sensitive `Transformer` returns DNAmBERT and the oncology review; all six automated test groups pass.

After the result-highlighting change, all nine automated tests pass. Highlight rendering is tested against a small DOM contract fixture; this checks text/mark construction and text preservation, not visual browser appearance.

The installed OpenWorker Linux x64 runtime was separately started, configured, used to register an agent and create a session, shut down, and restarted using the same state directory. That check did not send a live model question.

The execution environment disallows listening on local sockets, so browser preview and full network/live-model end-to-end tests were not available. Run the server in your local terminal for those checks; Linux x64 is the exercised native-runtime platform.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Related words appear for `transformer` | Restart the updated app and turn Fuzzy search off. Current database version is 2, queries omit `*`, and the tokenizer has no Porter stemmer. Fuzzy mode intentionally permits single-edit spellings. |
| Abstract/author search misses a paper | Open paper details and inspect Authors and abstract. Detection is heuristic; unlabeled abstracts and incomplete bylines may need manual correction. |
| Case-sensitive results seem different | Unchecking Case-insensitive enforces original token case in selected fields. Try the spelling/capitalization shown in the source or title. |
| Search term missing from the excerpt | Check the title and full matching page. Titles and bibliography text are searchable; a snippet is only a portion of a page. |
| `pdftotext` missing | Install Poppler or configure `PDFTOTEXT_PATH`, restart and rescan. Error records are retried. |
| PDF needs OCR | This version extracts only an existing text layer. View the original or provide a text-layer PDF. |
| Import seems stopped after pressing Stop | The active PDF can take up to the extraction timeout to finish; cancellation is checked between files. |
| AI disabled | Set `AI_MODEL` plus a provider endpoint or key, then restart. |
| Library missing after moving files | Rescan their new folder; originals are referenced by absolute paths. |
