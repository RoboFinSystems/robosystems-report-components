/**
 * The `tavi.json` adapter — offline, no backend, no auth.
 *
 * A filing as a **Project Tavi compiled model** (XBRL International, PWD
 * 2026-09-01): one JSON object model carrying the taxonomy objects and the
 * report objects together, fully resolved. It is the second of xbrlkit's JSON
 * projections beside the holon, and the two carry the same facts, so a report
 * renders identically from either. Unlike the holon there is no RDF step: the
 * model is walked directly, which is also why this adapter is synchronous.
 *
 * The one thing Tavi has that the normalized model must be *given* is the
 * section partition. A holon carries Information Blocks and fact sets; a Tavi
 * carries presentation networks under groups (the extended link roles). Each
 * presentation network becomes a section whose fact set is the network itself,
 * and a fact belongs to every network that presents its concept — the same
 * rule the SEC adapter applies per structure. The pivot's dimensional scope
 * then keeps a segment breakdown out of the face statement.
 *
 * Periods are normalized to the holon's human-facing dates: Tavi writes ISO
 * intervals of exclusive-end dateTimes (`2025-01-01T00:00:00` is the close of
 * 2024-12-31), older emitters wrote inclusive dates; both land as the same
 * `PeriodInfo`.
 */
import { humanize, stripRoleSuffix } from '../constants'
import type {
  BalanceType,
  CalcAssociation,
  DimensionQualifier,
  ElementInfo,
  EntityInfo,
  Fact,
  InformationBlock,
  NormalizedReport,
  NumericKind,
  PeriodInfo,
  PeriodType,
  PresAssociation,
  StructureInfo,
  UnitInfo,
} from '../model'
import { parseStructureName } from '../sections'
import type { ReportAdapter } from './types'

// ── The document, as far as this adapter reads it ───────────────────────────

interface TaviProperty {
  property: string
  value?: unknown
}
interface TaviNamed {
  name: string
}
interface TaviConcept extends TaviNamed {
  dataType?: string | null
  periodType?: string | null
  properties?: TaviProperty[]
}
interface TaviDimension extends TaviNamed {
  domainClass?: string | null
}
interface TaviUnit extends TaviNamed {
  dataType?: string
  compositeUnitRepresentation?: string[]
}
interface TaviLabel {
  forObject: string
  labelType: string
  value: string
  language?: string
}
interface TaviRelationship {
  source: string
  target: string
  order?: number
  properties?: TaviProperty[]
}
interface TaviNetwork extends TaviNamed {
  relationshipTypeName?: string
  relationships?: TaviRelationship[]
  roots?: string[]
}
interface TaviGroup extends TaviNamed {
  groupURI?: string
}
interface TaviGroupContent {
  groupName: string
  forObject: string
}
interface TaviFactValue {
  value?: unknown
  decimals?: unknown
}
interface TaviFact extends TaviNamed {
  factDimensions?: Record<string, unknown>
  factValues?: TaviFactValue[]
}
interface TaviModel {
  name?: string
  modelType?: string
  properties?: TaviProperty[]
  entities?: TaviNamed[]
  units?: TaviUnit[]
  concepts?: TaviConcept[]
  headings?: TaviNamed[]
  dimensions?: TaviDimension[]
  domainClasses?: TaviNamed[]
  members?: TaviNamed[]
  labels?: TaviLabel[]
  networks?: TaviNetwork[]
  groups?: TaviGroup[]
  groupContents?: TaviGroupContent[]
  facts?: TaviFact[]
}

/** A Tavi document: the envelope and the model. */
export interface TaviDocument {
  documentInfo?: {
    documentType?: string
    namespaces?: Record<string, string>
    description?: string
  }
  xbrlModel?: TaviModel
}

const TAVI_DOCUMENT_TYPE = /xbrl\.org\/(PWD|20\d\d)\//
const PRESENTATION = 'xbrl:parent-child'
const CALCULATION = 'xbrl:summation-item'
const ROOT_SOURCE = 'xbrl:rootSource'
/** The fact aspects that are not taxonomy dimensions. */
const CORE_ASPECTS = new Set([
  'xbrl:concept',
  'xbrl:period',
  'xbrl:entity',
  'xbrl:unit',
  'xbrl:language',
])
const STANDARD_LABEL = 'xbrl:label'
const REGISTRANT_NAME = 'dei:EntityRegistrantName'

/** Whether a parsed document is a Tavi model (a `documentInfo.documentType` under xbrl.org, or an `xbrlModel` report). */
export function isTaviDocument(doc: unknown): doc is TaviDocument {
  if (!doc || typeof doc !== 'object') return false
  const d = doc as TaviDocument
  if (!d.xbrlModel || typeof d.xbrlModel !== 'object') return false
  const type = d.documentInfo?.documentType
  return (
    (typeof type === 'string' && TAVI_DOCUMENT_TYPE.test(type)) ||
    d.xbrlModel.modelType === 'xbrl:report'
  )
}

// ── Small readers ───────────────────────────────────────────────────────────

function propertyValue(props: TaviProperty[] | undefined, name: string): unknown {
  return props?.find((p) => p.property === name)?.value
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    return Number.isNaN(n) ? null : n
  }
  return null
}

function localName(qname: string): string {
  const i = qname.indexOf(':')
  return i >= 0 ? qname.slice(i + 1) : qname
}

/**
 * A Tavi datatype → the holon's `rs:itemType` vocabulary and the numeric kind
 * that drives formatting. Share counts have no built-in Tavi type (the
 * emitter records them as a gap), so they are recognized from the unit their
 * facts carry instead — see `sharesConcepts`.
 */
function itemTypeOf(dataType: string | null | undefined): {
  itemType?: string
  numericKind?: NumericKind
} {
  if (!dataType) return {}
  const local = localName(dataType)
  switch (local) {
    case 'monetary':
      return { itemType: 'monetary', numericKind: 'monetary' }
    case 'perShare':
      return { itemType: 'perShare', numericKind: 'perShare' }
    case 'percent':
      return { itemType: 'percent', numericKind: 'percent' }
    case 'pure':
      return { itemType: 'pure', numericKind: 'pure' }
    case 'sharesType':
    case 'shares':
      return { itemType: 'shares', numericKind: 'shares' }
    case 'integer':
    case 'int':
    case 'long':
    case 'nonNegativeInteger':
      return { itemType: 'integer', numericKind: 'integer' }
    case 'decimal':
    case 'float':
    case 'double':
      return { itemType: 'decimal' }
    case 'textBlock':
      return { itemType: 'textBlock' }
    case 'boolean':
      return { itemType: 'boolean' }
    case 'date':
    case 'dateTime':
      return { itemType: 'date' }
    case 'string':
    case 'normalizedString':
    case 'token':
      return { itemType: 'string' }
    default:
      return { itemType: local }
  }
}

/**
 * A Tavi period literal as the holon's human-facing dates. An interval is
 * `start/end`; an instant is one value. A dateTime is exclusive (Tavi's
 * `xbrlr:periodString` form): the day before is the date meant. A bare date
 * (older emitters) is inclusive already.
 */
function periodOf(literal: string): PeriodInfo {
  const [first, second] = literal.split('/')
  if (second === undefined) {
    const instant = inclusiveDate(first)
    return { id: literal, type: 'instant', instant, startDate: null, endDate: null, end: instant }
  }
  const startDate = datePart(first)
  const endDate = inclusiveDate(second)
  return { id: literal, type: 'duration', instant: null, startDate, endDate, end: endDate }
}

function datePart(value: string): string {
  return value.slice(0, 10)
}

function inclusiveDate(value: string): string {
  const date = datePart(value)
  if (!/T/.test(value)) return date
  const t = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(t)) return date
  return new Date(t - 86400000).toISOString().slice(0, 10)
}

// ── The parse ───────────────────────────────────────────────────────────────

/** Parse a `tavi.json` document (string or parsed object) into the model. */
export function parseTavi(doc: string | object): NormalizedReport {
  const json = (typeof doc === 'string' ? JSON.parse(doc) : doc) as TaviDocument
  const model: TaviModel = json.xbrlModel ?? {}
  const namespaces = json.documentInfo?.namespaces ?? {}

  // ── Labels: object → label type → text (the first of each type wins) ──
  const labels = new Map<string, Map<string, string>>()
  for (const l of model.labels ?? []) {
    if (!l.forObject || !l.labelType || typeof l.value !== 'string') continue
    let byType = labels.get(l.forObject)
    if (!byType) {
      byType = new Map()
      labels.set(l.forObject, byType)
    }
    if (!byType.has(l.labelType)) byType.set(l.labelType, l.value)
  }
  const labelOf = (name: string, type = STANDARD_LABEL): string | null =>
    labels.get(name)?.get(type) ?? null
  const displayLabel = (name: string): string => {
    const standard = labelOf(name)
    return standard ? stripRoleSuffix(standard) : humanize(name)
  }

  // ── Facts, first pass: the units concepts are measured in ──
  const facts = model.facts ?? []
  const sharesConcepts = new Set<string>()
  for (const f of facts) {
    const dims = f.factDimensions ?? {}
    const unit = dims['xbrl:unit']
    const concept = dims['xbrl:concept']
    if (typeof unit === 'string' && typeof concept === 'string' && localName(unit) === 'shares') {
      sharesConcepts.add(concept)
    }
  }

  // ── Elements: concepts, then the structural objects ──
  const elements: Record<string, ElementInfo> = {}
  for (const c of model.concepts ?? []) {
    const balanceValue = propertyValue(c.properties, 'xbrla:balance')
    const balance: BalanceType | null =
      balanceValue === 'debit' || balanceValue === 'credit' ? balanceValue : null
    const periodType: PeriodType | null =
      c.periodType === 'instant' || c.periodType === 'duration' ? c.periodType : null
    const typed = itemTypeOf(c.dataType)
    const asShares = !typed.numericKind && sharesConcepts.has(c.name)
    elements[c.name] = {
      id: c.name,
      qname: c.name,
      label: displayLabel(c.name),
      balance,
      periodType,
      abstract: false,
      monetary: typed.numericKind === 'monetary',
      itemType: asShares ? 'shares' : typed.itemType,
      numericKind: asShares ? 'shares' : typed.numericKind,
    }
  }
  const structural = [
    ...(model.headings ?? []),
    ...(model.dimensions ?? []),
    ...(model.domainClasses ?? []),
    ...(model.members ?? []),
  ]
  for (const s of structural) {
    if (!s.name || elements[s.name]) continue
    elements[s.name] = {
      id: s.name,
      qname: s.name,
      label: displayLabel(s.name),
      balance: null,
      periodType: null,
      abstract: true,
      monetary: false,
    }
  }
  const explicitAxes = new Set(
    (model.dimensions ?? []).filter((d) => d.domainClass).map((d) => d.name)
  )

  // ── Units ──
  const units: Record<string, UnitInfo> = {}
  for (const u of model.units ?? []) {
    if (!u.name) continue
    const measure = u.compositeUnitRepresentation?.[0] ?? u.name
    units[u.name] = {
      id: u.name,
      measure,
      label: measure.includes('/')
        ? measure.split('/').map(localName).join('/')
        : localName(measure),
    }
  }

  // ── Sections: one per presentation network, titled by its group's definition ──
  const groups = new Map<string, TaviGroup>()
  for (const g of model.groups ?? []) groups.set(g.name, g)
  const groupOf = new Map<string, string>()
  for (const gc of model.groupContents ?? []) groupOf.set(gc.forObject, gc.groupName)
  const groupIndex = new Map<string, number>()
  ;(model.groups ?? []).forEach((g, i) => groupIndex.set(g.name, i))

  const networks = model.networks ?? []
  const structures: StructureInfo[] = []
  const informationBlocks: InformationBlock[] = []
  const presAssociations: PresAssociation[] = []
  const calcAssociations: CalcAssociation[] = []
  /** concept → the presentation networks that present it */
  const presentedIn = new Map<string, string[]>()
  /** group → its first presentation network (the structure a calc network attaches to) */
  const presentationOfGroup = new Map<string, string>()

  const sectionMeta = (groupName: string | undefined) => {
    const group = groupName ? groups.get(groupName) : undefined
    const definition = groupName ? labelOf(groupName) : null
    const parsed = parseStructureName(definition)
    const roleUri = group?.groupURI ?? null
    const fallback = roleUri ? humanize(roleUri) : groupName ? humanize(groupName) : 'Section'
    const sortCode = definition ? /^\s*(\d+)\s*-/.exec(definition)?.[1] : undefined
    return {
      roleUri,
      definition: parsed.definition,
      title: parsed.title ?? fallback,
      kind: parsed.kind,
      order: sortCode
        ? Number(sortCode)
        : groupName
          ? (groupIndex.get(groupName) ?? undefined)
          : undefined,
    }
  }

  for (const n of networks) {
    if (n.relationshipTypeName !== PRESENTATION) continue
    const groupName = groupOf.get(n.name)
    const meta = sectionMeta(groupName)
    if (groupName && !presentationOfGroup.has(groupName)) presentationOfGroup.set(groupName, n.name)
    structures.push({
      id: n.name,
      blockType: '',
      roleUri: meta.roleUri,
      structureName: meta.title,
      definition: meta.definition,
      kind: meta.kind,
      order: meta.order,
    })
    informationBlocks.push({
      id: n.name,
      blockType: '',
      factSet: n.name,
      label: meta.title,
      structureId: n.name,
    })
    for (const r of n.relationships ?? []) {
      if (!r.source || !r.target) continue
      for (const node of r.source === ROOT_SOURCE ? [r.target] : [r.source, r.target]) {
        const list = presentedIn.get(node)
        if (!list) presentedIn.set(node, [n.name])
        else if (!list.includes(n.name)) list.push(n.name)
      }
      if (r.source === ROOT_SOURCE) continue
      const preferred = propertyValue(r.properties, 'xbrl:preferredLabel')
      const preferredType = typeof preferred === 'string' ? preferred : null
      const preferredText =
        preferredType && preferredType !== STANDARD_LABEL ? labelOf(r.target, preferredType) : null
      presAssociations.push({
        parent: r.source,
        child: r.target,
        order: toNumber(r.order) ?? 0,
        role: meta.roleUri,
        structure: n.name,
        preferredLabel: preferredText ? stripRoleSuffix(preferredText) : null,
        preferredLabelRole: preferredType,
      })
    }
  }
  for (const n of networks) {
    if (n.relationshipTypeName !== CALCULATION) continue
    const groupName = groupOf.get(n.name)
    const structure = (groupName && presentationOfGroup.get(groupName)) ?? null
    const roleUri = groupName ? (groups.get(groupName)?.groupURI ?? null) : null
    for (const r of n.relationships ?? []) {
      if (!r.source || !r.target || r.source === ROOT_SOURCE) continue
      calcAssociations.push({
        parent: r.source,
        child: r.target,
        weight: toNumber(propertyValue(r.properties, 'xbrl:weight')) ?? 1,
        order: toNumber(r.order) ?? 0,
        role: roleUri,
        structure,
      })
    }
  }

  // ── Facts ──
  const periods: Record<string, PeriodInfo> = {}
  const out: Fact[] = []
  let registrantName: string | null = null
  for (const f of facts) {
    const dims = f.factDimensions ?? {}
    const element = dims['xbrl:concept']
    const periodLiteral = dims['xbrl:period']
    if (typeof element !== 'string' || typeof periodLiteral !== 'string') continue
    if (!periods[periodLiteral]) periods[periodLiteral] = periodOf(periodLiteral)
    const unit = typeof dims['xbrl:unit'] === 'string' ? (dims['xbrl:unit'] as string) : null
    const entity = typeof dims['xbrl:entity'] === 'string' ? (dims['xbrl:entity'] as string) : null
    const first = f.factValues?.[0]
    const raw = first?.value
    const numeric =
      elements[element]?.numericKind !== undefined || elements[element]?.itemType === 'decimal'
    const value = numeric || typeof raw === 'number' ? toNumber(raw) : null
    const textValue = value === null && raw !== undefined && raw !== null ? String(raw) : null
    if (element === REGISTRANT_NAME && textValue && !registrantName) registrantName = textValue
    const decimalsRaw = first?.decimals
    const decimals =
      typeof decimalsRaw === 'number'
        ? String(decimalsRaw)
        : typeof decimalsRaw === 'string'
          ? decimalsRaw
          : null

    const dimensions: DimensionQualifier[] = []
    for (const [axis, member] of Object.entries(dims)) {
      if (CORE_ASPECTS.has(axis)) continue
      const explicit = explicitAxes.has(axis) && typeof member === 'string' && member.includes(':')
      const memberName = explicit ? (member as string) : null
      const typedValue = explicit
        ? null
        : member === null || member === undefined
          ? null
          : String(member)
      dimensions.push({
        axis,
        member: memberName,
        axisLabel: elements[axis]?.label ?? humanize(axis),
        memberLabel: memberName
          ? (elements[memberName]?.label ?? humanize(memberName))
          : (typedValue ?? ''),
        explicit,
        typedValue,
      })
    }
    const factSets = presentedIn.get(element) ?? []
    out.push({
      id: f.name,
      element,
      period: periodLiteral,
      unit,
      entity,
      factSet: factSets[0] ?? null,
      factSets: factSets.length ? [...factSets] : undefined,
      value,
      textValue,
      contentType: null,
      decimals,
      dimensions: dimensions.length ? dimensions : undefined,
    })
  }

  // ── Entity, report identity ──
  // A filing names its registrant in a dei fact; a model with no dei facts (a
  // ledger's own report) carries the name as a label on the entity object.
  const entityName = model.entities?.[0]?.name ?? null
  const entityLabel = entityName ? labelOf(entityName) : null
  const entity: EntityInfo | null = entityName
    ? {
        id: entityName,
        name: registrantName ?? entityLabel ?? humanize(entityName),
        legalName: registrantName ?? entityLabel,
        country: null,
      }
    : null
  const reportIri = namespaces.rpt ?? null
  const reportId = reportIri
    ? (reportIri.replace(/\/$/, '').split('/').pop() ?? null)
    : (model.name ?? null)

  return {
    reportId,
    reportIri,
    entity,
    informationBlocks,
    structures,
    facts: out,
    elements,
    periods,
    units,
    calcAssociations,
    presAssociations,
  }
}

/** A `ReportAdapter` over an in-memory `tavi.json` document. */
export function taviFileAdapter(doc: string | object, source = 'tavi.json'): ReportAdapter {
  return {
    source,
    load: async () => parseTavi(doc),
  }
}
