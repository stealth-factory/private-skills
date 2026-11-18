---
name: self-hosted-macos-runner
description: Turn a Mac you own (a Mac mini build box) into a GitHub Actions self-hosted runner for Xcode CI, simulator UI tests, screenshots and TestFlight uploads, and point the Apple workflows at it. The studio does not use GitHub-hosted macOS runners at all, not even as a fallback. Use when asked to "use our Mac as the CI runner", "register the Mac mini with GitHub", "stop paying for macOS minutes", "GitHub macOS bill is too high", "run Xcode CI on our own hardware", "self-hosted runner for iOS", or when an agent keeps pushing to CI to compile and test iOS code instead of building on the Mac first, or when Apple jobs on a self-hosted Mac collide on simulators, hang on the keychain, queue forever, or fail only when the Mac rebooted. The release workflow itself (versions, tags, TestFlight stages) is the sibling skill xcode-vercel-release-tracks; this skill only decides WHERE the Mac jobs run.
metadata:
  author: stealth-factory
  co-author: wiiiimm
  version: "1.4.0"
---

# self-hosted-macos-runner

GitHub-hosted macOS minutes are the most expensive Actions SKU, and an iOS
repo with a UI-test or screenshot matrix burns them on every push. A Mac you
already own can run the same jobs as a **self-hosted runner**: no hosted
minutes, Xcode and simulator runtimes already installed, and the same Mac
doubles as a remote Xcode build box.

Pricing moves: check GitHub's current Actions billing docs before quoting a
saving. As of late 2026 self-hosted minutes carried no per-minute charge; a
small per-minute platform fee for self-hosted runners was announced for 2026
and then postponed, not cancelled.

## Decide first

| Question | Default | Why |
| --- | --- | --- |
| Org-level or repo-level runner? | **Org**, in a runner group limited to selected repos | one Mac serves several app repos; the group is the access control |
| Public repos allowed in the group? | **No**, unless the repo has Apple CI and no other home | anyone can open a PR on a public repo; a self-hosted runner executes it on your Mac. A public repo in the group must skip fork PRs on every Mac job (see "Public repositories") |
| How many instances? | 2–3 on an M-series Mac mini with 16 GB+ | one instance runs one job; an iPhone + iPad matrix otherwise queues |
| Which jobs move? | builds, unit tests, UI tests, screenshots, TestFlight | Linux jobs stay hosted; they are cheap |
| Fallback when the Mac is off? | **another self-hosted Mac**, never GitHub-hosted | a repo variable switches `runs-on` between Macs; see "Switchable runs-on" |

## What the human has to do

The agent can do the rest on the Mac, but these need an org owner:

1. **A registration token.** Org → Settings → Actions → Runners → New
   self-hosted runner shows one (valid about an hour, reusable for several
   runners within that hour). Or give the agent a `gh` login with the
   `admin:org` scope so it can call
   `POST /orgs/{org}/actions/runners/registration-token` itself.
2. **A runner group** (Org → Settings → Actions → Runner groups) limited to the
   repos that should use the Mac, with "Allow public repositories" off. The
   Default group is shared with every repo in the org.
3. **Auto-login on the Mac** for the account the runner runs as (System
   Settings → Users & Groups → Automatically log in). Simulators need a GUI
   session; a runner started before anyone logs in cannot boot one.

Never paste the token into a commit, a skill, an issue or a PR. It expires,
but treat it as a secret while it lives.

## Install on the Mac

[scripts/install-runners.sh](scripts/install-runners.sh) does this for N
instances; read it before running. By hand, per instance:

```bash
mkdir -p ~/actions-runner/1 && cd ~/actions-runner/1
# Latest arm64 macOS runner, from the actions/runner releases API.
url=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest \
  | python3 -c 'import json,sys; print(next(a["browser_download_url"] for a in json.load(sys.stdin)["assets"] if a["name"].startswith("actions-runner-osx-arm64-") and a["name"].endswith(".tar.gz")))')
curl -fsSL "$url" | tar xz
read -rs RUNNER_TOKEN    # paste the token; nothing lands in shell history
# The runner reads ACTIONS_RUNNER_INPUT_<ARG> for any argument, so the token
# never appears in a process list. No --replace: a name clash should fail.
ACTIONS_RUNNER_INPUT_TOKEN="$RUNNER_TOKEN" ./config.sh --unattended \
  --url "https://github.com/<org>" \
  --name "$(scutil --get LocalHostName)-1" \
  --runnergroup "<group>" --labels "<mac-label>,xcode-<major>" \
  --work _work
./svc.sh install && ./svc.sh start     # a LaunchAgent: runs in the logged-in session
```

- Every self-hosted runner already carries `self-hosted`, `macOS` and `ARM64`;
  add a label naming the machine and one naming the Xcode major so a workflow
  can ask for "Xcode 27" without knowing which Mac.
- `svc.sh` installs a **LaunchAgent** under `~/Library/LaunchAgents`, so it
  starts at login, not at boot. That is what simulators need; it is also why
  auto-login matters.
- Run the runner as a **dedicated macOS user** if the Mac is also someone's
  workstation. Jobs can read anything that user can read.

Prepare the Mac once:

```bash
sudo xcode-select -s /Applications/Xcode.app
sudo xcodebuild -license accept
xcodebuild -runFirstLaunch
xcodebuild -downloadPlatform iOS            # plus watchOS etc. as needed
brew install xcodegen                       # whatever the workflows install per job
sudo pmset -a sleep 0 disksleep 0 autorestart 1   # never sleep; restart after power loss
```

`xcode-select -p` must print a path inside `Xcode.app`. If it prints
`/Library/Developer/CommandLineTools`, every job fails within seconds
(`xcodebuild requires Xcode`, `unable to find utility "xcresulttool"`,
`plugin for module 'TestingMacros' not found`). Check it on every Mac you
add to the group before its runner goes online.

Check: Org → Settings → Actions → Runners lists each instance as **Idle**, or
`gh api orgs/<org>/actions/runners --jq '.runners[] | [.name,.status,.busy] | @tsv'`.

## Point the workflows at it

### Switchable runs-on

**Never use GitHub-hosted macOS runners** (`macos-*` labels), not even as a
fallback. Every macOS job, TestFlight and other signing jobs included, runs on
the team's self-hosted Macs. Keep one switch per repo so a Mac that is off,
broken or being upgraded can be swapped for another self-hosted Mac without a
commit:

```yaml
jobs:
  build:
    # Repo variable MACOS_RUNS_ON, as JSON, narrows the labels, e.g.
    # '["self-hosted","macOS","<mac-label>"]'. Unset: any self-hosted Apple
    # silicon Mac in the runner group.
    runs-on: ${{ fromJSON(vars.MACOS_RUNS_ON || '["self-hosted","macOS","ARM64"]') }}
```

The default and every value of the variable name self-hosted labels only.
When no Mac is online the jobs queue; that is intended. Bring a Mac back or
point the variable at another one, rather than paying for hosted minutes.

`vars` is allowed in `runs-on`; `secrets` is not. Changing the variable needs
no commit, so the switch works mid-incident. It only affects runs that start
after the change: a job already queued keeps the labels it asked for, so
cancel it and re-run it once the variable is set. Put the same expression on every
macOS job (build, tests, screenshots, accessibility, TestFlight) so they move
together.

**Intel builds.** The runners are Apple silicon. Cross-compile x86_64
(`swift build --arch x86_64`, `cargo build --target x86_64-apple-darwin`,
`xcodebuild ARCHS=x86_64`) and run it under Rosetta when it is installed;
without Rosetta, check the architecture with `lipo -archs` instead of
running the binary. Do not keep a hosted `macos-*-intel` job for it.

### Public repositories

Self-hosted runners on a public repo execute whatever a PR contains. If a
public repo needs Apple CI, keep GitHub's org-level restrictions on outside
contributors on, and make every Mac job skip fork PRs:

```yaml
    if: github.event.pull_request.head.repo.fork != true
```

Fork PRs then get no macOS checks; a maintainer re-runs the change from a
branch in the repo when it needs one. Never trigger Mac jobs from
`pull_request_target`.

### Things that are free on a hosted runner and are not here

| Hosted runner gives you | On your Mac you must |
| --- | --- |
| a fresh VM per job | clean up: DerivedData under `$RUNNER_TEMP`, not `~/Library` |
| one simulator per machine | **create a simulator per job** (below); instances share the Mac |
| an empty login keychain | **use a temporary keychain per job** (below) and remove it |
| preinstalled tools | skip `brew install` when `command -v` finds the tool |
| any Xcode you select | install the Xcode the workflow needs, and keep the label honest |

**Simulators.** Scripts that pick "the newest iPhone simulator" by name will
pick the same device in two concurrent jobs, and the second boot fails or the
two tests drive one screen. Create one per job and delete it after. Use the
device type and runtime the job needs (an iPad job creates an iPad; pin the
runtime when the job targets one iOS version). This example is an iPhone on
the newest installed runtime:

```bash
runtime=$(xcrun simctl list runtimes -j | python3 -c 'import json,sys; r=[x for x in json.load(sys.stdin)["runtimes"] if x["platform"]=="iOS" and x["isAvailable"]]; print(r[-1]["identifier"])')
udid=$(xcrun simctl create "ci-$GITHUB_RUN_ID-$GITHUB_JOB" "iPhone 17" "$runtime")
echo "SIM_UDID=$udid" >> "$GITHUB_ENV"
# … xcodebuild test -destination "id=$udid" …
# in an `if: always()` step:
xcrun simctl delete "$SIM_UDID" || true
```

**Signing.** Never import a certificate into the login keychain of a shared
Mac. Per job: create a keychain in `$RUNNER_TEMP`, add it to the search list,
import, and in an `if: always()` step delete it and restore the list. With
App Store Connect API key signing (`-allowProvisioningUpdates` plus
`-authenticationKeyPath`), write the `.p8` under `$RUNNER_TEMP` and delete it
the same way. Snippet: [reference/signing.md](reference/signing.md).

**Concurrency.** A `concurrency:` group only serialises runs within one
repository. Signing jobs from different repos on the same Mac share one
keychain search list and one set of certificates, so every signing job holds
the machine-wide lock in [reference/signing.md](reference/signing.md) from
setup through cleanup.

## Develop on the Mac, let CI confirm

A runner moves CI off hosted minutes. It does not stop an agent from using CI
as its compiler: push, wait 20 minutes, read the log, push again. Each loop
starts every macOS job, and the jobs queue behind one another on your own Mac
too. Make it a standing rule for iOS work: **build and test on the Mac before
you push.** CI is the last check, not where you iterate.

- **Reach a Mac directly.** That can be a remote session on it (SSH, or an
  agent running there) or the Mac acting as a remote Xcode build box. A cloud
  container cannot run `xcodebuild`, so that kind of agent must hand iOS
  builds and tests to a Mac. Pick the Mac in this order:
  1. **The team's build Mac**, the one this skill registers. Use it whenever
     it is online.
  2. **The user's own Mac** (MacBook, Mac Studio and so on), when the build Mac
     is offline and the user is working on one. Ask them to run the
     development builds and tests there until the build Mac is back.
  3. **Another Mac the user can connect**, when the user is on Linux or
     Windows. Ask whether another Mac is reachable, for example one on the
     team's private network (a tailnet, VPN or LAN).
  4. **No Mac reachable:** stop and ask the user which Mac to use. Never
     fall back to GitHub-hosted macOS runners, and never push to CI to get
     a compile.

  CI is separate from this list: its jobs follow the `runs-on` switch below.
- **Use your own worktree, never the runner's `_work`.** Run
  `git worktree add --track -b <branch> <repo>/.worktrees/<branch> origin/<branch>`
  (or `git worktree add <repo>/.worktrees/<branch> <branch>` if the local
  branch already exists), and leave
  the checkout a person uses alone.
- **Mirror the workflow.** Read the job's steps, then run the same commands,
  with the same scheme, test plan and destination type. Run the same project
  generator (e.g. `xcodegen generate`) first if CI does.
- **Isolate the run.** Give it its own simulator (`xcrun simctl create`, then
  delete it), and put DerivedData under a temp directory with
  `-derivedDataPath`. Then a local run never collides with a runner job on the
  same Mac.
- **Iterate on the failure.** Open the `.xcresult` (`xcrun xcresulttool`),
  fix the problem, re-run only that test (`-only-testing:`), and push once it
  passes.
- **Only then push.** The PR's CI run should be the confirmation.

Trim CI as well, so the final check stays cheap:

- **Run the expensive jobs less.** On draft PRs, run the build and unit tests
  only. Run UI tests, accessibility audits and screenshots when the PR is
  marked ready, when a label is added, or on `main`. Use
  `if: github.event.pull_request.draft == false || contains(github.event.pull_request.labels.*.name, 'run-ui-tests')`
  and add `ready_for_review` and `labeled` to the `pull_request` types.
- **Cancel stale runs**, so pushes in quick succession don't stack up:

  ```yaml
  concurrency:
    group: ${{ github.workflow }}-${{ github.ref }}
    cancel-in-progress: true
  ```
- **Don't rebuild `main` on every push** to get a "before" screenshot. Cache it
  per `main` SHA, or capture it on demand.

## Security rules

- Private repos only, through the runner group. On a public repo, any fork PR
  is code execution on your Mac.
- Never trigger self-hosted jobs from `pull_request_target`, and keep
  `permissions:` minimal per job.
- Secrets reach the runner process environment. Anything a job writes outside
  `$RUNNER_TEMP` and `_work` survives into the next job; clean up.
- For stricter isolation, register with `--ephemeral` (one job, then the
  runner unregisters) behind a small re-register loop, or use JIT runners.
  That costs setup time per job; most small teams accept persistent runners on
  private repos.

## Upkeep

- The runner auto-updates itself. Xcode and simulator runtimes do not: update
  them deliberately, then update the `xcode-<major>` label.
- Disk fills from DerivedData, simulator devices and caches:
  `xcrun simctl delete unavailable`, clear `~/Library/Developer/CoreSimulator/Caches`,
  and prune `_work` of each instance now and then.
- A runner shows **Offline** after a reboot without auto-login, after the
  user logs out, or after macOS updates. Jobs then queue silently: point the
  repo variable at another self-hosted Mac's labels, or fix the Mac. Never
  switch to GitHub-hosted macOS runners.

## Done when

- Each instance is Idle in the org's runner list, in the restricted group.
- A PR's Apple jobs show the Mac's runner name in their logs, and run in
  parallel up to the instance count without simulator collisions.
- A TestFlight upload from the Mac succeeds, and the job leaves no keychain,
  key file or simulator behind.
- No workflow asks for a GitHub-hosted macOS label:
  `grep -rnE 'macos-(latest|[0-9])' .github/workflows` finds nothing.
- Pointing the repo variable at another Mac's labels runs the same jobs there.
- iOS changes are built and tested on the Mac before they are pushed; draft
  PRs run build and unit tests only.
