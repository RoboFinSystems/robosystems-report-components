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
  | 'monetary'
  | 'perShare'
  | 'shares'
  | 'percent'
  | 'pure'
  | 'integer'
  | 'other'

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
  /**
   * Raw string value for non-numeric facts (e.g. a Cover Page's entity name,
   * or a yes/no flag) — present when `value` is null. Lets text-bearing sections
   * (the cover, narrative disclosures) render their content instead of a blank.
   */
  textValue?: string | null
  /**
   * The fact's dimensional coordinate — one qualifier per axis, ordered by axis.
   * Absent/empty means a consolidated (undimensioned) fact. Part of the fact's
   * identity: the pivot engine keys cells by `(element, period, dimensions)`, so
   * segment/component breakdowns no longer overwrite the consolidated total.
   */
  dimensions?: DimensionQualifier[]
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
