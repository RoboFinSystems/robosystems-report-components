import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TimeSeriesChart } from '../src'
import type { ChartSeriesData } from '../src/chart'

const RATIOS: ChartSeriesData[] = [
  {
    key: 'el_cr',
    label: 'Current Ratio',
    itemType: 'ratio',
    points: [
      { x: '2025-04-30', y: 3.16 },
      { x: '2025-05-31', y: 3.27 },
      { x: '2025-06-30', y: 5.59 },
    ],
  },
  {
    key: 'el_qr',
    label: 'Quick Ratio',
    itemType: 'ratio',
    points: [
      { x: '2025-04-30', y: 2.7 },
      { x: '2025-05-31', y: 2.8 },
      { x: '2025-06-30', y: 3.74 },
    ],
  },
]

describe('TimeSeriesChart — renders an SVG line panel', () => {
  it('draws a legend for two-plus series and one path per series', () => {
    const { container } = render(<TimeSeriesChart series={RATIOS} title="Ratios" />)
    expect(screen.getByText('Ratios')).toBeTruthy()
    // Legend names both series (identity is never color-alone).
    expect(screen.getByText('Current Ratio')).toBeTruthy()
    expect(screen.getByText('Quick Ratio')).toBeTruthy()
    // One line path per series.
    const paths = container.querySelectorAll('path[stroke]')
    expect(paths.length).toBe(2)
    // The svg carries an accessible label.
    const svg = container.querySelector('svg[role="img"]')
    expect(svg?.getAttribute('aria-label')).toContain('2 metrics')
  })

  it('places selective end labels formatted by family', () => {
    render(<TimeSeriesChart series={RATIOS} title="Ratios" />)
    // Final Current Ratio value labelled at the line end, ratio-formatted.
    expect(screen.getByText('5.59')).toBeTruthy()
    expect(screen.getByText('3.74')).toBeTruthy()
  })

  it('omits the legend for a single series', () => {
    const [only] = RATIOS
    const { container } = render(<TimeSeriesChart series={[only]} />)
    const paths = container.querySelectorAll('path[stroke]')
    expect(paths.length).toBe(1)
    // No legend list entries — only the direct end label remains.
    expect(screen.queryByText('Quick Ratio')).toBeNull()
  })

  it('renders an empty state when every point is null', () => {
    const empty: ChartSeriesData[] = [
      { key: 'x', label: 'X', itemType: 'ratio', points: [{ x: '2025-04-30', y: null }] },
    ]
    render(<TimeSeriesChart series={empty} title="Empty" />)
    expect(screen.getByText(/No data to plot/)).toBeTruthy()
  })
})
