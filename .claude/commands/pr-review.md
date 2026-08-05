---
description: Review a pull request — gather metadata, diff, and existing feedback, then give a verdict.
argument-hint: '[pr-number-or-url]'
---

Review a pull request by gathering all PR metadata, diff, and review comments, then provide a comprehensive review summary.

## Instructions

### 1. Identify the PR

- **URL provided** (e.g., `https://github.com/RoboFinSystems/robosystems-report-components/pull/29`): extract repo and number
- **Number provided** (e.g., `29`): use the current repository
- **Nothing provided**: detect from the current branch with `gh pr view --json number,url`; if none, ask

### 2. Gather PR Data

```bash
gh pr view <NUMBER> --json number,url,title,body,author,state,isDraft,labels,comments,reviews,reviewDecision,latestReviews,reviewRequests,statusCheckRollup,mergeStateStatus,headRefName,headRefOid,baseRefName,additions,deletions,changedFiles,files,closingIssuesReferences,createdAt,updatedAt

gh pr diff <NUMBER>

# Inline review comments — no --json equivalent exists
gh api repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/pulls/<NUMBER>/comments --paginate
```

**Field notes:**

- `reviews` not `reviewers` — `reviewers` is not a valid field and errors.
- `reviewDecision` answers "has this been approved."
- `comments` covers the top-level conversation; no separate `issues/<n>/comments` call needed.
- `files` matters: a diff touching `src/index.ts`, `src/adapters/index.ts`, `tsup.config.ts`, or `package.json` `files` has a blast radius the source diff doesn't show.
- Keep `--paginate` **bare** — adding `-q`/`--jq` makes gh emit one JSON document per page. Pipe to `jq` after.

### 3. Categorize Review Feedback

**How feedback actually arrives here:**

- Formal `reviews` and inline comments are typically **empty**, `reviewDecision` blank. That's the norm, not a skipped review.
- **AI review is opt-in** — `claude.yml` fires only on an `@claude` mention from an `OWNER`/`MEMBER`/`COLLABORATOR`, and findings land as a **bot comment in `comments`**, not a formal review.
- CI runs the full gate on **Node 22 and 24**, plus a **"Verify dist loads under Node ESM"** step. That step is this repo's signature check — it exists because tsc's `moduleResolution: "Bundler"` output is unloadable by Node's native resolver, and it's what catches a build-config regression.
- **What CI cannot see: the consumers.** Nothing installs the built package into `roboledger-app` or `robosystems-holon-viewer`. Green CI means it builds and loads, not that statements still render correctly downstream.
- `NEUTRAL`/`SKIPPED` conclusions are not failures.

### 4. Review the Diff

- **Adapter seam first.** An adapter turns its source into a `NormalizedReport` and nothing more; the presentation walk, subtotal footing, and projection are identical for every source. **A source-specific branch inside `pivot`, `project`, `sections`, or a component is an architecture violation** — flag it as blocking and ask what prevented an adapter-level fix. A new source means a new adapter behind the `ReportAdapter` contract.
- **Changed numbers.** Does the diff alter a rendered value, a subtotal, a scaling or formatting rule, or `footCheck`? Those need a before/after in the description and a fixture that pins them. A silent numeric change is the worst thing this library can ship — consumers reconcile real statements against it.
- **Pivot correctness.** A section is a hypercube and each cell is keyed on a fact's **full aspect signature**. A change that loosens that key produces cells that look plausible and are wrong — the hardest failure mode here to spot by eye. Read such a change against the fixtures, not the prose.
- **Public API.** Exports from `src/index.ts` / `src/adapters/index.ts` are downstream API for `roboledger-app` and `robosystems-holon-viewer`. Renames and removals are **breaking even pre-1.0**. Is new surface actually re-exported from an entry? If not, consumers can't reach it.
- **Framework purity.** `react` / `react-dom` are external peers, and **no framework import belongs in this package** — a `next/*` import is blocking, not a nit; it would break the non-Next consumer.
- **Build config.** Changes to `tsup.config.ts` (entries, `external`, `splitting`, `dts`) or to `package.json` `files`/`.npmignore` decide what ships and whether it loads. Read them with real suspicion, and check the Node-ESM verification step still passes.
- **Correctness / patterns**: does it do what the description says, and follow `CLAUDE.md`?
- **Tests**: are changes covered? Read the test — one asserting the buggy behavior passes just as happily. New rendering behavior should come with a fixture; `test/fixtures/` is verbatim sample data and Prettier-ignored on purpose, so don't flag its formatting.
- **Disclosure hygiene** (public repo): does the PR text over-disclose? And is there **real financial data** in a new fixture? Fixtures should be invented, not borrowed.
- **Missing changes**: a new adapter not registered in `src/adapters/index.ts`, a new component not exported, a new section role missing from `sections.ts`.

### 5. Output Format

```
## PR Summary
**Title**: ...
**Author**: ... | **Branch**: ... → ...
**Status**: ... | **Changes**: +X / -Y across Z files

<Brief summary of what the PR does>

## Consumer Impact
<BREAKING / ADDITIVE / INTERNAL — and whether any rendered number changed>

## Existing Review Feedback

### Human Reviews
### AI Reviews
### Code Quality
### Security
### CI/CD Status

## My Review

### Issues (should fix before merge)
### Suggestions (non-blocking improvements)
### Questions

## Verdict
<APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION — with brief rationale>
```

### Notes

- Weight the adapter-seam and changed-numbers checks above everything else; they are what this library exists to get right
- Build-config diffs are small, untested by unit tests, and consumer-fatal — read them closely
- For security findings, err on the side of flagging
- If the PR references an issue (`closingIssuesReferences`), check the requirements are met

$ARGUMENTS
