---
description: Create a GitHub issue for the report-rendering library, routed to the right layer.
argument-hint: '[what the issue is about]'
---

Create a GitHub issue for the current repository based on the user's input.

## Instructions

1. **Check you're in the right repo, and the right layer** - This package renders XBRL-grade financial statements from a `NormalizedReport`. It is source-agnostic and framework-free by design, and it is consumed in production by `roboledger-app` and `robosystems-holon-viewer`. Most reports of "the statement is wrong" resolve to one of four layers — say which:
   - **The data** — the facts, elements, periods, units, or the calculation/presentation association networks are wrong at the source. That belongs in `RoboFinSystems/robosystems` (or whatever produced the document). This library renders what it is given; a wrong number that is wrong in the source is not a bug here.
   - **An adapter** (`src/adapters/`) — the source was right but the translation into `NormalizedReport` dropped or mangled something. One file per source (`jsonld`, `store`, `sec`, `cypher`), all behind the `ReportAdapter` contract in `types.ts`.
   - **The engine** (`src/pivot.ts`, `src/project.ts`, `src/sections.ts`, `src/format.ts`) — the normalization was right but the pivot, the presentation-order walk, the calculation-subtotal set, `footCheck`, or the formatting is wrong. This is source-independent: if it reproduces from more than one adapter, it lives here.
   - **A component** (`src/components/`, `src/chart/`) — the projection was right but `ReportView` / `StatementTable` / `FactInspector` / `TimeSeriesChart` renders it wrong.

   A useful discriminator: **does it reproduce through a different adapter?** If yes, it's the engine or a component; if only one source shows it, suspect that adapter.

2. **Determine Issue Type** - Pick one: **Bug**, **Task**, **Feature**, **RFC**, **Spec**.

   **This repo has no `.github/ISSUE_TEMPLATE/` directory**, unlike the apps and the SDK clients. Confirm before assuming — `ls .github/ISSUE_TEMPLATE/` and `gh issue create --help`. If issue types are available on the org, still set one with `--type`; otherwise structure the body yourself.

3. **Gather Context** - Read the relevant source, and check `test/` — specs there are the fastest way to see what behavior is currently pinned. Note `test/fixtures/` is verbatim sample data and is Prettier-ignored on purpose.

4. **Draft the Issue** - With no template to mirror, impose structure. For a rendering bug that means:
   - **Which adapter** the report came through, and whether it reproduces through another
   - The **statement and section**, plus the element name or concept, and the period
   - **Actual vs expected values**, precisely — "the subtotal is wrong" is not reproducible; "Total current assets renders 1,240 where the calculation network sums its children to 1,245" is
   - Whether **`footCheck`** flags it — a subtotal that doesn't foot is a different bug class from one that foots to the wrong number
   - A **minimal fixture** if you can produce one. Fixtures are how bugs in this repo get fixed; a described bug without one usually stalls.

5. **Say whether it's a breaking change for consumers** - The package is **pre-1.0 but the exported surface is a real API contract**: `roboledger-app` and `robosystems-holon-viewer` both consume it in production. Exporting from `src/index.ts` (or `src/adapters/index.ts`) publishes a symbol downstream — **renames and removals are breaking even pre-1.0**. If the issue implies changing an exported name, a prop, or a rendered structure consumers style against, say so.

6. **Sanitize for Public Visibility** - This repo is public and the issue is world-readable immediately. Before creating:
   - **Financial data is the main hazard here.** Real statements, balances, and entity names must not appear. Reconstruct the shape with invented figures — that's usually a _better_ bug report anyway, since it isolates the mechanism.
   - Remove customer names, graph IDs, API keys, and JWTs from pasted output
   - Remove internal pricing, margins, or cost details
   - For anything security-adjacent, keep the text terse and non-actionable. For coordinated disclosure use a private GitHub Security Advisory, never a public issue.

7. **Create the Issue**:

   ```bash
   gh issue create \
     --type <Bug|Task|Feature|RFC|Spec> \
     --title "<clear, concise title>" \
     --body-file /tmp/issue-body.md \
     --label "<labels>"
   ```

   No prefixes like `[SPEC]` in the title. Write the body to a file to avoid shell-escaping problems.

## Labels

```bash
gh label list --limit 100
```

**This repo carries only GitHub's stock labels** (`bug`, `documentation`, `enhancement`, `question`, …). It does **not** have the `area:*` / `priority:*` / `size:*` families the apps and SDK clients use — don't apply those from memory, because `gh issue create` fails on a label that doesn't exist.

## Example Usage

User: "Operating expenses shows a blank cell for FY2023 in the holon viewer"

Response: Let me work out which layer that is...

[Check whether the fact exists in the source document at all — if not, it's a data issue]
[If present, check whether the adapter normalized it, then whether the pivot's aspect signature matched the cell]
[Draft a body naming the adapter, statement, element, period, actual vs expected, plus a minimal fixture]
[Create with `gh issue create --type Bug --label bug`]

## Output Format

1. The issue URL
2. Brief summary of what was created
3. Issue type and labels applied
4. Which layer you concluded it belongs to, and any companion issue that should be filed upstream

$ARGUMENTS
