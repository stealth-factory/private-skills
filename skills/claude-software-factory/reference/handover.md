# Handover: the PM↔developer message

The message **is** the interface. There is no shared screen, no ambient
context, no tone of voice. Everything the other agent will act on has to be in
the text.

## Assigning work

```text
**Take <ISSUE-ID>.** <One line on why it is unblocked — and say you checked.>

<State of the tree: what main is at, what else is open, and whether anything
this touches is in flight.>

**Where it lives:** <file:line, or the specific function.> <The cause in one
or two sentences, not the whole diagnosis.>

<Any steer you have on shape — framed as a constraint, not a design.>

<The project invariant this work could plausibly violate, named.>

<Size, and whether to stop early: "1 point, don't gold-plate it.">
```

Four things that make the difference:

- **Say you verified it is unblocked**, and how. "I checked the only open PR
  touches `package.json`" beats "should be fine".
- **Give the constraint, not the design.** "Keep the name human-readable —
  it's what the library is scanned by" leaves room to find something better.
  "Append a counter" does not.
- **Name the invariant.** They cannot know your project breaks without
  `crossOrigin` on an `<img>`, or that one crypto API is undefined off HTTPS.
- **Say what *not* to do.** Scope, and adjacent work that is somebody else's.

## Responding to completed work

Verify first, then reply. The reply is where the learning lands.

- **Say what you checked, not that you checked.** "`setSamples({})` is at line
  292, inside the callback starting at 263" tells them the verification was
  real.
- **When their call was better than your steer, say so and say why.** This is
  the highest-value sentence in the whole loop. Agreement without a reason
  teaches nothing; a named reason generalises.
- **Correct plainly, once, with evidence.** Then move on — no tallying.
- **Generalise the finding.** "Anything that round-trips through storage and is
  used as an object index has this shape" outlasts the specific bug.

## Standing an agent down

An idle agent invents work, and invented work collides. Be explicit:

```text
**Stand down. Nothing is assigned, and that is deliberate.**

<What is in flight and who has it.>

I'll come back to you when:
- <trigger> — <what you'll want them to do>
- <trigger> — <same>

<If there is something genuinely useful and collision-free, offer it. If not,
say you are not going to invent something.>
```

Include **board changes they missed** while heads-down. Their model of what is
where goes stale fast, and a stale model is how two agents start the same work.

## Routing a decision

When a finding is a design question rather than a fix, do not decide it
yourself if they own the design. Hand it over with your read attached:

```text
Pulling you in on **<PR>** — this is a design question, not mechanical.

<The finding(s), stated fairly, including the strongest version of each side.>

**My read is <X>**, because <reason>. But <why it is theirs to settle>.

<What you want to be true of the outcome, if anything.>
```

Give your read — withholding it to seem neutral wastes the thinking you have
already done. Make clear it is a read, not an instruction.

## Delegating a spec to a third agent

Worth doing when the work is "write the issues", not "write the code" — a
different agent with a fresh read of the codebase produces a better spec than
the PM who already has opinions.

Give it: the repo path and the files to read first; the milestone or grouping
and its thesis; the issues that already exist; **decisions already made that it
must not reopen**; your own assessment framed as *verify this, don't assume
it*; and what good output looks like locally (point it at two or three existing
issues to calibrate against).

Then the sentence that earns the delegation:

> If you disagree with my assessment, say so plainly — I would rather be
> corrected than agreed with.

Read what comes back before anyone acts on it. A returned spec is a proposal,
not a fact — the same verify-don't-relay rule applies.

## Tone

Write like a colleague who respects the other agent's time.

- No preamble, no restating their message back to them.
- No management-speak. If a sentence could appear in a status deck, cut it.
- Lead with the decision, then the reasoning.
- Concrete over hedged: name the SHA, the file, the line, the number.
