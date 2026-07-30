/**
 * The fact pivot engine — a `NormalizedReport` section → a `PivotTable`.
 *
 * A section is an XBRL hypercube; rendering it is pivoting its fact table. Every
 * fact is a point in aspect space (concept · period · entity · unit · dimensions);
 * a `PivotConfig` assigns each aspect a role — row, column, or slicer — and the
 * cells fall out. The default arrangement (concept hierarchy + multi-member
 * dimensions on rows, period on columns, entity and single-member dimensions as
 * slicers) is derived per section, but nothing is hardcoded: a caller can move
 * any aspect to any role (the Pesseract "override the default view" model) —
 * `pivotDimensionsOn` flips dimensions between rows and columns for the toggle.
 *
 * This supersedes the collision-prone `(element, period.end)` cell keying of the
 * legacy `buildStatement`. A cell is the one fact whose *full* aspect signature —
 * element, period, and dimensional coordinate — matches its row and column, so
 * segment/component breakdowns and consolidated totals occupy distinct cells
 * instead of silently overwriting one another. Because every cell owns its fact,
 * the fact's own period/unit metadata is exact (no borrowing from a merged
 * column), which is what fixes the wrong-metadata symptom too.
 */
import { BLOCK_ORDER, BLOCK_TITLES, humanize, qname } from './constants'
import { formatDate, numericKindOf } from './format'
import type {
  AspectKey,
  DimensionQualifier,
  ElementInfo,
  Fact,
  InformationBlock,
  NormalizedReport,
  PeriodInfo,
  PivotColumn,
  PivotColumnHeader,
  PivotConfig,
  PivotRow,
  PivotSlicer,
  PivotTable,
  ResolvedScale,
  Scale,
  StructureInfo,
} from './model'
import { calcSubtotals } from './project'
import type { SectionKind } from './sections'

// ── Aspect / signature helpers ──────────────────────────────────────────────

/** The domain-total coordinate for an axis (a fact with no member on it). */
const DOMAIN = '∅' // ∅

/** The `dim:<axis>` aspect key for an axis IRI/qname. */
function dimKey(axis: string): AspectKey {
  return `dim:${axis}`
}

/** The axis IRI behind a `dim:<axis>` key, or null for a builtin aspect. */
function axisOf(key: AspectKey): string | null {
  return key.startsWith('dim:') ? key.slice(4) : null
}

/** The dimension axes named by a role's aspect list, in order. */
function dimAxes(keys: AspectKey[]): string[] {
  return keys.map(axisOf).filter((a): a is string => a !== null)
}

/** A fact's members keyed by axis (empty when consolidated). */
function memberByAxis(fact: Fact): Map<string, DimensionQualifier> {
  const m = new Map<string, DimensionQualifier>()
  for (const d of fact.dimensions ?? []) m.set(d.axis, d)
  return m
}

/** The signature key one qualifier contributes: member, typed value, or domain. */
function memberKey(d: DimensionQualifier | null | undefined): string {
  return d?.member ?? d?.typedValue ?? DOMAIN
}

/**
 * The ISO date one day before `date`. XBRL dates a beginning-of-period instant
 * as the prior period's end (FY2026 runs 2025-01-27 → 2026-01-25; its opening
 * balance is the instant 2025-01-26), so a `periodStart*` row binds the instant
 * at the duration's start date minus one day (with the exact start date as a
 * fallback for non-SEC conventions).
 */
function isoDayBefore(date: string): string {
  const t = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(t.getTime())) return date
  t.setUTCDate(t.getUTCDate() - 1)
  return t.toISOString().slice(0, 10)
}

/**
 * A fact's coordinate along a chosen set of axes, as a stable signature. A fact
 * with no member on an axis contributes the domain-total marker, so the
 * consolidated total gets its own coordinate distinct from every member.
 */
function coordinate(byAxis: Map<string, DimensionQualifier>, axes: string[]): string {
  return axes.map((a) => `${a}=${memberKey(byAxis.get(a))}`).join('|')
}

/** Facts belonging to one section (its Information Block's factset). */
function sectionFacts(model: NormalizedReport, ib: InformationBlock): Fact[] {
  const target = ib.factSet
  if (target === null) return []
  // Membership, not equality: a fact may belong to several factSets (a summary
  // concept presented in multiple structures), so include it when THIS section is
  // among them. Fall back to the single `factSet` for adapters that set only one.
  return model.facts.filter((f) =>
    (f.factSets ?? (f.factSet !== null ? [f.factSet] : [])).includes(target)
  )
}

/** The local part of a qname (`us-gaap:Assets` → `Assets`). */
function localName(qname: string): string {
  return qname.includes(':') ? (qname.split(':').pop() as string) : qname
}

/**
 * Local names of every element in a structure's presentation network. A section
 * only *owns* the dimension axes declared here (its hypercube's axes appear as
 * presentation nodes); facts carrying any other axis are a different table's
 * breakdown — e.g. segment revenue tagged to the income-statement role — and must
 * not be pivoted into this statement. Matched by local name so a company-specific
 * axis (`nvda:FooAxis`) lines up regardless of prefix.
 */
function presentationNodeLocals(model: NormalizedReport, structureId: string): Set<string> {
  const out = new Set<string>()
  for (const a of model.presAssociations) {
    if (a.structure !== structureId) continue
    out.add(localName(a.parent))
    out.add(localName(a.child))
  }
  return out
}

interface PresentationScope {
  /** Local names of every presentation node (axes, members, line items). */
  declared: Set<string>
  /** Whether the presentation lists explicit members (a closed member set). */
  listsMembers: boolean
}

/**
 * The section's dimensional scope. Many "Details" disclosures share one hypercube
 * factset (every debt instrument, every segment), and are distinguished only by
 * which *members* each network's presentation declares — so "DEBT, DuQuoin State
 * Bank" and "DEBT, CREM Loan" pull from the same facts but must show different
 * rows. When the presentation lists members, a fact whose member on any axis is
 * not declared belongs to a sibling disclosure and is out of scope.
 */
function presentationScope(model: NormalizedReport, structureId: string): PresentationScope {
  const declared = presentationNodeLocals(model, structureId)
  let listsMembers = false
  for (const l of declared) {
    if (l.endsWith('Member')) {
      listsMembers = true
      break
    }
  }
  return { declared, listsMembers }
}

/** Whether a dimension is in a section's declared scope (axis + member). */
function dimensionInScope(scope: PresentationScope, d: DimensionQualifier): boolean {
  if (!scope.declared.has(localName(d.axis))) return false
  return !scope.listsMembers || d.member === null || scope.declared.has(localName(d.member))
}

// ── Presentation tree ───────────────────────────────────────────────────────

/**
 * One presentation arc as the row walk consumes it: the child plus the arc's
 * preferred-label choice. `binding` is the roll-forward semantic — a
 * `periodStart*` / `periodEnd*` role means this arc's row binds the instant
 * fact at the START (respectively end) of each duration column, so the same
 * concept legitimately appears twice (beginning and ending balance).
 */
interface PresArcRef {
  child: string
  label: string | null
  binding: 'start' | 'end' | null
  negated: boolean
}

interface PresentationTree {
  /** Ordered child arcs per parent (by arc order). */
  childrenOf: Map<string, PresArcRef[]>
  /** Presentation roots (a `from` that is never a `to`), in filing sequence. */
  roots: string[]
  /** Pre-order position of each element — the member/row ordering key. */
  indexOf: Map<string, number>
}

function arcRef(a: {
  child: string
  preferredLabel?: string | null
  preferredLabelRole?: string | null
}): PresArcRef {
  const role = a.preferredLabelRole ?? ''
  return {
    child: a.child,
    label: a.preferredLabel ?? null,
    binding: /periodStart/i.test(role) ? 'start' : /periodEnd/i.test(role) ? 'end' : null,
    negated: /negated/i.test(role),
  }
}

/**
 * Index one structure's presentation arcs: ordered child arcs per parent, the
 * roots, and each element's pre-order position (used to order dimension members).
 * The row walk itself (in `buildPivot`) is a hybrid — abstract headers emit
 * before their children, concrete concepts after — so a subtotal renders after
 * its components whether the taxonomy models it as an abstract's last child
 * (us-gaap) or as the presentation parent of its components (rs-gaap).
 */
function presentationTree(model: NormalizedReport, structureId: string): PresentationTree {
  const children = new Map<string, Array<[number, PresArcRef]>>()
  const froms = new Set<string>()
  const tos = new Set<string>()
  for (const assoc of model.presAssociations) {
    if (assoc.structure !== structureId) continue
    const kids = children.get(assoc.parent) ?? []
    kids.push([assoc.order, arcRef(assoc)])
    children.set(assoc.parent, kids)
    froms.add(assoc.parent)
    tos.add(assoc.child)
  }
  const childrenOf = new Map<string, PresArcRef[]>()
  for (const [parent, kids] of children) {
    childrenOf.set(
      parent,
      kids.sort((a, b) => a[0] - b[0]).map(([, arc]) => arc)
    )
  }
  const rootKey = (root: string): number => {
    const kids = children.get(root)
    return kids && kids.length ? kids[0][0] : 0
  }
  const roots = [...froms].filter((f) => !tos.has(f)).sort((a, b) => rootKey(a) - rootKey(b))

  // Keyed by *local name* so member ordering matches a dimension qualifier's
  // member regardless of prefix (a company member `mrmd:RetailMember` reaches the
  // renderer as the bare local `RetailMember`).
  const indexOf = new Map<string, number>()
  const seen = new Set<string>()
  const pre = (node: string): void => {
    if (seen.has(node)) return
    seen.add(node)
    const ln = localName(node)
    if (!indexOf.has(ln)) indexOf.set(ln, indexOf.size)
    for (const arc of childrenOf.get(node) ?? []) pre(arc.child)
  }
  for (const root of roots) pre(root)
  return { childrenOf, roots, indexOf }
}

/** The structure supplying a block's networks (by id, else by block type). */
function structureForBlock(model: NormalizedReport, ib: InformationBlock): StructureInfo | null {
  if (ib.structureId) {
    const byId = model.structures.find((s) => s.id === ib.structureId)
    if (byId) return byId
  }
  return model.structures.find((s) => s.blockType === ib.blockType) ?? null
}

function fallbackElement(id: string): ElementInfo {
  return {
    id,
    qname: qname(id),
    label: humanize(id),
    balance: null,
    periodType: null,
    abstract: false,
    monetary: false,
  }
}

const elementOf = (model: NormalizedReport, id: string): ElementInfo =>
  model.elements[id] ?? fallbackElement(id)

/**
 * Pure XBRL hypercube plumbing: a `[Table]` (the hypercube itself) and its
 * `[Line Items]` container. These abstracts exist only to hang dimensional facts
 * off of — they carry no data, and once their role tag is stripped for display
 * they collapse to a bare, duplicated "Statement" heading. So they are never a
 * meaningful row: skip the header and promote their children in their place.
 * Keyed off the concept's local name (identical across the store and SEC routes,
 * which key elements by IRI vs qname respectively) so both render the same.
 */
const SCAFFOLD_LOCAL_RE = /(?:Table|LineItems)$/
function isStructuralScaffold(el: ElementInfo): boolean {
  return el.abstract && SCAFFOLD_LOCAL_RE.test(localName(el.qname))
}

// ── Default configuration ───────────────────────────────────────────────────

/**
 * Derive the default pivot for a section from the aspects its facts actually
 * carry: concept on rows, period on columns, entity a slicer, and each dimension
 * axis on columns when it has more than one member (a real breakdown) or a slicer
 * when it has just one (diced to a single member, e.g. `Consolidated [Domain]`).
 */
export function defaultPivotConfig(model: NormalizedReport, ib: InformationBlock): PivotConfig {
  const facts = sectionFacts(model, ib)
  const structure = structureForBlock(model, ib)
  // Only the axes *and members* this section's presentation/hypercube declares
  // belong in its view — so an axis that's a single declared member becomes a
  // slicer, not a spurious multi-member breakdown from a sibling disclosure.
  const scope = structure
    ? presentationScope(model, structure.id)
    : { declared: new Set<string>(), listsMembers: false }
  const membersByAxis = new Map<string, Set<string>>()
  let hasEntity = false
  for (const f of facts) {
    if (f.entity) hasEntity = true
    for (const d of f.dimensions ?? []) {
      if (!dimensionInScope(scope, d)) continue
      const set = membersByAxis.get(d.axis) ?? new Set<string>()
      set.add(d.member ?? d.typedValue ?? DOMAIN)
      membersByAxis.set(d.axis, set)
    }
  }
  const axes = [...membersByAxis.keys()].sort()
  const memberAxes = axes.filter((a) => (membersByAxis.get(a)?.size ?? 0) > 1)
  const slicerAxes = axes.filter((a) => (membersByAxis.get(a)?.size ?? 0) <= 1)

  // Dimensions default to *rows* (nested under the concept): financial statements
  // are tall, not wide, so member breakdowns stack more legibly than they spread
  // across columns. `pivotDimensionsOn` flips them to columns for the matrix view.
  return {
    rows: ['concept', ...memberAxes.map(dimKey)],
    columns: ['period'],
    slicers: [...(hasEntity ? (['entity'] as AspectKey[]) : []), ...slicerAxes.map(dimKey)],
    scale: 'auto',
    showAbstracts: true,
    dropSparsePeriods: true,
  }
}

/**
 * Move every dimension axis to one side of the pivot — the toggle behind a
 * "dimensions as rows / columns" control. Concept stays on rows and period on
 * columns; only `dim:*` aspects move. Rows (nested breakdowns) is the default;
 * columns gives the side-by-side matrix (equity components across the top).
 */
export function pivotDimensionsOn(config: PivotConfig, placement: 'rows' | 'columns'): PivotConfig {
  const isDim = (k: AspectKey): boolean => k.startsWith('dim:')
  const dims = [...config.rows, ...config.columns].filter(isDim)
  const rows = config.rows.filter((k) => !isDim(k))
  const columns = config.columns.filter((k) => !isDim(k))
  if (placement === 'rows') rows.push(...dims)
  else columns.push(...dims)
  return { ...config, rows, columns }
}

// ── Columns ─────────────────────────────────────────────────────────────────

/** Fraction of the densest period a column must reach to count as a real one. */
const PERIOD_DENSITY_FRACTION = 0.2

/**
 * Drop "incomplete" period columns — incidental context dates that aren't real
 * reporting periods: a transaction date (a single fact), a prior-year opening
 * balance, a stub period. The SEC/Arelle renderer selects reporting periods by
 * type + recency (most-recent instants aligned to the fiscal year-end for a
 * balance sheet, day-count-classified durations for income); we approximate that
 * with density, which separates the same set here — a real comparative repeats
 * most line items and clears the bar, while an incidental date is sparse. Keep a
 * period whose populated-fact count is at least `PERIOD_DENSITY_FRACTION` of the
 * densest (min 2), when the densest is non-trivial. Metadata-safe: cells still
 * own their own facts, so a dropped column can never mislabel a kept one.
 */
function pruneSparsePeriods(
  model: NormalizedReport,
  facts: Fact[],
  periods: PeriodInfo[]
): PeriodInfo[] {
  const count = new Map<string, number>()
  for (const f of facts) {
    const populated = f.value !== null || (f.textValue != null && f.textValue !== '')
    const end = model.periods[f.period]?.end
    if (end && populated) count.set(end, (count.get(end) ?? 0) + 1)
  }
  const max = Math.max(0, ...count.values())
  if (max < 5) return periods
  const threshold = Math.max(2, max * PERIOD_DENSITY_FRACTION)
  return periods.filter((p) => (count.get(p.end) ?? 0) >= threshold)
}

/** Period columns keyed by end date, preferring a duration as the representative. */
function derivePeriods(model: NormalizedReport, facts: Fact[]): PeriodInfo[] {
  const byEnd = new Map<string, PeriodInfo>()
  for (const fact of facts) {
    const period = model.periods[fact.period]
    if (!period || !period.end) continue
    const existing = byEnd.get(period.end)
    if (!existing || (existing.type === 'instant' && period.type === 'duration')) {
      byEnd.set(period.end, period)
    }
  }
  return [...byEnd.values()].sort((a, b) => {
    const aStart = a.startDate ?? a.end
    const bStart = b.startDate ?? b.end
    return aStart.localeCompare(bStart) || a.end.localeCompare(b.end)
  })
}

interface MemberCombo {
  /** Signature over the chosen axes (domain-total for a missing member). */
  sig: string
  /** One qualifier per axis — null where this combo is the axis's domain total. */
  members: DimensionQualifier[]
  /** Header segment labels, one per axis. */
  labels: string[]
}

/**
 * The distinct member combinations present across `facts` for the chosen axes,
 * ordered by each member's presentation position. The union across periods, so
 * the grid is regular (a member absent in one period shows an empty cell rather
 * than a ragged set). `domainLast` places the domain total (the consolidated,
 * memberless combo) after its members — a trailing "Total" column, or on rows the
 * concept's summing total below its member breakdown.
 */
function memberCombos(
  facts: Fact[],
  axes: string[],
  order: Map<string, number>,
  domainLast: boolean
): MemberCombo[] {
  if (axes.length === 0) return [{ sig: '', members: [], labels: [] }]

  // Distinct members seen per axis (+ whether a domain total exists), plus a
  // representative qualifier so we can render a member's label without re-joining.
  const perAxis = axes.map((axis) => {
    const byMember = new Map<string, DimensionQualifier | null>()
    let hasDomain = false
    for (const f of facts) {
      const d = (f.dimensions ?? []).find((x) => x.axis === axis)
      if (d) byMember.set(d.member ?? d.typedValue ?? DOMAIN, d)
      else hasDomain = true
    }
    const members = [...byMember.entries()]
      .map(([key, qual]) => ({ key, qual }))
      .sort((a, b) => {
        const ao = a.qual?.member ? (order.get(localName(a.qual.member)) ?? Infinity) : Infinity
        const bo = b.qual?.member ? (order.get(localName(b.qual.member)) ?? Infinity) : Infinity
        return ao - bo || (a.qual?.memberLabel ?? a.key).localeCompare(b.qual?.memberLabel ?? b.key)
      })
    if (hasDomain) {
      const domain = { key: DOMAIN, qual: null }
      if (domainLast) members.push(domain)
      else members.unshift(domain)
    }
    return { axis, members }
  })

  // Cartesian product across axes → ordered combos.
  let combos: MemberCombo[] = [{ sig: '', members: [], labels: [] }]
  for (const { axis, members } of perAxis) {
    const next: MemberCombo[] = []
    for (const combo of combos) {
      for (const { key, qual } of members) {
        next.push({
          sig: combo.sig ? `${combo.sig}|${axis}=${key}` : `${axis}=${key}`,
          members: [...combo.members, ...(qual ? [qual] : [])],
          labels: [...combo.labels, qual ? qual.memberLabel : 'Total'],
        })
      }
    }
    combos = next
  }
  return combos
}

/** Run-length-encode leaf-column segment tuples into spanning header levels. */
function headerLevels(segsPerColumn: string[][]): PivotColumnHeader[][] {
  const levels = segsPerColumn[0]?.length ?? 0
  const out: PivotColumnHeader[][] = []
  for (let level = 0; level < levels; level++) {
    const row: PivotColumnHeader[] = []
    let i = 0
    while (i < segsPerColumn.length) {
      // Merge consecutive columns equal at this level *and* all ancestor levels.
      let span = 1
      while (
        i + span < segsPerColumn.length &&
        segsPerColumn[i + span][level] === segsPerColumn[i][level] &&
        Array.from({ length: level + 1 }, (_, l) => l).every(
          (l) => segsPerColumn[i + span][l] === segsPerColumn[i][l]
        )
      ) {
        span++
      }
      row.push({ label: segsPerColumn[i][level], span })
      i += span
    }
    out.push(row)
  }
  return out
}

// ── Scale ───────────────────────────────────────────────────────────────────

const SCALE_FACTOR: Record<Exclude<Scale, 'auto'>, { factor: number; label: string }> = {
  ones: { factor: 1, label: '' },
  thousands: { factor: 1e3, label: 'thousands' },
  millions: { factor: 1e6, label: 'millions' },
  billions: { factor: 1e9, label: 'billions' },
}

/**
 * Resolve the section's display scale. `auto` picks the most common rounding
 * (`decimals`) among monetary facts — `-6` → millions, `-3..-5` → thousands — and
 * captions it, noting the per-share exception when the section also has EPS or
 * share-count facts (which are never rescaled).
 */
function resolveScale(facts: Fact[], model: NormalizedReport, requested: Scale): ResolvedScale {
  const kindOf = (id: string): string => numericKindOf(elementOf(model, id))

  let factor = 1
  let label = ''
  if (requested !== 'auto') {
    ;({ factor, label } = SCALE_FACTOR[requested])
  } else {
    const decimalsCount = new Map<number, number>()
    for (const f of facts) {
      if (f.value === null || kindOf(f.element) !== 'monetary') continue
      const d = f.decimals === null || f.decimals === 'INF' ? NaN : Number(f.decimals)
      if (Number.isNaN(d) || d >= 0) continue
      decimalsCount.set(d, (decimalsCount.get(d) ?? 0) + 1)
    }
    let dominant = 0
    let best = 0
    for (const [d, count] of decimalsCount) {
      if (count > best) {
        best = count
        dominant = d
      }
    }
    if (dominant <= -9) ({ factor, label } = SCALE_FACTOR.billions)
    else if (dominant <= -6) ({ factor, label } = SCALE_FACTOR.millions)
    else if (dominant <= -3) ({ factor, label } = SCALE_FACTOR.thousands)
  }

  let caption: string | null = null
  if (factor > 1) {
    const hasPerShare = facts.some((f) => {
      const k = kindOf(f.element)
      return f.value !== null && (k === 'perShare' || k === 'shares')
    })
    caption = hasPerShare ? `In ${label}, except per-share amounts` : `In ${label}`
  }
  return { factor, label, caption }
}

// ── Slicers ─────────────────────────────────────────────────────────────────

function buildSlicers(
  model: NormalizedReport,
  config: PivotConfig,
  diced: Map<string, DimensionQualifier | null>
): PivotSlicer[] {
  const slicers: PivotSlicer[] = []
  for (const key of config.slicers) {
    if (key === 'entity') {
      if (model.entity) {
        slicers.push({
          aspect: 'entity',
          label: 'Reporting Entity',
          valueLabel: model.entity.name,
        })
      }
      continue
    }
    const axis = axisOf(key)
    if (!axis) continue
    // A slicer dimension is diced to a single member (or its domain total) —
    // the same coordinate the fact index binds cells against, so the chip
    // states exactly what the cells show.
    const qual = diced.get(axis) ?? null
    const axisLabel = qual?.axisLabel ?? humanize(axis)
    slicers.push({
      aspect: key,
      label: `${axisLabel} [Axis]`,
      valueLabel: qual ? qual.memberLabel : 'Consolidated',
    })
  }
  return slicers
}

// ── Build ───────────────────────────────────────────────────────────────────

/**
 * Pivot one section into a `PivotTable`. Pass `config` to override the default
 * arrangement (e.g. move a high-arity axis from columns to rows).
 */
export function buildPivot(
  model: NormalizedReport,
  ib: InformationBlock,
  config: PivotConfig = defaultPivotConfig(model, ib)
): PivotTable {
  const structure = structureForBlock(model, ib)
  const tree: PresentationTree = structure
    ? presentationTree(model, structure.id)
    : { childrenOf: new Map(), roots: [], indexOf: new Map() }

  const rowDimAxes = dimAxes(config.rows)
  const colDimAxes = dimAxes(config.columns)
  const allowedAxes = new Set([...rowDimAxes, ...colDimAxes, ...dimAxes(config.slicers)])
  const scope: PresentationScope = structure
    ? presentationScope(model, structure.id)
    : { declared: new Set(), listsMembers: false }

  // In-table facts: drop any carrying an axis this configuration doesn't place,
  // or (when the section lists members) a member its presentation doesn't declare
  // — a sibling disclosure's row that shares this hypercube's factset.
  const facts = sectionFacts(model, ib).filter((f) =>
    (f.dimensions ?? []).every((d) => allowedAxes.has(d.axis) && dimensionInScope(scope, d))
  )

  // Each slicer axis is diced to one coordinate: the (single) member its facts
  // carry, or the domain total when no fact carries the axis. Cell binding and
  // the slicer chips both read this map, so the chip states exactly which
  // coordinate the cells show.
  const dicedSlicers = new Map<string, DimensionQualifier | null>()
  for (const axis of dimAxes(config.slicers)) {
    const qual = facts.flatMap((f) => f.dimensions ?? []).find((d) => d.axis === axis) ?? null
    dicedSlicers.set(axis, qual)
  }

  // A fact belongs in the table when every dimension it carries is either shown
  // on rows/columns (where it contributes to the cell signature) or sits on a
  // slicer axis at the diced coordinate. A fact on an axis this pivot doesn't
  // place at all is a finer breakdown of a coarser cell; a fact at a different
  // slicer coordinate is a sibling slice. Both are dropped — indexing either
  // would collide with the cell's rightful fact.
  const shownAxes = new Set([...rowDimAxes, ...colDimAxes])
  const tableFacts = facts.filter((f) =>
    (f.dimensions ?? []).every(
      (d) =>
        shownAxes.has(d.axis) ||
        (dicedSlicers.has(d.axis) && memberKey(d) === memberKey(dicedSlicers.get(d.axis)))
    )
  )

  // Columns: period (outer) × member combos over the column axes (inner).
  const periodOnColumns = config.columns.includes('period')
  let periods = periodOnColumns ? derivePeriods(model, tableFacts) : []
  if (periodOnColumns && config.dropSparsePeriods !== false) {
    periods = pruneSparsePeriods(model, tableFacts, periods)
  }
  // A roll-forward's opening instants render as beginning-balance rows *inside*
  // the duration columns (periodStart binding below); a standalone column for
  // the same instant would duplicate that data, so drop it.
  const hasRollForward = [...tree.childrenOf.values()].some((arcs) =>
    arcs.some((a) => a.binding !== null)
  )
  if (periodOnColumns && hasRollForward) {
    const startKeys = new Set(
      periods
        .filter((p) => p.type === 'duration' && p.startDate)
        .flatMap((p) => [isoDayBefore(p.startDate as string), p.startDate as string])
    )
    periods = periods.filter((p) => !(p.type === 'instant' && startKeys.has(p.end)))
  }
  const colCombos = memberCombos(tableFacts, colDimAxes, tree.indexOf, true)

  // Column coordinates that actually carry a fact. The member-combo union (and
  // cross-product across axes) yields many (period × member) columns that never
  // occur; drop the empty ones — the column analog of only emitting member rows
  // that have facts.
  const occupiedCols = new Set<string>()
  for (const f of tableFacts) {
    const end = model.periods[f.period]?.end ?? ''
    occupiedCols.add(`${end}#${coordinate(memberByAxis(f), colDimAxes)}`)
  }

  const columns: PivotColumn[] = []
  const columnSegs: string[][] = []
  const periodList = periodOnColumns ? periods : [null]
  for (const period of periodList) {
    for (const combo of colCombos) {
      const end = period?.end ?? ''
      if (!occupiedCols.has(`${end}#${combo.sig}`)) continue
      const periodLabel = period ? formatDate(period.end) : ''
      columns.push({
        key: `${end}#${combo.sig}`,
        period,
        members: combo.members,
        label: combo.labels.length ? combo.labels[combo.labels.length - 1] : periodLabel,
      })
      columnSegs.push([...(periodOnColumns ? [periodLabel] : []), ...combo.labels])
    }
  }
  const columnHeaders = headerLevels(columnSegs)

  // Index every in-table fact by (element, rowCombo, periodEnd, colCombo) so a
  // cell is an O(1) exact-signature lookup — no last-write-wins collisions.
  //
  // A fact that doesn't carry a slicer axis is that axis's domain total and may
  // still bind, but a fact AT the diced coordinate is more specific and wins the
  // cell: with Consolidation Items diced to `Operating Segments`, the
  // operating-segments total owns the aggregate cell, not the consolidated
  // face-statement fact that shares its factset. Ascending-specificity insertion
  // makes the map's last write the most specific fact.
  const slicerSpecificity = (f: Fact): number =>
    (f.dimensions ?? []).filter((d) => !shownAxes.has(d.axis)).length
  const factIndex = new Map<string, Fact>()
  for (const f of [...tableFacts].sort((a, b) => slicerSpecificity(a) - slicerSpecificity(b))) {
    const byAxis = memberByAxis(f)
    const end = model.periods[f.period]?.end ?? ''
    const rowSig = coordinate(byAxis, rowDimAxes)
    const colSig = coordinate(byAxis, colDimAxes)
    factIndex.set(`${f.element}␟${rowSig}␟${end}␟${colSig}`, f)
  }

  const factfulConcepts = new Set(tableFacts.map((f) => f.element))

  // The period end-date(s) a row binds against in a column. Default (and
  // `periodEnd`) rows read the column's own end; a `periodStart` row reads the
  // instant at the column duration's start — dated the day before the start
  // (the XBRL/SEC convention), with the exact start date as fallback.
  const periodKeysFor = (col: PivotColumn, binding: 'start' | 'end' | null): string[] => {
    if (binding !== 'start') return [col.period?.end ?? '']
    const start = col.period?.startDate
    return start ? [isoDayBefore(start), start] : []
  }

  const lookupFact = (
    element: string,
    rowSig: string,
    col: PivotColumn,
    binding: 'start' | 'end' | null
  ): Fact | undefined => {
    const colSig = coordinate(new Map(col.members.map((m) => [m.axis, m])), colDimAxes)
    for (const end of periodKeysFor(col, binding)) {
      const fact = factIndex.get(`${element}␟${rowSig}␟${end}␟${colSig}`)
      if (fact) return fact
    }
    return undefined
  }

  // Domain total last on rows too: member rows list first, then the concept's
  // own (memberless) total below and outdented — the accounting "components then
  // total" layout, so the total reads as the sum of the members above it.
  const rowCombos = memberCombos(tableFacts, rowDimAxes, tree.indexOf, true)
  const combosForConcept = (element: string, binding: 'start' | 'end' | null): MemberCombo[] => {
    const occupied = (combo: MemberCombo): boolean =>
      columns.some((col) => lookupFact(element, combo.sig, col, binding) !== undefined)
    if (rowDimAxes.length === 0) {
      // A start/end row with no bindable fact anywhere must not render at all.
      return binding === null || occupied(rowCombos[0]) ? rowCombos : []
    }
    return rowCombos.filter(occupied)
  }

  const cellsFor = (
    element: string,
    rowSig: string,
    binding: 'start' | 'end' | null
  ): PivotRow['cells'] =>
    columns.map((col) => {
      const fact = lookupFact(element, rowSig, col, binding)
      return {
        value: fact?.value ?? null,
        fact: fact ?? null,
        textValue: fact && fact.value === null ? (fact.textValue ?? null) : null,
      }
    })

  const subtotals = calcSubtotals(model)

  // Prune empty subtrees: only walk into a node that itself has facts or has a
  // fact-bearing descendant, so empty sections (and their headers) don't show.
  const hasFactMemo = new Map<string, boolean>()
  const subtreeHasFact = (id: string): boolean => {
    const cached = hasFactMemo.get(id)
    if (cached !== undefined) return cached
    hasFactMemo.set(id, false) // guard against cycles
    let has = factfulConcepts.has(id)
    for (const arc of tree.childrenOf.get(id) ?? []) {
      if (subtreeHasFact(arc.child)) has = true
    }
    hasFactMemo.set(id, has)
    return has
  }

  const rows: PivotRow[] = []
  const emitConcept = (id: string, depth: number, arc: PresArcRef | null): void => {
    const el = elementOf(model, id)
    const binding = arc?.binding ?? null
    const combos = combosForConcept(id, binding)
    if (!combos.length) return
    const rowLabel = arc?.label ?? undefined
    const negated = arc?.negated || undefined
    // A roll-forward concept renders once per arc (beginning / ending balance);
    // the binding suffix keeps those rows' keys distinct.
    const variant = binding ? `${id}␟rf:${binding}` : id
    // With dimensions on rows, a concept's own total row heads its indented member
    // breakdown and supplies the concept name. When the concept has *no*
    // consolidated total (only per-member facts — common in detail disclosures),
    // emit a valueless heading row so the members aren't orphaned member-only
    // labels (`CREM Loan · Mortgages` with no idea what is being measured).
    if (combos.every((c) => c.members.length > 0)) {
      rows.push({
        key: variant,
        element: el,
        depth,
        header: false,
        isSubtotal: subtotals.has(id),
        members: [],
        cells: columns.map(() => ({ value: null, fact: null, textValue: null })),
        label: rowLabel,
        negated,
      })
    }
    for (const combo of combos) {
      // The domain-total combo (no members) keys by the element alone — it's the
      // concept's own total row, identical to the undimensioned case. Only member
      // sub-rows carry the dimensional signature in their key.
      rows.push({
        key: combo.members.length ? `${variant}␟${combo.sig}` : variant,
        element: el,
        depth: depth + (combo.members.length ? 1 : 0),
        header: false,
        isSubtotal: subtotals.has(id),
        members: combo.members,
        cells: cellsFor(id, combo.sig, binding),
        label: rowLabel,
        negated,
      })
    }
  }

  // Hybrid walk: an abstract emits its header *before* its children (so the
  // `[Roll Up]` header sits above its section); a concrete concept emits *after*
  // its children (so a subtotal lands below its components) — correct whether the
  // subtotal is an abstract's last child (us-gaap) or the parent itself (rs-gaap).
  //
  // Dedup is per (element, binding): a roll-forward concept appears under TWO
  // arcs — beginning balance at the top of the network, ending balance at the
  // bottom — and each emits its own row; every other repeat of an element is a
  // genuine duplicate and drops.
  const seenInTree = new Set<string>()
  const walkedConcepts = new Set<string>()
  const walk = (arc: PresArcRef, depth: number): void => {
    const id = arc.child
    if (!subtreeHasFact(id)) return
    const el = elementOf(model, id)
    const dedupKey = el.abstract ? id : `${id}␟${arc.binding ?? ''}`
    if (seenInTree.has(dedupKey)) return
    seenInTree.add(dedupKey)
    walkedConcepts.add(id)
    if (el.abstract) {
      // Hypercube scaffolding ([Table]/[Line Items]) is not a heading — hide its
      // row and keep its children at the current depth so the tree stays flat.
      const scaffold = isStructuralScaffold(el)
      if (config.showAbstracts && !scaffold) {
        rows.push({
          key: id,
          element: el,
          depth,
          header: true,
          isSubtotal: false,
          members: [],
          cells: [],
          label: arc.label ?? undefined,
        })
      }
      const childDepth = scaffold ? depth : depth + 1
      for (const child of tree.childrenOf.get(id) ?? []) walk(child, childDepth)
    } else {
      for (const child of tree.childrenOf.get(id) ?? []) walk(child, depth + 1)
      emitConcept(id, depth, arc)
    }
  }
  for (const root of tree.roots) {
    walk({ child: root, label: null, binding: null, negated: false }, 0)
  }
  // Concepts with facts but absent from the presentation network — append after.
  for (const id of factfulConcepts) {
    if (walkedConcepts.has(id) || elementOf(model, id).abstract) continue
    emitConcept(id, 0, null)
  }

  const title = ib.structureId
    ? (structure?.structureName ?? ib.label ?? BLOCK_TITLES[ib.blockType] ?? ib.blockType)
    : (BLOCK_TITLES[ib.blockType] ?? ib.label ?? ib.blockType)

  return {
    ib,
    blockType: ib.blockType,
    title,
    structureName: ib.structureId ? null : (structure?.structureName ?? ib.label ?? null),
    definition: structure?.definition ?? null,
    kind: structure?.kind ?? null,
    slicers: buildSlicers(model, config, dicedSlicers),
    columnHeaders,
    columns,
    rows,
    scale: resolveScale(tableFacts, model, config.scale),
    config,
  }
}

/** Section metadata (id + display title, full definition, kind) in canonical order. */
export function reportSections(
  model: NormalizedReport
): Array<{ id: string; title: string; definition: string | null; kind: SectionKind | null }> {
  return buildPivots(model).map((p) => ({
    id: p.ib.id,
    title: p.title,
    definition: p.definition,
    kind: p.kind,
  }))
}

/**
 * Pivot every section of a report, in canonical block order. `configFor` may
 * transform each section's default config before it is built — e.g. to apply a
 * "dimensions as rows / columns" toggle across the whole report.
 */
export function buildPivots(
  model: NormalizedReport,
  configFor?: (ib: InformationBlock, defaultConfig: PivotConfig) => PivotConfig
): PivotTable[] {
  const order = (ib: InformationBlock): number => {
    if (ib.structureId) {
      const s = model.structures.find((x) => x.id === ib.structureId)
      if (s?.order !== undefined) return s.order
    }
    return BLOCK_ORDER[ib.blockType] ?? 99
  }
  return [...model.informationBlocks]
    .sort((a, b) => order(a) - order(b) || a.blockType.localeCompare(b.blockType))
    .map((ib) =>
      configFor
        ? buildPivot(model, ib, configFor(ib, defaultPivotConfig(model, ib)))
        : buildPivot(model, ib)
    )
}
