---
name: turborepo-vercel-monorepo
description: Lay out a pnpm + Turborepo monorepo that deploys each app to its own Vercel project, optionally with a native Swift/Xcode app beside the JS apps and Neon Postgres through the Vercel Marketplace — apps/api on Vercel Functions, apps/web, apps/apple, shared packages/*, path-filtered CI, one Vercel project per app with its Root Directory and a build skip, Neon wired per environment. Use when asked to "make this a monorepo", "turn the repo into a Turborepo", "add an API / backend / website next to the iOS app", "move the Swift app under apps/", "one Vercel project per app", "deploy apps/api and apps/web separately", "connect Neon to Vercel", or when Vercel rebuilds every project on every push. Versioned releases (TestFlight stages, Vercel staging/production, release PRs) are the sibling skill xcode-vercel-release-tracks, which builds on this layout.
metadata:
  author: stealth-factory
  co-author: wiiiimm
  version: "1.0.0"
---

# turborepo-vercel-monorepo

One repository, one `main`, several deployables. JS apps share a pnpm
workspace and a Turborepo task graph; each deploys to its own Vercel project.
A Swift app, if there is one, sits beside them and the JS tooling ignores it.
Built from stealth-factory/canary-messenger (layout from its PR #13).

```text
package.json            # private root: packageManager, turbo, typescript, scripts
pnpm-workspace.yaml     # apps/*, packages/*
turbo.json              # build / typecheck / test / dev
tsconfig.base.json      # strict, NodeNext, noEmit; apps extend it
.node-version           # one Node major for CI, Vercel and local
apps/api/               # Vercel Functions: api/*.ts endpoints, logic in src/, tests in test/
apps/web/               # the website (static placeholder, or Next.js)
apps/apple/             # Swift app: project.yml or .xcodeproj, Packages/, no package.json
packages/<name>/        # shared TS libraries, depended on as "workspace:*"
.github/workflows/js.yml, apple.yml   # path-filtered: each side runs only for its own changes
```

## Templates

From [templates/](templates/) into the target repo. Replace `__REPO__` (root
package name), `__SCOPE__` (package scope, e.g. `canary` for `@canary/api`),
`__PRODUCT__`, `__APPLE_DIR__` (`apps/apple`), `__XCODE_PROJECT__`,
`__SCHEME__` and `__SWIFT_PACKAGE__`; then
`grep -rn '__[A-Z_]*__' .` must print nothing outside `node_modules`.

| Template | Becomes |
| --- | --- |
| `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` | repo root, as named |
| `node-version`, `gitignore` | `.node-version`, merged into `.gitignore` (stored without the dot so they are not hidden or applied here) |
| `apps/api/**` | a working Vercel Functions app: `GET /api/health`, vitest test, `tsc` typecheck |
| `apps/web/**` | a static holding page in `public/` |
| `apps/*/vercel.json` | per-project Vercel config with the build skip (see Gotchas) |
| `github/workflows/js.yml`, `apple.yml` | `.github/workflows/`; drop `apple.yml` and the `!__APPLE_DIR__/**` line when there is no app |

The version pins are Canary's as of 2026-10-26 (pnpm 12.14, Turbo 2.11,
TypeScript 7.0, Node 24, vitest 5). Check npm for newer ones and keep them
**exact**; the actions are pinned by commit SHA with the version in a comment,
and new ones must be too.

## Procedure

1. **Inventory.** What deploys (API, site, app), what is shared, and whether a
   Swift app is already at the root. Name the scope and the apps; app folder
   names become Vercel project names and, with release tracks, tag prefixes.
2. **Root files** from the templates. `packageManager` pins pnpm (Corepack
   and Vercel both read it); `engines.node` and `.node-version` agree.
3. **Apps.** Copy `apps/api` and `apps/web`, or create a real site in
   `apps/web` (for Next.js, `pnpm create next-app apps/web`, then give its
   `package.json` the scoped name and `"version": "0.1.0"`). Every workspace
   package needs a unique `name`; apps that ship need a `version`.
4. **Move an existing Swift app** under `apps/apple` with `git mv` in its own
   PR: XcodeGen paths are relative to `project.yml` and move with it, but
   scripts, CI paths, docs and `.gitignore` entries that name old paths do not.
   Warn the user that open PRs touching the app will need a rebase. Keep Swift
   packages at `apps/apple/Packages/`, never a root `Packages/` beside
   `packages/` (see Gotchas).
5. **Shared code** goes in `packages/<name>` with its own `package.json`
   (`"name": "@<scope>/<name>"`, `"private": true`, `exports` pointing at the
   TS source or a `dist` build) and is used as `"@<scope>/<name>": "workspace:*"`.
   Declare every internal dependency in the consumer's `package.json`: Vercel
   and Turborepo both build the dependency graph from it.
6. **CI.** `js.yml` runs `pnpm install --frozen-lockfile` and
   `pnpm turbo run typecheck test build` for JS changes only; `apple.yml` runs
   `swift test` and unsigned simulator/macOS builds for app changes only. Add
   both job names to `main`'s required checks.
7. **Verify locally:** `pnpm install`, then `pnpm turbo run typecheck test build`
   (all green), and for the app `xcodegen generate` plus a simulator build.
   Commit `pnpm-lock.yaml`.
8. **Vercel and Neon**: one project per app, created and configured **before
   the first push that links it**:
   [reference/vercel-and-neon.md](reference/vercel-and-neon.md). Do the parts
   you can reach through the Vercel/Neon MCP or CLI when the user has
   approved deploying; otherwise hand over the list.
9. **Document it** in `AGENTS.md`/`CLAUDE.md` and the README: the layout table,
   `pnpm install` + `pnpm turbo run typecheck test build` from the root,
   "shared JS goes in `packages/*`", the Swift build commands, and each app's
   Vercel Root Directory.
10. **Releases:** for versions, changelogs, two-stage TestFlight and Vercel
    staging → production, install the sibling skill xcode-vercel-release-tracks
    (`npx skills@1.5.23 add stealth-factory/private-skills --skill xcode-vercel-release-tracks`)
    in monorepo mode. Its tracks map one-to-one onto these apps: `apple`
    (`apps/apple`), and `api`/`web` (each app plus `packages`, `pnpm-lock.yaml`).

## Gotchas

- **A Swift app makes every push a "global" change to Vercel.** Vercel's
  automatic skip of unaffected projects only understands workspace packages;
  a file outside them (all of `apps/apple`, which has no `package.json`)
  counts as a change to every project, so each Swift commit rebuilds the API
  and the site. The template `vercel.json` sets `ignoreCommand` to a
  `git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- . ../../packages …` over
  the app and what it builds from: exit 0 skips, anything else (no previous
  deployment, a commit outside Vercel's shallow clone) builds. Verified on a
  scratch repo 2026-10-26: Swift-only change skips, `packages/` change builds,
  empty previous SHA builds. Add any other root file an app reads to its list.
  `turbo query affected --base=$VERCEL_GIT_PREVIOUS_SHA --packages <pkg> --exit-code`
  is Vercel's documented alternative when Turbo's graph is enough.
- **`packages/` vs `Packages/`.** APFS is case-insensitive by default: a root
  `Packages/` (SwiftPM convention) and `packages/` (pnpm convention) are the
  same folder on a Mac and different ones on Linux CI. Keep Swift packages
  inside the app folder.
- **pnpm and Turbo skip the Swift app** because it has no `package.json`, and
  that is intended: it is not a JS package. Do not add one to "fix" Vercel
  skipping; the `ignoreCommand` handles that.
- **First deployment is production.** A newly linked Vercel project deploys
  its first build to production. Set the Root Directory, the Production
  Branch (with release tracks, `production/<app>`), the env vars and Neon first.
- **Turbo env vars.** A build that reads an env var must list it under that
  task's `env` in `turbo.json`, or a cached build from one environment is
  reused in another (Next.js inlines `NEXT_PUBLIC_*` at build time).
- **Turbo in cloud agent containers** can fail with `Exec format error` (wrong
  platform binary). Run the package scripts directly there
  (`pnpm --filter @<scope>/web run build`); CI and Macs are unaffected.
- **One Node version everywhere**: `.node-version` for CI and local, the
  Vercel project's Node.js Version setting, and `engines.node`, which takes
  precedence over the project setting on Vercel.
- **Deployment Protection** blocks an app calling a protected preview or
  staging API (it gets an HTML login page). Turn it off for the API project's
  staging environment, or send `x-vercel-protection-bypass` from tests only,
  never from a shipped app binary.
