---
name: xcode-vercel-release-tracks
description: Set up semantic-versioned releases for an Xcode app shipped through TestFlight, either on its own in a plain Xcode app repo or as one track of a monorepo that also ships web apps or APIs on Vercel — one main branch, a version, changelog and <track>-vX.Y.Z tag per deployable, a standing release PR per track, main builds to TestFlight internal (and a Vercel staging environment), tags to TestFlight external with Beta App Review (and Vercel production). Use when asked to "set up releases", "semantic versioning", "auto versioning", "release tracks", "release PR like opscope", "only tagged builds go to TestFlight", "internal vs external testers", "staging vs production on Vercel", "should we version the API", "/v1 prefix", "old app builds still call the API", or to add, change or debug release-pr.yml / tag-release.yml / testflight.yml / release-tracks.json. Laying out the monorepo itself (pnpm, Turborepo, Vercel projects, Neon) is the sibling skill turborepo-vercel-monorepo; for a one-off TestFlight upload without versioning, just run xcodebuild.
metadata:
  author: stealth-factory
  co-author: wiiiimm
  version: "1.3.0"
---

# xcode-vercel-release-tracks

Installs a release system for an Xcode app and, optionally, Vercel projects
beside it. Everything merges to one `main`; each deployable is a **track** with
its own semver. Pick the mode first:

| Mode | Repo | Tracks | Skip |
| --- | --- | --- | --- |
| **Xcode app only** | a plain app repo (`App.xcodeproj` or `project.yml` at or near the root) | one `apple` track, `paths: ["."]` | Vercel, Neon, `vercel.json`, `neon-refresh-staging.yml`, the `production/*` ruleset |
| **Monorepo** | Turborepo/pnpm with `apps/apple`, `apps/api`, `apps/web`, … (the sibling skill turborepo-vercel-monorepo lays it out) | `apple` plus one per Vercel project | nothing; drop the Apple files if there is no app |

Same workflows and script in both: a mode is only what `release-tracks.json`
lists and which templates you copy. Start Xcode-only and add Vercel tracks
later without changing what is already there.

| Stage | Vercel track | Apple track |
| --- | --- | --- |
| Merge to main | `staging` custom environment (fixed domain, staging env vars, Neon `staging` branch) | TestFlight internal, build points at the staging API |
| Merge the track's release PR → tag `<track>-vX.Y.Z` | tag fast-forwards `production/<track>`; Vercel builds production | TestFlight external, Beta App Review |
| By hand | n/a | App Store submission of a tested external build |

Why it is shaped this way, the alternatives rejected and the day-one gotchas:
[reference/design.md](reference/design.md). Read it before changing the shape.

## What you install

From [templates/](templates/) into the target repo (`templates/github/` → `.github/`):

| File | Job |
| --- | --- |
| `.github/release-tracks.json` | the per-repo config: tracks, their paths, manifest, kind, how they ship. Start from `release-tracks.json` (monorepo) or `release-tracks.xcode.json` (Xcode app only) |
| `.github/scripts/release-track.sh` | everything about a track: next version, bump, changelog notes |
| `.github/scripts/install-git-cliff.sh` | pinned, checksummed git-cliff (Linux x86_64, macOS arm64) |
| `cliff.toml` (repo root) | changelog format and bump rules, shared by all tracks |
| `.github/workflows/pr-title.yml` | PR titles must be Conventional Commits (they become the squash commit) |
| `.github/workflows/release-pr.yml` | standing `release(<track>): vX.Y.Z` PR per track |
| `.github/workflows/tag-release.yml` | on merge: tag, GitHub Release, then ship (TestFlight dispatch / production branch) |
| `.github/workflows/testflight.yml` | main → internal; `<apple>-v*` tag → external + Beta App Review |
| `.github/scripts/testflight-external.mjs` | App Store Connect API: wait, What to Test, external group, review |
| `.github/scripts/asc-certificates.mjs` | revokes the Apple Development certificates CI signing leaves behind (revoke-own, prune) |
| `.github/scripts/asc-certificates.test.mjs` | its tests: `node --test '.github/scripts/*.test.mjs'`, no dependencies |
| `.github/workflows/apple-certificates.yml` | manual: list, then revoke, every CI-made development certificate |
| `.github/workflows/neon-refresh-staging.yml` | manual reset of a track's Neon `staging` branch |
| `<track dir>/CHANGELOG.md` | from `templates/CHANGELOG.md`, one per track, hand-written baseline |
| `<vercel app>/vercel.json` | merge in the `git.deploymentEnabled` block from `templates/vercel.json` |
| `ExportOptions.plist` | from the template if the app has none (set the team id) |

Skip the Apple files if the repo has no app, the Vercel bits if it has no
Vercel project, and `neon-refresh-staging.yml` if there is no Neon. Install
the sibling skill turborepo-vercel-monorepo
(`npx skills@1.5.23 add stealth-factory/private-skills --skill turborepo-vercel-monorepo`)
when the monorepo itself does not exist yet.

## Procedure

1. **Inventory the repo.** List the deployables and where each lives. For each,
   find the version source:
   - XcodeGen `project.yml` with `MARKETING_VERSION:` → kind `xcodegen`;
   - an `.xcconfig` with `MARKETING_VERSION = …` → kind `xcconfig`;
   - only `project.pbxproj` (Xcode's default) → kind `pbxproj`, manifest
     `<App>.xcodeproj/project.pbxproj`. Every target and configuration must
     already carry the same `MARKETING_VERSION` (the script refuses a mix, and
     App Store Connect rejects extensions whose version differs from the app):
     set them all to one `X.Y.Z` first, replacing Xcode's default `1.0`;
   - `package.json` → kind `package-json` (add `"version": "0.1.0"` if absent).

   Decide each track's `paths`: its own folder, plus shared code it ships
   (workspace packages, the lockfile). A shared path may belong to several
   tracks. Repo-root CI and docs belong to none. **Xcode app only:** `paths`
   is `["."]`, so every commit counts (a `ci:` or `docs:` commit still rides
   along without starting a release), and the changelog is `./CHANGELOG.md`.
2. **Write `.github/release-tracks.json`** from the template. `ship` is
   `testflight`, `vercel` or `none`. `changelog` defaults to
   `<first path>/CHANGELOG.md`. Track names become tag prefixes; keep them short
   and lowercase (`apple`, `api`, `web`).
3. **Copy the templates and fill the placeholders** in `testflight.yml`:
   `__APPLE_TRACK__` (track name), `__APPLE_DIR__` (folder with the project),
   `__XCODE_PROJECT__`, `__SCHEME__`, `__BUNDLE_ID__`,
   `__EXPORT_OPTIONS_PLIST__` (path relative to `__APPLE_DIR__`) and
   `__API_URL_SETTING__` (the build setting the app reads its API base URL
   from; delete the "Pick the API" step and the setting if the app calls no
   API). Set the matrix `platform` list and the external step's `PLATFORMS`
   (`IOS`, `MAC_OS`, `TV_OS`, `VISION_OS`) to what the app ships, and list
   every path of the Apple track in the `push.paths` filter. **Xcode app only:**
   `__APPLE_DIR__` is `.` (or the folder holding the project), delete the
   `push.paths` filter, and delete the "Pick the API" step unless the app talks
   to an API with separate staging and production URLs. Delete the XcodeGen
   step for a committed `.xcodeproj`. In `ExportOptions.plist` replace `__TEAM_ID__`; in
   each `vercel.json` replace `__TRACK__`. Then
   `grep -rn '__[A-Z_]*__' .github cliff.toml <apple dir>/<export options> <app>/vercel.json`
   must print nothing. Check the app's Info.plist sets
   `ITSAppUsesNonExemptEncryption` (usually `false`): without it every build
   waits on an export compliance answer and the external stage stops.
4. **Baseline changelogs.** One `CHANGELOG.md` per track with the template
   header and a hand-written `## [<current version>] - <today>` section. The
   first `tag-release.yml` run tags that version as the track's baseline.
5. **Document it in the repo's `AGENTS.md`/`CLAUDE.md`:** the track table
   (track, paths, version file, tags), "never edit versions or changelogs
   outside a release PR", "never commit to `production/*`", and the PR title
   rule: `type(scope): subject`, subject lowercase, no full stop, `!` for
   breaking; `feat`/`fix`/`perf`/`revert` release, other types ride along; the
   scope is a changelog label and does not pick the track. If the app calls
   an API in the repo, also the compatibility rules: the API is additive by
   default because shipped app builds keep calling it, every endpoint lives
   under `/v1`, and only a breaking change (`feat!:` on the api track; a
   major bump from `1.0.0`, a minor bump below it) adds `/v2` for all
   endpoints while `/v1` stays until old builds are gone
   ([reference/design.md](reference/design.md), "API compatibility").
6. **Verify locally before pushing** (in a scratch clone, never pushed):
   install git-cliff, tag each track's baseline locally, make a `feat:` commit
   touching one track and a `fix:` touching a shared path, then
   `release-track.sh next <track>` for each (expect minor / patch / no) and
   `release-track.sh bump` + `notes` (check the changelog section and the
   manifest). Xcode app only: one `feat:` commit anywhere gives a minor bump,
   and a `pbxproj` bump must change every `MARKETING_VERSION` line. Run `actionlint` on the workflows: the only expected finding is
   `concurrency.queue` in `testflight.yml`, `apple-certificates.yml` and `tag-release.yml`, which
   GitHub accepts. Run `node --test '.github/scripts/*.test.mjs'` (Node 22 needs the quoted glob,
   not a directory). Delete the local tags afterwards.
7. **Hand over the setup checklist**
   ([reference/setup-checklist.md](reference/setup-checklist.md)): GitHub
   (squash title, release App, `production/*` ruleset), App Store Connect
   (API key secrets, internal group with automatic distribution, external
   group, Test Information), Vercel (production branch, staging custom
   environment, Deployment Protection, ignored build step), Neon (staging
   branch, scoped `DATABASE_URL`). Do the API-reachable items yourself when you
   have access; the Vercel and Neon items must be done **before** the first
   push that links a new project. **Xcode app only:** the GitHub and App
   Store Connect sections are the whole list.
8. **Open the PR** titled e.g. `ci: release tracks and two-stage testflight`.
   `ci` does not cut a release. Say in the body that merging it lays baseline
   tags and ships nothing (the first real release of a Vercel track creates
   its `production/<track>` branch), and which setup items are still the
   user's.

## Day-two operations

- **Cut a release:** merge the track's open `release(<track>): …` PR. Nothing
  else. Re-running `tag-release.yml` is safe.
- **No release PR appeared:** nothing releasable since the last tag for that
  track (only docs/chores, or commits outside its paths), or the baseline tag
  is missing. `release-track.sh next <track>` says which.
- **Release PR has no checks:** it was opened with GITHUB_TOKEN; configure the
  release App (`RELEASE_APP_CLIENT_ID`, `RELEASE_APP_PRIVATE_KEY`).
- **Re-run a TestFlight stage:** Actions → TestFlight → Run workflow at `main`
  (internal) or at the tag (external). Branch refs are refused by design.
  After a failed external step, re-run just the `external` job: it finds the
  builds by version and run start time.
- **"Your account has reached the maximum number of certificates":** each
  upload signs on a fresh Mac, and Xcode makes a new Apple Development
  certificate there that nothing can use afterwards. Each upload job in
  `testflight.yml` revokes its own at the end, pass or fail, matched by serial
  number from the runner's keychain, so a parallel platform job or another
  repository on the same Apple team keeps its certificate. A backlog from
  before that, or a job whose clean-up warned, is cleared with Actions → Apple
  certificates: run it with *apply* off to see the list, then on while no
  repository on the team is uploading (it revokes every CI-made certificate on
  the team, and its concurrency group covers one repository). Only
  certificates named "Created via API" are touched, never one a person's Xcode
  made, and revoking a development certificate does not affect builds already
  on TestFlight or the App Store.
- **Beta App Review rejected:** fix, merge, and cut the next patch; a version
  that went out is never re-tagged.
- **`production/<track>` refused to move:** someone committed to it or `main`
  was rewritten. Investigate; do not force.
- **Xcode app grows a backend:** move the app under `apps/apple` (or keep it
  at the root and give it explicit `paths` instead of `.`), add the Vercel
  tracks, and follow the Vercel and Neon parts of the checklist. The apple
  track's tags and versions carry on unchanged.
- **Breaking API change:** a `feat!:` PR on the api track that adds `/v2` for
  every endpoint (unchanged handlers mounted under both prefixes), merged and
  released **before** the app release that needs it. Keep `/v1` until the
  minimum supported app version passes the last build that used it. Undo a
  bad api release with Vercel's instant rollback only to a deployment that
  still serves every shipped app build (one without `/v2` is not a target
  once an app needs it; roll forward with a patch instead), and never by
  routing old app builds to old deployment URLs.
- **Add a track later:** add it to `release-tracks.json`, add its changelog and
  manifest version, merge; the next `tag-release.yml` run lays its baseline.

## Rules

- Never edit a version, changelog or tag by hand outside a release PR, and
  never make the build rewrite its source to match a tag.
- Never commit to `release/*` or `production/*`; never force-push them.
- Never ship a Vercel protection-bypass secret inside an app binary.
- Never rename, remove or change the meaning of an API field or endpoint a
  shipped app build reads outside a new `/v<n>` prefix.
- Pin every action by commit SHA with the version in a comment, as the
  templates do.
