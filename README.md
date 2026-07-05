# @robosystems/report-components

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A source-agnostic React library for rendering XBRL-grade financial statements. The same components render financial statements from **any** source — a static `holon.jsonld` file (a report's canonical dataset-form holon), a live general ledger, or a graph database (entity graph or the SEC repository) — because the render logic is source-independent. The only thing that varies is a thin **data adapter** that turns its source into a normalized report model; the components handle the presentation-order walk, calculation-subtotal footing, and Information-Block table projection identically for every adapter.

React and react-dom are peer dependencies, and the components are plain React (no framework-specific imports) so the same package feeds a Next.js app or a lightweight Vite app.

## Installation

```bash
npm install @robosystems/report-components
```

## Usage

Render a statement by feeding `ReportView` a normalized report model produced by an adapter. The package ships read-only reference adapters under `@robosystems/report-components/adapters`: `parseJsonld` (the canonical `holon.jsonld`, via the `jsonld` processor) and `cypherAdapter` (a live graph over GraphQL).

```tsx
import { ReportView } from '@robosystems/report-components'
import { parseJsonld } from '@robosystems/report-components/adapters'

// `holonText` is a report's dataset-form holon.jsonld (scene / boundary / projection)
const report = await parseJsonld(holonText)

export function Report() {
  return <ReportView report={report} />
}
```

## Status

**In development.** APIs are unstable and may change. Co-developed with the `robosystems-holon-viewer` app as its harness.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

MIT © 2026 RFS LLC
