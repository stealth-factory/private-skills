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
npx skills@1.5.23 add stealth-factory/private-skills

# Or point at SSH directly, no gh setup needed:
npx skills@1.5.23 add git@github.com:stealth-factory/private-skills.git

# A specific skill:
npx skills@1.5.23 add stealth-factory/private-skills --skill claude-software-factory

# Everything, globally (available in every project):
npx skills@1.5.23 add stealth-factory/private-skills --all -g
```

Pin `@1.5.23` — flag behaviour in [`AGENTS.md`](./AGENTS.md) was verified
against that release. Manage installed skills with `npx skills@1.5.23 list`,
`npx skills@1.5.23 update`, and `npx skills@1.5.23 remove`.

> Private repos are **not** indexed by skills.sh search or the leaderboard. That
> is the trade: shareable with the team, not publicly discoverable.

## Skills

| Skill | What it's for |
| ----- | ------------- |
| [`claude-software-factory`](./skills/claude-software-factory/SKILL.md) | Run a project as a factory of two AI agents — a **PM** that owns the tracker, the PRs and the merge queue and writes no application code, and a **developer** that owns branches, worktrees and the code — with review bots reviewing and a **human as the only merge authority**. The operating manual for the PM half: *verify, never relay* (findings go stale faster than they get resolved), the handover message as the whole interface, triaging reviewers **before** they review, and the git traps that succeed silently — the lying `mergeable` flag, squash + stack + auto-delete, and the clean rebase that drops a hunk with no error. Ships handover templates, a review-bot playbook, and the git-trap catalogue. |
| [`turborepo-vercel-monorepo`](./skills/turborepo-vercel-monorepo/SKILL.md) | Lay out a **pnpm + Turborepo monorepo** with one Vercel project per app: `apps/api` on Vercel Functions, `apps/web`, an optional Swift app in `apps/apple`, shared `packages/*`, path-filtered CI, a per-app build skip so Swift commits do not rebuild Vercel projects, and Neon Postgres through the Vercel Marketplace. Ships root config, working app skeletons and CI templates. Releases come from `xcode-vercel-release-tracks`. |
| [`xcode-vercel-release-tracks`](./skills/xcode-vercel-release-tracks/SKILL.md) | Semantic-versioned **releases** for an Xcode app via TestFlight, either **on its own** in a plain Xcode app repo or as one track of a monorepo that also ships web apps or APIs on Vercel. One `main`; per-track git-cliff versions, changelogs and `<track>-vX.Y.Z` tags; a standing release PR per track. Merges to main go to TestFlight internal and a Vercel `staging` environment (with a Neon `staging` branch); tags go to TestFlight external with Beta App Review and fast-forward `production/<track>` for Vercel production. Ships the workflows, scripts, config and a one-off setup checklist. |

## Working in this repo

The public skills are installed here, and this repo's own skills are symlinked
into the agent-discovery directories, so both sets are live:

```bash
npx skills@1.5.23 add stealth-factory/skills -s '*' -a claude-code codex -y   # public set
```

See [`AGENTS.md`](./AGENTS.md) for the authoring conventions, the relink loop, what
belongs in this repo rather than the public one, and the branching/PR workflow.

## Repository layout

```text
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
npx skills@1.5.23 init skills/<skill-name>   # scaffolds skills/<skill-name>/SKILL.md
```

Then fill in the frontmatter + body, re-run the relink loop from
[`AGENTS.md`](./AGENTS.md), add a row to the table above, and open a PR.

## License

**Proprietary — internal to Stealth Company. All rights reserved.** Not licensed
for redistribution. (The public sibling repo is MIT; this one deliberately is
not.)
