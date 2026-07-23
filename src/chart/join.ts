/**
 * Join a chart panel's series to their plottable points.
 *
 * The server ships chart config (series identity) and rendering (values +
 * periods) separately so the value matrix is never duplicated. This resolves
 * each series' `elementId` to its rendering row and zips it against the
 * periods' `end` dates into `{ x, y }` points — the shape the renderer draws.
 * Series whose element has no rendering row (or an unexpected value-length
 * mismatch) are dropped, so a stale chart arm never crashes the plot.
 */
import type { ChartPanel, ChartRendering, ChartSeriesData } from './types'

export function joinChartSeries(panel: ChartPanel, rendering: ChartRendering): ChartSeriesData[] {
  const rowByElement = new Map(rendering.rows.map((r) => [r.elementId, r]))
  const periods = rendering.periods
  const out: ChartSeriesData[] = []
  for (const series of panel.series) {
    const row = rowByElement.get(series.elementId)
    if (!row) continue
    const points = periods.map((p, i) => ({
      x: p.end,
      y: i < row.values.length ? row.values[i] : null,
    }))
    out.push({
      key: series.key,
      label: series.label,
      itemType: panel.itemType,
      points,
    })
  }
  return out
}
