# AGENTS.md

Instructions for AI agents (and humans) authoring skills in this repository.

## What this repo is

The **private** half of the studio's [skills.sh](https://www.skills.sh)-compatible
**agent skills**. Each skill is reusable, on-demand context for an AI coding
agent. One skill = one folder under `skills/` with a `SKILL.md`.

Its public sibling is [`stealth-factory/skills`](https://github.com/stealth-factory/skills),
whose skills are **installed into this repo** (see below) so both sets are live
while you work here.

**Project tracking:** [Linear — Skills](https://linear.app/stealth-company/project/skills-2bf14f088070/overview).

### What belongs here rather than in the public repo

Public is the default — a skill that would help anyone should go there, because
public repos are the only ones indexed by skills.sh search and the leaderboard.
Put a skill **here** when it:

- encodes studio-internal process, judgement, or org structure;
- names clients, private repos, internal hostnames, or infrastructure;
- is only meaningful against a private codebase;
- is not ready to be read by strangers yet (draft it here, promote it later).

**Never** put a credential, token, or private key in a skill in either repo. A
private repo is access-controlled, not a secret store — it is cloned onto every
machine that installs from it.

## Layout

```text
skills/<skill-name>/SKILL.md              # flat (preferred)
skills/<category>/<skill-name>/SKILL.md   # only if you have enough to categorise
```

`<skill-name>` is kebab-case and matches the `name:` in the frontmatter. No
manifest file is needed — the `skills` CLI auto-discovers these paths.

Do **not** add a `SKILL.md` at the repo root: it short-circuits discovery and
the CLI treats the whole repo as one skill.

## SKILL.md format

```markdown
---
name: my-skill                # kebab-case, matches the folder
description: <one line>       # SEE BELOW — this is the most important field
metadata:
  author: stealth-factory
  co-author: wiiiimm          # de facto field across our skills — keep it
  version: "1.0.0"            # bump on meaningful change (semver)
---

# Title

<the body the agent loads when the skill fires>
```

### The `description` is the trigger (write it carefully)

It's the **only** part of a skill that's always in the agent's context; the body
loads **only when the description matches** the task. So write it as **concrete
triggers**, not marketing:

- Good: `Use when an iPhone/iPad page shows black bars, content is cut off at the
  bar edge, a cropped shadow, or the page jumps after the keyboard closes.`
- Bad: `Helps with iOS Safari styling.`

Lead with what the skill does, then "Use when …" listing the situations, symptoms,
and phrases a user might say. When a skill sits next to siblings with adjacent
scope, **say in the description which is which** — the description is the only
thing the agent has to choose between them.

### The body

- Write for the **agent**, not end users — actionable facts, steps, rules.
- Keep it **scannable** (headings, short sections, tables, code blocks).
- **Progressive disclosure:** keep `SKILL.md` focused; if a skill needs heavy
  reference material or scripts, put them in sibling files and link to them so
  they load only when needed.
- Prefer **facts and case-dependent guidance** over a single rigid recipe, so the
  skill stays useful across situations.
- Note provenance (how a non-obvious claim was verified) when it helps trust.
- **Cross-reference sibling skills by name, never by relative path.** A consumer
  can install one skill without the others, so `../other-skill/SKILL.md` dangles.
  Name it and give the install command once.

## Bundling files in a skill

A skill is a **directory**, not just `SKILL.md`:

```text
skills/<skill-name>/
  SKILL.md          # entry: frontmatter + concise body
  reference/*.md    # optional — deep detail, read on demand
  scripts/*         # optional — runnable helpers the skill invokes
  templates/*       # optional — boilerplate the skill copies
```

Only `SKILL.md`'s body loads when the skill fires; everything else loads/reads/
runs **only when `SKILL.md` references it** (by relative path *within* the
skill). The CLI installs the whole directory, so those relative links keep
working. Small skills are fine as a single `SKILL.md`.

## Adding a skill

```bash
npx skills@1.5.23 init skills/<skill-name>   # scaffolds the folder + SKILL.md
```

Then fill in the frontmatter + body, **re-run the relink loop below**, add a row
to the **Skills** table in `README.md`, and commit.

## The public skills are installed here

The public set is installed into this repo with the `skills` CLI, so both halves
are available to any agent working in this tree:

```bash
npx skills@1.5.23 add stealth-factory/skills -s '*' -a claude-code codex -y
```

Pin `@1.5.23` — that is the version the flag behaviour below was verified
against. An unpinned `npx skills` can run a different registry release.

**`-s` and `-a` are variadic** — pass values space-separated, or repeat the flag.
**A comma-separated list breaks both**, verified on `skills` v1.5.23:

| Form | Result |
| --- | --- |
| `-s a b` / `-a claude-code codex` | works |
| `-s a -s b` / `-a claude-code -a codex` | works, just noisier |
| `-a claude-code,codex` | `Invalid agents: claude-code,codex` — exit 1, nothing installed |
| `-s a,b` | `No matching skills found for: a,b` — exit 1, nothing installed, **no lock file written** |

Both comma forms exit **1**, so a direct call fails loudly. They go quiet only
when the call is **piped**: `skills add … | grep …` returns the *grep's* status,
so an install that did nothing reports success. **Check what landed on disk, not
`$?`** — `ls .agents/skills | wc -l` against the count you expected. (The agent
is named `claude-code`, not `claude`.)

`--all` (= `--skill '*' --agent '*' -y`) also works, but installs to ~19 agents
and leaves a second full copy of every skill under a **non-hidden, top-level
`agent/`** directory — easy to sweep into a commit with `git add -A`, and
`npx skills@1.5.23 remove --all` leaves the empty directories behind. `.gitignore`
covers `/agent/` so a later `git add -A` cannot vendor it.

That writes real copies into `.agents/skills/<name>/`, symlinks
`.claude/skills/<name>` at them, and records the set in `skills-lock.json`.

- **`skills-lock.json` is tracked.** It is the record of which public skills this
  repo expects, with a content hash per skill. No absolute paths in it.
- **The installed copies are ignored, never committed.** Vendoring them would
  fork the public repo silently: the copies go stale and become
  indistinguishable from genuinely private skills. Re-run the `add` command above
  to restore or refresh them. (`npx skills@1.5.23 experimental_install` claims to
  restore from `skills-lock.json` — it is flagged experimental by the CLI itself
  and has not been verified here; the `add` command is the reliable path.)

## Dogfooding — this repo's own skills are live while you work here

Every skill under `skills/<name>/` is symlinked into the agent-discovery dirs so
**Claude Code and Codex (and other agents) pick them up automatically** in this
repo. The links are **relative**, so they resolve in any clone or worktree, and
they point at the **working-tree** skill — edits are live, no reinstall.

Those dirs are also where the CLI installs the public skills, and `.gitignore`
ignores their contents wholesale. So the relink loop **force-adds** our own
links; once tracked, git keeps tracking them:

```bash
# Flat (preferred): skills/<name>/SKILL.md
# Categorised:      skills/<category>/<name>/SKILL.md
# skills/*/ matches the category in the second form, so a basename-only
# loop would link the category and miss the skill.
# ln -sfn will not replace a real directory: GNU ln exits 0 and quietly
# creates the link *inside* it (verified). But a real directory at that path
# is an installed PUBLIC skill of the same name — refuse, do not delete it.
# Deleting would leave skills-lock.json describing a skill no longer on disk,
# and losing something is not recoverable the way failing to add is.
link_skill() {
  dest="$1" target="$2"
  if [ -d "$dest" ] && [ ! -L "$dest" ]; then
    echo "refusing: $dest is a real directory — an installed skill of the" >&2
    echo "  same name. Rename yours, or remove that install deliberately." >&2
    return 1
  fi
  ln -sfn "$target" "$dest"
}
for d in skills/*/; do
  if [ -f "${d}SKILL.md" ]; then
    n=$(basename "$d")
    link_skill ".claude/skills/$n" "../../skills/$n" || continue
    link_skill ".agents/skills/$n" "../../skills/$n" || continue
    git add -f ".claude/skills/$n" ".agents/skills/$n"
  else
    for sd in "$d"*/; do
      [ -f "${sd}SKILL.md" ] || continue
      n=$(basename "$sd")
      cat=$(basename "$d")
      link_skill ".claude/skills/$n" "../../skills/$cat/$n" || continue
      link_skill ".agents/skills/$n" "../../skills/$cat/$n" || continue
      git add -f ".claude/skills/$n" ".agents/skills/$n"
    done
  fi
done
```

Run it whenever you add a skill. Nothing else in those two directories should
ever be committed.

> `npx skills@1.5.23 remove --all` only removes what `skills-lock.json` tracks,
> so it leaves these links alone — but it is worth re-running the loop after any
> CLI operation on those directories.

## Consuming this repo elsewhere

`npx skills add` **git-clones** the source, so a private repo works only if the
machine is authed to clone it:

```bash
gh auth setup-git                                        # once, for HTTPS
npx skills@1.5.23 add stealth-factory/private-skills            # then this works
npx skills@1.5.23 add git@github.com:stealth-factory/private-skills.git   # or SSH directly
```

Private repos are not indexed by skills.sh search or the leaderboard. That is
the trade: shareable-with-the-team, not discoverable.

## Branching & pull requests

This repo uses a **feature-branch + PR** workflow. Do **not** commit directly to
`main` (the root bootstrap commit is the one exception — an empty repo cannot
take a PR).

- **Branch per change:** `feature/<kebab-desc>` off `main`. Build larger work in
  a git **worktree** so each change stays isolated.
- **Open a PR** with a **Conventional Commits title** — it becomes the
  squash-merge commit message (`feat(skill): …`, `docs: …`, `fix: …`).
- **Squash merge** to `main` (one PR = one commit on `main`).
- **Don't self-merge:** leave the PR for review and **ask before merging**.

## Conventions

- One concern per skill. Split rather than overload.
- Bump `metadata.version` (semver) on a meaningful change. Publisher metadata
  alone (`author:` rename, display-name/branding) is **not** a version bump —
  consumers resolve skills by repo path, not by that field.
- Conventional Commits for messages (`feat(skill): …`, `docs: …`, `fix: …`).

## The earned lessons live in the public repo

The public repo's [`AGENTS.md`](https://github.com/stealth-factory/skills/blob/main/AGENTS.md)
carries sections this one deliberately does **not** duplicate, because their
value is that they are *verified against that repo's environment* and a fork of
them would drift into confident fiction:

- **Environment facts** — a `gh` version-compatibility table (`--json` on
  `gh pr checks`, `gh api` not forwarding jq flags, `--slurp`, overloaded exit
  codes). Read as compatibility notes, not claims about the current machine;
  `gh` has been 2.45.0, 2.91.0 and 2.96.0 across checkouts. **Detect the version
  and run the exact invocation in the form it will ship.**
- **Writing skills that survive review** and **driving review** — failure
  patterns earned over that repo's PR history.

Those disciplines apply here; the specific verified facts belong to where they
were verified. Read them there.

## Review bots on this repo — observed, not inherited

This repo **does** have review bots: they fired on PR #1 without any setup, so
they are installed at the org level. Everything below was observed on that PR.
Re-verify — bots drift.

| Bot | Observed on PR #1 |
| --- | --- |
| **CodeRabbit** (`coderabbitai`) | Most active: 12 reviews. Its **final check was green (`pass`) with the description `Review rate limited`** — a passing tick on a head it never actually read. Read the description, never the colour. |
| **Codex** (`chatgpt-codex-connector`) | Reviewed, but posted **no status check at all**, so it never appears in the rollup. Silence from it is ambiguous, not approval. |
| **Greptile** (`greptile-apps`) | Posted a check while in progress, which was **not** in the final rollup. Do not read a verdict into its absence. |
| **`cursor`** (`cursoragent`) | **Fixes as well as reviews** — it pushed three commits to the branch, it did not merely comment. |

Two things that PR established and are worth keeping:

- **The pre-review triage worked.** The PR body named four deliberate decisions
  not to "fix" (the `.gitignore` + `git add -f` scheme, the absent LICENSE,
  name-not-path skill references, the guarded shell). All four survived a bot
  that was actively rewriting files. Post that triage **before** the review
  starts, per `skills/claude-software-factory/reference/review-bots.md`.
- **A bot that pushes commits needs its work reviewed like anyone's.** Those
  three commits were merged; two of their claims (`ln -sfn` linking *inside* a
  real directory, `git fetch origin main <branch>` refreshing the
  remote-tracking ref) were checked here and hold. One change it introduced —
  an `rm -rf` in the relink loop — did not, and is fixed in this file.
