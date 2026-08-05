---
description: Review the staged diff against this library's adapter seam, numeric correctness, and packaging rules.
---

Review all staged changes (`git diff --cached`) with focus on the contexts below. Read the diff first — if nothing is staged, say so rather than reviewing the working tree.

This is `@robosystems/report-components`: a **published, source-agnostic React library** for rendering XBRL-grade financial statements. Plain React + ESM, `react`/`react-dom` as peers only, no framework imports. Pre-1.0, but consumed in production by `roboledger-app` and `robosystems-holon-viewer`, so the exported surface is a real API contract. It is a **public repository**.

## The adapter seam (decides most verdicts)

The architecture is one idea: an adapter turns its source into a `NormalizedReport` and nothing more. The presentation walk, subtotal footing, and table projection are then **identical for every source**.

- **A source-specific branch inside `src/pivot.ts`, `src/project.ts`, `src/sections.ts`, or a component is an architecture violation** — not a pragmatic shortcut. Flag it as blocking and ask what prevented an adapter-level fix.
- A new source means a **new adapter** behind the `ReportAdapter` contract in `types.ts`, registered in `src/adapters/index.ts`.
- Does the change belong in `model.ts` instead? That file is the load-bearing seam — facts, Information Blocks, elements/periods/units/entity, and the calculation + presentation association networks. Widening it affects every adapter and every consumer.

## Numeric correctness

This library renders numbers people reconcile against. Treat any change to what is displayed as high-risk:

- Does the diff alter a rendered value, a subtotal, a scaling or formatting rule (`format.ts`, `constants.ts`), or `footCheck`? It needs a before/after and a fixture pinning it. A silent numeric change is the worst outcome here.
- **Pivot keys.** A section is a hypercube; each cell is keyed on a fact's **full aspect signature**. A change that loosens that key yields cells that look plausible and are wrong — the hardest failure to catch by eye. Check it against fixtures, not against the reasoning in the commit message.
- **Calculation vs presentation.** `project.ts` walks presentation order and derives the calculation-subtotal set; conflating the two networks produces subtotals in the wrong places.

## Public API

- Exporting from `src/index.ts` (or `src/adapters/index.ts` for adapters) **publishes the symbol downstream**. Renames and removals are breaking **even pre-1.0** — `roboledger-app` and `robosystems-holon-viewer` both consume this in production.
- Is new surface actually re-exported from one of the two entries? If not, consumers cannot reach it and the change is inert.
- Changed props or altered rendered structure count as breaking when consumer CSS or tests depend on them.

## Framework purity and packaging

- **No framework imports.** `react` / `react-dom` are external peers; a `next/*` import (or anything else framework-specific) is blocking — it would break the non-Next consumer.
- **tsup, not tsc.** `moduleResolution: "Bundler"` makes tsc emit extensionless relative imports that Node's ESM resolver rejects. Changes to `tsup.config.ts` — entries, `external`, `splitting`, `dts` — decide whether the published artifact loads at all. CI's "Verify dist loads under Node ESM" step guards this; keep it.
- **Two entries** (`src/index.ts`, `src/adapters/index.ts`) map to the `.` and `./adapters` export paths.
- **Only `dist/`, `README.md`, `LICENSE` publish** (`files` in `package.json`, `.npmignore` as defense in depth). A file consumers need that isn't in that list simply won't ship.
- **Never stage a `version` bump** — `create-release.yml` owns it.

## Testing

- Do rendering changes come with a fixture? Fixtures are how bugs here get fixed and kept fixed.
- `test/fixtures/` is verbatim sample data and is **Prettier-ignored on purpose** — don't flag its formatting, and don't reformat it.
- Is the test asserting correct behavior, or just what the code currently does?
- Are both Node 22 and 24 in play? CI runs the gate on both; a change relying on newer runtime behavior fails only on 22.

## Public-repo hygiene

- **Real financial data is the main hazard.** New fixtures must be invented, not borrowed from a customer's books — no real entity names, balances, or filings.
- No graph IDs, API keys, internal cost/pricing detail, or customer names in code, comments, or fixtures.
- If the change fixes a security issue, keep commit messages and comments terse and non-actionable — the area hardened, never the mechanism. The vulnerable version stays installable on npm until a patch is published.

## Style

Prettier owns style here (no semicolons, single quotes, 100 columns, organize-imports). Don't hand-format, and don't raise style points the formatter already settles — run `npm run format` instead. Note the gate is **check-only** (`format:check`), so it fails rather than fixing for you.

## Output

1. **Consumer impact**: BREAKING / ADDITIVE / INTERNAL, plus whether any rendered number changed
2. **Issues**: Problems that should be fixed before commit
3. **Suggestions**: Improvements that aren't blocking
4. **Questions**: Anything unclear that needs clarification

Anchor each finding to `file:line`. If the staged diff is clean, say so plainly rather than manufacturing findings.
