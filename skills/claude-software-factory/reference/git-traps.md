# Git traps in a two-agent, squash-merge, stacked-PR workflow

Every one of these was hit in a single working day. They share a shape: **the
command succeeds and the result is wrong**, so nothing alerts you.

## 1. The mergeable flag is not the answer

GitHub's `mergeable` field reports `UNKNOWN` while it recomputes and stays
stale for minutes after a merge lands. Branches that will conflict show
`MERGEABLE`; branches that are fine show `CONFLICTING`.

```bash
# Fetch the base AND the topic. Fetching only <branch> leaves origin/main
# stale and can report CLEAN against a pre-merge base.
if git fetch origin main "<branch>" -q \
   && git rev-parse -q --verify "origin/main^{commit}" >/dev/null \
   && git rev-parse -q --verify "origin/<branch>^{commit}" >/dev/null
then
  git merge-tree --write-tree --name-only origin/main "origin/<branch>" \
    >/dev/null 2>&1 && echo CLEAN || echo CONFLICTS
else
  echo UNKNOWN
fi
```

`CLEAN` / `CONFLICTS` are a merge verdict **only after both refs resolve.**
A failed fetch or a missing ref is `UNKNOWN` — missing evidence, not a
conflict. Do not run `merge-tree` until the three lookups above have
succeeded: it exits **1** for a real conflict *and* for a ref it cannot merge,
so a branch you never fetched, or one that was deleted, reports as
`CONFLICTS` identically to a genuine conflict. Verified on git 2.43.0: a real
conflict exits 1 and names the file; a nonexistent ref exits 1 and prints
`not something we can merge`. The exit status alone cannot tell them apart —
that is why the lookups are in the `if` and `merge-tree` is only in the
`then`. Drop the redirect to see which files conflict.

**Do not use the older three-argument form** — `git merge-tree <base> <a> <b>`
does a trivial merge and prints `changed in both` for files touched on both
sides *without* conflicting. Counting those as conflicts gives false alarms;
counting conflict markers misses real ones. One session had this report zero
markers on a branch the real merge refused.

Sweep every open PR after every merge — running the guarded recipe above per
branch, and **testing every lookup on its own**. Do not wrap it in the obvious
one-liner:

```bash
for n in $(gh pr list --state open --json number --jq '.[].number'); do   # DON'T
```

If `gh` fails — auth expired, wrong repo, rate limit — the substitution is
**empty**, the loop body never runs, and a sweep that examined nothing prints
nothing. That is indistinguishable from "every branch is clean", which is the
one answer you must never get wrong here. The same applies to each branch-name
lookup and each fetch inside the loop: a failure is missing evidence, not a
clean branch. Capture the PR list first, confirm it is non-empty and plausible,
then iterate. `gh pr list` also defaults to `--limit 30` and is silent about
the remainder — a sweep of 31 open PRs that never asked for more will claim
to have checked every branch while skipping PR 31 onward.

```bash
if prs=$(gh pr list --state open --limit 1000 --json number,headRefName); then
  count=$(printf '%s\n' "$prs" | jq 'length')
  # empty can be real (no open PRs) or a surprise — confirm against the UI
  # 1000 means you hit the cap you asked for: paginate, do not treat as done
  [ "$count" -eq 1000 ] && echo UNKNOWN: hit --limit cap
else
  echo UNKNOWN: gh pr list failed
fi
```

## 2. Squash-merge + stacked PR + auto-delete

The compound trap. Three settings that are each individually correct:

- **squash merge** — one commit per PR on main
- **stacked PRs** — a branch based on another open branch
- **delete branch on merge** — no stale branches

When the parent squash-merges, main gets **one** commit containing all its
changes. The child branch still carries the parent's **original** commits. Git
now sees the same changes from two ancestries and reports conflicts that are
not real conflicts. And the base branch the child pointed at has been deleted.

GitHub retargets the child to the parent's base (usually `main`) rather than
closing it, so the PR survives — but the content is wrong until rebased.

```bash
# replay only the child's own commits onto main
git rebase --onto origin/main <last-commit-of-parent> <child-branch>
git push --force-with-lease=<child-branch>:<expected-sha> origin HEAD:<child-branch>
```

`--force-with-lease` pinned to the exact expected SHA, not the bare flag: it
must fail if anyone pushed in between.

**Check whether the parent's branch still exists before you plan the rebase**
— if auto-delete removed it, the SHAs are still reachable from the child, so
the rebase works, but `origin/<parent>` will not resolve.

```bash
# assignment (unprefixed) propagates ls-remote's own status; `export refs=$(…)` would not
refs=$(git ls-remote --heads origin <parent-branch>) || { echo "lookup failed"; exit 1; }
[ -n "$refs" ] && echo "still there" || echo "gone"
```

**Do not pipe this into `wc -l` and read `0` as "gone".** A broken remote, an
auth failure or no network prints `0` through that pipe exactly like a branch
that really was deleted — verified: both cases print `0`. A failed lookup is
missing evidence, not a negative result, and here the negative result is what
tells you it is safe to rebase. Test the lookup's own status; treat a failure as
unknown and stop.

## 3. The squash body carries every commit

GitHub builds a squashed commit message from **every commit in
`main..branch`**. Resolve a stacked branch's conflict by *merging* main into it
and the parent's original commits are still in that range — so the parent's
commit messages land on main a second time, inside the child's squashed commit.

A repo using conventional commits for changelog generation will emit the same
feature line twice.

```bash
git log --format='%h %s' origin/main..origin/<branch>   # this is the squash body
```

Rebase rather than merge for a stacked branch, for this reason alone. In one
case it was 13 commits (8 belonging to an already-merged PR) versus 4.

**When two agents resolve the same conflict differently**, compare trees before
arguing about approach:

```bash
git rev-parse <a>^{tree}
git rev-parse <b>^{tree}       # identical trees => the choice is free
```

Identical trees mean no work is lost either way and the decision is purely
about history shape. That converts an argument into a checkable fact.

## 4. A clean rebase silently drops hunks

**The most dangerous one, because nothing reports it.**

If a change anchored on a line that another branch has since deleted, the hunk
is dropped during rebase with no conflict. The command exits zero. Type-check,
build and lint all pass, because the code is *valid* — it just no longer does
the thing.

Observed twice in a day. Once: a `setSamples({})` call vanished from a reset
function because the edit anchored on a line a merged PR had removed. Clearing
the workspace would have left orphaned records pointing at deleted objects. No
error, ever.

**Mitigation** — there is no automatic one:

- Name the specific things to re-check when you ask for a rebase, don't say
  "re-verify".
- Prefer checking the *substance* (`grep` for the call, read the function) over
  re-running the type-checker.
- Treat a rebase across a branch that touched the same files as a change
  requiring the same verification the original work needed.

A type error will catch this when the dropped hunk referenced a symbol that
also changed. It will not catch it when the code still compiles.

## 5. `--cwd` resolves output paths against the target

Tooling that takes a working-directory flag may resolve *output* paths against
it. A credentials pull run this way wrote three env files containing live
database URLs and API keys into a repo root, untracked and **not** covered by
`.gitignore` (`.env*` does not match `env.production`).

```bash
git status --porcelain            # look before every commit
git check-ignore -v <file>        # confirm ignore coverage rather than assuming
```

Stage by name. Never `git add -A` in a repo you have run tooling in.

## 6. Vercel "fail" that is a human cancel

A deployment cancelled from the dashboard reports as a **failed check**, not a
skipped one. It reads as a broken build on an otherwise green PR. Check the
description string before treating it as a failure — and do not redeploy over
someone's deliberate cancel; the next push clears it anyway.

```bash
gh pr checks <n>    # the last column carries "Canceled from the Vercel Dashboard"
```

## 7. Worktrees do not clean themselves up

Remote branches auto-delete on merge; local worktrees do not. They accumulate
stale `node_modules` and mislead the next agent about what is in flight.

```bash
git worktree remove ../<dir> && git worktree prune
```

Do it as part of the post-merge step, not as an occasional tidy-up. Also note a
worktree does **not** share `node_modules` — each needs its own install, and
its own dev-server port, or they silently fight over one.
