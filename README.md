# @robosystems/report-components

[![npm version](https://badge.fury.io/js/@robosystems%2Freport-components.svg)](https://www.npmjs.com/package/@robosystems/report-components)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A source-agnostic React library for rendering XBRL-grade financial statements. The same components render financial statements from **any** source — a static `holon.jsonld` file (a report's canonical dataset-form holon), a live general ledger, or a graph database (entity graph or the SEC repository) — because the render logic is source-independent. The only thing that varies is a thin **data adapter** that turns its source into a normalized report model; the components handle the presentation-order walk, calculation-subtotal footing, and Information-Block table projection identically for every adapter.

## Features

- **Components** — `ReportView`, `StatementTable`, `FactInspector`, and `ExternalTextBlock` for full statements down to per-fact inspection
- **Four reference adapters** (under `/adapters`) — `parseJsonld` for canonical `holon.jsonld` files, `cypherAdapter` for live graphs over GraphQL, `fetchSecReportShell`/`fetchSecSection` for the SEC repository, and `parseStore` for pre-parsed RDF stores
- **Correct-by-construction rendering** — presentation-order walk, calculation-subtotal footing, multi-factSet facts, and structure-title/kind parsing shared across all sources
- **Plain React, ESM, tree-shakeable** — `react`/`react-dom` peers only, no framework-specific imports; the same package feeds a Next.js app or a lightweight Vite app

## Installation

```bash
npm install @robosystems/report-components
```

## Usage

Render a statement by feeding `ReportView` a normalized report model produced by an adapter:

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

**Pre-1.0.** Published to npm and consumed in production by RoboLedger and the RoboSystems holon viewer. The API surface may still evolve between minor versions until 1.0.

## Resources

- [RoboSystems Platform](https://robosystems.ai)
- [GitHub Repository](https://github.com/RoboFinSystems/robosystems-report-components)
- [API Documentation](https://api.robosystems.ai/docs)

## Support

- [Issues](https://github.com/RoboFinSystems/robosystems-report-components/issues)
- [Wiki](https://github.com/RoboFinSystems/robosystems/wiki)
- [Projects](https://github.com/orgs/RoboFinSystems/projects)
- [Discussions](https://github.com/orgs/RoboFinSystems/discussions)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

MIT © 2026 RFS LLC
