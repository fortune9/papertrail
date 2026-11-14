# HTTP API and browser UI

Implementation: [src/server.js](../../src/server.js), [public/app.js](../../public/app.js), [public/index.html](../../public/index.html), [public/style.css](../../public/style.css).

## Routes

| Method and route | Request | Response |
| --- | --- | --- |
| `GET /` | — | HTML UI |
| `GET /app.js`, `/highlight.js`, `/style.css` | — | Static assets from an explicit allowlist |
| `GET /api/status` | Optional `refreshAI=1` | Counts, root paths, import job, AI flags and per-backend status |
| `GET /api/search?q=…&offset=…` | Query, paper offset, optional search controls below | `{ total, papers, capped? }`; 40-paper limit |
| `POST /api/import` | JSON `{ folder }` | `202` with new job state; work continues asynchronously |
| `POST /api/import/cancel` | JSON `{}` | `{ ok: true }`; flags the current import for cancellation |
| `GET /api/papers/:id` | Numeric paper ID | Metadata plus ordered `{ number, text }` content pages |
| `GET /api/papers/:id/file` | Numeric paper ID | Original PDF stream after resolved-path validation |
| `POST /api/papers/:id/metadata` | JSON `{ authors, abstract, title? }` | Updated paper with pages; corrections reindex atomically |
| `POST /api/ask` | JSON `{ question, query, options?, backend? }` | NDJSON stream or JSON validation error |

Search results include metadata and, for nonempty token queries, `match_page`, `snippet`, `score`, `matched_fields` and `highlights`. `highlights` contains `title` and `snippet` arrays of ordered, nonoverlapping `{ start, end }` UTF-16 offsets (end exclusive), suitable for JavaScript `slice()`. An array can be empty when that displayed field has no eligible match. Empty queries omit highlights and list metadata sorted by indexing time descending and ID descending if any fields are enabled. Details/metadata writes for an unknown ID return 404. JSON failures have `{ error }`; most validation/runtime exceptions return 400. Cross-origin or unknown-host requests return 403. Busy AI requests return 409. Unknown routes return 404.

Search query controls: `caseInsensitive=true|false` (default true), `fuzzy=true|false` (default false), and `fields=title,text,abstract,authors` with a comma-separated subset (default `title,text`). `fields=` selects none. Unknown fields or non-boolean control values return 400. The AI endpoint accepts corresponding JSON booleans and a field array inside `options`; omission retains defaults. The server validates these controls before building SQL column filters. Example: `/api/search?q=transfomer&fields=title&fuzzy=true`.

`backend` accepts `openworker` or `codex`; omission uses `AI_BACKEND`, defaulting to OpenWorker. Unknown or unconfigured choices return 400 without silently falling back to another engine. Busy requests return 409 across both engines. Codex login is checked before generation; a disconnected client is detected after that asynchronous check, before a model run starts.

`/api/status` includes `ai` (any engine configured), `aiDefaultBackend`, and `aiBackends`: an array of `{ id, label, configured, message }`. Codex status only reports the result of a bounded login check, not whether inference or account limits will allow a question. `refreshAI=1` forces a fresh check; ordinary requests use a 30-second cache. No credentials or raw login command output are returned.

Metadata updates require both string fields: `authors` at most 4,000 characters and `abstract` at most 12,000. Empty strings clear those fields. Optional `title` must be a nonempty string of at most 1,000 characters; supplying it records a manual title correction. Omitting title preserves its current value/source. Corrections are saved locally, indexed for field-specific retrieval and preserved on rescans; original PDF content is not changed.

JSON request bodies are limited to 65,536 accumulated string characters, allowing the bounded title/author/abstract fields and JSON escapes together. Questions must be nonempty strings no longer than 2,000 characters. Browser search queries are truncated to 1,000 characters and offsets constrained to 0–100,000 before retrieval. There is no general arbitrary-filesystem route or proxy to the harness.

## AI stream protocol

Each line is a JSON object:

```json
{"type":"sources","sources":[{"id":2,"title":"Example paper","page":3}]}
{"type":"text","text":"Accumulated answer so far"}
{"type":"done","text":"Final answer [Paper 2, p. 3]"}
```

Failures after streaming begins use `{"type":"error","error":"message"}`. `text` and `done` replace displayed text. A stream ending without `done` is treated as incomplete. See [assistant lifecycle](../architecture/assistant.md).

## Browser state and interaction

Search input is debounced by 220 ms. Enter or the Search button searches immediately. A sequence counter prevents an older response from replacing a more recent query. The `/` keyboard shortcut focuses search outside input fields. “Load more” appends another 40 results.

The browser polls status every 1.5 seconds to refresh statistics, folders and import progress. When a running import finishes, it refreshes results. Root entries offer a rescan. The import dialog accepts a path on the server's machine, not a browser upload. The paper dialog loads extracted pages; PDF links use `#page=N` with browser-native viewing.

Checkboxes immediately under the search box control case-insensitivity, fuzzy spelling and Title/Abstract/Authors/Full text scope. They default to case-insensitive, fuzzy off, Title + Full text. The browser saves choices in `localStorage` under `papertrail.searchOptions`; a storage failure does not prevent searching. Changing a control triggers a fresh search and resets pagination. The hint reflects active options, and selecting no fields shows a prompt to choose one. Cards show matching fields alongside the PDF-derived title, page count, status, passage and original path. Older titles pending extraction are labeled **Title needs rescan**.

Paper details includes an expandable **Title, authors and abstract** editor. It displays title provenance, labels inferred metadata as reviewable, and loads existing corrections. It posts author/abstract fields together and includes title only if the user changed it, so editing an author does not accidentally pin an inferred title as manual. This does not change original page text or the PDF. The assistant request receives the same checkbox options as the current library search.

The companion panel's **Answer with** selector offers OpenWorker and local Codex, with a **Check connection** action and backend-specific configuration text. Browser selection is saved as `papertrail.assistantBackend`. The Ask button is enabled only when that selected backend reports configured; another configured engine does not override it. During an active answer, selection is disabled. Stop works for both through the same response-abort flow.

The UI uses text nodes and `textContent` for filenames, PDF text, errors and model output. A restrictive Content Security Policy allows local scripts/styles and prevents external framing. It has no external fonts, analytics or CDN dependencies. Responsive CSS adapts the fixed sidebar and two-column research view to a single-column mobile view.

Result titles and excerpts use [public/highlight.js](../../public/highlight.js) to wrap matching ranges in `<mark>` nodes. This preserves literal text and active case/fuzzy/field rules. Invalid or overlapping ranges are ignored without discarding text. Highlighting does not use `innerHTML`, and PDF contents resembling tags remain plain text. Original PDF viewing and the extracted-page dialog remain unhighlighted.
