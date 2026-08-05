Draft curated release notes for an upcoming milestone release, following the convention in `.github/release-notes/README.md`.

## Why this command exists

`tag-release.yml` generates release bodies from the changes since the last tag. That suits routine releases but reads poorly for milestones, where the story is what the version _is_. The curated-notes override has non-obvious rules (body-only format, the file must exist at the tagged ref), and these notes are read by everyone who upgrades a published npm package — this command encodes the review and hygiene checks that keep them accurate and safe to publish.

## Instructions

### 1. Decide whether to curate at all

Not every release deserves curated notes. Routine patch releases should keep the generated changelog — skipping is a normal outcome, not a failure. Curate when the release is a milestone: a minor that changes component or adapter surface, a change to how statements render, the 1.0 graduation, or a version the documentation will reference. If the user invoked this command for a plain patch, say so and confirm they still want curated notes.

### 2. Establish the version and the range

- The target version comes from the argument (e.g. `/release-notes 0.4.0`). If none was given, ask what version the user intends to tag — the filename must match the eventual tag exactly, and a mismatched file is silently ignored. Derive it from the current `package.json` version plus the bump type the user will dispatch (`0.3.4` + `minor` → `0.4.0`).
- **Never bump the version yourself.** `create-release.yml` bumps `package.json` on `main` as its first step and derives the tag from the result — a hand-bump collides with it.
- **The range depends on the release kind.** A minor memorializes the whole series since the _previous minor_ (`vX.(Y-1).0..origin/main`) — patches got generated changelogs; the minor is the digest nobody gets from reading a dozen of them. A curated patch or hotfix covers only the span since the last tag:

```bash
LAST=$(git tag --sort=-creatordate | head -1)          # patch: last tag
# minor: previous minor tag, e.g. v0.3.0 when cutting v0.4.0
git log "$RANGE_START"..origin/main --merges --format='%s'
gh pr list --state merged --limit 30 --json number,title,mergedAt
```

Note the generated links section will still compare against the last tag; the prose should state the span it covers (e.g. "since v0.3.0") explicitly.

### 3. Review the changes for real

Do not write notes from commit subjects alone. Read the PR bodies (`gh pr view <n>`) and spot-check diffs where the description is thin. Classify everything into public-surface changes, rendering changes, fixes, and internals, then check specifically:

- **Rendering behavior.** This is the load-bearing check. The components render XBRL-grade statements: presentation-order walk, calculation-subtotal footing, multi-factSet facts, Information-Block table projection. A change that makes a statement _look_ or _foot_ differently is the most consequential thing this package can ship, and it must be stated plainly — consumers reconcile against these numbers. Never bury it under "styling".
- **Public surface.** The exported components (`ReportView`, `StatementTable`, `FactInspector`, `ExternalTextBlock`), the `./adapters` entry point and its reference adapters (`parseJsonld`, `cypherAdapter`, `fetchSecReportShell` / `fetchSecSection`, `parseStore`), and the normalized report model they produce. Renamed or removed props, changed defaults, and changed adapter return shapes break consumers even pre-1.0 — call each out by name.
- **Consumer coupling.** roboledger-app and roboinvestor-app both pin this package. Anything that requires a coordinated change on their side belongs in the notes, and should already have been flagged in the PR.
- **Source coupling.** Adapters read specific external shapes — `holon.jsonld` files, the GraphQL/Cypher surface, the SEC repository. If a change requires a newer producer of those shapes, say so; a consumer on the old producer will see empty or wrong output rather than an error.
- **Packaging changes.** New or renamed subpath exports, changed peer-dependency ranges, or a raised React or Node floor are upgrade blockers for someone. Note them.

### 4. Security disclosure review

This repo is public and the release publishes to npm in the same run, so the notes are world-readable immediately. For any security-adjacent change:

- Keep the line at PR-title neutrality: what area was hardened, never how or against what.
- No exploit mechanics, no affected-input enumerations, no detection signatures or thresholds, no "previously protected only by X" tells.
- Never paste content from private analysis documents into the notes.
- When in doubt, terser.

### 5. Write the file

Write `.github/release-notes/v<version>.md` — **body only**:

- No `# @robosystems/report-components v<version>` heading, no release-statistics section, no links section, no generated-with footer. The workflow supplies all of those. Start at the first line of prose.
- Lead with one or two sentences saying what the version is. Then sections as warranted: rendering changes, component and adapter surface, breaking changes (only if any truly exist), bug fixes. Ground every line in a change you actually reviewed.

### 6. Hand off — sequencing matters

The file must exist **at the tagged ref**, and there is no window to add it late: `create-release.yml` bumps the version on `main`, cuts `release/<version>` from the result, and tags it in the same run. Pushing that release branch is also what triggers `publish.yml`, so by the time the package is on npm the notes are already fixed. They have to be **merged into `main` before the workflow is dispatched**.

Write the draft on a feature branch (created via `npm run feature:create`), never on `main`. Present it for review and leave the merge and the dispatch to the user.
