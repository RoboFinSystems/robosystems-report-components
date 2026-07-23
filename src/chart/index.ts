/**
 * Chart projection — the client half of the server's `view.chart` arm.
 *
 * `joinChartSeries` resolves a panel's series to plottable points against the
 * rendering; `formatMetricValue` / `formatMetricCompact` format by metric
 * format family; `seriesColor` maps a slot to its themeable token. The
 * `TimeSeriesChart` component (exported from the package root) draws one panel.
 */
export { formatMetricCompact, formatMetricValue } from './format'
export { joinChartSeries } from './join'
export { SERIES_COLORS_DARK, SERIES_COLORS_LIGHT, seriesColor } from './palette'
export type {
  ChartPanel,
  ChartPeriod,
  ChartProjection,
  ChartRendering,
  ChartRenderingRow,
  ChartSeries,
  ChartSeriesData,
  MetricItemType,
} from './types'
