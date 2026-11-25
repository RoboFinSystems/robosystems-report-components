# @robosystems/report-components

[![npm version](https://badge.fury.io/js/@robosystems%2Freport-components.svg)](https://www.npmjs.com/package/@robosystems/report-components)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**The financial-statement renderer for [RoboSystems](https://github.com/RoboFinSystems/robosystems), the open-source knowledge graph for finance.** `@robosystems/report-components` renders XBRL-grade statements from any source: a report's `holon.jsonld`, a live general ledger, an entity graph or the SEC repository. The render logic is the same for every source; only a thin data adapter varies, turning its source into one normalized report model.

The components then do the same work for every adapter: walk the presentation order, foot the calculation subtotals and project Information-Block tables.

## What it does

- **Components**: `ReportView`, `StatementTable`, `FactInspector` and `ExternalTextBlock`, from a full statement down to one fact
- **Adapters** (`/adapters`): `parseJsonld` for a canonical `holon.jsonld`; `parseTavi` for `tavi.json`, the same filing as a Project Tavi compiled model (XBRL International's draft), walked directly with no RDF step; `parseReportDocument` to sniff which of the two it was handed; `cypherAdapter` for the live SEC graph over the Cypher query endpoint; `fetchSecReportShell` / `fetchSecSection` for the SEC repository; and `parseStore` for pre-parsed RDF stores
- **Statements as CSV**: `pivotToCsv(buildPivot(report, block))` writes a statement row for row as `StatementTable` shows it (depth, labels, negated signs), at full precision, with text cells guarded against running as spreadsheet formulas
- **From a figure to the books**: a holon downloaded _with lineage_ carries a fourth named graph, `#lineage`, and the fact inspector walks it: the accounts a figure was summed from, the lines under each with their entries, events and counterparties, the balance before the span, and the figure's evidence hash recomputed in the browser against the one the report froze (`checkFactLineage`). A plain holon renders as before
- **Plain React**: ESM and tree-shakeable, with `react` / `react-dom` as the only peers and no framework-specific imports, so the same package feeds a Next.js app or a Vite app

## Install

```bash
npm install @robosystems/report-components
```

Needs Node.js 24 or later, and React 18 or later in the consuming app.

## Usage

Feed `ReportView` the report model an adapter produces:

```tsx
import { ReportView } from '@robosystems/report-components'
import { parseJsonld } from '@robosystems/report-components/adapters'

// `holonText` is a report's dataset-form holon.jsonld (scene / boundary / projection)
const report = await parseJsonld(holonText)

export function Report() {
  return <ReportView report={report} />
}
```

## Versioning

Pre-1.0: the API can change in a minor release, named in the [release notes](https://github.com/RoboFinSystems/robosystems-report-components/releases). It runs in production in RoboLedger, RoboInvestor and the [xbrlkit viewer](https://github.com/RoboFinSystems/xbrlkit-viewer).

## Documentation

- **Technical docs**: [robosystems.ai/docs/technical](https://robosystems.ai/docs/technical). For this package: [Reporting & Rendering](https://robosystems.ai/docs/technical/reporting-and-rendering) · [Serialization & Export](https://robosystems.ai/docs/technical/serialization-and-export) · [Information Blocks](https://robosystems.ai/docs/technical/information-blocks)
- **Related**: [RoboSystems](https://github.com/RoboFinSystems/robosystems) · [xbrlkit](https://github.com/RoboFinSystems/xbrlkit) · [xbrlkit viewer](https://github.com/RoboFinSystems/xbrlkit-viewer) · [roboledger-app](https://github.com/RoboFinSystems/roboledger-app) · [roboinvestor-app](https://github.com/RoboFinSystems/roboinvestor-app)

## Support

- [Issues](https://github.com/RoboFinSystems/robosystems-report-components/issues) · [Discussions](https://github.com/orgs/RoboFinSystems/discussions) · [Projects](https://github.com/orgs/RoboFinSystems/projects)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

MIT © 2026 RFS LLC
