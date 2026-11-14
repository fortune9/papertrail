# PDF indexing pipeline

Implementation: [Library.startImport and Library.importFolder](../../src/library.js). Storage details: [database reference](../reference/database.md).

## 1. Discover files

`POST /api/import` provides a folder path. The service resolves it to an absolute real path, confirms it is a directory, and records the root. A second import is rejected while one is running.

The importer walks the directory tree using `fs.readdir(..., { withFileTypes: true })`. It collects regular files whose names end in `.pdf`, case insensitively. Subdirectories are visited recursively. Symlink entries are skipped, preventing ordinary link cycles or traversal into linked folders. Discovery finishes before file extraction begins.

The job records discovered/processed counts, the current file, indexed/unchanged/failed/removed counts, and up to 100 ordinary issue messages. Directory read failures are recorded and mark the scan incomplete. The UI polls this job through `/api/status`.

## 2. Decide whether extraction is needed

File identity is its absolute path, not a content hash. For each path, the importer compares its size and modification time in milliseconds with the stored record. If both are unchanged and the prior status is not `error`, extraction is skipped. Error records are retried. Thus a blank scanned PDF is skipped on later unchanged scans, while a corrupt file is retried.

The importer does not deduplicate identical PDFs at different paths. A rename behaves as a new path plus removal of the old path. Content modified while preserving both size and modification time will not be detected by this shortcut.

## 3. Extract text by page

For each new, modified or previously failed PDF:

1. Reject files larger than 100 MiB.
2. Resolve the file's real path again and verify that it remains under the selected root.
3. Execute `pdftotext -enc UTF-8 <absolute-file-path> -` through `execFile`, without a shell.
4. Limit extraction to 60 seconds and subprocess output buffering to 32 MiB.
5. Split stdout on form-feed (`\f`) page boundaries and discard an empty trailing segment.

The resulting page numbers are one-based PDF page positions, not printed journal page labels. Extracted text is saved as returned; reading order, line breaks, ligatures and hyphenation depend on Poppler and the PDF's text layer. Images and tables are not separately parsed. OCR is not performed.

The title is the filename without its extension, with underscores converted to spaces and whitespace collapsed. Publisher headers on page one are deliberately not used as titles.

### Author and abstract fields

[src/metadata.js](../../src/metadata.js) examines the first three stored pages without a model call. It normalizes a working copy with NFKC, looks for an explicit Abstract/Summary heading, and stops at recognized headings such as Introduction, Keywords or publication notices. Abstract text is limited to 12,000 characters. Unlabeled abstracts remain empty rather than treating all opening text as an abstract.

Authors come from an explicit Authors heading or a conservative name-like byline heuristic before Abstract/Summary. It filters common affiliation lines, strips numeric affiliation markers and caps text at 4,000 characters. These are editable text fields, not a verified structured author list. Layout can truncate, reorder or contaminate bylines; missing fields stay empty. The originating page number is retained for each field. A paper dialog lets users save corrections without changing the PDF.

For existing databases, migration derives these fields from stored pages without re-extraction. On a changed-file rescan, inferred metadata is refreshed unless `metadata_edited=1`; user corrections survive. Saved field page positions are clamped to the new page count. Corrections do not rewrite original extracted page text or claim that edited wording is present in the PDF.

## 4. Save one paper atomically

Each paper uses its own SQL transaction. For an existing paper, old page rows and FTS rows are deleted. The metadata record is upserted using its unique path, preserving its paper ID. New page rows and one FTS row per page are inserted. Authors and abstract are included in their originating page's FTS columns, then the transaction commits. A paper without page segments gets a title row at page 1 that can also carry manually supplied metadata. Metadata edits use a separate transaction to update both the paper and its FTS columns.

| Status | Meaning |
| --- | --- |
| `ready` | At least one extracted page contains non-whitespace text |
| `no-text` | Extraction completed, but no page contains usable text; likely needs OCR |
| `error` | Extraction failed or a resource limit was hit; a diagnostic is stored |

An extraction failure replaces any previous searchable page text for that path with an error record rather than leaving stale content searchable. A transaction failure rolls back that paper's writes. Individual extraction failures are recorded and the import continues.

## 5. Reconcile removed files

After a complete, uncancelled scan, existing records owned by that root whose paths were not discovered are removed from `search` and `papers`; foreign keys cascade deletion to `pages`. A directory discovery failure or outer file-processing failure prevents this cleanup. Extraction failures for discovered files keep their error records. Original PDF files are never removed or edited.

Roots can overlap, but a paper has only one recorded owner root; this is not a many-to-many collection system.

## Cancellation and restart

Stop sets `job.cancelled`. Discovery checks this flag, and extraction checks it between files. The currently executing `pdftotext` is allowed to complete; user cancellation does not kill it. Cancelled scans do not remove missing-path records. Committed papers remain available. After an application restart, start another scan; unchanged committed papers are skipped.
