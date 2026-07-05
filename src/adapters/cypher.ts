/**
 * The cypher adapter — a whole-report `ReportAdapter` over the live SEC graph.
 *
 * This is a convenience wrapper: it loads the section list, then every section,
 * and merges them into one `NormalizedReport`. Apps that want responsive,
 * lazy-per-section loading should call `fetchSecReportShell` + `fetchSecSection`
 * directly (see `./sec`) rather than materializing a whole filing up front.
 */
import type { SecQuery } from './sec'
import { fetchSecReportShell, fetchSecSection, mergeSecSections } from './sec'
import type { ReportAdapter } from './types'

export interface CypherAdapterConfig {
  /** Injected transport over `POST /v1/graphs/{graphId}/query` (auth lives here). */
  query: SecQuery
  /** The report to materialize — a `Report.identifier`. */
  reportId: string
}

export function cypherAdapter(config: CypherAdapterConfig): ReportAdapter {
  return {
    source: `sec:${config.reportId}`,
    load: async () => {
      const shell = await fetchSecReportShell(config.query, config.reportId)
      const sections = await Promise.all(
        shell.sections.map((section) => fetchSecSection(config.query, shell, section))
      )
      return mergeSecSections(shell, sections)
    },
  }
}
