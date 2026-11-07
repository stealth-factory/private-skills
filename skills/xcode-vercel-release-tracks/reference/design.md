# Design: why it is shaped like this

Read when a user asks *why*, wants to change the shape, or a repo does not fit.

## One rule across every track

**main is for the team, a tag is for the public, the store is a promotion by hand.**

| Stage | Trigger | Vercel track (api, web) | Apple track | Database (Neon) |
| --- | --- | --- | --- | --- |
| Local | developer machine | `vercel dev`, Development env vars | Xcode Debug build, Simulator | dev branch or local Postgres |
| PR branch | push to a branch | Preview deployment, Preview env vars | CI build and tests only, nothing uploaded | `preview/<branch>` from the integration, deleted with the deployment |
| Merge to main | push to `main` | `staging` custom environment, fixed domain, staging env vars | TestFlight **internal** group (automatic distribution), build points at the staging API | persistent `staging` branch |
| Release tag | merging the track's release PR | tag fast-forwards `production/<track>`; Vercel builds Production | tagged build uploaded, added to the **external** group, Beta App Review | production branch |
| Store | by hand | n/a | pick a tested external build in App Store Connect and submit | production |

## Versioning

- One `main`. Each deployable target is a **track** with its own semver, changelog and tags `<track>-vX.Y.Z`.
- A commit belongs to every track whose `paths` it touches (git-cliff `--include-path`, `--tag-pattern`). Nobody assigns tracks; the PR title only says *how much* to bump (`feat` minor, `fix` patch, `!` breaking; below 1.0 breaking bumps minor).
- Only `feat`, `fix`, `perf`, `revert` and breaking changes start a release. Everything else rides along in the next changelog.
- Release PR per track, `release(<track>): vX.Y.Z`, rebuilt on every merge to main. Merging it is the release decision. The manifest is bumped in that commit **before** the tag, and the build never edits its source to match a tag.
- A track's first tag is a **baseline**: it marks what exists, ships nothing and gets no GitHub Release.
- GitHub's **Latest** badge goes to an app-store (`testflight`) track's release, because that is what people install. Until such a release exists, every release takes Latest. Otherwise a repo whose apple track has only its baseline keeps the badge on whatever release held it before the tracks, often an old pre-track tag.
- Adapted from stealth-factory/opscope's release-pr / tag-release / pr-title flow, which ships one product; this runs it once per track.

## Why these choices

- **One skill with two modes, not an Xcode skill and a Vercel skill.** The release engine (`release-track.sh`, `release-pr.yml`, `tag-release.yml`, `cliff.toml`) is the same for both; only `ship` differs. Two skills would carry two copies of it that drift. An Xcode-only repo is one `apple` track with `paths: ["."]`, and it becomes a monorepo by adding tracks, with no migration of tags or versions. Laying out the monorepo is a separate concern, in turborepo-vercel-monorepo. Decided 2026-10-26 (SWR-1077).
- **git-cliff over release-please.** Path routing per track, the "releasable types only" gate and the manifest kinds (`xcodegen`, `xcconfig`, `package-json`) are a few lines of shell around git-cliff; the opscope lineage already proved the release-PR shape. Reviewed and kept on 2026-10-23.
- **Production branch fast-forward over `vercel deploy --prod` from Actions.** Vercel's own tag guide disables Git deploys and deploys from Actions with a token. Moving `production/<track>` keeps the native Git integration (PR previews, comments, Neon preview branching, skew protection, instant rollback) and needs no Vercel token.
- **Staging custom environment over main-as-preview.** It gets its own env-var scope (no staging secrets leaking into PR previews), a fixed domain and `VERCEL_TARGET_ENV=staging`. Pro includes one custom environment per project. On Hobby, fall back to a branch domain on `main` plus branch-scoped Preview env vars; the workflows do not change.
- **Not staged production + `vercel promote`.** A staged production build uses production env vars, so it cannot be staging, and Next.js inlines env vars at build time.
- **Persistent Neon `staging` branch** rather than the integration's `preview/main`: a recognisable name, never garbage-collected with old deployments, and migrations rehearse against it on every main deploy. Refresh it with reset-from-parent (`neon-refresh-staging.yml`).
- **Internal builds labelled with the next version.** Beta App Review counts external builds only, so the tagged build is still the first reviewed build of its version. When nothing releasable has landed since the last tag, the label is the next patch, so a build never joins a version that has already gone out. Expect orphan internal versions when a `feat` lands after a `fix` (0.1.1 builds, then 0.2.0): harmless.
- **Build number = whole minutes since the Unix epoch.** Monotonic across re-runs and within macOS's 4.2.2-digit limit.

## Gotchas that bite on day one

- **Deployment Protection.** Pro protects non-production deployments (custom environments included) with Vercel Authentication. An app build calling staging gets an HTML login page. Turn protection off for the staging environment of an API project, or send `x-vercel-protection-bypass` (never ship that secret in an app binary: anyone with the build can extract it and it unlocks every preview).
- **Cross-track builds.** Vercel builds every linked project on every pushed branch, so a push to `production/api` builds a web preview and a stray Neon branch. Each app's `vercel.json` disables `production/*` except its own.
- **First deployment is production.** A new Vercel project's first deploy goes to production. Set the Production Branch, the staging environment and Neon before the first push.
- **APNs.** Every TestFlight and App Store build uses the **production** APNs gateway; only Xcode Debug builds use sandbox. A push relay must store the environment per device token and the staging relay must use the production host.
- **GITHUB_TOKEN limits.** A PR opened with it runs no workflows; a tag pushed with it starts none. Release PRs use the release GitHub App's token; tags stay on GITHUB_TOKEN and `tag-release.yml` dispatches `testflight.yml` explicitly.
- **Squash title.** The squash commit must be the PR title, or a single-commit PR lands its commit message instead and the title check proves nothing.

## API compatibility for native apps

Web clients always run the latest deployment. App Store users do not: a build
a user installed months ago keeps calling the API, and Vercel serves one
production deployment per project. So the API carries the compatibility
burden, and the release machinery above does not solve it on its own: the
`api-vX.Y.Z` tag says *what* is deployed, not *who* can still talk to it.

- **Additive by default.** Add fields and endpoints; never rename, remove or
  change the meaning of one that a shipped build reads. Most api releases then
  need no compatibility work, and "apple 1.3 needs api 1.0.3" is just "merge
  the api release PR first, then the apple one".
- **One path prefix for the whole API, from the first commit:** every
  endpoint lives under `/v1`. A breaking change is a `feat!:` (or `fix!:`) on
  the api track and adds `/v2` for **all** endpoints at once; unchanged
  handlers are mounted under both prefixes. `/v1` keeps serving the old shape
  until the old app builds are gone. The prefix is not bumped per release and
  not per endpoint: `/v1` serves every release until the next breaking
  change, and per-endpoint versions only pay off with many independent
  clients. The release number and the prefix are deliberately separate:
  `cliff.toml` bumps the major on a breaking change only from `1.0.0` (below
  it, `0.x` convention, a breaking change bumps the minor), so a fresh API
  at `0.1.0` that adds `/v2` releases as `0.2.0`, while an API at `1.4.2`
  releases as `2.0.0`. The prefix tracks shipped app builds, not semver.
- **Handshake.** The app sends its marketing version and build number in a
  header (`User-Agent` or `X-App-Version`); the API exposes a minimum
  supported app version (on the health endpoint or a dedicated one) so the
  app can show an update prompt instead of failing on a removed shape, and so
  the logs show which builds still call each prefix.
- **Rollback, not routing.** A bad api release is undone with Vercel's
  instant rollback (promote the previous deployment), but only to a
  deployment that still serves every shipped app build: once `/v2` and the
  app that needs it are out, a deployment without `/v2` is not a valid
  rollback target, and the fix rolls forward as a patch instead. Do not
  route old app builds to old deployment URLs. Old deployments stay
  reachable, but they share the live database, never receive fixes or
  rotated secrets, and sit behind Deployment Protection; and the app only
  knows the fixed domain.
- **Escape hatch for a long-lived major:** if `/v1` must stay frozen for a
  long time while `/v2` evolves, give it a second Vercel project (`api-v1`,
  its own production branch and track) and `rewrite` `/v1/*` to it from the
  main API project. One domain, no router code of your own.

Decided 2026-10-28 for Canary; applies to every app this skill installs.

## Hotfixes (not automated)

A fix for one track carries everything merged to main before it. For an urgent fix to an old release: branch from the tag, cherry-pick, bump the manifest, tag `<track>-vX.Y.Z+1` by hand from that branch, and push `production/<track>` to it by hand (an admin bypass of the ruleset). Merge the fix to main too.
