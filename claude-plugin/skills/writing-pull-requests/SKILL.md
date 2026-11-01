---
name: writing-pull-requests
description: Write a pull request description that pull-me accepts - Why, How, Review hints and Proof, self-contained and readable for a junior engineer. Use before every gh pr create or gh pr edit with a body, and after the pull-me hook denied one.
---

# Writing pull requests with pull-me

Repositories that use pull-me reject a pull request whose description misses a section or whose Proof has no
evidence. A hook in this plugin checks the body before `gh pr create` or `gh pr edit` runs; this skill is how to get
it right the first time.

## Who you write for

A junior engineer who is new to this repository reads the description. They have not seen the issue, the design
document or the chat that led to the change. So:

- **State every fact yourself.** An issue, a decision or a design document may be linked, but your text says what it
  says. "Implements D12." tells the reader nothing; "The team capped each client at 10 requests a second (D12)."
  does. A reference that stands alone is an error.
- **Explain each term and abbreviation the first time**: in brackets ("SBOM (software bill of materials)"), after a
  colon, or as "Vale, a linter for prose". The repository's glossary (`.github/glossary.md`) lists the terms that need
  it, and the hook's hint quotes the glossary.
- **Keep sentences short**: one idea each, under 30 words.
- **Say it plainly**: no "very", "basically", "in order to", "I think". Give the number or the fact.

## The four sections

```markdown
## Why
## How
## Review hints
## Proof
```

Use exactly these `##` headings, in this order. Optional sections: `## Stacked on` (with a sentence on what each
linked pull request does), `## Breaking changes` (needed when the title has `!`), `## Follow-ups`.

**Why** is the outcome and its reason: what we wanted to achieve, for whom, and who asked for it. Not the diff.

**How** is the choices and their trade-offs: what you picked, what you rejected and why, what moved where. Not a
file list: `pull-me body` generates that.

**Review hints** names the riskiest file first, then the known gaps and what was not tested. Say what to read first.

**Proof** is evidence, not a claim. Each of these counts:

- the command and its output in a fenced block (a block with only `$ commands` does not count);
- a link to the CI run, job or artifact (`https://github.com/<owner>/<repo>/actions/runs/<id>`);
- a screenshot: `gh pr edit <n> --attach shot.png` (or `pull-me attach <n> shot.png#alt text`), which uploads it
  and puts it in the body. A local path such as `![](./shot.png)` without `--attach` is an error;
- before and after numbers, in a table or a fenced block, with how they were measured.

"All tests pass." on its own is not evidence.

## Before and after

> Before: "Implements D12 per rate-limit.md §3; see #41. Uses a TB with burst 20."
>
> After: "Clients that send too many requests slowed the API (application programming interface) for everyone. The
> team decided to cap each client at 10 requests a second ([D12](link)). This PR adds a token bucket: each client
> gets 20 tokens, and one comes back every 100 ms. A request without a token gets HTTP 429 (too many requests)."

The "after" names the problem, the decision in its own words, the mechanism with its numbers, and what a client sees.
The links stay, as extras.

## When the hook denies

- **Errors** (`PM001`-`PM005`, `DevBuildDeploy.BareReferences`): the denial lists each finding with its line and a
  fix. Nothing was created or changed. Fix the body and run the command again.
- **Warnings** (long sentences, unexplained terms, weasel words): the first time, the hook denies once and lists them.
  Fix them, or send the same body again to keep it as it is; a false positive never blocks you.
- `gh pr create --fill` is denied (a body from commits has no sections), and so is `gh pr create` without a body.
- Write the body to a file and pass `--body-file`, or use a heredoc (`--body-file - <<'EOF'`): long bodies in
  `--body "..."` are easy to break with quotes.
- Check a body yourself first with `pull-me check --body-file body.md --title "<title>"`.
