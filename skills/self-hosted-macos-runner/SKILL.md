---
name: self-hosted-macos-runner
description: Turn a Mac you already own into a GitHub Actions self-hosted runner and route an org's macOS / iOS / Xcode CI jobs to it instead of GitHub-hosted macOS runners, which bill per minute once the plan's included minutes are spent. Covers getting a registration token, installing one or several runner instances as services, labels and runner groups, switching `runs-on` (with a repo/org variable so you can fall back to hosted), finding every workflow that still asks for hosted macOS, simulator and DerivedData isolation between concurrent jobs, signing-keychain hygiene, keeping the Mac awake, and cutting minutes on draft PRs. Use when asked "use our Mac as the CI runner", "route mac jobs to the Mac mini", "self-hosted runner", "register the Mac with GitHub", "macOS Actions minutes are too expensive", "why is the GitHub bill so high", "runs-on macos", "xcode CI on our own machine", or when hosted macOS cost spikes. Versioning and TestFlight release workflows themselves are the sibling skill xcode-vercel-release-tracks; this skill only decides where those jobs run.
metadata:
  author: stealth-factory
  co-author: wiiiimm
  version: "1.0.0"
---

# self-hosted-macos-runner

Move macOS CI off GitHub-hosted runners onto a Mac you control. Hosted
macOS minutes are the expensive SKU (10× Linux, about $0.06/min at the time
of writing) and an iOS repo with simulator-based UI tests burns them fast:
every push to a PR can start several 10–30 minute simulator jobs.

This repo is public. **Write no real hostnames, org names, repo names,
runner names, tokens or infrastructure URLs into anything derived from this
skill that lands here.** Use the placeholders below; fill them in only in the
private repo you are configuring.

| Placeholder | Meaning |
|---|---|
| `<org>` | GitHub organization login |
| `<repo>` | repository name |
| `<mac-label>` | a custom label unique to the Mac, e.g. a short machine nickname |
| `<runner-user>` | the macOS account the runner runs as |
| `<n>` | instance number (1, 2, 3 …) |

## 0. Decide before touching anything

1. **Measure first.** Know which repos and jobs spend the minutes, so you
   move the right things and can show the saving:

   ```bash
   # needs a token with the billing/admin read the org allows (org owner usually)
   gh api "orgs/<org>/settings/billing/usage?year=YYYY&month=MM" \
     --jq '.usageItems[] | select(.sku|test("macOS")) | [.date[:10], .repositoryName, .quantity] | @tsv'
   ```

   Per-job minutes for one repo: list runs since a date
   (`repos/<org>/<repo>/actions/runs?created=>=YYYY-MM-DD`), fetch each run's
   `/jobs`, and sum `completed_at - started_at` by job name, keeping only
   jobs whose `labels` start with `macos` or a larger-runner label.
2. **Org-level or repo-level runner?** Org-level serves every repo you allow
   and is what "all mac jobs go to the Mac" means. It needs an org owner (or
   the fine-grained "runners and runner groups" permission). Repo-level only
   needs repo admin and is a fine first step for one repo.
3. **What stays hosted.** Usually: release/signing jobs until the keychain
   setup in §6 is done, and anything that must run when the Mac is off.

## 1. Get a registration token

Either the UI — *Settings → Actions → Runners → New self-hosted runner* (org
or repo), pick **macOS / ARM64**; the page shows the download and `config.sh`
commands with a token filled in — or the API:

```bash
gh auth refresh -h github.com -s admin:org            # org-level only
gh api -X POST orgs/<org>/actions/runners/registration-token --jq .token
gh api -X POST repos/<org>/<repo>/actions/runners/registration-token --jq .token
```

A registration token expires after about an hour and is only used by
`config.sh`. Never commit it, paste it into an issue, or put it in a skill.

## 2. Install the runner instances

Use [`scripts/install-runner.sh`](scripts/install-runner.sh), or follow it by
hand. One instance runs **one job at a time**, so install several to let a
matrix (iPhone + iPad, several test shards) run in parallel.

How many: simulator UI-test jobs take roughly 4–6 GB RAM each plus Xcode.
On 16 GB run 2, on 24 GB 3, on 32 GB+ 4. CPU-bound compile jobs past
`hw.ncpu / 4` concurrent mostly just queue on the CPU.

Per instance, as `<runner-user>`:

```bash
mkdir -p ~/actions-runner/<n> && cd ~/actions-runner/<n>
gh release download -R actions/runner --pattern 'actions-runner-osx-arm64-*.tar.gz' -O runner.tar.gz
tar xzf runner.tar.gz && rm runner.tar.gz
./config.sh --unattended \
  --url "<org or repo URL on GitHub>" --token "<registration token>" \
  --name "<mac-label>-<n>" --labels "<mac-label>,xcode" \
  --runnergroup "<group>" --work _work --replace
./svc.sh install && ./svc.sh start      # launchd service, survives reboots
./svc.sh status
```

- GitHub adds `self-hosted`, `macOS` and `ARM64` labels automatically.
- `svc.sh` installs a **LaunchAgent** for the user, so it runs only while
  `<runner-user>` is logged in. Simulators need that GUI session anyway:
  enable automatic login for `<runner-user>` (a trade-off: physical access
  to the Mac is then access to that account; use a dedicated account with no
  personal data).
- The runner auto-updates itself; keep the service, not a manual `./run.sh`.

## 3. Lock it down

- **Runner group** (org): restrict to *selected repositories*, and leave
  "allow public repositories" off. A self-hosted runner executes whatever
  the workflow says with the account's access to the disk, keychain and
  network.
- **Never** let it run untrusted code: no `pull_request_target` jobs that
  check out PR heads, no public repos, and keep "run workflows from fork
  pull requests" off for private repos.
- Run as a dedicated, non-admin `<runner-user>`. Jobs that need `sudo` are a
  smell; fix the job.
- Keep secrets in GitHub secrets, not in files on the Mac.

## 4. Point the workflows at it

`runs-on` can't fall back automatically. Route through a variable so one
setting flips every job between the Mac and hosted:

```yaml
jobs:
  build:
    # vars.MACOS_RUNNER is JSON, set once per org or repo:
    #   '["self-hosted","macOS","<mac-label>"]'   → the Mac
    #   '"macos-26"'                              → back to hosted
    runs-on: ${{ fromJSON(vars.MACOS_RUNNER || '"macos-26"') }}
```

```bash
gh variable set MACOS_RUNNER --org <org> --visibility selected --repos <repo> \
  --body '["self-hosted","macOS","<mac-label>"]'
```

If a job queues forever, the Mac is off, asleep, logged out or the labels
don't match: `gh api orgs/<org>/actions/runners --jq '.runners[]|[.name,.status,.busy]'`.

**Find every job still asking for hosted macOS**, across all repos — a
workflow you didn't edit keeps billing:

```bash
for r in $(gh repo list <org> --no-archived --limit 500 --json name --jq '.[].name'); do
  gh api "repos/<org>/$r/contents/.github/workflows" --jq '.[].name' 2>/dev/null |
  while read -r w; do
    gh api "repos/<org>/$r/contents/.github/workflows/$w" --jq .content 2>/dev/null |
      base64 -d | grep -nE 'runs-on:.*(macos|xcode)' | sed "s|^|$r/$w:|"
  done
done
```

Also check non-default branches with their own workflows, reusable
workflows (`uses: ./.github/workflows/…`) and matrix values that hold the
label (`runs-on: ${{ matrix.os }}`). Larger-runner labels (anything that
isn't `macos-*` but names a GitHub-hosted image) are hosted too — check the
job's `runner_group_name`: `GitHub Actions` means hosted.

## 5. Make jobs safe to run side by side on one Mac

Hosted runners are fresh VMs; your Mac is not. Concurrent and successive
jobs share the disk, the simulators and the user's keychain.

- **Xcode version per job**, never `sudo xcode-select`:
  `env: DEVELOPER_DIR: /Applications/Xcode-<ver>.app/Contents/Developer`.
  Install versions side by side with distinct app names.
- **Own simulator per job.** Two jobs booting the same UDID collide. Create
  one and delete it at the end:

  ```bash
  udid=$(xcrun simctl create "ci-$GITHUB_RUN_ID-$GITHUB_JOB-$RUNNER_NAME" "<device type>" "<runtime>")
  echo "SIM_UDID=$udid" >> "$GITHUB_ENV"
  # … xcodebuild -destination "id=$udid" …
  # final step, if: always()
  xcrun simctl shutdown "$SIM_UDID" || true; xcrun simctl delete "$SIM_UDID" || true
  ```

  Device types and runtimes: `xcrun simctl list devicetypes` / `runtimes`.
- **DerivedData inside the workspace** (`-derivedDataPath build/dd`) so jobs
  don't share or corrupt `~/Library/Developer/Xcode/DerivedData`, and the
  runner's workspace cleanup removes it. Wipe stragglers weekly:
  `xcrun simctl delete unavailable`, old `~/actions-runner/*/_work/*`,
  `~/Library/Developer/CoreSimulator/Caches`.
- **Tools persist** between jobs: `brew install xcodegen` becomes a fast
  no-op after the first run; pin versions if output must be reproducible.
- **Don't leave the Mac asleep:** `sudo pmset -a sleep 0 disksleep 0`
  (display sleep is fine). Restart-on-power-loss on: `sudo pmset -a autorestart 1`.
- **Disk:** simulator runtimes are several GB each. Alert or clean when free
  space drops under ~50 GB.

## 6. Signing and TestFlight jobs

Leave them on hosted until this is in place:

- Create a **temporary keychain per job**, import the certificate into it,
  add it to the search list, and delete it in an `if: always()` step. Never
  import into the login keychain of `<runner-user>`.
- App Store Connect API key from secrets into `$RUNNER_TEMP`, removed at the
  end of the job.
- Automatic signing with `-allowProvisioningUpdates` creates development
  certificates on each new machine; the sibling skill
  xcode-vercel-release-tracks covers revoking the ones CI leaves behind.

## 7. Spend fewer minutes wherever the jobs run

Independent of the runner, and still worth it — a single Mac is a queue:

- `concurrency: { group: <wf>-${{ github.ref }}, cancel-in-progress: true }`.
- Heavy jobs (simulator UI tests, accessibility audits, screenshots) only
  when a PR is ready:

  ```yaml
  on:
    pull_request:
      types: [opened, synchronize, reopened, ready_for_review, labeled]
  jobs:
    ui-tests:
      if: ${{ !github.event.pull_request.draft || contains(github.event.pull_request.labels.*.name, 'run-ui-tests') }}
  ```

  Keep build + unit tests on every push.
- "Before/after" screenshot comparisons that rebuild the base branch: make
  them `workflow_dispatch` or label-gated.
- Path filters so web-only commits don't start Apple jobs.

## 8. Cost model

- Self-hosted jobs are not charged at the hosted macOS per-minute rate.
  GitHub has announced and changed plans for a small per-minute platform
  charge on self-hosted runners in private repos; check the current billing
  page and the usage API (a separate self-hosted SKU appears if it applies)
  rather than assuming either way.
- Still billed as before: artifact and cache storage, Linux jobs, and any
  workflow still on a hosted macOS label.
- Set an Actions budget in the org's billing settings as a backstop so a
  workflow nobody migrated can't run up hosted macOS minutes.
- The real costs move to you: the Mac's power and uptime, disk, keeping
  Xcode and runtimes current, and a queue when the Mac is busy or offline.

## Checklist

- [ ] Usage measured; jobs to move listed
- [ ] Token obtained (org or repo), not stored anywhere
- [ ] `<n>` instances installed as services, labels set, status `online`
- [ ] Runner group limited to the private repos; fork PRs off
- [ ] Auto-login for `<runner-user>`, sleep disabled
- [ ] `MACOS_RUNNER` variable set; workflows use it
- [ ] Audit loop shows no remaining hosted macOS jobs (or each is deliberate)
- [ ] Per-job simulator, `DEVELOPER_DIR`, workspace DerivedData
- [ ] Draft-PR gating on heavy jobs
- [ ] Budget set; next month's usage checked
