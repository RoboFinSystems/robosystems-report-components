/**
 * The cypher / GraphQL adapter — a live graph database (an entity graph **or**
 * the SEC repository) read read-only with an API key. One adapter for both:
 * only the endpoint / `graphId` differ.
 *
 * Phase 2 (Mode B). Stubbed for now so the seam and the `./adapters` export
 * surface are in place; the holon-viewer's SEC mode will drive its build-out.
 */
import type { ReportAdapter } from './types'

export interface CypherAdapterConfig {
  /** GraphQL / cypher endpoint base URL. */
  endpoint: string
  /** User-supplied API key (sent client-side; never app-managed). */
  apiKey: string
  /** Target graph — an entity graph id or the SEC repository id. */
  graphId: string
  /** The report to materialize. */
  reportId: string
}

export function cypherAdapter(config: CypherAdapterConfig): ReportAdapter {
  return {
    source: `cypher:${config.graphId}/${config.reportId}`,
    load: async () => {
      throw new Error(
        'The cypher adapter is not implemented yet (phase 2 / Mode B — live SEC graph).'
      )
    },
  }
}
