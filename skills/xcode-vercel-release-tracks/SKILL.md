---
name: xcode-vercel-release-tracks
description: Set up semantic-versioned release tracks in a monorepo that ships an Xcode app through TestFlight and web apps or APIs on Vercel — one main branch, a version, changelog and <track>-vX.Y.Z tag per deployable, a standing release PR per track, main builds to TestFlight internal and a Vercel staging environment, tags to TestFlight external (Beta App Review) and Vercel production. Use when asked to "set up releases", "semantic versioning", "auto versioning", "release tracks", "only tagged builds go to TestFlight", "staging vs production on Vercel", "release PR like opscope", or to add, change or debug release-pr.yml / tag-release.yml / testflight.yml / release-tracks.json in such a repo. For one-off TestFlight uploads without versioning, just run xcodebuild; this skill is for the whole release system.
metadata:
  author: stealth-factory
  co-author: wiiiimm
  version: "1.0.0"
---

# xcode-vercel-release-tracks

Installs a release system into a monorepo with an Xcode app and one or more
Vercel projects. Everything merges to one `main`; each deployable is a **track**
with its own semver.

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
| `.github/release-tracks.json` | the per-repo config: tracks, their paths, manifest, kind, how they ship |
| `.github/scripts/release-track.sh` | everything about a track: next version, bump, changelog notes |
| `.github/scripts/install-git-cliff.sh` | pinned, checksummed git-cliff (Linux x86_64, macOS arm64) |
| `cliff.toml` (repo root) | changelog format and bump rules, shared by all tracks |
| `.github/workflows/pr-title.yml` | PR titles must be Conventional Commits (they become the squash commit) |
| `.github/workflows/release-pr.yml` | standing `release(<track>): vX.Y.Z` PR per track |
| `.github/workflows/tag-release.yml` | on merge: tag, GitHub Release, then ship (TestFlight dispatch / production branch) |
| `.github/workflows/testflight.yml` | main → internal; `<apple>-v*` tag → external + Beta App Review |
| `.github/scripts/testflight-external.mjs` | App Store Connect API: wait, What to Test, external group, review |
| `.github/workflows/neon-refresh-staging.yml` | manual reset of a track's Neon `staging` branch |
| `<track dir>/CHANGELOG.md` | from `templates/CHANGELOG.md`, one per track, hand-written baseline |
| `<vercel app>/vercel.json` | merge in the `git.deploymentEnabled` block from `templates/vercel.json` |
| `ExportOptions.plist` | from the template if the app has none (set the team id) |

Skip the Apple files if the repo has no app, the Vercel bits if it has no
Vercel project, and `neon-refresh-staging.yml` if there is no Neon.

## Procedure

1. **Inventory the repo.** List the deployables and where each lives. For each,
   find the version source:
   - XcodeGen `project.yml` with `MARKETING_VERSION:` → kind `xcodegen`;
   - an `.xcconfig` with `MARKETING_VERSION = …` → kind `xcconfig` (if the
     version only lives in `project.pbxproj`, move it to an xcconfig first);
   - `package.json` → kind `package-json` (add `"version": "0.1.0"` if absent).

   Decide each track's `paths`: its own folder, plus shared code it ships
   (workspace packages, the lockfile). A shared path may belong to several
   tracks. Repo-root CI and docs belong to none.
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
   API). Set the matrix `platform` list and `PLATFORMS` (`IOS`, `MAC_OS`,
   `TV_OS`, `VISION_OS`) to what the app ships. Delete the XcodeGen step for a
   committed `.xcodeproj`. In `vercel.json` replace `__TRACK__`. Then
   `grep -rn '__[A-Z_]*__' .github cliff.toml` must print nothing.
4. **Baseline changelogs.** One `CHANGELOG.md` per track with the template
   header and a hand-written `## [<current version>] - <today>` section. The
   first `tag-release.yml` run tags that version as the track's baseline.
5. **Document it in the repo's `AGENTS.md`/`CLAUDE.md`:** the track table
   (track, paths, version file, tags), "never edit versions or changelogs
   outside a release PR", "never commit to `production/*`", and the PR title
   rule: `type(scope): subject`, subject lowercase, no full stop, `!` for
   breaking; `feat`/`fix`/`perf`/`revert` release, other types ride along; the
   scope is a changelog label and does not pick the track.
6. **Verify locally before pushing** (in a scratch clone, never pushed):
   install git-cliff, tag each track's baseline locally, make a `feat:` commit
   touching one track and a `fix:` touching a shared path, then
   `release-track.sh next <track>` for each (expect minor / patch / no) and
   `release-track.sh bump` + `notes` (check the changelog section and the
   manifest). Run `actionlint` on the workflows: the only expected finding is
   `concurrency.queue` in `testflight.yml`, which GitHub accepts. Delete the
   local tags afterwards.
7. **Hand over the setup checklist**
   ([reference/setup-checklist.md](reference/setup-checklist.md)): GitHub
   (squash title, release App, `production/*` ruleset), App Store Connect
   (API key secrets, internal group with automatic distribution, external
   group, Test Information), Vercel (production branch, staging custom
   environment, Deployment Protection, ignored build step), Neon (staging
   branch, scoped `DATABASE_URL`). Do the API-reachable items yourself when you
   have access; the Vercel and Neon items must be done **before** the first
   push that links a new project.
8. **Open the PR** titled e.g. `ci: release tracks and two-stage testflight`.
   `ci` does not cut a release. Say in the body that merging it lays baseline
   tags and creates `production/<track>` branches, and which setup items are
   still the user's.

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
- **Beta App Review rejected:** fix, merge, and cut the next patch; a version
  that went out is never re-tagged.
- **`production/<track>` refused to move:** someone committed to it or `main`
  was rewritten. Investigate; do not force.
- **Add a track later:** add it to `release-tracks.json`, add its changelog and
  manifest version, merge; the next `tag-release.yml` run lays its baseline.

## Rules

- Never edit a version, changelog or tag by hand outside a release PR, and
  never make the build rewrite its source to match a tag.
- Never commit to `release/*` or `production/*`; never force-push them.
- Never ship a Vercel protection-bypass secret inside an app binary.
- Pin every action by commit SHA with the version in a comment, as the
  templates do.
