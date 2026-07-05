/**
 * The adapter seam. An adapter turns one source into a `NormalizedReport`; the
 * projection + components do the rest, identically for every source.
 *
 * The package ships two read-only reference adapters — `jsonld` (offline file
 * via the jsonld processor) and `cypher` (a live graph database). A consuming
 * app with operational needs (a live ledger it also edits) supplies its own
 * adapter in-app.
 */
import type { NormalizedReport } from '../model'

export interface ReportAdapter {
  /** A short, human-readable description of the source (for the UI). */
  readonly source: string
  /** Produce the normalized report model. */
  load(): Promise<NormalizedReport>
}
