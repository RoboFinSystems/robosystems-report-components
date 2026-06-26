# `@robosystems/report-components` — a source-agnostic financial-report rendering library

**Status**: Design — not yet built.

One npm-published React library that renders financial statements from **any** source behind a thin **data-adapter** interface. The same components render a live general ledger (OLTP), a company pulled live from a graph database (OLAP / cypher), and a static `holon.trig` file — because the **render logic is source-independent** and the only thing that varies is the adapter.

This is the cross-cutting artifact: the `robosystems-holon-viewer` app is just _one_ consumer of it, alongside the main RoboLedger app and a potential SEC-graph explorer.

---

## 1. The thesis: one renderer, many sources

The RoboLedger app renders financial statements. The holon-viewer renders financial statements. A SEC explorer would render financial statements. They differ **only in where the facts come from** — the presentation-order walk, the calculation-subtotal footing, and the Information-Block-to-table projection are identical. Copy-pasting that logic into each surface guarantees silent drift. The right architecture is **one rendering library, published once, consumed everywhere**, with each surface supplying only a data adapter.

This is also what makes the source-agnostic claim _provable_ rather than aspirational: if the same components render a live ledger, a SEC 10-K, and a static file, the abstraction is real.

## 2. The load-bearing seam: adapter → normalized model → components

The whole design rests on one clean interface:

- **An adapter's job**: turn its source into a **normalized report model** — facts, Information Blocks, elements / periods / units / entity, calculation associations, presentation associations. Nothing more.
- **The components' job**: turn that normalized model into rendered statements — the presentation-order post-order walk, calculation subtotals off the calc tree, the IB table render, plus interactivity (click a fact → its element/period/unit + the live foots-check). **Identical for every adapter.**

So "how do I get the data" lives in the adapter; "how a statement looks and foots" lives in the components, once.

## 3. The adapters

| Adapter                | Source                                                           | How it reads                                   | Mode                                                 | Primary consumer                   |
| ---------------------- | ---------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| **live OLTP**          | a live general ledger                                            | platform API — GraphQL typed reads + fact-grid | render **+ operate** (auth, stateful)                | RoboLedger app                     |
| **live OLAP / cypher** | _any_ graph database — an entity graph **or the SEC repository** | GraphQL / cypher + an **API key**              | render (read-only)                                   | holon-viewer (SEC mode); explorers |
| **holon.trig file**    | a static file                                                    | **N3.js** parse → traverse the quad store      | render (read-only, **offline, no backend, no auth**) | holon-viewer (file mode)           |

The OLAP/cypher adapter is **one adapter for both** an entity graph and the SEC repository — only the `graph_id`/endpoint differ. The file adapter is the only fully-offline one; the two live adapters differ from it (and each other) only in endpoint + auth.

**The package ships the two read-only reference adapters** (trig-file via N3.js, cypher/GraphQL). The RoboLedger app supplies its own **operate-capable OLTP adapter** in-app (it's stateful + app-specific — render _and_ close/map/edit — so it doesn't belong in a render library).

## 4. The one hard rule: framework-agnostic components

**The components must be plain React — no `next/image` / `next/link` / `next/router`, no Server Actions.** That single rule is what lets the _same_ package feed a Next.js app and a lightweight Vite app. Get it right and each consumer's shell framework becomes a free choice the components don't care about. React (and react-dom) are **peer dependencies**, not bundled.

## 5. How it's built: greenfield in the holon-viewer harness

This library is **co-developed with `robosystems-holon-viewer` as its harness** — the viewer is the base app the components are implemented against and exercised by. The simplest consumer (a static viewer + the trig-file adapter) is the cleanest place to prove the component API, so the components are built **greenfield in that harness**, not extracted from an existing app first. The RoboLedger app's current statement rendering is used only as a **correctness reference** while building.

The payoff comes later: once published, the **RoboLedger app adopts the package** — swapping its API-welded renderer for the shared one. That's a real hygiene win (it decouples "rendering" from "data + operations"), but it's a **downstream migration**, not the origin. RoboLedger keeps a live-OLTP adapter and loses nothing.

## 6. The `holon.trig` source format (what the file adapter parses)

A `holon.trig` is a published financial report serialized as **RDF named graphs** (TriG), decomposed into three addressable graphs under the report IRI:

| Named graph           | Holds                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `<report>#scene`      | the facts + the Information Blocks that group them + elements / periods / units / entity |
| `<report>#boundary`   | the calculation network (rollup rules: `xlink:from` parent, `xlink:to` children)         |
| `<report>#projection` | the presentation network (order, indentation, subtotals) + structure nodes               |

There is no event/ledger graph in a report holon — the underlying ledger is internal and never published. Vocabulary is mixed: `rs:` for structure (`blockType`, `factSet`, `numericValue`, `element`), `skos:` for human labels, plus `xlink:` / `xbrli:` / `iso4217:`. The file adapter parses with N3.js into a quad store and emits the normalized model of §2; **no SPARQL engine is required for rendering** — only store traversal. (A reference implementation of the traversal exists in the RoboSystems platform's DataBook converter; the adapter is a JS port of it.)

## 7. npm publishing — public, OIDC trusted publishing

Publish **public** to npmjs.org, matching the sibling packages `@robosystems/client` and `@robosystems/mcp`:

- `publishConfig.access: public`, `registry: https://registry.npmjs.org/`.
- Release flow is identical to the templates: a manual `create-release` dispatch bumps the version on `main` and cuts a `release/X.Y.Z` branch → `tag-release` tags + releases → `publish` (`npm publish --provenance --access public`) fires on push to `release/**` via **OIDC** (no NPM_TOKEN; `id-token: write`).
- A **build-time** dependency in every consumer (`npm install` → bundled at build) — so it's fully compatible with the holon-viewer's static S3 + CloudFront deploy: nothing from npm/node survives to runtime.

Consistency across surfaces holds **as long as consumers stay pinned to the same version** — normal dependency hygiene (bump on update), far stronger than copy-pasted renderers that drift silently.

## 8. Out of scope

- **An XBRL-zip → holon converter.** A someday-maybe, with **no current use case** — SEC reports are read via the live cypher adapter, not by converting filings to `holon.trig`. Captured here only so it isn't re-proposed as a gap.
- **Operate / stateful logic** (close, map, edit). Stays in the consuming apps' adapters; this library renders.
- **The viewer app itself** — its own repo, `robosystems-holon-viewer`.
- **Pivot / search / export / on-the-fly graphs** — a later consumer concern.

## 9. Phasing

Co-developed with the holon-viewer harness (§5) — the viewer links this package locally (`file:../robosystems-report-components`) so no publish is needed to iterate.

| Phase                           | Work                                                                                                                                                                         | Notes                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **1 — skeleton + model**        | Package + CI + the **normalized report model** + the **adapter interface** + the **trig-file** (N3.js) reference adapter. Link into the viewer.                              | A runnable target the viewer can drive. The file adapter ports the platform's traversal.   |
| **2 — components (greenfield)** | Implement `components/` driven by what the viewer needs to render a real `.holon.trig`, until the four statements render and foot. Enforce the framework-agnostic rule (§4). | Built in the harness; RoboLedger rendering is a correctness reference, not extracted (§5). |
| **3 — cypher adapter**          | Ship the **cypher/GraphQL** read-only adapter (any graph database) → the viewer's SEC mode.                                                                                  | Proves source-agnosticism across file · OLAP.                                              |
| **4 — publish**                 | Public npm release + semver/changelog (OIDC trusted publishing); the viewer switches off the local link to the published version.                                            | The publish-flow pilot for the broader move off git-subtree.                               |
| **5 — RoboLedger adopts**       | RoboLedger swaps its API-welded renderer for the package + a live-OLTP adapter. A SEC explorer surface optionally follows.                                                   | The downstream hygiene win (§5); proves OLTP too.                                          |
