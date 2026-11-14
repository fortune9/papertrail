# Implementation change record

## PDF-derived titles and first-time setup guide — 2026-11-13

Replaced filename-derived titles with verified embedded PDF title metadata, bounded opening-page layout extraction and a text fallback. Metadata must occur in visible opening-page text; stale document names, common publisher labels and repeated large running banners are filtered. Undetectable titles become **Untitled paper**. Titles can be corrected in paper details and stay corrected across rescans.

Schema version 3 adds title provenance, detected page and parser-version fields. Older titles are explicitly marked as legacy until a rescan. An unchanged PDF gets only the title pass; stored pages and saved author/abstract corrections remain intact. The current 32-paper/532-page library was refreshed without changing any stored page row; 27 titles used verified metadata and 5 used layout. All eleven regression tests pass, including upgrades from versions 0, 1 and 2 and repeated-banner rejection.

Rewrote the README Run locally guide for a first-time user, covering Git installation/cloning, Node 24, Poppler, Ubuntu/WSL/macOS setup, validation commands, dependency installation, first import and subsequent restarts. Replaced machine-specific paths with generic examples, including in development verification notes. Linked official installation sources; installers and clean-machine setup were not executed here.

## Highlight matching result words — 2026-11-13

Result titles and excerpts now highlight matching tokens using the active field selection, case and fuzzy settings. Server responses include UTF-16 ranges computed with the same matching rules as retrieval; the browser creates text and gold `<mark>` nodes without interpreting PDF content as HTML. Fuzzy search highlights the actual matched spelling. Title highlights are omitted when Title is excluded.

Snippet boundaries now extend to whole tokens so clipping cannot manufacture a shorter apparent match. No database migration or PDF reimport is required; original PDFs and the page dialog remain unchanged. All nine automated tests pass, including Unicode/case/fuzzy spans, scope isolation, snippet clipping, HTTP payloads, and text-safe rendering. Browser appearance remains unverified in this socket-restricted environment.

## Search checkboxes and editable paper metadata — 2026-11-13

Added Case-insensitive and Fuzzy search checkboxes and independently selectable Title, Abstract, Authors and Full text fields below search. Defaults preserve literal case-insensitive title/full-text search, with fuzzy disabled. Browser choices persist locally; selected fields also constrain assistant retrieval. Result cards identify matching fields.

Case-sensitive mode verifies original tokens after FTS candidate retrieval. Fuzzy mode expands words of five or more characters to up to 32 vocabulary alternatives within one spelling edit, including adjacent transpositions; it does not use stemming. Tests cover combined case/fuzzy behavior and field isolation.

Database version 2 adds inferred author/abstract text, source page positions and an edit flag, extends FTS fields and adds a column-aware vocabulary view. Versions 0 and 1 migrate from stored pages without reopening PDFs or changing existing IDs/page text. Metadata detection is conservative and incomplete: 4 abstracts and 7 nonempty author fields were detected in the supplied 7-paper/150-page library. Paper details now lets users correct missing/inaccurate fields, and corrections survive rescans.

All six automated test groups pass, including migration from both earlier versions and checkbox/API behavior. Real-corpus checks confirm Authors-only `Maryam`, Abstract-only `transformer`, fuzzy `transfomer`, and original-case filtering. Browser rendering remains unverified because the execution environment blocks local sockets.

## Whole-word search and developer documentation — 2026-11-13

**Reported problem:** searching `transformer` returned “Liquid biopsy in cancer current status challenges,” although that word was absent.

**Cause:** the original Porter-stemmed FTS index merged `transformer` with `transformation` and `transformed`; query terms also had automatic prefix expansion. The reported paper matched `transformation` on PDF page 10.

**Correction:** the index now uses `unicode61 remove_diacritics 0`, and queries quote complete terms without appending `*`. Matching remains case-insensitive and combines multiple terms using OR. The UI hint and user README explain the new contract.

**Existing data:** database version 0 migrates transactionally to version 1 by rebuilding the derived FTS table from stored papers/pages. PDF files, paper IDs, extracted pages and timestamps are retained; reimport is unnecessary. Restart the running app to load the updated search code.

**Verification:** all four test groups passed, including a legacy-index regression and preservation checks. The supplied database retained 7 papers and 150 pages. Its `transformer` results dropped from 6 to 3; all remaining selected pages or titles contain the literal word. The reported paper is excluded. Browser verification remains unavailable in the current socket-restricted execution environment.

**Documentation:** added the hierarchical `development/` guide and root contributor instructions requiring updates alongside future implementation changes.

## Initial local library — 2026-11-13

Implemented recursive Poppler PDF extraction, SQLite page storage and FTS5 retrieval, local HTTP/browser UI, incremental rescans, PDF page links, import status/cancellation and the optional OpenWorker assistant. Tested the supplied cfDNA library: 7 PDFs and 150 pages, followed by an unchanged rescan. Live model answer quality and browser rendering were not exercised in the restricted execution session.
