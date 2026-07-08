/**
 * Shared parsing of an XBRL structure's role definition into a display title, its
 * full raw definition, and a coarse `kind`. Used by BOTH the SEC adapter (whose
 * definitions are always SEC-shaped) and the jsonld/file adapter (whose structure
 * names may be non-SEC), so every source lands the same `StructureInfo` shape —
 * the section header and TOC read identically regardless of where the data came
 * from.
 */

/** Coarse grouping for a section — the basis for a "Statements / Disclosures" TOC. */
export type SectionKind = 'Statement' | 'Disclosure' | 'Document' | 'Cover' | 'Other'

/**
 * The primary financial statements. Only these `canonical_type`s belong in the
 * TOC's "Financial Statements" group — other canonical types (rollforwards,
 * hierarchies, `(Details)` networks) are disclosures, classified by their
 * definition's type word instead.
 */
const CORE_STATEMENT_TYPES = new Set([
  'balance_sheet',
  'income_statement',
  'cash_flow_statement',
  'equity_statement',
  'comprehensive_income',
])

/**
 * Split an XBRL `Structure.definition` into a human title + a coarse kind.
 * Definitions look like `"9952153 - Statement - Consolidated Balance Sheets"` or
 * `"0000001 - Document - Cover Page"` — a `"NNNN - <Type> - <Title>"` shape whose
 * middle word (Statement / Disclosure / Document) drives the kind. A core
 * canonical statement always reads as a Statement so the primaries group cleanly.
 */
export function parseStructureDefinition(
  definition: string | null,
  canonicalType: string | null
): { title: string; kind: SectionKind } {
  const raw = (definition ?? '').trim()
  const parts = raw.split(' - ')
  let type = ''
  let title = raw
  if (parts.length >= 3) {
    type = parts[1].trim()
    title = parts.slice(2).join(' - ').trim()
  } else if (parts.length === 2) {
    title = parts[1].trim()
  }

  let kind: SectionKind = 'Other'
  if (/cover/i.test(title)) kind = 'Cover'
  else if (type === 'Statement') kind = 'Statement'
  else if (type === 'Disclosure') kind = 'Disclosure'
  else if (type === 'Document') kind = 'Document'
  // A core statement is always a Statement; a non-core canonical type (e.g.
  // GoodwillRollForward) stays whatever its definition type word made it.
  if (canonicalType && CORE_STATEMENT_TYPES.has(canonicalType)) kind = 'Statement'

  return { title: title || raw || canonicalType || 'Section', kind }
}

// A SEC role definition's signature: a leading numeric sort code immediately
// followed by " - ". Only names with that shape are parsed; anything else (a
// non-SEC holon's plain structure name) is left untouched, so this never
// over-strips a name that merely happens to contain " - ".
const SEC_ROLE_PREFIX = /^\s*\d+\s*-\s/

/**
 * Parse a structure NAME as carried on a holon's `rs:structureName`, the same way
 * as a SEC definition but only when it is SEC-shaped. Returns the full definition
 * (verbatim, for hover), a clean display title, and the kind (null for a non-SEC
 * name, whose title is just the name).
 */
export function parseStructureName(name: string | null): {
  definition: string | null
  title: string | null
  kind: SectionKind | null
} {
  if (!name) return { definition: null, title: null, kind: null }
  if (!SEC_ROLE_PREFIX.test(name)) return { definition: name, title: name, kind: null }
  const { title, kind } = parseStructureDefinition(name, null)
  return { definition: name, title, kind }
}
