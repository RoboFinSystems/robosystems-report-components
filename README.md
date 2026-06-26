# @robosystems/report-components

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A source-agnostic React library for rendering XBRL-grade financial statements. The same components render financial statements from **any** source — a live general ledger, a graph database (entity graph or the SEC repository), or a static `holon.trig` file — because the render logic is source-independent. The only thing that varies is a thin **data adapter** that turns its source into a normalized report model; the components handle the presentation-order walk, calculation-subtotal footing, and Information-Block table projection identically for every adapter.

React and react-dom are peer dependencies, and the components are plain React (no framework-specific imports) so the same package feeds a Next.js app or a lightweight Vite app.

## Installation

```bash
npm install @robosystems/report-components
```

## Usage

Render a statement by feeding a component a normalized report model produced by an adapter. The package ships two read-only reference adapters (a `holon.trig` file adapter via N3.js, and a cypher/GraphQL adapter) under `@robosystems/report-components/adapters`:

```tsx
import { FinancialStatement } from '@robosystems/report-components'
import { createTrigFileAdapter } from '@robosystems/report-components/adapters'

const adapter = createTrigFileAdapter({ source: trigText })
const report = await adapter.load()

export function Report() {
  return <FinancialStatement report={report} />
}
```

## Status

**In development.** APIs are unstable and may change. Co-developed with the `robosystems-holon-viewer` app as its harness.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

MIT © 2026 RFS LLC
