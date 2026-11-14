# Papertrail implementation guide

This documentation describes the current implementation. Start with the system overview, then follow the component links for details.

```text
development/
├── README.md                         Documentation map
├── architecture/
│   ├── overview.md                   Processes, components and data flow
│   ├── indexing.md                   Folder discovery and PDF extraction
│   ├── search.md                     Token matching, ranking and migration
│   └── assistant.md                  OpenWorker lifecycle and retrieval
├── reference/
│   ├── database.md                   Tables, relationships and versions
│   └── http-and-ui.md                Routes and browser behavior
├── operations/
│   └── verification.md               Running, testing and troubleshooting
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
| How do the browser and server communicate? | [HTTP and UI reference](reference/http-and-ui.md) |
| What was tested, and how can I reproduce it? | [Verification](operations/verification.md) |

Source files are linked from each page. See the root [README](../README.md) for installation and day-to-day use. The [maintenance policy](maintenance.md) and root [AGENTS.md](../AGENTS.md) require documentation to change alongside implementation; the documents do not update themselves automatically.
