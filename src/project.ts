/**
 * Presentation/calculation helpers over a `NormalizedReport`, plus the live
 * footing check used by the fact inspector.
 *
 * The heavy lifting — turning a report into renderable tables — now lives in the
 * fact pivot engine (`pivot.ts`). This file holds the small, reusable graph
 * utilities that the engine and the components share: the presentation-order
 * walk, the calculation-subtotal set, single-section slicing, and `footCheck`.
 */
import { humanize, qname } from './constants'
import type { CalcAssociation, ElementInfo, NormalizedReport, PivotTable } from './model'

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
 * arc order. Retained as a reusable utility; the pivot engine builds its own
 * pre-order tree (it needs abstract headers), but external callers may still want
 * a flat order map.
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

/**
 * Narrow a whole report to a single section (one Information Block) so it can be
 * rendered on its own. `buildPivots` only iterates `informationBlocks`, so
 * restricting to one yields exactly that section — facts, structures, and
 * networks stay intact because the pivot filters them by the block.
 */
export function sliceReportSection(
  model: NormalizedReport,
  informationBlockId: string
): NormalizedReport {
  const ib = model.informationBlocks.find((b) => b.id === informationBlockId)
  return { ...model, informationBlocks: ib ? [ib] : [] }
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
 * element is not a calculation parent (nothing to foot). Values are read from the
 * consolidated (undimensioned) row for each concept.
 */
export function footCheck(
  model: NormalizedReport,
  table: PivotTable,
  elementId: string,
  columnIndex: number
): FootCheck | null {
  const kids: CalcAssociation[] = model.calcAssociations.filter((a) => a.parent === elementId)
  if (!kids.length) return null

  const valueOf = (id: string): number | null => {
    const row = table.rows.find((r) => r.element.id === id && r.members.length === 0)
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
