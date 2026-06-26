/**
 * `@robosystems/report-components` — public API.
 *
 * Render XBRL-grade financial statements from any source behind a thin adapter:
 *
 *   import { ReportView } from '@robosystems/report-components'
 *   import { trigFileAdapter } from '@robosystems/report-components/adapters'
 *
 *   const report = await trigFileAdapter(trigText).load()
 *   <ReportView report={report} />
 */

// Model + reconstruction + formatting
export { BLOCK_ORDER, BLOCK_TITLES, NS, humanize, qname } from './constants'
export * from './format'
export * from './model'
export * from './project'

// Components
export { FactInspector } from './components/FactInspector'
export type { FactInspectorProps } from './components/FactInspector'
export { ReportView } from './components/ReportView'
export type { ReportViewProps } from './components/ReportView'
export { StatementTable } from './components/StatementTable'
export type { StatementTableProps } from './components/StatementTable'

// Adapters (also available at the `/adapters` subpath)
export { cypherAdapter } from './adapters/cypher'
export type { CypherAdapterConfig } from './adapters/cypher'
export { parseTrig, trigFileAdapter } from './adapters/trig'
export type { ReportAdapter } from './adapters/types'
