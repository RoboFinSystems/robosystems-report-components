/**
 * The normalized report model — the load-bearing seam of the library.
 *
 * An **adapter** turns its source (a `holon.jsonld` file, a cypher endpoint, a
 * live ledger) into a `NormalizedReport`: the raw facts, Information Blocks,
 * elements / periods / units / entity, and the calculation + presentation
 * association networks. Nothing more.
 *
 * The **projection** (`project.ts`) and **components** turn that normalized
 * model into rendered statements — the presentation-order walk, the calculation
 * subtotals, the table layout. That work is identical for every adapter, which
 * is what makes the rendering source-agnostic.
 */

import type { SectionKind } from './sections'

export type PeriodType = 'instant' | 'duration'
export type BalanceType = 'debit' | 'credit'

/**
 * How a numeric fact is formatted and whether it may be rescaled. Monetary values
 * take the unit's currency symbol and honor the section scale; per-share amounts
 * and share counts are never rescaled (an EPS of 4.93 stays 4.93 under "in
 * millions"); percentages render with a `%` suffix. Absent → the formatter falls
 * back to `monetary ? 'monetary' : 'other'`.
 */
export type NumericKind =
  'monetary' | 'perShare' | 'shares' | 'percent' | 'pure' | 'integer' | 'other'

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
  /**
   * Finer numeric classification driving format + scale (per-share and share
   * counts opt out of rescaling). Optional; when absent the formatter falls back
   * to `monetary ? 'monetary' : 'other'`.
   */
  numericKind?: NumericKind
  /**
   * Value domain (`rs:itemType`): `textBlock` / `monetary` / `shares` / `decimal`
   * / `date` / `boolean` / `string`. `textBlock` marks an element whose facts are
   * rendered HTML disclosures — orthogonal to elementType's structural role.
   */
  itemType?: string
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
  /**
   * Currency symbol for a monetary unit (`$`, `€`, `£`, `¥`), else null — a share
   * or pure unit has none. Lets the renderer stop hard-coding `$` for non-USD.
   * Optional; when absent the formatter derives it from `measure`.
   */
  symbol?: string | null
}

/** The reporting entity. */
export interface EntityInfo {
  id: string
  name: string
  legalName: string | null
  country: string | null
}

/**
 * One dimensional qualifier on a fact: an axis pinned to a member. A fact's full
 * dimensional coordinate is an ordered list of these (one per axis); an empty
 * list is the consolidated total. Explicit dimensions name a `member`; typed
 * dimensions carry a `typedValue` instead. This is the only multi-valued fact
 * aspect, and it is what separates otherwise-identical facts (same element +
 * period) into distinct pivot cells — so it is part of a fact's identity.
 */
export interface DimensionQualifier {
  /** Axis element IRI/qname, e.g. `us-gaap:StatementEquityComponentsAxis`. */
  axis: string
  /** Member element IRI/qname (explicit), or null for a typed dimension. */
  member: string | null
  /** Human axis label, e.g. `Equity Components`. */
  axisLabel: string
  /** Human member label, e.g. `Common Stock`. */
  memberLabel: string
  /** Explicit (member drawn from a domain) vs typed (an arbitrary value). */
  explicit: boolean
  /** The typed-dimension value, present when `!explicit`. */
  typedValue?: string | null
}

/**
 * Where a fact came from, as its producer states it. A filing carries none of
 * this; a report produced from a ledger says how each figure was made. The
 * holon writes it as PROV-O (`prov:hadPrimarySource`, `prov:wasAttributedTo`)
 * plus `rs:sourceKind` and `rs:contentHash`; a Tavi model as fact properties
 * under the same names. The un-entitled projection carries the kind, the hash
 * and who asserted it — never an account or a ledger row.
 */
export interface FactProvenance {
  /** The producer's word for how the fact was made: `pivot`, `rollup`, `derived`, `document`, … */
  kind: string | null
  /** IRI of the evidence the fact was derived from, when the producer names one. */
  source: string | null
  /** Algorithm-prefixed hash of the evidence (`sha256:<hex>`), checkable later. */
  contentHash: string | null
  /** IRI or name of the agent, rule or system that asserted the fact. */
  attributedTo: string | null
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
  /** FactSet IRI — the grouping key shared with an Information Block. `factSet`
   * is the first; `factSets` carries all of them (see below). */
  factSet: string | null
  /** Every FactSet a fact belongs to. A summary concept (Total Assets, Net
   * Income) is presented in more than one structure, so it lands in each — the
   * pivot matches a section by membership, not single-value equality. Absent when
   * the adapter sets a single `factSet` (e.g. the SEC adapter re-keys per section). */
  factSets?: string[]
  value: number | null
  decimals: string | null
  /**
   * Raw string value for non-numeric facts (e.g. a Cover Page's entity name,
   * or a yes/no flag) — present when `value` is null. Lets text-bearing sections
   * (the cover, narrative disclosures) render their content instead of a blank.
   */
  textValue?: string | null
  /**
   * MIME type of `textValue` (rs:contentType) when the producer declares one.
   * SEC-derived text blocks carry HTML and omit this; RoboLedger-authored
   * narratives declare `text/markdown`, which the text-block renderer converts
   * before display. Absent/null means treat the payload as HTML.
   */
  contentType?: string | null
  /**
   * The fact's dimensional coordinate — one qualifier per axis, ordered by axis.
   * Absent/empty means a consolidated (undimensioned) fact. Part of the fact's
   * identity: the pivot engine keys cells by `(element, period, dimensions)`, so
   * segment/component breakdowns no longer overwrite the consolidated total.
   */
  dimensions?: DimensionQualifier[]
  /** How the fact was made, when the report says. Absent on a filing. */
  provenance?: FactProvenance | null
  /**
   * The contributions (by id, see `Lineage`) the figure was derived from, when
   * the file carries its `#lineage` graph. Absent on a plain holon and on
   * every figure that was not pivoted from the ledger.
   */
  derivedFrom?: string[]
}

// ── Lineage: the ledger behind a report's frozen figures ─────────────────────
//
// A holon downloaded "with lineage" carries a fourth named graph: for every
// figure that was summed from the ledger, one contribution per account the
// pivot summed, each listing every line under that account in the figure's
// window by IRI, and a description of the lines inside the report's own span
// (their entry, transaction, event and counterparty). The member list is
// complete so the figure's `contentHash` can be recomputed from the file; the
// description is bounded, and a contribution reaching further back states the
// balance of what it leaves undescribed.

/** One account's share of a figure: the lines the pivot summed under it. */
export interface LineageContribution {
  id: string
  /** The fact it substantiates. */
  fact: string
  /** The entity whose pivot summed the account (a member of the group, on a consolidated figure). */
  entity: string
  account: string
  /** The account's share of the figure, in its natural sign. */
  amount: number | null
  frozenAt: string | null
  windowStart: string | null
  windowEnd: string | null
  /** Every landed line under the account in the window. */
  lineCount: number
  /** Of those, the lines described in the file. */
  describedLineCount: number
  /** When set, lines before this date are members but not described … */
  describedFrom: string | null
  /** … and this is how many there are, and what they net to. */
  priorLineCount: number
  priorBalance: number | null
  /** Every member line, by IRI, described or not; sorted. */
  members: string[]
}

export interface LineageLine {
  id: string
  entry: string
  account: string
  entity: string | null
  debit: number | null
  credit: number | null
  lineOrder: number | null
  description: string | null
  /** The cash-flow concept the line carried as of the freeze, as a qname. */
  flowConcept: string | null
  dimensionMembers: string[]
  /** The event the line's entry was posted from. */
  event: string | null
}

export interface LineageEntry {
  id: string
  entity: string | null
  number: string | null
  postingDate: string | null
  postedAt: string | null
  type: string | null
  /** `posted` or `reversed`: both halves of a reversal are in the books. */
  status: string | null
  /** How it was recorded: `manual_entry`, `source_sync`, `schedule_derived`, … */
  recordedBy: string | null
  memo: string | null
  transaction: string | null
  event: string | null
  reversalOf: string | null
  reversedBy: string | null
  /** On a consolidating entry: `elimination_intercompany`, `nci_allocation`, … */
  adjustmentKind: string | null
  adjustsEntity: string | null
}

export interface LineageTransaction {
  id: string
  entity: string | null
  type: string | null
  category: string | null
  amount: number | null
  currency: string | null
  date: string | null
  dueDate: string | null
  merchantName: string | null
  referenceNumber: string | null
  description: string | null
  source: string | null
  event: string | null
}

export interface LineageEvent {
  id: string
  entity: string | null
  type: string | null
  category: string | null
  eventClass: string | null
  action: string | null
  status: string | null
  occurredAt: string | null
  dueDate: string | null
  amount: number | null
  currency: string | null
  source: string | null
  description: string | null
  /** The counterparty. */
  agent: string | null
  obligatedBy: string | null
  discharges: string | null
  replaces: string | null
}

export interface LineageAgent {
  id: string
  name: string
  type: string | null
}

/** A chart-of-accounts account — distinct from the concepts the report is presented in. */
export interface LineageAccount {
  id: string
  name: string
  code: string | null
  balance: BalanceType | null
  periodType: PeriodType | null
}

/** A member of the reporting group; the report's own entity is `NormalizedReport.entity`. */
export interface LineageEntity {
  id: string
  name: string | null
  /** `operating` or `consolidation`. */
  role: string | null
  parent: string | null
}

export interface Lineage {
  contributions: Record<string, LineageContribution>
  lines: Record<string, LineageLine>
  entries: Record<string, LineageEntry>
  transactions: Record<string, LineageTransaction>
  events: Record<string, LineageEvent>
  agents: Record<string, LineageAgent>
  accounts: Record<string, LineageAccount>
  entities: Record<string, LineageEntity>
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
  /** The filer's label choice for this arc (resolved string), when declared. */
  preferredLabel?: string | null
  /** The preferred-label role URI — `negated*` roles flip the displayed sign. */
  preferredLabelRole?: string | null
}

/** A network root — groups associations under one role / block type. */
export interface StructureInfo {
  id: string
  blockType: string
  roleUri: string | null
  /** Clean display title (any SEC `NNN - Type - ` prefix stripped). */
  structureName: string | null
  /** Full role definition, verbatim (e.g. "9952153 - Statement - …"), for hover. */
  definition?: string | null
  /** Coarse grouping (Statement / Disclosure / Document / Cover); null/absent for non-SEC. */
  kind?: SectionKind | null
  /**
   * Filing sequence for ordering sections (SEC `Structure.number`). When present,
   * `buildStatements` orders by it instead of the canonical `BLOCK_ORDER` — a real
   * filing has dozens of sections whose order is the filer's, not a fixed four.
   */
  order?: number
}

/** An Information Block — groups a statement's facts via a shared `factSet`. */
export interface InformationBlock {
  id: string
  blockType: string
  factSet: string | null
  label: string | null
  /**
   * Direct link to the `StructureInfo` that supplies this block's presentation +
   * calculation networks. When set (SEC adapter), the projection matches block →
   * structure by this id, so a filing with many structures sharing one `blockType`
   * (e.g. balance sheet main + parenthetical) resolves each to its own structure.
   * Left undefined by the holon/file path, which matches by `blockType`.
   */
  structureId?: string
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
  /** The ledger behind the frozen figures, when the file carries its `#lineage` graph. */
  lineage?: Lineage
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
  /** Raw string for a non-numeric fact (from `Fact.textValue`), when `value` is null. */
  textValue?: string | null
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

// ── Fact pivot model (produced by pivot.ts) ──────────────────────────────────
//
// A section is a hypercube; viewing it is pivoting its facts. Every fact is a
// point in aspect space — concept, period, entity, unit, and its (multi-valued)
// dimensions. A `PivotConfig` assigns each aspect a role (row / column / slicer);
// the engine hardcodes no arrangement, so the default view can be overridden.

/**
 * A reference to one fact aspect, for assigning it a pivot role. `concept`,
 * `period`, `entity`, `unit` are the single-valued builtins; `dim:<axisIri>`
 * names a dimensional axis. String-form so a config round-trips through JSON or
 * a UI control (e.g. `dim:us-gaap:StatementEquityComponentsAxis`).
 */
export type AspectKey = 'concept' | 'period' | 'entity' | 'unit' | `dim:${string}`

/** Display scale for monetary values; `auto` infers from the facts' decimals. */
export type Scale = 'auto' | 'ones' | 'thousands' | 'millions' | 'billions'

/**
 * A pivot configuration: which aspects lay out as rows, which as columns, and
 * which are held fixed as slicers. `defaultPivotConfig` derives one per section
 * (concept→rows, period + multi-member dimensions→columns, entity + single-member
 * dimensions→slicers); a caller may override any of it.
 */
export interface PivotConfig {
  rows: AspectKey[]
  columns: AspectKey[]
  slicers: AspectKey[]
  scale: Scale
  /** Emit abstract concept rows as group headers (default true). */
  showAbstracts: boolean
  /**
   * Drop a period column with fewer than two populated facts when the densest
   * period has several (default true). This removes lone stragglers — e.g. an
   * equity opening balance that leaked into the balance-sheet factset — without
   * ever touching a real comparative period (which repeats many line items).
   * Metadata-safe: unlike the old fact filter, cells still own their own facts.
   */
  dropSparsePeriods?: boolean
}

/** An aspect held fixed for the whole table, rendered as a header bar. */
export interface PivotSlicer {
  aspect: AspectKey
  /** e.g. `Reporting Entity` or `Equity Components [Axis]`. */
  label: string
  /** e.g. `NVIDIA CORP`, `Consolidated`, `USD`. */
  valueLabel: string
}

/** One leaf column — a single combination of the column aspects. */
export interface PivotColumn {
  /** Stable key: signature of this column's coordinate. */
  key: string
  /** The period, when period is a column aspect (else null). */
  period: PeriodInfo | null
  /** The member coordinate, when dimensions are column aspects (else empty). */
  members: DimensionQualifier[]
  /** Leaf header label (a date, a member name, …). */
  label: string
}

/** A column-header cell spanning one level of the (possibly nested) column tree. */
export interface PivotColumnHeader {
  label: string
  /** colspan across leaf columns. */
  span: number
}

/** One value in a pivot row, plus the fact behind it (for inspection / footing). */
export interface PivotCell {
  value: number | null
  fact: Fact | null
  /** Raw string for a non-numeric fact, when `value` is null. */
  textValue?: string | null
}

/** One rendered pivot line. */
export interface PivotRow {
  /** Stable key: element id + dimensional signature (when dims are on rows). */
  key: string
  element: ElementInfo
  /** Indent depth in the concept tree — drives indentation. */
  depth: number
  /** A concept header row (abstract) — carries no values. */
  header: boolean
  /** A calculation parent (roll-up) — rendered emphasized. */
  isSubtotal: boolean
  /** The member coordinate, when dimensions are row aspects (else empty). */
  members: DimensionQualifier[]
  /** One cell per leaf column, aligned by index (empty for header rows). */
  cells: PivotCell[]
  /** The filer's preferred label for this row's presentation arc, when declared. */
  label?: string
  /**
   * The arc's preferred-label role is a `negated*` variant: display each cell
   * value sign-flipped (accounting parentheses). Fact values stay untouched —
   * this is presentation, so inspection and analysis read the raw fact.
   */
  negated?: boolean
}

/** Resolved display scale + a caption for the section header. */
export interface ResolvedScale {
  /** Divide monetary values by this (1 for ones, 1e6 for millions). */
  factor: number
  /** `millions`, `thousands`, `billions`, or '' when unscaled. */
  label: string
  /** Header caption, e.g. `In millions, except per-share amounts`, or null. */
  caption: string | null
}

/** A fully pivoted section — the render input, and the raw fact table's source. */
export interface PivotTable {
  ib: InformationBlock
  blockType: string
  title: string
  structureName: string | null
  /** Full role definition (for hover/context); null when unavailable. */
  definition: string | null
  /** Coarse grouping for the TOC; null for non-SEC sections. */
  kind: SectionKind | null
  /** Aspects held fixed for the whole table, shown as header bars. */
  slicers: PivotSlicer[]
  /** Column header rows, outermost level first (period over members). */
  columnHeaders: PivotColumnHeader[][]
  /** Leaf columns; row cells align to these by index. */
  columns: PivotColumn[]
  rows: PivotRow[]
  /** Resolved display scale (factor + caption). */
  scale: ResolvedScale
  /** The configuration this table was built from (default, unless overridden). */
  config: PivotConfig
}
