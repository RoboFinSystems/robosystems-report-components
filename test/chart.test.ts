import { describe, expect, it } from 'vitest'
import type { ChartPanel, ChartRendering } from '../src/chart'
import { formatMetricCompact, formatMetricValue, joinChartSeries, seriesColor } from '../src/chart'

describe('formatMetricValue — by metric family', () => {
  it('formats monetary accounting-style with the money symbol', () => {
    expect(formatMetricValue('monetary', 238499.83)).toBe('$238,499.83')
    expect(formatMetricValue('monetary', -1500)).toBe('$(1,500.00)')
  })
  it('scales percent ×100 with a % suffix (raw fraction stored)', () => {
    expect(formatMetricValue('percent', 0.0512)).toBe('5.12%')
  })
  it('suffixes multiples with ×', () => {
    expect(formatMetricValue('multiple', 1.5)).toBe('1.50×')
  })
  it('renders ratios to two decimals and days as integers', () => {
    expect(formatMetricValue('ratio', 5.586)).toBe('5.59')
    expect(formatMetricValue('days', 31.4)).toBe('31')
  })
  it('returns an em-dash for null/NaN', () => {
    expect(formatMetricValue('ratio', null)).toBe('—')
    expect(formatMetricValue('monetary', undefined)).toBe('—')
  })
})

describe('formatMetricCompact — axis ticks', () => {
  it('abbreviates money magnitudes', () => {
    expect(formatMetricCompact('monetary', 1_500)).toBe('$1.5K')
    expect(formatMetricCompact('monetary', 2_400_000)).toBe('$2.4M')
    expect(formatMetricCompact('monetary', 3_100_000_000)).toBe('$3.1B')
  })
  it('keeps percent and multiple compact', () => {
    expect(formatMetricCompact('percent', 0.05)).toBe('5%')
    expect(formatMetricCompact('multiple', 1.5)).toBe('1.5×')
  })
  it('is empty for null', () => {
    expect(formatMetricCompact('ratio', null)).toBe('')
  })
})

describe('seriesColor — themeable token with validated fallback', () => {
  it('maps slots to --rs-chart-series-N tokens', () => {
    expect(seriesColor(0)).toBe('var(--rs-chart-series-1, #2a78d6)')
    expect(seriesColor(2)).toBe('var(--rs-chart-series-3, #1baf7a)')
  })
  it('clamps out-of-range slots to the last (never cycles)', () => {
    expect(seriesColor(20)).toBe('var(--rs-chart-series-8, #e34948)')
  })
})

describe('joinChartSeries — panel series → plottable points', () => {
  const rendering: ChartRendering = {
    rows: [
      { elementId: 'el_cr', values: [3.16, 3.27, null] },
      { elementId: 'el_qr', values: [2.7, 2.8, 2.9] },
    ],
    periods: [{ end: '2025-04-30' }, { end: '2025-05-31' }, { end: '2025-06-30' }],
  }

  it('zips each series value against the period ends', () => {
    const panel: ChartPanel = {
      itemType: 'ratio',
      series: [
        { key: 'el_cr', elementId: 'el_cr', label: 'Current Ratio' },
        { key: 'el_qr', elementId: 'el_qr', label: 'Quick Ratio' },
      ],
    }
    const data = joinChartSeries(panel, rendering)
    expect(data.map((d) => d.label)).toEqual(['Current Ratio', 'Quick Ratio'])
    expect(data[0].itemType).toBe('ratio')
    expect(data[0].points).toEqual([
      { x: '2025-04-30', y: 3.16 },
      { x: '2025-05-31', y: 3.27 },
      { x: '2025-06-30', y: null },
    ])
  })

  it('drops series whose element has no rendering row', () => {
    const panel: ChartPanel = {
      itemType: 'ratio',
      series: [{ key: 'ghost', elementId: 'el_missing', label: 'Ghost' }],
    }
    expect(joinChartSeries(panel, rendering)).toEqual([])
  })

  it('pads shorter value rows with null against the period list', () => {
    const short: ChartRendering = {
      rows: [{ elementId: 'el_cr', values: [3.16] }],
      periods: rendering.periods,
    }
    const panel: ChartPanel = {
      series: [{ key: 'el_cr', elementId: 'el_cr', label: 'Current Ratio' }],
    }
    const [data] = joinChartSeries(panel, short)
    expect(data.points.map((p) => p.y)).toEqual([3.16, null, null])
  })
})
