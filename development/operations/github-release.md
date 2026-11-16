# GitHub build and release automation

The workflow is [.github/workflows/release.yml](../../.github/workflows/release.yml). It runs only for pushes to `main` and pull requests whose base branch is `main`. It has no tag, schedule, manual-dispatch or `pull_request_target` trigger.

| Event | Result |
| --- | --- |
| PR opened, updated or reopened against `main` | Check the declared version bump; test/build/inspect the Linux `.deb`; run the extracted installer smoke check; upload downloadable Actions artifacts for 14 days. No GitHub Release. |
| Push to `main` | The same checks, followed by a GitHub Release tagged `v<package version>` with all successful platform assets, build manifests and `SHA256SUMS`. |
| Other branch pushes or PR bases | No run. |

The first configured target is Linux x64 on Ubuntu 24.04, using Node 24 and the existing checksum-pinned Electron/runtime packaging. The workflow installs Poppler and the desktop libraries needed by the extracted executable. Regression and Node-mode packaged tests do not claim to validate the full graphical UI or live model sign-in. See [Linux qualification](linux-release.md#qualification-before-public-release).

## Declaring a version

The maintainer chooses significance as part of the code review; CI does not guess from commit messages or labels. Use one of these commands before committing:

```bash
npm run version:bump -- patch
npm run version:bump -- minor
npm run version:bump -- major
```

Choose **one**, not all three:

| Level | Use for | Example from 1.3.7 |
| --- | --- | --- |
| Patch | Compatible fixes, documentation and maintenance | 1.3.8 |
| Minor | Compatible new capabilities | 1.4.0 |
| Major | Breaking behavior/interfaces or compatibility changes | 2.0.0 |

[release-version.mjs](../../scripts/release-version.mjs) updates `package.json` and both root version entries in `package-lock.json`, resetting lower components when needed. It does not change dependencies, create a Git tag, commit or push. The desktop login client's default version also reads the package metadata, avoiding a second hardcoded version to maintain. This automation feature bumps 1.3.0 to **1.4.0**.

CI requires a stable `major.minor.patch` with matching package/lockfile entries and a number greater than the comparison commit. For a PR the comparison is its base SHA; for a main push it is the previous main SHA from the event. An initial branch-creation push with an all-zero previous SHA only checks synchronized valid version metadata. Every normal main push needs a version increase, including maintenance-only changes, because each successful push is intended to create a distinct release.

If another PR merges the same planned version first, update/rebase and bump again. Branch protection can require this workflow and an up-to-date branch before merging. Local checks:

```bash
npm run version:check
# Also check against a known earlier commit:
npm run version:check -- <full-base-commit-SHA>
```

## Assets, integrity and future platforms

The Linux build outputs a versioned file under `dist/`. [release-assets.mjs](../../scripts/release-assets.mjs) stages only regular, nonempty, versioned distribution files. It excludes old-version installers and unrelated/private files. Supported suffixes are `.deb`, `.rpm`, `.AppImage`, `.dmg`, `.pkg`, `.exe`, `.msi`, `.zip`, `.tar.gz` and `.tar.xz`; extend the explicit list for other future asset types.

Each build artifact contains its installers, `SHA256SUMS-<target>` and `build-<target>.json`. The manifest records the target, source commit, version, filenames, sizes and SHA-256 digests. `release-assets/` and the downloaded `incoming/` directories are ignored by Git.

To add a future platform, implement and qualify its builder/smoke checks, extend the workflow build matrix/jobs with its runner and platform-specific setup/build steps, and stage its outputs under a unique target name. Filename examples: `papertrail_1.4.0_amd64.deb`, `papertrail_1.4.0_arm64.dmg`. Windows/macOS installers are not implemented by this change. The shared publisher already collects multiple platform manifests; a failed matrix target prevents publishing a partial release.

The publishing job downloads only artifacts from its own workflow run. It rejects wrong-commit/version manifests, duplicate targets/asset names, symlinks, missing files and checksum/size mismatches before creating a release. It combines all verified assets and build manifests and produces a single `SHA256SUMS`. Locally, after building:

```bash
node scripts/release-assets.mjs stage linux-x64
```

Downloads from a PR are available under its Actions run's **Artifacts** section. Published installers are under [GitHub Releases](https://github.com/fortune9/papertrail/releases). Verify a downloaded release by placing its files together and running `sha256sum -c SHA256SUMS`.

## Publishing, permissions and retries

Build jobs have `contents: read`, with checkout credentials persistence disabled. Only the release job, guarded by `push` plus `refs/heads/main`, has `contents: write`. It passes the built-in `GITHUB_TOKEN` as `GH_TOKEN` only to the publishing step. No additional personal token or AI credentials are required. Actions are pinned to verified full commit SHAs. PRs from forks never enter the write-enabled release job.

[publish-release.mjs](../../scripts/publish-release.mjs) independently enforces the event/ref guard, verifies local checksums and checks any existing version tag's source commit. It uses GitHub CLI’s REST API command to create a draft anchored to the exact tested SHA and keeps the release ID returned by creation. GitHub’s by-tag REST endpoint returns published releases, so draft recovery instead searches the authenticated release listing, with pagination. Upload verification retrieves the draft by numeric ID. GitHub CLI uploads the verified assets; their uploaded sizes/digests are checked before publishing. Generated notes describe the release. GitHub's semantic-version latest-release selection (`make_latest=legacy`) handles builds finishing out of order. A tag collision with a different commit fails instead of retagging.

If upload/verification fails, the draft remains unpublished. A rerun of the same main commit can replace that run’s Actions build artifact, resume the draft and replace its draft assets. An already published release at the same source tag is left intact, avoiding nondeterministic rebuilds overwriting public downloads. Distinct main commits have separate concurrency groups, so a newer push does not cancel an older version's release; PR updates cancel obsolete PR runs.

No workflow run or release is created merely by writing these local files. A hosted run of 1.4.0 built and collected its assets successfully but failed at publication because the original publisher tried to retrieve a draft through the published-release-by-tag endpoint. The 1.4.1 patch fixes creation, retry discovery and upload verification. Commit/push the patch to main to build and release 1.4.1; rerunning the old commit still executes the old publisher. Any failed 1.4.0 draft is left untouched. Organization/repository rules must allow Actions and the workflow's declared release permission. Existing GUI/signing/notarization/automatic-update limitations remain as documented in the Linux guide.

## Verification and references

Local tests model by-tag lookups returning 404 for drafts, paginated draft recovery and draft retrieval by ID. They also cover version synchronization and bump levels, rejection of a missing increase, exclusion of stale/private files, multi-platform collection, digest/size/source checks, main-only publishing, draft upload order, retries, immutable published assets and tag collisions. GitHub API/CLI publication is mocked in these tests; it does not publish a release. The workflow is checked with actionlint and its event/permission boundaries are inspected separately.

Primary references: [workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow), [GITHUB_TOKEN permissions](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token), [GitHub release CLI](https://cli.github.com/manual/gh_release_create), [release API](https://docs.github.com/en/rest/releases/releases).
