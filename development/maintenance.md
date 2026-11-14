# Documentation maintenance policy

Implementation documents must be updated in the same change as the behavior they describe. This is a contributor requirement recorded in root [AGENTS.md](../AGENTS.md), not an automated documentation generator.

## Change-to-document map

| Change | Required review/update |
| --- | --- |
| File discovery, extraction, resource limits, rescans or cancellation | [Indexing](architecture/indexing.md), [verification](operations/verification.md) |
| Query parsing, matching, ranking, snippets or pagination | [Search](architecture/search.md), UI hint, root README, regression tests |
| Tables, stored fields or index migration | [Database](reference/database.md), relevant architecture page, migration/preservation tests |
| Metadata detection, editing or preservation | [Indexing metadata section](architecture/indexing.md#author-and-abstract-fields), [database](reference/database.md), [HTTP and UI](reference/http-and-ui.md), backfill/rescan tests |
| Routes, payloads or UI interactions | [HTTP and UI](reference/http-and-ui.md), root README if user-visible |
| Model configuration, prompts, tools, sessions or streaming | [Assistant](architecture/assistant.md), configuration/verification guidance |
| Processes, dependencies, trust boundaries or storage ownership | [Overview](architecture/overview.md), root README |
| Environment requirements or commands | [Verification](operations/verification.md), root README and `.env.example` |
| Any user-visible behavior correction | [Change record](changes.md), with cause, fix, migration impact and evidence |
| Desktop startup, settings, login, storage or IPC | [Desktop architecture](architecture/desktop.md), [HTTP and UI](reference/http-and-ui.md), desktop regression tests |
| Installer, Electron version, native helper layout or system dependencies | [Linux release guide](operations/linux-release.md), runtime/optional-tool checksum manifests, packaged smoke and archive checks |

Keep the [documentation map](README.md) current when adding, moving or removing pages. Link relative to each document's own directory. Prefer explaining the source's purpose, data flow and constraints over copying entire implementations into prose.

## Completion checks

1. Confirm the affected documentation matches the final code, including defaults and limitations.
2. Update user help when matching rules or user-facing behavior changes.
3. Run appropriate checks; for search/index/schema changes, run `npm test` with a regression covering the behavior at issue.
4. Describe migrations and preservation of existing user data. Separate source-of-truth records from rebuildable derived data.
5. Record actual validation results and any unexercised browser/provider/platform paths. Do not carry forward stale counts or examples after a change invalidates them.

Documentation-only changes do not require a new test unless an example or executable command needs verification. Future features should be clearly marked as planned rather than described as implemented.
