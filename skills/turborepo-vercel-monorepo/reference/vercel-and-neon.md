# Vercel projects and Neon for the monorepo

Read when creating or fixing the Vercel side. Order matters: a newly linked
project's **first deployment goes to production**, so configure before the
first push that links it. Never deploy without the user's go-ahead.

## One Vercel project per app

For each app under `apps/` that deploys (not the Swift app):

1. **Import the repo** (Dashboard → Add New → Project) or, from the repo root,
   `vercel link --repo` (links several projects at once; do not run it from a
   subdirectory). The project name is usually `<repo>-<app>`.
2. **Root Directory** = `apps/<app>`. Keep *Include files outside the Root
   Directory* on: builds need `packages/` and the root lockfile. Vercel finds
   `pnpm-lock.yaml` at the repo root and installs the workspace from there.
3. **Framework preset:** `Other` for `apps/api` (Vercel Functions are found
   in `api/`; no build command needed) and for the static `apps/web` template
   (Output Directory `public`). Pick `Next.js`, or the site's framework, only
   once `apps/web` is replaced with that app.
4. **Node.js version** matching `.node-version` / `engines.node`.
   **pnpm version:** Vercel picks pnpm from the lockfile version unless
   Corepack is on, so add the env var `ENABLE_EXPERIMENTAL_COREPACK=1` (all
   environments) to make it honour the root `packageManager` pin. If the
   install then fails with `ERR_PNPM_UNSUPPORTED_ENGINE`, make `engines.pnpm`
   (if set) agree with `packageManager`.
5. **Build skip:** the template `vercel.json` `ignoreCommand` (see SKILL.md
   Gotchas). Leave the automatic *Skip deployment* for unaffected projects on
   as well; it runs first and costs no build slot.
6. **Optional faster installs:** `"installCommand": "pnpm install --filter @<scope>/<app>..."`
   in the app's `vercel.json`, once the app has workspace dependencies.
7. **Related Projects** (optional): `"relatedProjects": ["prj_…"]` in the web
   app's `vercel.json` gives each web deployment its matching API deployment's
   host in `VERCEL_RELATED_PROJECTS` (read with `@vercel/related-projects`), so
   previews talk to previews without hand-set URLs. Up to three per app; Git
   deployments only.
8. **Environments.** Without release tracks, `main` is Production and PRs are
   Previews. With xcode-vercel-release-tracks, set the Production Branch to
   `production/<app>` and add a `staging` custom environment tracking `main`
   (its setup checklist has the details).
9. **Deployment Protection:** on for web previews; off for the environment an
   app build calls (the API's staging), or the app gets a login page.

Check: a PR that touches only `apps/apple` shows the Vercel projects as
skipped/ignored; a PR touching `packages/` builds both.

## Neon through the Vercel Marketplace

Install Neon from the Vercel Marketplace (Storage → Neon), create the
database, then **Connect Project** for each app that needs it, choosing
Development, Preview and Production.

- Injected variables: `DATABASE_URL` (pooled, for the app),
  `DATABASE_URL_UNPOOLED` (direct, for migrations), the `PG*` parts and legacy
  `POSTGRES_*` names. Read the pooled one at runtime.
- **Preview branching** (tick *Create database branch for deployment*): each
  preview deployment gets a copy-on-write branch `preview/<git-branch>` of
  the default branch, with its connection variables injected into that
  deployment only. A branch is a full copy of its parent's data, so preview
  code can read everything in it: if the default branch holds customer data,
  point preview branching at a masked or synthetic-data parent first, or
  leave it off. Branches are deleted with their deployments, which Vercel
  keeps for months by default, so prune old ones (the public skill
  vercel-preview-cleanup helps).
- **Migrations** run in the build against the deployment's own database: set
  the build command to `<migrate with DATABASE_URL_UNPOOLED> && <build>`, so
  previews migrate their branch and production migrates production.
- **A staging environment** (release tracks) needs a persistent Neon branch
  named `staging` (from an anonymised branch if production holds personal
  data) and `DATABASE_URL`/`DATABASE_URL_UNPOOLED` in the `staging`
  environment pointing at it. Since September 2026 Marketplace connections
  can target custom environments on Pro and Enterprise
  (`vercel integration add neon --environment staging`, or the dashboard),
  but check which Neon branch the injected URLs point at: staging must not
  get production's. Where that cannot pick the `staging` branch, scope the
  two variables to the `staging` environment by hand.
- Pull variables for local work with `vercel env pull apps/<app>/.env.local`
  (git-ignored by `.env*.local`).

Provenance: Vercel monorepo docs and Neon's Vercel native integration guide,
read 2026-10-26.
