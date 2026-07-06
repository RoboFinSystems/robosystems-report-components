/**
 * The fact pivot engine — a `NormalizedReport` section → a `PivotTable`.
 *
 * A section is an XBRL hypercube; rendering it is pivoting its fact table. Every
 * fact is a point in aspect space (concept · period · entity · unit · dimensions);
 * a `PivotConfig` assigns each aspect a role — row, column, or slicer — and the
 * cells fall out. The default arrangement (concept hierarchy on rows, period and
 * multi-member dimensions on columns, entity and single-member dimensions as
 * slicers) is derived per section, but nothing is hardcoded: a caller can move
 * any aspect to any role (the Pesseract "override the default view" model).
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

/**
 * A fact's coordinate along a chosen set of axes, as a stable signature. A fact
 * with no member on an axis contributes the domain-total marker, so the
 * consolidated total gets its own coordinate distinct from every member.
 */
function coordinate(byAxis: Map<string, DimensionQualifier>, axes: string[]): string {
  return axes
    .map((a) => `${a}=${byAxis.get(a)?.member ?? byAxis.get(a)?.typedValue ?? DOMAIN}`)
    .join('|')
}

/** Facts belonging to one section (its Information Block's factset). */
function sectionFacts(model: NormalizedReport, ib: InformationBlock): Fact[] {
  return model.facts.filter((f) => f.factSet !== null && f.factSet === ib.factSet)
}

// ── Presentation tree ───────────────────────────────────────────────────────

interface PresentationTree {
  /** Ordered children per parent (by arc order). */
  childrenOf: Map<string, string[]>
  /** Presentation roots (a `from` that is never a `to`), in filing sequence. */
  roots: string[]
  /** Pre-order position of each element — the member/row ordering key. */
  indexOf: Map<string, number>
}

/**
 * Index one structure's presentation arcs: ordered children per parent, the
 * roots, and each element's pre-order position (used to order dimension members).
 * The row walk itself (in `buildPivot`) is a hybrid — abstract headers emit
 * before their children, concrete concepts after — so a subtotal renders after
 * its components whether the taxonomy models it as an abstract's last child
 * (us-gaap) or as the presentation parent of its components (rs-gaap).
 */
function presentationTree(model: NormalizedReport, structureId: string): PresentationTree {
  const children = new Map<string, Array<[number, string]>>()
  const froms = new Set<string>()
  const tos = new Set<string>()
  for (const assoc of model.presAssociations) {
    if (assoc.structure !== structureId) continue
    const kids = children.get(assoc.parent) ?? []
    kids.push([assoc.order, assoc.child])
    children.set(assoc.parent, kids)
    froms.add(assoc.parent)
    tos.add(assoc.child)
  }
  const childrenOf = new Map<string, string[]>()
  for (const [parent, kids] of children) {
    childrenOf.set(
      parent,
      kids.sort((a, b) => a[0] - b[0]).map(([, child]) => child)
    )
  }
  const rootKey = (root: string): number => {
    const kids = children.get(root)
    return kids && kids.length ? kids[0][0] : 0
  }
  const roots = [...froms].filter((f) => !tos.has(f)).sort((a, b) => rootKey(a) - rootKey(b))

  const indexOf = new Map<string, number>()
  const seen = new Set<string>()
  const pre = (node: string): void => {
    if (seen.has(node)) return
    seen.add(node)
    if (!indexOf.has(node)) indexOf.set(node, indexOf.size)
    for (const child of childrenOf.get(node) ?? []) pre(child)
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

// ── Default configuration ───────────────────────────────────────────────────

/**
 * Derive the default pivot for a section from the aspects its facts actually
 * carry: concept on rows, period on columns, entity a slicer, and each dimension
 * axis on columns when it has more than one member (a real breakdown) or a slicer
 * when it has just one (diced to a single member, e.g. `Consolidated [Domain]`).
 */
export function defaultPivotConfig(model: NormalizedReport, ib: InformationBlock): PivotConfig {
  const facts = sectionFacts(model, ib)
  const membersByAxis = new Map<string, Set<string>>()
  let hasEntity = false
  for (const f of facts) {
    if (f.entity) hasEntity = true
    for (const d of f.dimensions ?? []) {
      const set = membersByAxis.get(d.axis) ?? new Set<string>()
      set.add(d.member ?? d.typedValue ?? DOMAIN)
      membersByAxis.set(d.axis, set)
    }
  }
  const axes = [...membersByAxis.keys()].sort()
  const columnAxes = axes.filter((a) => (membersByAxis.get(a)?.size ?? 0) > 1)
  const slicerAxes = axes.filter((a) => (membersByAxis.get(a)?.size ?? 0) <= 1)

  return {
    rows: ['concept'],
    columns: ['period', ...columnAxes.map(dimKey)],
    slicers: [...(hasEntity ? (['entity'] as AspectKey[]) : []), ...slicerAxes.map(dimKey)],
    scale: 'auto',
    showAbstracts: true,
    dropSparsePeriods: true,
  }
}

// ── Columns ─────────────────────────────────────────────────────────────────

/**
 * Drop lone-straggler periods: those with fewer than two populated facts, when
 * some period has four or more. Conservative on purpose — a real comparative
 * period repeats many line items and always clears the bar, so this only removes
 * noise like an equity opening balance leaked into the balance-sheet factset.
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
  if (max < 4) return periods
  return periods.filter((p) => (count.get(p.end) ?? 0) >= 2)
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
 * ordered by each member's presentation position (domain-total last). The union
 * across periods, so the grid is regular (a member absent in one period shows an
 * empty cell rather than a ragged column set).
 */
function memberCombos(facts: Fact[], axes: string[], order: Map<string, number>): MemberCombo[] {
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
        const ao = a.qual?.member ? (order.get(a.qual.member) ?? Infinity) : Infinity
        const bo = b.qual?.member ? (order.get(b.qual.member) ?? Infinity) : Infinity
        return ao - bo || (a.qual?.memberLabel ?? a.key).localeCompare(b.qual?.memberLabel ?? b.key)
      })
    if (hasDomain) members.push({ key: DOMAIN, qual: null })
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

function buildSlicers(model: NormalizedReport, facts: Fact[], config: PivotConfig): PivotSlicer[] {
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
    // A slicer dimension is diced to a single member (or its domain total).
    let qual: DimensionQualifier | null = null
    for (const f of facts) {
      const d = (f.dimensions ?? []).find((x) => x.axis === axis)
      if (d) {
        qual = d
        break
      }
    }
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

  // In-table facts: drop any carrying an axis this configuration doesn't place
  // (a finer breakdown that belongs to a different pivot), so nothing is
  // double-counted. Single-member slicer axes don't filter — they only label.
  const facts = sectionFacts(model, ib).filter((f) =>
    (f.dimensions ?? []).every((d) => allowedAxes.has(d.axis))
  )

  // Columns: period (outer) × member combos over the column axes (inner).
  const periodOnColumns = config.columns.includes('period')
  let periods = periodOnColumns ? derivePeriods(model, facts) : []
  if (periodOnColumns && config.dropSparsePeriods !== false) {
    periods = pruneSparsePeriods(model, facts, periods)
  }
  const colCombos = memberCombos(facts, colDimAxes, tree.indexOf)

  const columns: PivotColumn[] = []
  const columnSegs: string[][] = []
  const periodList = periodOnColumns ? periods : [null]
  for (const period of periodList) {
    for (const combo of colCombos) {
      const periodLabel = period ? formatDate(period.end) : ''
      columns.push({
        key: `${period?.end ?? ''}#${combo.sig}`,
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
  const factIndex = new Map<string, Fact>()
  for (const f of facts) {
    const byAxis = memberByAxis(f)
    const end = model.periods[f.period]?.end ?? ''
    const rowSig = coordinate(byAxis, rowDimAxes)
    const colSig = coordinate(byAxis, colDimAxes)
    factIndex.set(`${f.element}␟${rowSig}␟${end}␟${colSig}`, f)
  }

  const factfulConcepts = new Set(facts.map((f) => f.element))
  const rowCombos = memberCombos(facts, rowDimAxes, tree.indexOf)
  const combosForConcept = (element: string): MemberCombo[] => {
    if (rowDimAxes.length === 0) return rowCombos // single domain combo
    return rowCombos.filter((combo) =>
      columns.some((col) =>
        factIndex.has(
          `${element}␟${combo.sig}␟${col.period?.end ?? ''}␟${coordinate(
            new Map(col.members.map((m) => [m.axis, m])),
            colDimAxes
          )}`
        )
      )
    )
  }

  const cellsFor = (element: string, rowSig: string): PivotRow['cells'] =>
    columns.map((col) => {
      const colSig = coordinate(new Map(col.members.map((m) => [m.axis, m])), colDimAxes)
      const fact = factIndex.get(`${element}␟${rowSig}␟${col.period?.end ?? ''}␟${colSig}`)
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
    for (const child of tree.childrenOf.get(id) ?? []) {
      if (subtreeHasFact(child)) has = true
    }
    hasFactMemo.set(id, has)
    return has
  }

  const rows: PivotRow[] = []
  const emitConcept = (id: string, depth: number): void => {
    const el = elementOf(model, id)
    for (const combo of combosForConcept(id)) {
      rows.push({
        key: combo.sig ? `${id}␟${combo.sig}` : id,
        element: el,
        depth: depth + (combo.members.length ? 1 : 0),
        header: false,
        isSubtotal: subtotals.has(id),
        members: combo.members,
        cells: cellsFor(id, combo.sig),
      })
    }
  }

  // Hybrid walk: an abstract emits its header *before* its children (so the
  // `[Roll Up]` header sits above its section); a concrete concept emits *after*
  // its children (so a subtotal lands below its components) — correct whether the
  // subtotal is an abstract's last child (us-gaap) or the parent itself (rs-gaap).
  const seenInTree = new Set<string>()
  const walk = (id: string, depth: number): void => {
    if (seenInTree.has(id) || !subtreeHasFact(id)) return
    seenInTree.add(id)
    const el = elementOf(model, id)
    if (el.abstract) {
      if (config.showAbstracts) {
        rows.push({
          key: id,
          element: el,
          depth,
          header: true,
          isSubtotal: false,
          members: [],
          cells: [],
        })
      }
      for (const child of tree.childrenOf.get(id) ?? []) walk(child, depth + 1)
    } else {
      for (const child of tree.childrenOf.get(id) ?? []) walk(child, depth + 1)
      emitConcept(id, depth)
    }
  }
  for (const root of tree.roots) walk(root, 0)
  // Concepts with facts but absent from the presentation network — append after.
  for (const id of factfulConcepts) {
    if (seenInTree.has(id) || elementOf(model, id).abstract) continue
    emitConcept(id, 0)
  }

  const title = ib.structureId
    ? (structure?.structureName ?? ib.label ?? BLOCK_TITLES[ib.blockType] ?? ib.blockType)
    : (BLOCK_TITLES[ib.blockType] ?? ib.label ?? ib.blockType)

  return {
    ib,
    blockType: ib.blockType,
    title,
    structureName: ib.structureId ? null : (structure?.structureName ?? ib.label ?? null),
    slicers: buildSlicers(model, facts, config),
    columnHeaders,
    columns,
    rows,
    scale: resolveScale(facts, model, config.scale),
    config,
  }
}

/** Section metadata (id + display title) for a report, in canonical order. */
export function reportSections(model: NormalizedReport): Array<{ id: string; title: string }> {
  return buildPivots(model).map((p) => ({ id: p.ib.id, title: p.title }))
}

/** Pivot every section of a report, in canonical block order. */
export function buildPivots(model: NormalizedReport): PivotTable[] {
  const order = (ib: InformationBlock): number => {
    if (ib.structureId) {
      const s = model.structures.find((x) => x.id === ib.structureId)
      if (s?.order !== undefined) return s.order
    }
    return BLOCK_ORDER[ib.blockType] ?? 99
  }
  return [...model.informationBlocks]
    .sort((a, b) => order(a) - order(b) || a.blockType.localeCompare(b.blockType))
    .map((ib) => buildPivot(model, ib))
}
