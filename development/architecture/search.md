# Search implementation

Implementation: [Library.search and Library.migrateSearch](../../src/library.js), with validated options and spelling comparison in [src/search.js](../../src/search.js). This same retrieval function supplies the browser and optional AI assistant.

## Matching contract

The default is **case-insensitive whole-token matching**, fuzzy off, over title + full text. The FTS5 tokenizer is `unicode61 remove_diacritics 0`: Unicode case folding is applied, accents are retained, and punctuation generally separates tokens. The browser exposes checkboxes for case-insensitivity, fuzzy spelling and selected fields (`title`, `text`, `abstract`, `authors`). The fields are combined with OR. An empty field list returns no results, including for a blank query.

| Query | Matches | Does not match solely because of this word |
| --- | --- | --- |
| `transformer` | `transformer`, `Transformer`, `transformer-based` | `transformation`, `transformed`, `transformative`, `transformers` |
| `methylation` | `Methylation` | `methylated` |
| `trans` | A standalone `trans` token | `transformer` |

The server limits browser queries to 1,000 characters. The library extracts up to 24 runs of Unicode letters and numbers. Each run becomes a quoted FTS term, and the terms are combined with `OR` within an allowlisted FTS column filter. Consequently, multiple words mean **any term**, not all terms or an exact phrase. Quotes, `*`, and other punctuation do not enable user-authored FTS expressions. Parameters are bound in SQL. A query with no extracted terms lists all papers when at least one field is selected.

Matching searches only selected fields. Abstracts and authors are [detected metadata](indexing.md#author-and-abstract-fields), editable in the paper dialog; missing metadata never falls back to searching unrelated page text. Bibliographies remain part of Full text, so a paper can legitimately match a reference. This is keyword retrieval; there are no embeddings, vector database, semantic synonyms or model calls.

## Case-sensitive and fuzzy matching

The FTS index always folds case. When Case-insensitive is unchecked, it supplies candidates, then the library checks original tokens from the selected fields to enforce the query's case. Case-only differences cannot count as fuzzy substitutions. Each returned row carries `matched_fields`, and nonmatching candidates are discarded before paper grouping.

Fuzzy mode uses a column-aware `fts5vocab` table to find indexed words within one character of the query length in selected fields. For query words of five or more Unicode code points, it expands to up to 32 lexically ordered dictionary alternatives within one insertion, deletion, substitution or adjacent transposition. The original term is always included. Shorter query words stay exact. This is spelling tolerance, not Porter stemming. It can intentionally include a related word if it differs by just one character; fuzzy mode is explicitly opt-in.

Dictionary lookup and candidate verification run synchronously in Node. Expansion limits keep the FTS query bounded but can omit alternatives in a dense vocabulary; this is not exhaustive arbitrary-distance fuzzy search.

## Ranking, snippets and pagination

Each FTS row represents one page and repeats its paper title. Abstract and author text appear only on their recorded source pages. FTS5 `bm25(search,5,1,0,0,3,3)` weights title matches by 5, page-text matches by 1 and abstract/author matches by 3. Lower scores sort first. Scores depend on term frequency, document length and the current indexed corpus; they are not confidence values. Fuzzy alternatives participate in the same scoring; exact matches have no separate ranking boost.

The query retrieves up to 4,000 ranked page rows. After checking original tokens against case/fuzzy options, JavaScript groups these by paper ID, retaining the first (best-ranked) matching page per paper. It then applies paper-level offset and limit; browser pages contain 40 papers. The reported count is the unique paper count within that candidate set. `capped: true` indicates that 4,000 page rows were reached and more matches may exist, including candidates omitted before case verification. Tied scores do not have a specified secondary ordering.

FTS provides a fallback snippet from its best column. The library replaces it with a passage containing a verified matching token from a selected field: approximately 100 preceding and 500 following characters, with ellipses when truncated. Boundaries extend to include complete tokens, avoiding false highlights caused by clipping a longer word. It prefers a matching non-title field, otherwise shows title context. Cards identify matching fields. `match_page` supplies the one-based page number for the text dialog and PDF URL fragment. Edited metadata may differ from original PDF wording.

### Result highlighting

`matchRanges()` in [src/search.js](../../src/search.js) uses the same `termMatches()` rules as candidate verification to produce `{ start, end }` UTF-16 offsets into result strings. Ranges include combining marks and normalize a working token to NFC for comparison while preserving source offsets. Each paper response includes `highlights.title` and `highlights.snippet` for nonempty token queries. Title highlights are generated only when Title is a selected matching field; snippet highlights refer to the selected source field. Empty browsing queries have no highlight ranges.

[public/highlight.js](../../public/highlight.js) builds text nodes and `<mark>` elements from these offsets; it never parses returned strings as HTML. Highlighting preserves source spelling, including fuzzy variants, and respects original-case matching. The browser uses gold marks in result titles and excerpts. This does not highlight the original PDF, alter stored content or require a database migration.

## Fix for the “transformer” false match

The initial index used `porter unicode61`, and queries appended `*`. Porter reduced words such as `transformer`, `transformation` and `transformed` to a shared stem; automatic prefix matching expanded matches further. In the supplied corpus, “Liquid biopsy in cancer current status challenges” matched `transformation` on PDF page 10 despite containing no literal `transformer` token.

The correction removes the Porter tokenizer and query suffix `*`. It intentionally makes singulars/plurals and related word forms distinct. The UI hint and main README describe these semantics.

## Existing-database migration

Unversioned databases have `PRAGMA user_version = 0`; the earlier literal-search release used version 1, and the author/abstract release used version 2. Current startup migrates these versions to 3 in one `BEGIN IMMEDIATE` transaction. For versions below 2, it first adds author/abstract fields, backfills them from stored pages, and rebuilds FTS and its vocabulary view. It then adds title provenance/page/parser-version fields. IDs, timestamps, roots, stored page text and saved corrections are preserved. Migration itself does not read PDFs or call a model. A migration failure rolls back and closes the connection; a future unsupported version is rejected.

Version 3 skips schema work on subsequent opens. Existing titles are marked `legacy` until a rescan reads opening-page title layout and updates all FTS title rows for that paper. This title-only pass leaves original stored pages untouched. Saving a corrected title updates its FTS rows immediately and preserves the manual title across rescans. See [indexing](indexing.md#paper-titles) and [verification](../operations/verification.md).
