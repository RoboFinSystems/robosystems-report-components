# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`@robosystems/report-components` — a published, MIT-licensed npm package: source-agnostic React
components for rendering XBRL-grade financial statements. Plain React + ESM, `react`/`react-dom` as
peer deps only, no framework imports. **Pre-1.0**, but consumed in production by `roboledger-app` and
`robosystems-holon-viewer`, so the exported surface is a real API contract.

## Commands

```bash
npm run test:all      # format:check + lint + typecheck + test + build — the CI gate
npm run test          # Vitest (happy-dom); test:watch for watch mode
npm run build         # tsup → dist/ (ESM + .d.ts, two entries)
npm run lint          # ESLint (lint:fix to autofix)
npm run typecheck     # tsc --noEmit over src + test
npm run format        # Prettier write (format:check to verify)
```

`npm run prepare` points `core.hooksPath` at `.githooks/`: **pre-commit** runs format:check, lint,
typecheck, and test on every commit; **pre-push** blocks pushes to `main` / `release/*`. Both no-op
under CI. Never bypass them with `--no-verify`.

## Layout

- `src/model.ts` — `NormalizedReport`, the load-bearing seam: facts, Information Blocks, elements /
  periods / units / entity, and the calculation + presentation association networks
- `src/adapters/` — one file per source (`jsonld`, `store`, `sec`, `cypher`) behind the
  `ReportAdapter` contract in `types.ts`
- `src/pivot.ts` — the fact pivot engine (a section is a hypercube; rendering it is pivoting its
  fact table, with each cell keyed on a fact's full aspect signature)
- `src/project.ts` — presentation-order walk, calculation-subtotal set, `footCheck`
- `src/sections.ts` — structure role definition → title + `SectionKind`, shared by all adapters
- `src/format.ts`, `src/constants.ts` — value formatting / scaling and shared vocabulary
- `src/chart/` — chart projection (join, format, palette) for `TimeSeriesChart`
- `src/components/` — `ReportView`, `StatementTable`, `FactInspector`, `ExternalTextBlock`,
  `TimeSeriesChart`
- `src/index.ts` + `src/adapters/index.ts` — the two build entries, matching the `.` and `./adapters`
  export paths. A symbol not re-exported here is not public API
- `test/` — Vitest specs; `test/fixtures/` is verbatim sample data and is Prettier-ignored

## Conventions

- **The adapter seam is the architecture.** An adapter turns its source into a `NormalizedReport` and
  nothing more; the presentation walk, subtotal footing, and table projection are identical for every
  source. A new source means a new adapter — never a source-specific branch inside `pivot`,
  `project`, or a component.
- **Public API is deliberate.** Exporting from `src/index.ts` (and `src/adapters/index.ts` for
  adapters) publishes the symbol to downstream apps; renames and removals are breaking even pre-1.0.
- **Build with tsup, not tsc.** `moduleResolution: "Bundler"` makes tsc emit extensionless relative
  imports that Node's ESM resolver rejects (see the comment in `tsup.config.ts`). CI's
  "Verify dist loads under Node ESM" step guards the built output — keep it.
- **`react` / `react-dom` stay external peers.** Never bundle them, never import a framework.
- **Don't hand-format.** Prettier owns style (no semicolons, single quotes, 100 columns,
  organize-imports); run `npm run format`.
- **Never bump `version` in `package.json`** — the release workflow owns it.
- Create branches with `npm run feature:create <type> <name>`, not `git switch -c`.

## Release & Publish

- `create-release.yml` (manual dispatch, `major|minor|patch`) bumps the version on `main`, creates
  `release/<version>`, then `tag-release.yml` tags it and cuts the GitHub release; pushing
  `release/**` triggers `publish.yml` → `npm publish --provenance`. `npm run release:create [type]`
  dispatches that workflow and checks the branch out locally.
- **Release notes**: `tag-release.yml` auto-generates the changelog from changes since the last tag
  (via the Claude API). For milestone releases, commit curated notes to
  `.github/release-notes/v<version>.md` _before_ dispatching `create-release.yml` — when that file
  exists at the tagged ref it replaces the generated changelog (and the stats section is skipped).
- CI (`test.yml`) runs the full gate on Node 22 and 24; releases build on 24.
- Only `dist/`, `README.md`, and `LICENSE` are published (`files` in `package.json`, with
  `.npmignore` as defense in depth).
