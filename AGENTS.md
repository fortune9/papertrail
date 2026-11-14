# Working on Papertrail

Read [development/README.md](development/README.md) before changing implementation.

The user requires hierarchical implementation documents in `development/` and updates whenever implementation changes. Update the affected documents in the same change as the code. Use [development/maintenance.md](development/maintenance.md) to identify the relevant pages, record behavior changes in [development/changes.md](development/changes.md), and keep the main README and UI help consistent. Document actual behavior and verification limits.

For indexing, schema, search or migration changes, run `npm test` and add meaningful regression coverage. Preserve original PDFs, paper IDs and stored page text when rebuilding derived indexes. Do not require PDF reimport for an index-only change when stored text is sufficient.

Do not change the pinned OpenWorker SDK or immutable agent definition identity without following the OpenWorker builder skill. Application changes must retain offline indexing and search without model credentials.
