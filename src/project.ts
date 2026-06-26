/**
 * Reconstruction: a `NormalizedReport` → renderable `Statement`s.
 *
 * This is the source-agnostic half of the library — the part that is identical
 * for every adapter. It is a TypeScript port of the RoboSystems platform's
 * DataBook converter:
 *
 *  - **presentation walk** — a post-order DFS of the presentation network, so a
 *    total renders *after* its components (cash + receivables … then *Assets,
 *    Current*; the section subtotals last). `order` is the flattened post-order
 *    position; `depth` is the tree depth (drives indentation).
 *  - **subtotal detection** — a concept is a subtotal iff it is a *calculation
 *    parent*. A presentation leaf can still be a subtotal (Gross Profit is a
 *    presentation sibling but a calculation parent), so bolding off the calc
 *    tree marks exactly the right rows.
 *  - **table projection** — collect a block's facts by `factSet`, key by
 *    element, derive period columns from the facts themselves, lay rows out in
 *    presentation order.
 */
import { BLOCK_ORDER, BLOCK_TITLES, humanize, qname } from './constants'
import { formatDate } from './format'
import type {
  CalcAssociation,
  ElementInfo,
  Fact,
  InformationBlock,
  NormalizedReport,
  PeriodInfo,
  RowCell,
  Statement,
  StatementColumn,
  StatementRow,
  StructureInfo,
} from './model'

interface OrderEntry {
  order: number
  depth: number
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

/**
 * Post-order the presentation arcs of one structure → `{element: {order, depth}}`.
 * Roots (a `from` that is never a `to`) are visited by their subtree's leading
 * arc order, so a balance sheet's roots (Assets, then Liabilities and Equity)
 * come out in the right sequence.
 */
export function presentationOrder(
  model: NormalizedReport,
  structureId: string
): Map<string, OrderEntry> {
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
  for (const kids of children.values()) {
    kids.sort((a, b) => a[0] - b[0])
  }

  const out = new Map<string, OrderEntry>()
  const seen = new Set<string>()
  let counter = 0

  const walk = (node: string, depth: number): void => {
    if (seen.has(node)) return
    seen.add(node)
    for (const [, child] of children.get(node) ?? []) {
      walk(child, depth + 1)
    }
    out.set(node, { order: counter, depth })
    counter += 1
  }

  const rootKey = (root: string): number => {
    const kids = children.get(root)
    return kids && kids.length ? kids[0][0] : 0
  }

  const roots = [...froms].filter((f) => !tos.has(f)).sort((a, b) => rootKey(a) - rootKey(b))
  for (const root of roots) walk(root, 0)
  return out
}

/** Concepts that are calculation parents — the authoritative subtotal set. */
export function calcSubtotals(model: NormalizedReport): Set<string> {
  const out = new Set<string>()
  for (const assoc of model.calcAssociations) out.add(assoc.parent)
  return out
}

function structureForBlock(model: NormalizedReport, blockType: string): StructureInfo | null {
  return model.structures.find((s) => s.blockType === blockType) ?? null
}

function columnLabel(period: PeriodInfo): string {
  return formatDate(period.end)
}

/** Period columns derived from the facts in one block, keyed and sorted by end. */
function deriveColumns(model: NormalizedReport, facts: Fact[]): StatementColumn[] {
  const byEnd = new Map<string, PeriodInfo>()
  for (const fact of facts) {
    const period = model.periods[fact.period]
    if (!period || !period.end) continue
    const existing = byEnd.get(period.end)
    // Prefer a duration as the column representative — it carries the span.
    if (!existing || (existing.type === 'instant' && period.type === 'duration')) {
      byEnd.set(period.end, period)
    }
  }
  return [...byEnd.values()]
    .sort((a, b) => {
      const aStart = a.startDate ?? a.end
      const bStart = b.startDate ?? b.end
      return aStart.localeCompare(bStart) || a.end.localeCompare(b.end)
    })
    .map((period) => ({ key: period.end, label: columnLabel(period), period }))
}

function buildStatement(
  model: NormalizedReport,
  ib: InformationBlock,
  subtotals: Set<string>
): Statement {
  const structure = structureForBlock(model, ib.blockType)
  const order = structure ? presentationOrder(model, structure.id) : new Map<string, OrderEntry>()

  const facts = model.facts.filter((f) => f.factSet !== null && f.factSet === ib.factSet)
  const columns = deriveColumns(model, facts)
  const colIndex = new Map(columns.map((c, i) => [c.key, i]))

  const cellsByElement = new Map<string, RowCell[]>()
  for (const fact of facts) {
    const period = model.periods[fact.period]
    if (!period) continue
    const idx = colIndex.get(period.end)
    if (idx === undefined) continue
    let cells = cellsByElement.get(fact.element)
    if (!cells) {
      cells = columns.map(() => ({ value: null, fact: null }))
      cellsByElement.set(fact.element, cells)
    }
    cells[idx] = { value: fact.value, fact }
  }

  const rows: StatementRow[] = [...cellsByElement.keys()]
    .map((id) => {
      const entry = order.get(id)
      return {
        id,
        order: entry ? entry.order : Number.MAX_SAFE_INTEGER,
        depth: entry ? entry.depth : 0,
      }
    })
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map(({ id, depth }) => ({
      element: model.elements[id] ?? fallbackElement(id),
      depth,
      isSubtotal: subtotals.has(id),
      cells: cellsByElement.get(id) as RowCell[],
    }))

  return {
    ib,
    blockType: ib.blockType,
    title: BLOCK_TITLES[ib.blockType] ?? ib.label ?? ib.blockType,
    structureName: structure?.structureName ?? ib.label ?? null,
    columns,
    rows,
  }
}

/** Reconstruct every statement in the report, in canonical block order. */
export function buildStatements(model: NormalizedReport): Statement[] {
  const subtotals = calcSubtotals(model)
  return [...model.informationBlocks]
    .sort(
      (a, b) =>
        (BLOCK_ORDER[a.blockType] ?? 99) - (BLOCK_ORDER[b.blockType] ?? 99) ||
        a.blockType.localeCompare(b.blockType)
    )
    .map((ib) => buildStatement(model, ib, subtotals))
}

// ── Footing check ────────────────────────────────────────────────────────────

export interface FootTerm {
  element: ElementInfo
  weight: number
  value: number | null
}

export interface FootCheck {
  element: ElementInfo
  columnIndex: number
  terms: FootTerm[]
  /** Σ child·weight over the present terms, or null if none are present. */
  expected: number | null
  /** The subtotal's own reported value in this column. */
  actual: number | null
  ok: boolean
}

/**
 * Foot a subtotal live: sum its calculation children (× weight) and compare to
 * its reported value, e.g. `13,550 + 900 = 14,450 ✓`. Returns `null` when the
 * element is not a calculation parent (nothing to foot).
 */
export function footCheck(
  model: NormalizedReport,
  statement: Statement,
  elementId: string,
  columnIndex: number
): FootCheck | null {
  const kids: CalcAssociation[] = model.calcAssociations.filter((a) => a.parent === elementId)
  if (!kids.length) return null

  const valueOf = (id: string): number | null => {
    const row = statement.rows.find((r) => r.element.id === id)
    return row ? (row.cells[columnIndex]?.value ?? null) : null
  }

  const terms: FootTerm[] = kids
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((a) => ({
      element: model.elements[a.child] ?? fallbackElement(a.child),
      weight: a.weight,
      value: valueOf(a.child),
    }))

  const present = terms.filter((t) => t.value !== null)
  const expected = present.length
    ? present.reduce((sum, t) => sum + (t.value as number) * t.weight, 0)
    : null
  const actual = valueOf(elementId)
  const ok = expected !== null && actual !== null && Math.abs(expected - actual) < 0.005

  return {
    element: model.elements[elementId] ?? fallbackElement(elementId),
    columnIndex,
    terms,
    expected,
    actual,
    ok,
  }
}
