/**
 * One door for both of xbrlkit's JSON projections. A holon is dataset-form
 * JSON-LD (a `@context` and named graphs); a Tavi model announces itself in
 * `documentInfo.documentType`. Callers that take "a report file" — a dropped
 * file, a URL — sniff here and never need to know which they were handed.
 */
import type { NormalizedReport } from '../model'
import { parseJsonld } from './jsonld'
import { isTaviDocument, parseTavi } from './tavi'

export type ReportFormat = 'holon' | 'tavi'

/** The format of a parsed report document, or null when it is neither. */
export function detectReportFormat(doc: unknown): ReportFormat | null {
  if (!doc || typeof doc !== 'object') return null
  if (isTaviDocument(doc)) return 'tavi'
  const d = doc as Record<string, unknown>
  if ('@context' in d || '@graph' in d || '@id' in d) return 'holon'
  return null
}

/** Parse a report document (string or object) whichever JSON projection it is. */
export async function parseReportDocument(
  doc: string | object
): Promise<{ format: ReportFormat; report: NormalizedReport }> {
  const json = (typeof doc === 'string' ? JSON.parse(doc) : doc) as object
  const format = detectReportFormat(json)
  if (format === 'tavi') return { format, report: parseTavi(json) }
  if (format === 'holon') return { format, report: await parseJsonld(json) }
  throw new Error('Not a report document: expected a holon (JSON-LD) or a Tavi compiled model')
}
