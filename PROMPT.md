# Kickoff prompt — `robosystems-report-components`

Paste this into a fresh Claude Code session opened in this repo to bootstrap it.

---

You are bootstrapping **`@robosystems/report-components`**, a new public npm package in the RoboSystems ecosystem. Read **`SPEC.md`** in this repo first — it is the full design. This prompt covers the _scaffolding_, which must follow the two existing published packages **as closely as possible**.

> **This library is co-developed with `robosystems-holon-viewer` as its harness.** The viewer is the base app the components are implemented against and exercised by — see **`../robosystems-holon-viewer/PROMPT.md`** for the combined build loop. During co-dev the viewer links this package locally (`file:../robosystems-report-components`), so you don't publish to iterate. **This file is the packaging/publishing reference** — the package.json, build, `exports`, and OIDC release flow you'll need when the library is stable enough to publish.

## Templates to copy from (sibling repos, already on disk)

- **`../robosystems-mcp-client`** — `@robosystems/mcp`. The simplest template: single-package, OIDC publish, the full release/CI workflow set. **Use this as the primary structural template.**
- **`../robosystems-typescript-client`** — `@robosystems/client`. A TypeScript package _with a build step_ and a multi-entry `exports` map + `tsconfig`. **Use this for the TS build + `exports` + `files` patterns** (this package compiles to `dist/`, like a real library).

Read the actual files in those repos — do not guess. The conventions below are the contract.

## Scaffolding to replicate (copy + adapt, don't reinvent)

1. **`.github/workflows/`** — copy all five and adapt the package name / URLs:
   - `test.yml` — push/PR to `main`: install → `format:check` → `lint` → `test` → build → package-structure check.
   - `create-release.yml` — manual `workflow_dispatch` (major/minor/patch): bumps `package.json` on `main`, cuts `release/X.Y.Z`, calls `tag-release.yml`.
   - `tag-release.yml` — reusable: tags `vX.Y.Z`, Claude-generated changelog, GitHub Release. Keep `ANTHROPIC_API_KEY` / `ACTIONS_TOKEN` secret usage as-is.
   - `publish.yml` — on push to `release/**`: `npm publish --provenance --access public` via **OIDC** (`id-token: write`, **no NPM_TOKEN**). Update the `npm view @robosystems/report-components@...` guard and the package name in the summary.
   - `claude.yml` — the `@claude` PR-review bot, copy verbatim.
2. **`bin/create-feature.sh`** and **`bin/create-release.sh`** — copy verbatim; wired to `npm run feature:create` / `release:create`.
3. **`CLAUDE.local.md`** — copy verbatim from a template (identical across repos: git guardrails — never commit on `main`, branch only via `npm run feature:create`, push reserved for the user, no Claude attribution on commits).
4. **Tooling configs** — mirror from `../robosystems-typescript-client`: `eslint.config.mjs` (flat), `.prettierrc`, `.prettierignore`, `tsconfig.json`, `vitest.config.ts` + `vitest.setup.ts`, `.githooks/` (pre-commit), `.vscode/`, `.gitignore`, `.npmignore`, `LICENSE` (MIT, "RFS LLC").

## `package.json` for THIS package (it's a React component library)

Differs from the templates because it **compiles and ships components with React as a peer dep**:

```jsonc
{
  "name": "@robosystems/report-components",
  "version": "0.1.0",
  "description": "Source-agnostic React components for rendering XBRL-grade financial statements",
  "license": "MIT",
  "author": "RFS LLC",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    // model on robosystems-typescript-client's multi-entry exports
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./adapters": { "types": "./dist/adapters/index.d.ts", "import": "./dist/adapters/index.js" },
  },
  "files": ["dist/**/*", "README.md", "LICENSE"], // ship dist only
  "scripts": {
    "build": "tsc", // or tsup — pick one, keep it simple
    "format": "prettier . --write",
    "format:check": "prettier . --check",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:all": "npm run format:check && npm run lint && npm run typecheck && npm run test && npm run build",
    "prepublishOnly": "npm run build",
    "feature:create": "./bin/create-feature.sh",
    "release:create": "./bin/create-release.sh",
  },
  "peerDependencies": { "react": ">=18", "react-dom": ">=18" },
  "dependencies": { "n3": "^2" }, // the trig file adapter; add the graphql client for the cypher adapter
  "devDependencies": {
    /* react, react-dom, @types/react, typescript, eslint stack, prettier, vitest, happy-dom — mirror the templates */
  },
  "engines": { "node": ">=18.0.0" },
  "publishConfig": { "access": "public", "registry": "https://registry.npmjs.org/" },
  "repository": {
    "type": "git",
    "url": "https://github.com/RoboFinSystems/robosystems-report-components.git",
  },
  "bugs": { "url": "https://github.com/RoboFinSystems/robosystems-report-components/issues" },
  "homepage": "https://github.com/RoboFinSystems/robosystems-report-components#readme",
}
```

Key deltas vs the templates: **`peerDependencies` on React** (consumers bring React; don't bundle it), a real **`build` → `dist/`** step (TS source compiles; the SDK templates ship generated JS, this ships compiled components), and **`files` whitelists `dist/`** only.

## Source layout (per SPEC.md)

```
src/
  index.ts                 # barrel: components + the adapter interface type
  model.ts                 # the normalized report model (facts, IBs, elements, periods, units, calc + presentation associations)
  components/              # framework-agnostic React: statement tables, IB render, foots-check, fact-inspect
  adapters/
    index.ts
    trig.ts                # N3.js parse → normalized model (port the platform DataBook traversal)
    cypher.ts              # GraphQL/cypher → normalized model (any graph database + API key)
    types.ts               # the Adapter interface: source → normalized model
```

## First milestone

The components are built **greenfield in the holon-viewer harness**, not extracted from RoboLedger first. Order: stand up the package skeleton + CI + the **normalized report model** + the **adapter interface** + the **`trig` reference adapter**, link it into the viewer (`file:../robosystems-report-components`), then implement `src/components/` driven by what the viewer needs to render a real `.holon.trig`. Use the **RoboLedger app's existing statement rendering as a correctness reference** (read it) — the RoboLedger decoupling (SPEC §5) is a _later_ downstream adoption, not the starting point. The framework-agnostic rule (§4) is enforced from line one: if a component imports `next/*`, it's wrong.

## Working conventions

Follow `CLAUDE.local.md`: never commit on `main`; create branches only via `npm run feature:create`; the user runs `git push`, tags, and the release workflows. Don't bump the version yourself — `create-release.yml` owns version bumps.
