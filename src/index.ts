/**
 * `@robosystems/report-components` — public API.
 *
 * Render XBRL-grade financial statements from any source behind a thin adapter:
 *
 *   import { ReportView } from '@robosystems/report-components'
 *   import { parseJsonld } from '@robosystems/report-components/adapters'
 *
 *   const report = await parseJsonld(holonText)
 *   <ReportView report={report} />
 */

// Model + reconstruction + formatting
export { BLOCK_ORDER, BLOCK_TITLES, NS, humanize, isExternalFactUrl, qname } from './constants'
export * from './format'
export * from './model'
export { buildPivot, buildPivots, defaultPivotConfig, reportSections } from './pivot'
export * from './project'

// Components
export { ExternalTextBlock } from './components/ExternalTextBlock'
export type { ExternalTextBlockProps } from './components/ExternalTextBlock'
export { FactInspector } from './components/FactInspector'
export type { FactInspectorProps } from './components/FactInspector'
export { ReportView } from './components/ReportView'
export type { ReportViewProps } from './components/ReportView'
export { StatementTable } from './components/StatementTable'
export type { StatementTableProps } from './components/StatementTable'

// Adapters (also available at the `/adapters` subpath)
export { cypherAdapter } from './adapters/cypher'
export type { CypherAdapterConfig } from './adapters/cypher'
export { jsonldFileAdapter, parseJsonld } from './adapters/jsonld'
export {
  fetchSecReportShell,
  fetchSecSection,
  mergeSecSections,
  parseStructureDefinition,
} from './adapters/sec'
export type { SecQuery, SecReportShell, SecSection } from './adapters/sec'
export { parseStore } from './adapters/store'
export type { ReportAdapter } from './adapters/types'
