# One-off setup checklist

Everything outside the repo that the workflows rely on. Hand the user the parts
only they can do; do the API-reachable parts yourself when you have the access.
Order matters where marked. **Xcode app only:** GitHub (without the
`production/*` ruleset) and App Store Connect are the whole list; the API URL
variables apply only if the app calls an API with separate staging and
production URLs.

## GitHub (per repo, plus once per org)

- [ ] **Squash merge uses the PR title.** Settings → General → Pull Requests →
      "Default commit message" for squash = *Pull request title*. API:
      `gh api -X PATCH repos/OWNER/REPO -f squash_merge_commit_title=PR_TITLE`.
      Prefer squash-only merges (`allow_merge_commit=false`, `allow_rebase_merge=false`)
      so every change reaches main as one titled commit.
- [ ] **Release GitHub App** (once per org): a GitHub App with Contents
      read/write, Pull requests read/write, Workflows read/write, installed on
      the repos that use this. Store its Client ID as the org variable
      `RELEASE_APP_CLIENT_ID` and its private key as the org secret
      `RELEASE_APP_PRIVATE_KEY`. Without it the release PRs are still opened,
      but their CI does not run and `production/*` must be pushable by
      GITHUB_TOKEN.
- [ ] **Ruleset on `production/*`** (Vercel tracks): restrict updates to the
      release App (bypass list), block deletion and force-push. The track's
      first real release creates the branch (the baseline does not), so add
      the App to the bypass list before merging the first release PR.
- [ ] **Required checks** on `main` include `PR title / lint` and the repo's CI.
- [ ] Optional: ruleset on `release/*` so only the App pushes them.

## App Store Connect (apple track)

- [ ] App record exists for the bundle id (all platforms you ship).
- [ ] **Team API key**, Admin role (so `-allowProvisioningUpdates` can manage
      signing and revoke the development certificates CI leaves). Secrets: `APP_STORE_KEY_ID`, `APP_STORE_ISSUER_ID`,
      `APP_STORE_KEY_P8_BASE64` (`base64 -i AuthKey_<id>.p8`). Org secrets if
      several apps share the key.
- [ ] **Internal group** with *Enable automatic distribution* ticked: every
      upload from main reaches it with no API call.
- [ ] **External group** named `Public beta`, or set the repository variable
      `TESTFLIGHT_EXTERNAL_GROUP`. Public link optional.
- [ ] Info.plist sets `ITSAppUsesNonExemptEncryption` (`false` unless the app
      uses non-exempt encryption), or every build waits on an export
      compliance answer and the external stage fails.
- [ ] Repository variable `TESTFLIGHT_LOCALE` if "What to Test" should use a
      localisation other than `en-US` (one the app has in TestFlight).
- [ ] **Test Information** filled in, or Beta App Review rejects the first
      submission: beta description, feedback email, privacy policy URL, review
      contact, demo account and notes if the app needs a sign-in.
- [ ] Repository variables `STAGING_API_URL` and `PRODUCTION_API_URL` if the app
      talks to a Vercel track (internal builds get staging, tagged builds
      production). A tagged build fails without `PRODUCTION_API_URL`; an
      internal build without `STAGING_API_URL` keeps the project's default. The app reads them from the build setting the workflow
      passes (`__API_URL_SETTING__` in the template), usually via Info.plist.
      Consider a hidden in-app override so a tester can switch a build to
      production when reproducing a bug.

## Vercel (each Vercel track: one project, Root Directory = the app's folder)

Do these **before the first push that links the project**: a new project's
first deployment always goes to production.

- [ ] **Production Branch** = `production/<track>` (Settings → Environments →
      Production → Branch Tracking). It need not exist yet: the track's first
      release creates it.
- [ ] **`staging` custom environment** tracking `main`, with its own env vars
      and a fixed domain (e.g. `staging.<domain>`, `staging-api.<domain>`).
      Pro includes one per project. Hobby fallback: assign the staging domain to
      the `main` branch and scope staging env vars to Preview + branch `main`.
- [ ] **Deployment Protection**: off for the staging environment of any project
      an app build calls (an API). Keep it on for web previews.
- [ ] **Build skip**: the `ignoreCommand` in each app's `vercel.json` from the
      sibling skill turborepo-vercel-monorepo (a `git diff` over the app and
      what it builds from), or
      `turbo query affected --base=$VERCEL_GIT_PREVIOUS_SHA --packages <pkg> --exit-code`.
      Vercel's automatic skip alone rebuilds every project on a Swift-only
      commit, because the app folder is not a workspace package.
- [ ] The app's `vercel.json` carries the `git.deploymentEnabled` block from
      the template (other tracks' production branches off).

## Neon (Vercel tracks with a database)

- [ ] Connect Neon through the Vercel Marketplace integration for Production
      and Preview, with *Create database branch for deployment* on for Preview
      (PR previews get throwaway `preview/<branch>` databases). Each is a full
      copy of the Neon project's default branch, which is also the one the
      integration connects to Production, so with customer data in production
      leave automatic branching off and give previews a database built from
      an anonymised or synthetic branch instead.
- [ ] Create a branch named **`staging`** from production (or from an
      anonymised branch if production holds personal data).
- [ ] In Vercel, `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in the `staging`
      environment only, pointing at that branch: through the Marketplace
      connection where it can target the custom environment and that branch
      (Pro/Enterprise, since September 2026), otherwise by hand.
- [ ] Run migrations in the build (or a deploy step) against the deployment's
      own `DATABASE_URL`, so staging migrates on every main deploy and
      production on every tag.
- [ ] For `neon-refresh-staging.yml`: secret `NEON_API_KEY`, variable
      `NEON_PROJECT_ID_<TRACK>`.

## After the setup PR merges

- [ ] `tag-release.yml` laid baseline tags `<track>-v<version>`. Check the
      tags page. No `production/<track>` branch yet: the first real release
      creates it, and Vercel deploys production from it then.
- [ ] The first `feat`/`fix` merge opens `release(<track>): …` PRs; their checks
      run (if not, the release App is missing).
- [ ] A main build reached TestFlight internal testers, and its "Revoke this
      build's development certificate" step revoked one certificate. A warning
      that the keychain held none means the clean-up is not finding Xcode's
      certificate on that runner image: check where it went before relying on it.
