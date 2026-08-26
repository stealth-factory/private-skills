# Stealth Company — Private Agent Skills

> _The public repo is the set of skills we're happy for anyone to have. This is
> the set that only makes sense inside the studio._

The **private** half of our [skills.sh](https://www.skills.sh)-compatible **agent
skills** — reusable, on-demand context and instructions for AI coding agents
(Claude Code, Codex, Cursor, and other skills.sh-compatible agents).

Its public sibling lives at
[`stealth-factory/skills`](https://github.com/stealth-factory/skills), and **those
skills are installed into this repo**, so an agent working here sees both sets at
once.

Each skill is a folder under [`skills/`](./skills) containing a `SKILL.md`: YAML
frontmatter (`name` + a trigger `description`) and a markdown body the agent loads
only when the skill is relevant.

## Install

This repo is **private**, and `npx skills add` git-clones its source — so the
machine installing it needs access:

```bash
gh auth setup-git                                   # once, so git can clone over HTTPS

# Interactive — pick which skills (and which agents) to install:
npx skills add stealth-factory/private-skills

# Or point at SSH directly, no gh setup needed:
npx skills add git@github.com:stealth-factory/private-skills.git

# A specific skill:
npx skills add stealth-factory/private-skills --skill claude-software-factory

# Everything, globally (available in every project):
npx skills add stealth-factory/private-skills --all -g
```

Manage installed skills with `npx skills list`, `npx skills update`, and
`npx skills remove`.

> Private repos are **not** indexed by skills.sh search or the leaderboard. That
> is the trade: shareable with the team, not publicly discoverable.

## Skills

| Skill | What it's for |
| ----- | ------------- |
| [`claude-software-factory`](./skills/claude-software-factory/SKILL.md) | Run a project as a factory of two AI agents — a **PM** that owns the tracker, the PRs and the merge queue and writes no application code, and a **developer** that owns branches, worktrees and the code — with review bots reviewing and a **human as the only merge authority**. The operating manual for the PM half: *verify, never relay* (findings go stale faster than they get resolved), the handover message as the whole interface, triaging reviewers **before** they review, and the git traps that succeed silently — the lying `mergeable` flag, squash + stack + auto-delete, and the clean rebase that drops a hunk with no error. Ships handover templates, a review-bot playbook, and the git-trap catalogue. |

## Working in this repo

The public skills are installed here, and this repo's own skills are symlinked
into the agent-discovery directories, so both sets are live:

```bash
npx skills add stealth-factory/skills -s '*' -a claude-code codex -y   # public set
```

See [`AGENTS.md`](./AGENTS.md) for the authoring conventions, the relink loop, what
belongs in this repo rather than the public one, and the branching/PR workflow.

## Repository layout

```
skills/
  <skill-name>/
    SKILL.md         # entry: frontmatter (name + description) + the skill body
    reference/*.md   # optional — deep docs the skill links to, loaded on demand
    scripts/*        # optional — runnable helpers the skill invokes
    templates/*      # optional — boilerplate the skill copies
README.md
AGENTS.md            # conventions for authoring skills in this repo (CLAUDE.md -> this)
skills-lock.json     # which public skills are installed here (the copies are gitignored)
```

## Adding a skill

```bash
npx skills init skills/<skill-name>   # scaffolds skills/<skill-name>/SKILL.md
```

Then fill in the frontmatter + body, re-run the relink loop from
[`AGENTS.md`](./AGENTS.md), add a row to the table above, and open a PR.

## License

**Proprietary — internal to Stealth Company. All rights reserved.** Not licensed
for redistribution. (The public sibling repo is MIT; this one deliberately is
not.)
