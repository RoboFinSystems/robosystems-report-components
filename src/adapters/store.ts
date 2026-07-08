/**
 * The shared quad-store → `NormalizedReport` traversal.
 *
 * An adapter fills an N3 quad `Store` from its source, then hands it here. The
 * store is read as a **union** across its graphs (`graph = null`) — the
 * scene/boundary/projection partition is a publication concern, not a rendering
 * one, so the join is identical however the quads arrived (a dataset-form
 * JSON-LD holon, a flat graph, …). No SPARQL engine is required; only store
 * traversal. The only per-source code is how the store gets filled.
 */
import { DataFactory, Store } from 'n3'
import { IRI, humanize, qname } from '../constants'
import type {
  CalcAssociation,
  DimensionQualifier,
  ElementInfo,
  EntityInfo,
  Fact,
  InformationBlock,
  NormalizedReport,
  PeriodInfo,
  PeriodType,
  PresAssociation,
  StructureInfo,
  UnitInfo,
} from '../model'

const { namedNode } = DataFactory

function makeReaders(store: Store) {
  const objects = (s: string, p: string) => store.getObjects(namedNode(s), namedNode(p), null)
  const firstValue = (s: string, p: string): string | null => {
    const os = objects(s, p)
    return os.length ? os[0].value : null
  }
  const subjectsOfType = (type: string): string[] =>
    store.getSubjects(namedNode(IRI.type), namedNode(type), null).map((t) => t.value)
  return { objects, firstValue, subjectsOfType }
}

function toNumber(raw: string | null): number | null {
  if (raw === null || raw === '') return null
  const n = Number(raw)
  return Number.isNaN(n) ? null : n
}

/** Traverse a populated quad `Store` into the normalized report model. */
export function parseStore(store: Store): NormalizedReport {
  const { objects, firstValue, subjectsOfType } = makeReaders(store)

  // ── Elements ──
  const elements: Record<string, ElementInfo> = {}
  for (const id of subjectsOfType(IRI.Element)) {
    const balance = firstValue(id, IRI.balance)
    const periodType = firstValue(id, IRI.periodType)
    elements[id] = {
      id,
      qname: qname(id),
      label: firstValue(id, IRI.prefLabel) ?? humanize(id),
      balance: balance === 'debit' || balance === 'credit' ? balance : null,
      periodType: periodType === 'instant' || periodType === 'duration' ? periodType : null,
      abstract: firstValue(id, IRI.abstract) === 'true',
      monetary: firstValue(id, IRI.monetary) === 'true',
      itemType: firstValue(id, IRI.itemType) ?? undefined,
    }
  }

  // ── Periods ──
  const periods: Record<string, PeriodInfo> = {}
  for (const id of subjectsOfType(IRI.Period)) {
    const declared = firstValue(id, IRI.periodType)
    const instant = firstValue(id, IRI.instant)
    const startDate = firstValue(id, IRI.startDate)
    const endDate = firstValue(id, IRI.endDate)
    const type: PeriodType =
      declared === 'instant'
        ? 'instant'
        : declared === 'duration'
          ? 'duration'
          : instant
            ? 'instant'
            : 'duration'
    const end = (type === 'instant' ? instant : endDate) ?? instant ?? endDate ?? ''
    periods[id] = { id, type, instant, startDate, endDate, end }
  }

  // ── Units ──
  const units: Record<string, UnitInfo> = {}
  for (const id of subjectsOfType(IRI.Unit)) {
    const measureTerm = objects(id, IRI.measure)[0]
    const measure = measureTerm ? qname(measureTerm.value) : 'unknown'
    units[id] = {
      id,
      measure,
      label: measure.includes(':') ? (measure.split(':').pop() as string) : measure,
    }
  }

  // ── Entity ──
  let entity: EntityInfo | null = null
  const entityIds = subjectsOfType(IRI.Entity)
  if (entityIds.length) {
    const id = entityIds[0]
    entity = {
      id,
      name: firstValue(id, IRI.prefLabel) ?? firstValue(id, IRI.legalName) ?? 'Entity',
      legalName: firstValue(id, IRI.legalName),
      country: firstValue(id, IRI.country),
    }
  }

  // ── Facts ──
  const facts: Fact[] = []
  for (const id of subjectsOfType(IRI.Fact)) {
    // Dimensional coordinate (rs:dimension -> rs:Dimension {axis, member, ...}).
    // Without this every fact reads as consolidated, so a segment breakdown
    // collapses onto the face-statement cell and can overwrite the real total.
    const dimensions: DimensionQualifier[] = []
    for (const d of objects(id, IRI.dimension)) {
      const axis = firstValue(d.value, IRI.axis)
      if (!axis) continue
      const member = firstValue(d.value, IRI.member)
      const typedValue = firstValue(d.value, IRI.typedValue)
      dimensions.push({
        axis,
        member: member ?? null,
        axisLabel: elements[axis]?.label ?? humanize(axis),
        memberLabel: member
          ? (elements[member]?.label ?? humanize(member))
          : (typedValue ?? ''),
        explicit: firstValue(d.value, IRI.isExplicit) === 'true',
        typedValue: typedValue ?? null,
      })
    }
    facts.push({
      id,
      element: firstValue(id, IRI.element) ?? '',
      period: firstValue(id, IRI.period) ?? '',
      unit: firstValue(id, IRI.unit),
      entity: firstValue(id, IRI.entity),
      factSet: firstValue(id, IRI.factSet),
      value: toNumber(firstValue(id, IRI.numericValue)),
      textValue: firstValue(id, IRI.stringValue),
      decimals: firstValue(id, IRI.decimals),
      dimensions: dimensions.length ? dimensions : undefined,
    })
  }

  // ── Information Blocks ──
  const informationBlocks: InformationBlock[] = []
  for (const id of subjectsOfType(IRI.InformationBlock)) {
    informationBlocks.push({
      id,
      blockType: firstValue(id, IRI.blockType) ?? '',
      // Match a block to its structure by identity (the rs:structure link),
      // not by a semantic blockType — a full-fidelity holon carries no
      // block-type classification, so structureId is how row order is found.
      structureId: firstValue(id, IRI.structure) ?? undefined,
      factSet: firstValue(id, IRI.factSet),
      label: firstValue(id, IRI.prefLabel),
    })
  }

  // ── Structures + association → structure membership ──
  const structures: StructureInfo[] = []
  const assocStructure = new Map<string, string>()
  for (const id of subjectsOfType(IRI.Structure)) {
    structures.push({
      id,
      blockType: firstValue(id, IRI.blockType) ?? '',
      roleUri: firstValue(id, IRI.roleUri),
      structureName: firstValue(id, IRI.structureName),
      // Filing sequence (SEC role-definition number) so buildPivots orders all
      // sections by the filer's order rather than the fixed four-primary fallback.
      order: toNumber(firstValue(id, IRI.structureOrder)) ?? undefined,
    })
    for (const assoc of objects(id, IRI.hasAssociation)) {
      assocStructure.set(assoc.value, id)
    }
  }

  // ── Associations ──
  const calcAssociations: CalcAssociation[] = []
  const presAssociations: PresAssociation[] = []
  for (const id of subjectsOfType(IRI.Association)) {
    const parent = firstValue(id, IRI.from)
    const child = firstValue(id, IRI.to)
    if (!parent || !child) continue
    const type = firstValue(id, IRI.associationType)
    const order = toNumber(firstValue(id, IRI.order)) ?? 0
    const role = firstValue(id, IRI.role)
    const structure = assocStructure.get(id) ?? null
    if (type === 'calculation') {
      calcAssociations.push({
        parent,
        child,
        weight: toNumber(firstValue(id, IRI.weight)) ?? 1,
        order,
        role,
        structure,
      })
    } else if (type === 'presentation') {
      presAssociations.push({ parent, child, order, role, structure })
    }
  }

  // ── Report IRI / id ──
  // Prefer the named-graph name (`<report>#scene` → `<report>`) — present in a
  // dataset-form holon. Fall back to the `rs:Report` subject so a flat,
  // single-graph document still resolves its identity.
  let reportIri: string | null = null
  for (const graph of store.getGraphs(null, null, null)) {
    const hash = graph.value.indexOf('#')
    if (hash > 0) {
      reportIri = graph.value.slice(0, hash)
      break
    }
  }
  if (!reportIri) {
    const reports = subjectsOfType(IRI.Report)
    reportIri = reports.length ? reports[0] : null
  }
  const reportId = reportIri ? (reportIri.split('/').pop() ?? null) : null

  return {
    reportId,
    reportIri,
    entity,
    informationBlocks,
    structures,
    facts,
    elements,
    periods,
    units,
    calcAssociations,
    presAssociations,
  }
}
