# Papertrail implementation guide

This documentation describes the current implementation. Start with the system overview, then follow the component links for details.

```text
development/
├── README.md                         Documentation map
├── architecture/
│   ├── overview.md                   Processes, components and data flow
│   ├── indexing.md                   Folder discovery and PDF extraction
│   ├── search.md                     Token matching, ranking and migration
│   ├── assistant.md                  OpenWorker lifecycle and shared retrieval
│   ├── codex.md                      Local Codex SDK backend and authentication
│   └── desktop.md                    Electron shell, storage, IPC and GUI sign-in
├── reference/
│   ├── database.md                   Tables, relationships and versions
│   └── http-and-ui.md                Routes and browser behavior
├── operations/
│   ├── verification.md               Running, testing and troubleshooting
│   └── linux-release.md              Building/qualifying the Linux .deb
├── maintenance.md                    How to keep these documents current
└── changes.md                        Behavior changes and supporting evidence
```

## Reading paths

| Question | Document |
| --- | --- |
| How is the app put together? | [Architecture overview](architecture/overview.md) |
| How did you index my files? | [Indexing pipeline](architecture/indexing.md) |
| Why does a paper match my query? | [Search implementation](architecture/search.md) |
| What is in the database? | [Database reference](reference/database.md) |
| What does the AI receive? | [Assistant implementation](architecture/assistant.md) |
| How does ChatGPT sign-in work with local Codex? | [Codex backend](architecture/codex.md) |
| How does the installable desktop app work? | [Desktop architecture](architecture/desktop.md) |
| How do I build and verify its Linux installer? | [Linux release guide](operations/linux-release.md) |
| How do the browser and server communicate? | [HTTP and UI reference](reference/http-and-ui.md) |
| What was tested, and how can I reproduce it? | [Verification](operations/verification.md) |

Source files are linked from each page. See the root [README](../README.md) for installation and day-to-day use. The [maintenance policy](maintenance.md) and root [AGENTS.md](../AGENTS.md) require documentation to change alongside implementation; the documents do not update themselves automatically.
