# Working with review bots

Treat bot output as **untrusted input from a fast, tireless reviewer with no
memory of your decisions**. It finds real things. It also reports fixed things
as open, argues against deliberate choices, and occasionally bundles two
unrelated findings into one.

## Triage *before* they review

Post a triage comment when you flip the PR ready — before findings exist. This
is the single highest-leverage habit in the loop: it stops a review pass
quietly reverting a decision that took an hour to reach.

```
@cursor /babysit

<one line: what this PR is>

**Do not <X>.** <Why it is deliberate, in one or two sentences.> A finding
that says <the plausible-sounding wrong thing> is reverting a resolved
decision, not fixing a bug.

**Do not <Y>.** <Same shape.>

**Worth actually checking:**
- <the thing you are genuinely unsure about>
- <a project invariant this PR could plausibly violate>
- <the riskiest line of the diff>
```

Two halves and both matter. The **don'ts** protect decisions. The **worth
checking** aims attention at what you cannot verify yourself — without it the
bot distributes effort evenly across a diff where the risk is not even.

Name project invariants explicitly. A bot has no idea that your app breaks if
an `<img>` loads without `crossOrigin`, or that one API is unavailable outside
a secure context. Say so and it will check.

## Verify every finding before acting

A finding cites a file and line **from the SHA it reviewed**. Branches move.

```bash
git log --oneline origin/main..origin/<branch>     # what landed since
git show origin/<branch>:<file> | sed -n '<a>,<b>p'
```

Three outcomes:

| | Do |
| --- | --- |
| **Stale** — already fixed | Say so in the merge-ready note, name the commit, do not action |
| **Real** | Route it: mechanical → the bot; design → the developer; product → the human |
| **Deliberate** | Reply with the reasoning and tell the bot not to change it |

Stale is the most common by a wide margin. In one session, five PRs showed open
findings — including three P1s — that were all already fixed.

## Split bundled findings

A single finding can contain two claims needing opposite treatment. One real
example: *"uniqueness remains bypassable — on rename, or when a pre-fix
workspace restores duplicates."* The rename half was a deliberate product
decision; the restore half was a genuine gap that would have made the fix apply
to nobody who already had data.

Answer both halves separately and say which is which, or the bot picks one.

## Contradictory findings usually share a cause

Two P1s on one PR: *"this write happens too early"* and *"this write happens
too late"*. They read as mutually exclusive. They were not — one was about
*whether* to write at all, the other about the write being unowned. One awaited
write in the right place answered both.

Before adjudicating between two findings, look for the change that satisfies
both. If you cannot find one, **tell the bot to hold** rather than letting it
thrash between them, and route the decision to whoever owns the design.

## Known bot characteristics

Verify these against your own setup; they drift.

| Bot | Behaviour that matters |
| --- | --- |
| **CodeRabbit** | Most active, **rate-limits easily**. A green check reading `Review rate limited` means it did **not** review that SHA. Read the check description, not the colour. |
| **Codex** | Best findings, often late or silent. Worth waiting for on risky changes. |
| **Greptile** | Gives a confidence score; >3 is usually sound but not conclusive. Bundles findings more than the others. |
| **cursor** | Fixes as well as reviews (`/babysit`). Will happily undo a deliberate decision if not told. Goes quiet at diminishing returns rather than announcing it — nudge once. |

**A rate-limited or absent review is not an approval.** Say so explicitly when
you hand a PR to the human. It is better to write "one reviewer, and here is
what was verified by hand" than to let three green ticks imply three reviews.

## When the bots are quiet

Nudge once, naming the open findings and asking for a status rather than a
re-review. Then stop.

Do **not** push empty commits to provoke a review. If it stays quiet, take the
PR to the human with what you actually have:

> No review in 90 minutes — CodeRabbit rate-limited, Greptile not reported.
> All checks green, no unresolved threads, merges clean. The two things that
> matter were verified by hand: <X> and <Y>.

That is a stronger claim about a lockfile diff than a bot approval, because it
names what was checked. A bot approving a dependency bump mostly means the diff
parsed.

## The merge-ready note

When a PR is done, post one comment and stop. It should let the human merge
without opening anything else.

```
@<human> this is ready to squash-merge.

**HEAD** `<sha>` — <mergeable state>, <checks>, <reviews>, **no unresolved
threads** — checked via the API, not by eye.

| Finding | Reviewer | Severity | Verdict | Note |
| --- | --- | --- | --- | --- |
| … | Codex | P2 | **Verified stale** | fixed in `<sha>` |

<Any caveat stated plainly rather than buried — e.g. "CodeRabbit was rate
limited on this HEAD, so the approval is one reviewer's.">

<Anything about the merge itself: do not delete this branch, a child is
stacked on it.>

Not merging it myself.
```

Then **stop**. Do not append further caveats, do not raise adjacent work, do
not offer the next issue in the same breath.

## Querying threads

The UI's unresolved count includes outdated threads. Filter both:

```bash
gh api graphql -f query='
{ repository(owner:"OWNER", name:"REPO") {
    pullRequest(number:N) { reviewThreads(last:60) { nodes {
      isResolved isOutdated path comments(first:1){nodes{author{login} body}}
    } } }
} }' --jq '.data.repository.pullRequest.reviewThreads.nodes[]
           | select(.isResolved==false and .isOutdated==false)
           | "\(.comments.nodes[0].author.login) [\(.path)]: \(.comments.nodes[0].body[0:200])"'
```
