/**
 * The `holon.jsonld` adapter — offline, no backend, no auth.
 *
 * The canonical, API-native holon: **dataset-form JSON-LD** carrying the three
 * named graphs (`#scene`, `#boundary`, `#projection`) as `@id` + nested
 * `@graph`. JSON is native to the RoboSystems JSON API, so this is the one
 * holon file format.
 *
 * N3.js doesn't parse JSON-LD, so this adapter uses the `jsonld` processor to
 * expand the document to N-Quads (which preserves the named-graph labels),
 * parses those into an N3 quad `Store`, and delegates to the shared
 * `parseStore` traversal (`store.ts`).
 */
import type { JsonLdDocument } from 'jsonld'
import jsonld from 'jsonld'
import { Parser, Store } from 'n3'
import type { NormalizedReport } from '../model'
import { parseStore } from './store'
import type { ReportAdapter } from './types'

/** Parse a `holon.jsonld` document (string or parsed object) into the model. */
export async function parseJsonld(doc: string | object): Promise<NormalizedReport> {
  const json = (typeof doc === 'string' ? JSON.parse(doc) : doc) as JsonLdDocument
  // `toRDF` with the n-quads format returns a serialized string; each quad
  // carries its graph label, so the holon's named graphs survive the expansion.
  const nquads = (await jsonld.toRDF(json, { format: 'application/n-quads' })) as string
  const store = new Store(new Parser({ format: 'application/n-quads' }).parse(nquads))
  return parseStore(store)
}

/** A `ReportAdapter` over an in-memory `holon.jsonld` document. */
export function jsonldFileAdapter(doc: string | object, source = 'holon.jsonld'): ReportAdapter {
  return {
    source,
    load: () => parseJsonld(doc),
  }
}
