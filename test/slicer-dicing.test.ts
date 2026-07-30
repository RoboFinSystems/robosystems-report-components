import { describe, expect, it } from 'vitest'
import type { Fact, NormalizedReport } from '../src/model'
import { buildPivot, buildPivots, defaultPivotConfig, pivotDimensionsOn } from '../src/pivot'

// The NVIDIA "Reportable Segments (Details)" shape: every segment fact carries
// TWO axes — the segment axis (a real breakdown) and Consolidation Items diced
// to a single member (`Operating Segments`), which the default config makes a
// slicer. Facts carrying the slicer axis must still bind to cells, and at a
// shared coordinate the slicer-matching total (95) must win over the
// consolidated face-statement fact (90) that shares the factset — the slicer
// chip says `Operating Segments`, so the cells must show that coordinate.
const ABS = 'us-gaap:SegmentReportingAbstract'
const REV = 'us-gaap:Revenues'
const OI = 'us-gaap:OperatingIncomeLoss'
const CI_AXIS = 'srt:ConsolidationItemsAxis'
const SBS_AXIS = 'us-gaap:StatementBusinessSegmentsAxis'
const OS = 'us-gaap:OperatingSegmentsMember'
const ELIM = 'us-gaap:IntersegmentEliminationMember'
const CN = 'co:ComputeMember'
const GR = 'co:GraphicsMember'

const ciOS = {
  axis: CI_AXIS,
  member: OS,
  axisLabel: 'Consolidation Items',
  memberLabel: 'Operating Segments',
  explicit: true,
}
const seg = (member: string, memberLabel: string) => ({
  axis: SBS_AXIS,
  member,
  axisLabel: 'Segments',
  memberLabel,
  explicit: true,
})

const fact = (
  id: string,
  element: string,
  value: number,
  dimensions?: Fact['dimensions']
): Fact => ({
  id,
  element,
  period: 'p',
  unit: 'u',
  entity: 'e',
  factSet: 'fs',
  value,
  decimals: '-6',
  ...(dimensions ? { dimensions } : {}),
})

const concept = (id: string, label: string) => ({
  id,
  qname: id,
  label,
  balance: 'credit' as const,
  periodType: 'duration' as const,
  abstract: false,
  monetary: true,
  numericKind: 'monetary' as const,
})

const structural = (id: string, label: string) => ({
  id,
  qname: id,
  label,
  balance: null,
  periodType: null,
  abstract: true,
  monetary: false,
})

function report(extraFacts: Fact[] = []): NormalizedReport {
  return {
    reportId: 'r',
    reportIri: null,
    entity: { id: 'e', name: 'Co', legalName: null, country: null },
    informationBlocks: [
      { id: 's', blockType: '', factSet: 'fs', label: 'Segments', structureId: 's' },
    ],
    structures: [{ id: 's', blockType: '', roleUri: null, structureName: 'Segments', order: 0 }],
    facts: [
      fact('rev-consolidated', REV, 100),
      fact('rev-os', REV, 100, [ciOS]),
      fact('rev-cn', REV, 60, [ciOS, seg(CN, 'Compute')]),
      fact('rev-gr', REV, 40, [ciOS, seg(GR, 'Graphics')]),
      fact('oi-consolidated', OI, 90),
      fact('oi-os', OI, 95, [ciOS]),
      fact('oi-cn', OI, 70, [ciOS, seg(CN, 'Compute')]),
      fact('oi-gr', OI, 25, [ciOS, seg(GR, 'Graphics')]),
      ...extraFacts,
    ],
    elements: {
      [ABS]: structural(ABS, 'Segment Reporting'),
      [REV]: concept(REV, 'Revenues'),
      [OI]: concept(OI, 'Operating Income'),
      [CI_AXIS]: structural(CI_AXIS, 'Consolidation Items'),
      [SBS_AXIS]: structural(SBS_AXIS, 'Segments'),
      [OS]: structural(OS, 'Operating Segments'),
      [CN]: structural(CN, 'Compute'),
      [GR]: structural(GR, 'Graphics'),
    },
    periods: {
      p: {
        id: 'p',
        type: 'duration',
        instant: null,
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        end: '2025-12-31',
      },
    },
    units: { u: { id: 'u', measure: 'iso4217:USD', label: 'USD', symbol: '$' } },
    calcAssociations: [],
    presAssociations: [
      { parent: ABS, child: REV, order: 1, role: null, structure: 's' },
      { parent: ABS, child: OI, order: 2, role: null, structure: 's' },
      { parent: ABS, child: CI_AXIS, order: 3, role: null, structure: 's' },
      { parent: CI_AXIS, child: OS, order: 1, role: null, structure: 's' },
      { parent: ABS, child: SBS_AXIS, order: 4, role: null, structure: 's' },
      { parent: SBS_AXIS, child: CN, order: 1, role: null, structure: 's' },
      { parent: SBS_AXIS, child: GR, order: 2, role: null, structure: 's' },
    ],
  }
}

describe('slicer-axis facts bind to cells', () => {
  it('dices the single-member axis to a slicer and keeps the segment axis on rows', () => {
    const model = report()
    const cfg = defaultPivotConfig(model, model.informationBlocks[0])
    expect(cfg.rows).toEqual(['concept', `dim:${SBS_AXIS}`])
    expect(cfg.slicers).toContain(`dim:${CI_AXIS}`)
  })

  it('populates member rows from facts that also carry the slicer axis', () => {
    const table = buildPivots(report())[0]
    const members = table.rows.filter((r) => r.element.id === OI && r.members.length === 1)
    expect(members.map((r) => [r.members[0].memberLabel, r.cells[0]?.value])).toEqual([
      ['Compute', 70],
      ['Graphics', 25],
    ])
  })

  it('gives the aggregate cell to the fact at the diced coordinate, not the consolidated one', () => {
    const table = buildPivots(report())[0]
    const total = table.rows.find((r) => r.element.id === OI && r.members.length === 0)
    expect(total?.cells[0]?.value).toBe(95)
    expect(total?.cells[0]?.fact?.id).toBe('oi-os')
  })

  it('labels the slicer chip with the coordinate the cells actually show', () => {
    const table = buildPivots(report())[0]
    const chip = table.slicers.find((s) => s.aspect === `dim:${CI_AXIS}`)
    expect(chip?.valueLabel).toBe('Operating Segments')
  })

  it('renders the member matrix with dimensions on columns', () => {
    const model = report()
    const ib = model.informationBlocks[0]
    const cfg = pivotDimensionsOn(defaultPivotConfig(model, ib), 'columns')
    const table = buildPivot(model, ib, cfg)
    expect(table.columns.map((c) => c.label)).toEqual(['Compute', 'Graphics', 'Total'])
    const oi = table.rows.find((r) => r.element.id === OI)
    expect(oi?.cells.map((c) => c.value)).toEqual([70, 25, 95])
  })

  it('drops facts at a different coordinate of the slicer axis', () => {
    const model = report([
      fact('oi-elim', OI, -5, [
        {
          axis: CI_AXIS,
          member: ELIM,
          axisLabel: 'Consolidation Items',
          memberLabel: 'Eliminations',
          explicit: true,
        },
      ]),
    ])
    const ib = model.informationBlocks[0]
    // Force the axis to stay a slicer (two members would promote it otherwise).
    const table = buildPivot(model, ib, {
      rows: ['concept'],
      columns: ['period'],
      slicers: ['entity', `dim:${CI_AXIS}`],
      scale: 'auto',
      showAbstracts: true,
      dropSparsePeriods: true,
    })
    const values = table.rows.flatMap((r) => r.cells.map((c) => c.value))
    expect(values).not.toContain(-5)
    const oi = table.rows.find((r) => r.element.id === OI)
    expect(oi?.cells[0]?.value).toBe(95)
  })
})
