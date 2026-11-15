# Search implementation

Implementation: [Library.search and Library.migrateSearch](../../src/library.js), with validated options and spelling comparison in [src/search.js](../../src/search.js). This same retrieval function supplies the browser and optional AI assistant.

## Matching contract

The default is **case-insensitive whole-token matching**, prefix and fuzzy off, over title + full text. The FTS5 tokenizer is `unicode61 remove_diacritics 0`: Unicode case folding is applied, accents are retained, and punctuation generally separates tokens. The browser exposes checkboxes for case-insensitivity, word prefixes, fuzzy spelling and selected fields (`title`, `text`, `abstract`, `authors`). The fields are combined with OR. An empty field list returns no results, including for a blank query.

| Query | Matches | Does not match solely because of this word |
| --- | --- | --- |
| `transformer` | `transformer`, `Transformer`, `transformer-based` | `transformation`, `transformed`, `transformative`, `transformers` |
| `methylation` | `Methylation` | `methylated` |
| `performance` | The initial `Performance` in a title (with case-insensitivity enabled) | `perform`, or capitalized `Performance` when case-sensitive mode is selected |
| `trans` | A standalone `trans` token | `transformer` |

The server limits queries to 1,000 characters. `parseQuery()` extracts Unicode letter/number tokens and recognizes paired straight or curly double quotes. A quoted group is an exact consecutive-token phrase; unquoted words remain independent OR alternatives. Words/phrases are combined with OR within an allowlisted FTS column filter. The total is limited to 24 words; exceeding this returns an error instead of truncating a phrase into a different search. An unmatched quote is treated as ordinary text while the user types. Empty quoted groups are ignored. Other FTS operators and user-supplied wildcards are not interpreted. SQL parameters remain bound. A query with no extracted terms lists all papers when at least one field is selected.

Examples: `foundational model` matches either word, while `"foundational model"` requires both in that order with no intervening token. A phrase must occur within a single selected field and page; a title word cannot combine with a body word or the next page. Punctuation is a token separator, so a space, hyphen or newline can separate consecutive phrase tokens. Quotes preserve whole-word matching even when Prefix search or Fuzzy search is enabled. `"foundational model" oncology` matches the phrase OR the separate word `oncology`.

Matching searches only selected fields. Abstracts and authors are [detected metadata](indexing.md#author-and-abstract-fields), editable in the paper dialog; missing metadata never falls back to searching unrelated page text. Bibliographies remain part of Full text, so a paper can legitimately match a reference. This is keyword retrieval; there are no embeddings, vector database, semantic synonyms or model calls.

## Case-sensitive, prefix and fuzzy matching

The FTS index always folds case. When Case-insensitive is unchecked, it supplies candidates, then `searchRanges()` verifies original token sequences in selected fields to enforce the query's case and phrase boundaries. Case-only differences cannot count as fuzzy substitutions. Each returned row carries `matched_fields`, and nonmatching candidates are discarded before paper grouping.

Prefix search is explicit and off by default, preserving the earlier strict whole-word contract. The query emits `"perf"*` for an unquoted word and verifies source tokens with startsWith under the selected case rule. This makes `p`, `perf` and `perform` match `Performance` when case-insensitivity is enabled; `formance` does not. Prefix mode can include longer words/plurals. No token/index migration or PDF reimport is needed. The checkbox is persisted alongside other search options, including desktop preferences. Prefix and fuzzy alternatives use OR; only original unquoted terms receive the FTS prefix wildcard, avoiding unintended expansion of fuzzy alternatives.

Fuzzy mode uses a column-aware `fts5vocab` table to find indexed words within one character of the query length in selected fields. For query words of five or more Unicode code points, it expands to up to 32 lexically ordered dictionary alternatives within one insertion, deletion, substitution or adjacent transposition. The original term is always included. Words inside quoted phrases are not fuzzy-expanded. Shorter query words stay exact. This is spelling tolerance, not Porter stemming. It can intentionally include a related word if it differs by just one character; fuzzy mode is explicitly opt-in.

Dictionary lookup and candidate verification run synchronously in Node. Expansion limits keep the FTS query bounded but can omit alternatives in a dense vocabulary; this is not exhaustive arbitrary-distance fuzzy search.

## Ranking, snippets and pagination

Each FTS row represents one page and repeats its paper title. Abstract and author text appear only on their recorded source pages. FTS5 `bm25(search,5,1,0,0,3,3)` weights title matches by 5, page-text matches by 1 and abstract/author matches by 3. Lower scores sort first. Scores depend on term frequency, document length and the current indexed corpus; they are not confidence values. Fuzzy alternatives participate in the same scoring; exact matches have no separate ranking boost.

The query retrieves up to 4,000 ranked page rows. After checking original tokens against case/fuzzy options, JavaScript groups these by paper ID, retaining the first (best-ranked) matching page per paper. It then applies paper-level offset and limit; browser pages contain 40 papers. The reported count is the unique paper count within that candidate set. `capped: true` indicates that 4,000 page rows were reached and more matches may exist, including candidates omitted before case verification. Tied scores do not have a specified secondary ordering.

FTS provides a fallback snippet from its best column. The library replaces it with a passage containing a verified matching token from a selected field: approximately 100 preceding and 500 following characters, extending through the entire first matched phrase if longer, with ellipses when truncated. Boundaries extend to include complete tokens, avoiding false highlights caused by clipping a longer word. It prefers a matching non-title field, otherwise shows title context. Cards identify matching fields. `match_page` supplies the one-based page number for the text dialog and PDF URL fragment. Edited metadata may differ from original PDF wording.

### Result highlighting

`searchRanges()` in [src/search.js](../../src/search.js) combines `matchRanges()` / `termMatches()` for unquoted words with exact adjacent-token checks for phrases to produce `{ start, end }` UTF-16 offsets into result strings. Overlapping word/phrase ranges are merged. Prefix hits highlight the full matching word; phrase hits highlight the full phrase, including intervening separators. Ranges include combining marks and normalize a working token to NFC for comparison while preserving source offsets. Each paper response includes `highlights.title` and `highlights.snippet` for nonempty token queries. Title highlights are generated only when Title is a selected matching field; snippet highlights refer to the selected source field. Empty browsing queries have no highlight ranges.

[public/highlight.js](../../public/highlight.js) builds text nodes and `<mark>` elements from these offsets; it never parses returned strings as HTML. Highlighting preserves source spelling, including fuzzy variants, and respects original-case matching. The browser uses gold marks in result titles and excerpts. This does not highlight the original PDF, alter stored content or require a database migration.

## Fix for the “transformer” false match

The initial index used `porter unicode61`, and queries appended `*`. Porter reduced words such as `transformer`, `transformation` and `transformed` to a shared stem; automatic prefix matching expanded matches further. In the supplied corpus, “Liquid biopsy in cancer current status challenges” matched `transformation` on PDF page 10 despite containing no literal `transformer` token.

The correction removes the Porter tokenizer and query suffix `*`. It intentionally makes singulars/plurals and related word forms distinct. The UI hint and main README describe these semantics.

## Existing-database migration

Unversioned databases have `PRAGMA user_version = 0`; the earlier literal-search release used version 1, and the author/abstract release used version 2. Current startup migrates these versions to 3 in one `BEGIN IMMEDIATE` transaction. For versions below 2, it first adds author/abstract fields, backfills them from stored pages, and rebuilds FTS and its vocabulary view. It then adds title provenance/page/parser-version fields. IDs, timestamps, roots, stored page text and saved corrections are preserved. Migration itself does not read PDFs or call a model. A migration failure rolls back and closes the connection; a future unsupported version is rejected.

Version 3 skips schema work on subsequent opens. Existing titles are marked `legacy` until a rescan reads opening-page title layout and updates all FTS title rows for that paper. This title-only pass leaves original stored pages untouched. Saving a corrected title updates its FTS rows immediately and preserves the manual title across rescans. See [indexing](indexing.md#paper-titles) and [verification](../operations/verification.md).

## Desktop input verification

The reported disappearance while typing `perf` was clarified as the original complete-word contract, rather than a missing title-start match. Enable Prefix search for incremental word beginnings. The renderer regression harness evaluates the actual `public/app.js` with an isolated DOM/desktop bridge and routes fetches through the real HTTP handler and SQLite library. It checks restored desktop options, each typed prefix, case-insensitive title highlighting at offset zero, stale-response rejection, and preservation of quoted query text/phrase-only results. This is controller/DOM-contract coverage, not a real Chromium GUI test.
