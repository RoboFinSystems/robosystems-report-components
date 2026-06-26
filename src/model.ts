/**
 * The normalized report model — the load-bearing seam of the library.
 *
 * An **adapter** turns its source (a `holon.trig` file, a cypher endpoint, a
 * live ledger) into a `NormalizedReport`: the raw facts, Information Blocks,
 * elements / periods / units / entity, and the calculation + presentation
 * association networks. Nothing more.
 *
 * The **projection** (`project.ts`) and **components** turn that normalized
 * model into rendered statements — the presentation-order walk, the calculation
 * subtotals, the table layout. That work is identical for every adapter, which
 * is what makes the rendering source-agnostic.
 */

export type PeriodType = 'instant' | 'duration'
export type BalanceType = 'debit' | 'credit'

/** A reportable concept (a taxonomy element). */
export interface ElementInfo {
  /** Full element IRI — the join key used everywhere. */
  id: string
  /** Compacted name, e.g. `rs-gaap:Assets`. */
  qname: string
  /** Human label (`skos:prefLabel`, else a humanized local name). */
  label: string
  balance: BalanceType | null
  periodType: PeriodType | null
  abstract: boolean
  monetary: boolean
}

/** A reporting period — an instant (balance sheet) or a duration (flows). */
export interface PeriodInfo {
  id: string
  type: PeriodType
  instant: string | null
  startDate: string | null
  endDate: string | null
  /** The date a fact lands on: `instant` for instants, `endDate` for durations. */
  end: string
}

/** A unit of measure, e.g. USD. */
export interface UnitInfo {
  id: string
  /** Compacted measure, e.g. `iso4217:USD`. */
  measure: string
  /** Short display label, e.g. `USD`. */
  label: string
}

/** The reporting entity. */
export interface EntityInfo {
  id: string
  name: string
  legalName: string | null
  country: string | null
}

/** A single reported value. */
export interface Fact {
  id: string
  /** Element IRI. */
  element: string
  /** Period IRI. */
  period: string
  /** Unit IRI, when monetary/numeric. */
  unit: string | null
  /** Entity IRI. */
  entity: string | null
  /** FactSet IRI — the grouping key shared with an Information Block. */
  factSet: string | null
  value: number | null
  decimals: string | null
}

/** A calculation arc: `parent` (subtotal) rolls up `child * weight`. */
export interface CalcAssociation {
  parent: string
  child: string
  weight: number
  order: number
  role: string | null
  structure: string | null
}

/** A presentation arc: `parent` shows `child` at the given order. */
export interface PresAssociation {
  parent: string
  child: string
  order: number
  role: string | null
  structure: string | null
}

/** A network root — groups associations under one role / block type. */
export interface StructureInfo {
  id: string
  blockType: string
  roleUri: string | null
  structureName: string | null
}

/** An Information Block — groups a statement's facts via a shared `factSet`. */
export interface InformationBlock {
  id: string
  blockType: string
  factSet: string | null
  label: string | null
}

/** The full normalized report — the adapter's output and projection's input. */
export interface NormalizedReport {
  reportId: string | null
  reportIri: string | null
  entity: EntityInfo | null
  informationBlocks: InformationBlock[]
  structures: StructureInfo[]
  facts: Fact[]
  elements: Record<string, ElementInfo>
  periods: Record<string, PeriodInfo>
  units: Record<string, UnitInfo>
  calcAssociations: CalcAssociation[]
  presAssociations: PresAssociation[]
}

// ── Rendered statement model (produced by project.ts) ────────────────────────

/** A statement column, keyed by the period end date facts are matched against. */
export interface StatementColumn {
  /** The period end date used to match facts into this column. */
  key: string
  /** Human header label. */
  label: string
  /** A representative period for this column (for tooltips / fact inspection). */
  period: PeriodInfo
}

/** One value in a row, plus the fact behind it (for inspection / footing). */
export interface RowCell {
  value: number | null
  fact: Fact | null
}

/** A rendered statement line. */
export interface StatementRow {
  element: ElementInfo
  /** Tree depth — drives indentation. */
  depth: number
  /** True when the element is a calculation parent (rendered bold). */
  isSubtotal: boolean
  cells: RowCell[]
}

/** A fully reconstructed statement, ready to render. */
export interface Statement {
  ib: InformationBlock
  blockType: string
  /** Friendly heading, e.g. "Balance Sheet". */
  title: string
  structureName: string | null
  columns: StatementColumn[]
  rows: StatementRow[]
}
