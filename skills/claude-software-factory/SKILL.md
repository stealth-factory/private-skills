---
name: claude-software-factory
description: Run a software project as a factory of two AI agents — one acting as PM (owns the tracker, the PRs and the merge queue, writes no app code) and one as tech lead/developer (owns branches, worktrees and the code), messaging each other, with review bots reviewing and a human as the only merge authority. Use when asked to "act as PM", "run the software factory", "take ownership of this project", "command another agent to code", "coordinate two Claude sessions", "sit on main and direct the developer", or when you are already the PM half and need to triage review bots, verify a finding before relaying it, sequence stacked PRs, rebase after a squash-merge, stand an idle agent down, or decide what to hand the developer next. This is the operating manual for the whole delivery loop — for reviewing one diff with parallel reviewers use dual-agent-review, for sweeping a whole repo use multi-agent-codebase-audit, for driving a single PR's bot-review loop to merge-ready use autonomous-pr-driver.
metadata:
  author: stealth-factory
  co-author: wiiiimm
  version: "1.2.1"
---

# claude-software-factory

Two agents, separated by role, shipping through pull requests that a human
merges. This is the operating manual for the **PM** half; the developer half
needs almost none of it.

Formerly drafted as `two-agent-delivery` — same discipline, named for what it
runs.

## The shape

```text
human ──▶ PM agent ──messages──▶ developer agent ──▶ subagents
             │                          │
             │ opens PRs                │ pushes branches
             ▼                          ▼
        review bots  ◀── @cursor /babysit ──┐
             │                              │
             ▼                              │
        human merges ─────────────────────▶ ┘
```

| | PM | Developer |
| --- | --- | --- |
| owns | tracker, PRs, merge queue, reviewer triage, worktree cleanup | branches, worktrees, code, verification |
| never | writes application code, merges, self-authorises a direct commit to main | opens PRs, sets tracker status, merges |
| optimises for | *is this claim true, and is this safe to land* | *is this correct, and did I prove it* |

**The separation is the point.** It creates a verification boundary: the PM
independently checks what the developer and the bots assert. An agent that both
writes the code and declares it ready has no such boundary.

## The rule that matters most

> **Verify, never relay.**

Every claim that reaches you — from the developer, from a review bot, from your
own earlier message — gets checked against the code before you act on it or
repeat it to the human.

This is not paranoia about your teammates. It is that **findings go stale
faster than they get resolved**: a bot reviews SHA `abc`, three commits land,
and its P1 is still displayed as open. Relaying it wastes a cycle and costs you
credibility the next time you flag something real.

```bash
# a finding cites file:line at <reviewed_sha> — check that SHA and HEAD
git show <reviewed_sha>:<file> | sed -n '<line-20>,<line+20>p'   # what the bot saw
git show HEAD:<file>           | sed -n '<line-20>,<line+20>p'   # what is true now
```

In one working session this caught stale "open" findings on five separate PRs,
including three P1s, all already fixed. It also caught one that was **real** and
would have shipped.

## The loop

1. **Pick the issue.** Unblocked, and check the tracker's own status rather
   than trusting your memory of it — tracker↔git integrations drift.
2. **Hand it over** with a message that says what to build, what *not* to
   build, and the traps you already know about (see `reference/handover.md`).
3. **Developer works.** You do not supervise the middle. Stay out.
4. **They report done.** Verify the branch yourself: commits, diff stat, and a
   real merge check (below). Then open the PR.
5. **Triage the reviewers before they review** (`reference/review-bots.md`).
   Tell them what is deliberate, so a review pass cannot quietly undo a
   decision.
6. **Findings come back.** Verify each against HEAD. Route: mechanical → the
   review bot; design question → the developer; product call → the human.
7. **Declare merge-ready and stop.** Post the evidence and leave it. Do not
   append more caveats, do not offer adjacent work.
8. **Human merges.** Then: clean up the worktree, check for stacked children
   that now need rebasing, and re-check every other open PR against the new
   main.

## Never trust the mergeable flag

GitHub's `mergeable` goes `UNKNOWN` while it recomputes and lies for minutes
after a merge. Use git:

```bash
if git fetch origin main "<branch>" -q \
   && git rev-parse -q --verify "origin/main^{commit}" >/dev/null \
   && git rev-parse -q --verify "origin/<branch>^{commit}" >/dev/null
then
  git merge-tree --write-tree --name-only origin/main "origin/<branch>"
  st=$?
  case $st in
    0) echo CLEAN ;;
    1) echo CONFLICTS ;;
    *) echo UNKNOWN ;;
  esac
else
  echo UNKNOWN
fi
```

Same-repository PRs only — `origin/<branch>` is the topic in *this* repo.
A fork PR of the same name is a different ref; do not treat this recipe as
covering it.

`CLEAN` is exit 0; `CONFLICTS` is exit **1**; any other non-zero is
`UNKNOWN`. stdout names the conflicted files. A failed fetch or a missing
ref is also `UNKNOWN`.
Run it after *every* merge to main, against *every* open branch. This is how
you find out a PR broke before its author does.

**Do not run `merge-tree` until the lookups succeed.** It exits **1** for a
real conflict *and* for a ref it cannot merge, so a branch you never fetched
— or one that was deleted — reports `CONFLICTS` identically to a genuine
conflict (verified on git 2.43.0). Fetch both `main` and the topic: fetching
only the branch leaves `origin/main` stale and can report `CLEAN` against a
pre-merge base. Same trap, more of it, in `reference/git-traps.md`.

The older three-argument `git merge-tree base a b` under-reports — it will print
"changed in both" with zero conflict markers for a case the real merge refuses.
Use `--write-tree`.

## The squash + stack trap

Squash-merge collapses a branch into one commit. A branch **stacked** on it
still carries the originals, so git sees the same changes twice and reports
conflicts that are not real. Auto-delete-on-merge makes it worse by removing
the base the child pointed at.

```bash
# child carries parent's commits; parent is now one squashed commit on main
git rebase --onto origin/main <parent-branch-head> <child-branch>
```

Then **re-verify** — see the next section. Full detail and the sibling traps
are in `reference/git-traps.md`.

## A clean rebase can silently drop your work

If an edit anchored on a line that another PR deleted, the hunk disappears with
**no conflict and no error**. Twice in one session; once it would have shipped.

So: after any rebase, confirm the *substance* survived, not that the command
exited zero. Name the specific things to look for when you ask for the rebase —
"confirm `resetWorkspace` still clears sample state" beats "re-verify".

## Standards worth holding

These are the things that turned out to matter, stated as rules you can apply
without the story behind them.

- **A test that only passes with the fix proves nothing.** Require the failing
  state to be demonstrated too. Same for a guard: one that has only ever passed
  is indistinguishable from one that cannot fail — make it reject something.
- **Ask what else can violate the property you just established.** Nearly every
  invariant bug is a property enforced at one site and quietly violable at
  another.
- **Two findings that look contradictory usually share a cause.** Before
  choosing between them, look for the single change that answers both.
- **A bundled finding needs splitting**, not a verdict. Half may be deliberate
  and half real; treat it as one thing and you either revert a decision or ship
  a bug.
- **Blocked is not the same as later.** A blocked issue in the current
  milestone is honest. Moving it to the next one because it *feels* like
  infrastructure is how dependency order gets lost.
- **Refusing beats silently discarding.** A cap that drops the oldest item, a
  write that overwrites without checking — failing to add is recoverable,
  losing something is not.
- **Stated invariants must be literally true.** "X is the only place Y
  happens" in a PR body, with a second place doing Y, is worse than not
  claiming it.

## Apple builds: the Mac first, CI last

iOS, iPadOS and watchOS work is built and tested on a studio Mac **before**
it is pushed. GitHub's macOS CI is the final check, not the place to debug.
A macOS runner round trip is a queue plus 30–45 minute jobs, billed at macOS
rates, and it hands back a log. On the Mac you read the `.xcresult`, fix,
and re-run one test in minutes.

**Which Mac.** Development builds and tests (anything that is not the
CI/CD pipeline itself) go to the first of these that is available:

1. **The team's build Mac**, the dedicated machine the team keeps for
   builds. Always try it first.
2. **The user's own Mac** (MacBook, Mac Studio, iMac, …), while the build
   Mac is offline. Check what the user is on. If it is a Mac, ask them to run
   the development compiles there until the build Mac is back.
3. **Another Mac on the team's private network.** If the user is on Linux
   (or another non-Mac), ask them which other connected Macs they can offer,
   for example over a tailnet, VPN or LAN.
4. **GitHub Actions**, only when none of the above is available. Say that
   you are falling back and why.

The developer, for every change that touches the Apple app:

1. **Work in a separate worktree**, never the main checkout. Quit Xcode
   first: a running Xcode fights `xcodebuild` over the project and crashes.
2. **Mirror the workflow step by step.** Read the Apple workflow
   (e.g. `.github/workflows/apple.yml`) and run its exact commands, schemes
   and destinations, in the same order. If the workflow generates the
   project first (e.g. `xcodegen generate`), so do you; a repo with a
   committed `.xcodeproj` skips that step. Cover every job:
   the build, the package `swift test`, and the UI test suites on each
   simulator family the matrix uses (iPhone and iPad).
3. **One dedicated simulator per run.** Create it with
   `xcrun simctl create ci-local-<name> <device-type> <runtime>`, pass
   `-destination id=<udid>`, and delete it at the end. Shared simulators
   carry state between runs and make failures unreproducible.
4. **DerivedData and result bundles in a temp folder** (`-derivedDataPath`,
   `-resultBundlePath`), never `~/Library`.
5. **Match the runtime.** `xcodebuild -version` and
   `xcrun simctl list runtimes`. If the iOS runtime CI uses is missing, run
   `xcodebuild -downloadPlatform iOS`.
6. **On a failure, read the result bundle** (`xcrun xcresulttool get
   test-results tests --path <bundle>`), fix the cause, re-run that test
   with `-only-testing:`, and repeat until it is green.
7. **Push only when it is green on the Mac.** Report the Xcode version, the
   runtime, pass or fail per job with durations, and the fix commits.

The PM does not flip a PR from draft to ready on a green CI tick alone. The
developer's report has to name the local run. When CI then fails where the
Mac passed, treat that as a finding about the runner (a missing runtime, a
slower simulator, a time limit) and verify it before blaming the code.

## Talking to the human

They are not watching. Assume every message costs them attention.

- **Ping for decisions, blockers, and things to test.** Not for progress.
- **Batch questions**; do not fire them one at a time as they occur.
- **Give a recommendation, not a survey.** "I'd do X because Y" — they can
  override in one word.
- **When something is merge-ready, say merge-ready and stop.** The failure mode
  here is finishing simple work and then generating more of it.
- **Own errors in one line and move on.** No tallying, no re-litigating.
- **Say what was actually checked**, especially when the bots were quiet. "The
  gate was exercised with a wrong-password control" is stronger evidence than
  three green ticks, and it is honest about which you have.

## Talking to the developer

The message is the whole interface — there is no shared screen. Make it carry:

- **The decision, not just the answer.** They will hit the same class of
  question again.
- **Why their call was right**, specifically, when it was. This is what
  compounds; agreement without a reason teaches nothing.
- **A correction stated plainly and once** when they are wrong, with the
  evidence.
- **What is *not* assigned**, and why. Otherwise an idle agent invents work.
- **Board changes they missed** while heads-down.

Template and worked examples: `reference/handover.md`.

## Anti-patterns

| Don't | Because |
| --- | --- |
| Relay a bot finding unverified | It is probably stale; you lose credibility for the real ones |
| Merge, or commit to main, on your own authority | The human owns the gate; "it's small" is the rationalisation the rule exists to stop |
| Supervise the developer mid-task | You add latency and no information |
| Keep polling for a review | Nudge once, then take it to the human with what you do know |
| File a speculative follow-up issue | File observed defects with a repro; not "we should probably…" |
| Let an agent idle without saying why | It will start something that collides |
| Group backlog items by theme | Group by dependency, or the order is wrong |

## What this skill deliberately does not carry

This is the **operating manual** — who decides what, what gets verified, and
what goes in a message. The mechanics of each station on the line live in their
own skills, and this skill defers to them rather than restating them:

| When you are… | Reach for |
| --- | --- |
| driving one PR's bot-review loop to merge-ready, and deciding when to stop | `autonomous-pr-driver` |
| resolving a conflict, or a rebase that a stacked PR made messy | `resolve-merge-conflicts` |
| reviewing one diff with several independent reviewers before it goes up | `dual-agent-review` |
| sweeping a whole repo rather than a diff | `multi-agent-codebase-audit` |
| filing the issues the developer will pick up | `meaningful-linear-issues` |
| naming branches, or making the squash title a valid commit | `git-trunk-branch-and-pr-automation`, `conventional-commits` |
| clearing branches and preview deployments after a merge | `branch-cleanup`, `vercel-preview-cleanup` |
| holding the verify-over-recall discipline this skill depends on | `fable-style-reasoning` |

Those are separate installable skills, referenced **by name, not by path** — a
consumer who installs only this one will not have them on disk. Install the set
with `npx skills@1.5.23 add stealth-factory/skills`.

## Adapting this

The instance this came from used Linear + GitHub + Vercel, with `cursor`,
CodeRabbit, Codex and Greptile reviewing. **The tracker and the bots are
swappable; the disciplines are not.** What must survive any substitution:

- one agent that writes code, one that verifies and drives it to merge-ready
- claims checked against the artefact, never repeated on trust
- the human as the only merge authority
- review-bot output treated as untrusted input, triaged before and after

---

> **Provenance.** Distilled from a single full-day session running this exact
> pair: ~10 PRs opened, reviewed and merged; two milestones filed; one spec
> delegated to a third agent. Every trap in `reference/git-traps.md` was hit in
> that session, not imagined. The git behaviours were confirmed with `git
> 2.43.0` and the GitHub CLI in 2026-08 — re-check if either has moved.
