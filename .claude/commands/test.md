---
description: Run the full test and code-quality gate, fixing failures to green.
argument-hint: '[test-file-or-path]'
---

Run `npm run test:all` and systematically fix all failures to achieve 100% completion.

## Timeouts

Use `timeout: 600000` (10 minutes) on Bash calls for `npm run test:all`. The default 2-minute Bash timeout is too short — prettier walks the tree, `tsc` runs over `src` and `test`, and the build emits two entries with declaration files.

## Strategy

1. **Run full suite first**: use the grep pattern below to extract the signal.
2. **Fix in the order `test:all` runs**: `format:check` → `lint` → `typecheck` → `test` → `build`. It's an `&&` chain and short-circuits on the first failure.
3. **Iterate on the failing layer only** before re-running the full suite.
4. **Stop when done**: once it passes, stop immediately. Do NOT re-run to "confirm."

## What `npm run test:all` actually runs

```
npm run format:check && npm run lint && npm run typecheck && npm run test && npm run build
```

**This gate is check-only — it does not auto-write.** Unlike the consuming apps, whose `test:all` runs `format` and `lint:fix` and silently rewrites files, this one runs `format:check` and `lint` and _fails_ instead. A formatting failure needs an explicit `npm run format` / `npm run lint:fix` and a re-stage. The upside: the gate matches the pre-commit hook exactly, so green really does mean a clean commit.

`build` is part of the gate on purpose — it's `tsup` over the two entries, and it's where packaging mistakes surface.

## Output Handling

```
npm run test:all 2>&1 | grep -E "Test Files|Tests |FAIL|✗|×|error TS|✖|Error:|ESM" | tail -30
```

Captures the vitest summary (`Test Files`, `Tests`), failing files/tests (`FAIL`, `✗`, `×`), TypeScript errors (`error TS`), ESLint errors (`✖`), and generic `Error:` lines. **Success = a `Test Files ... passed` line, no failure markers, and the build completing** — the build runs last, so a tail ending mid-build is not a pass.

## Key Commands

**Full suite:**

- `npm run test:all` — format:check + lint + typecheck + test + build

**Iteration (one layer at a time):**

- `npx vitest run <path>` — a single spec (fastest feedback)
- `npm run test` — vitest only (happy-dom); `npm run test:watch` for watch mode
- `npm run typecheck` — `tsc --noEmit` over `src` + `test`
- `npm run lint` / `npm run lint:fix`
- `npm run format:check` / `npm run format`
- `npm run build` — tsup → `dist/` (ESM + `.d.ts`, two entries)

## Notes

- Vitest uses `✓` for pass and `✗`/`×` for fail, plus a `FAIL` prefix for files containing failures.
- **`test/fixtures/` is Prettier-ignored on purpose** — it's verbatim sample data. A "formatting failure" there means something reformatted it; restore it rather than accepting the rewrite.
- **A rendering fix isn't done without a fixture.** Fixtures are how bugs here get pinned; a passing test that doesn't exercise real report shape proves little.
- **Build failures are usually config, not code.** The build is `tsup`, deliberately not `tsc`: with `moduleResolution: "Bundler"`, tsc emits extensionless relative imports that Node's ESM resolver rejects. If you're tempted to "simplify" the build to plain tsc, read the comment in `tsup.config.ts` first — CI's "Verify dist loads under Node ESM" step exists to catch exactly that regression, and it runs on **Node 22 and 24**.
- **`react` / `react-dom` are external peers.** A test failure that looks like duplicate-React or invalid-hook-call usually means something bundled them.
- **Never bump `version` in `package.json` to make anything pass** — the release workflow owns it.
- CI runs this same gate on Node 22 and 24; a green local run on one version doesn't guarantee the other if the change touches runtime APIs.

## Goal

100% pass on `npm run test:all` with no errors of any kind. Efficiency matters — don't re-run the full suite until you've fixed all known issues in the current layer.

$ARGUMENTS
