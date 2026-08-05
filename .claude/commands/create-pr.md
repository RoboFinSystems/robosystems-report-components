---
description: Open a pull request for the current branch, writing the description from the work actually done.
argument-hint: '[target-branch] [review]'
---

Create a GitHub pull request for the current branch, writing the title and description from the actual work done in this session — not reconstructed from the diff.

## Why this command exists

A PR description written from the diff alone can't know _why_ a change was made, so it tends to describe things that aren't true — and those descriptions then feed `@claude` reviews, compounding the bad information. **You author the description here, where the full context is available.**

This is `@robosystems/report-components` — a **published, source-agnostic React library** for rendering XBRL-grade financial statements, consumed in production by `roboledger-app` and `robosystems-holon-viewer`. It is pre-1.0, but the exported surface is a real API contract: a symbol re-exported from `src/index.ts` or `src/adapters/index.ts` is downstream API, and renames or removals are breaking regardless of the version number.

**This repository is public.** The PR title and body are world-readable the moment they're pushed, and publishing is triggered by a push to `release/**` rather than by a merge — so the text is often public before the version that carries it.

## Instructions

### 1. Preflight

```bash
CURRENT=$(git branch --show-current)
TARGET=${1:-main}            # override target via the first argument
```

- **Never PR from the default branch.** If `CURRENT` is `main`, stop. Branches are created with `npm run feature:create <type> <name>`, never `git switch -c`.
- **Never target a release branch.** `release/**` is what `publish.yml` watches; a PR into one is a publish trigger, not a review. Target `main`.
- **Source ≠ target.** If `CURRENT == TARGET`, stop.
- **Uncommitted changes.** `git status --porcelain` — surface them and ask whether to commit (never on `main`, stage by name, no `git add -A`) or proceed without. The description must reflect committed state.
- **Existing PR.** `gh pr list --head "$CURRENT" --base "$TARGET" --json url,number` — don't duplicate; offer `gh pr edit`.
- **Security fixes — check what's published.** The diff discloses the bug the moment it's pushed, and the vulnerable version stays installable on npm. Say which published versions are affected.
- **Push the branch.** `git push -u origin "$CURRENT"` (never `main` or `release/*` — the pre-push hook blocks those).

### 2. Gather the real change context

- **Primary source: this session.** What changed and why.
- **Corroborate:**
  ```bash
  git log --oneline "$TARGET".."$CURRENT"
  git diff --stat "$TARGET"..."$CURRENT"
  git diff "$TARGET"..."$CURRENT"             # read it, don't guess
  ```
- **Hard rule — no confabulation.** Every claim must be supported by the diff. When session context and the diff disagree, the diff wins and you investigate.

### 3. Compose the PR

- **Type** — from the branch prefix (`feature/` → feat, `bugfix/`/`fix/` → fix, `chore/` → chore, `refactor/` → refactor). Default `feat`.
- **Title** — concise (~50–72 chars), conventional-commit style with a scope, matching `git log` (e.g. `fix(pivot): key cells on the full aspect signature`).
- **Body** — markdown. **Match the headings in `.github/PULL_REQUEST_TEMPLATE.md`**, because `--body-file` bypasses template prefill entirely and a hand-written body silently drops whatever sections it omits:
  - **Summary** — 1–3 sentences: what this PR does and why.
  - **Changes** — bullets grouped by layer: adapter, engine (`pivot`/`project`/`sections`/`format`), components, build/tooling. Naming the layer is the single most useful thing for a reviewer here.
  - **Consumer Impact** — "None" if nothing exported changed, and say so explicitly rather than omitting the section. See below.
  - **Testing** — state truthfully what was run. The gate is `npm run test:all` (`format:check` → `lint` → `typecheck` → `test` → `build`). If the change affects rendered output, say which fixtures cover it. If nothing was run, say "Not run" — never claim passing tests that weren't executed.

  The template has no Related Issues section — put `Closes #123` / `Fixes #456` as the last line of the Summary.

- **Respect the adapter seam — and say if you didn't.** An adapter turns its source into a `NormalizedReport` and nothing more; the presentation walk, subtotal footing, and table projection are identical for every source. **A source-specific branch inside `pivot`, `project`, or a component is an architecture violation**, not a shortcut — if the PR contains one, say so explicitly and explain why no adapter-level fix was possible. A new source means a new adapter.

- **Consumer Impact is a required judgment:**
  - **Breaking** — a removed or renamed export, a changed prop, or altered rendered structure that consumer CSS or tests depend on. Both `roboledger-app` and `robosystems-holon-viewer` need coordinated adoption; say what each must change.
  - **Additive** — new exports, new optional props, a new adapter. Free, but name it.
  - **Internal** — engine refactors, tests, tooling that leave the exported surface and rendered output identical.

- **Changed numbers are their own category.** If the diff alters a rendered value, a subtotal, a scaling or formatting rule, or `footCheck` behavior, say so in plain terms and give a before/after. Consumers reconcile statements against these; a silent numeric change is the worst outcome this library can produce.

- **Build and packaging callouts** — small diffs, real blast radius:
  - **tsup, not tsc.** `moduleResolution: "Bundler"` makes tsc emit extensionless relative imports that Node's ESM resolver rejects. CI's "Verify dist loads under Node ESM" step guards the built output — if you touched `tsup.config.ts`, say so.
  - **`react` / `react-dom` stay external peers.** Never bundled, and no framework import ever enters this package.
  - **Two entries** (`src/index.ts`, `src/adapters/index.ts`) map to the `.` and `./adapters` export paths. A symbol not re-exported there is not public API.
  - **Only `dist/`, `README.md`, and `LICENSE` publish** (`files` plus `.npmignore`). Adding a file consumers need means updating that list.

- **Never bump `version` in `package.json`** — `create-release.yml` owns it. This PR publishes nothing.

- **Security-fix disclosure.** Terse and non-actionable — the area hardened, never the mechanism. For coordinated disclosure use a private GitHub Security Advisory.

- **Attribution** — attribute to the user only. No "🤖 Generated with Claude Code" footer, no `Co-Authored-By: Claude` trailer, unless explicitly asked.

### 4. Create the PR

```bash
gh pr create \
  --base "$TARGET" \
  --head "$CURRENT" \
  --title "<title>" \
  --body-file /tmp/pr-body.md
```

Print the resulting PR URL.

### 5. Optional Claude review

Only if the user explicitly asks (`review` / `--review`):

```bash
gh pr comment <number> --body "@claude please review this PR"
```

`claude.yml` only fires on an `@claude` mention from an `OWNER`/`MEMBER`/`COLLABORATOR`.

## Output

1. The PR URL.
2. A one-line summary of the title.
3. Target ← source branches.
4. The Consumer Impact classification, and whether any rendered number changed.
5. Whether a Claude review was requested.

## Arguments

`$ARGUMENTS` may contain a target branch (default `main`), `review` / `--review`, or freeform guidance.

$ARGUMENTS
