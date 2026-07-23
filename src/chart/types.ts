/**
 * Input types for the chart View projection — the client-side mirror of the
 * server's `ChartLite` arm plus the slice of the rendering it joins against.
 *
 * The server ships chart CONFIG only (panels, series identity, format
 * families); the plottable values live in the sibling rendering rows and the
 * x-axis in the rendering periods, joined here by `elementId`. Keeping these
 * as plain structural types (not the generated SDK envelope) keeps
 * report-components source-agnostic — any caller that can shape a
 * `ChartProjection` + `ChartRendering` can render a chart.
 */

/** The value-domain format family a panel's series share. */
export type MetricItemType = 'monetary' | 'ratio' | 'percent' | 'multiple' | 'days'

/** One plottable series — identity only; values join `ChartRendering.rows`. */
export interface ChartSeries {
  /** Stable series id (equals `elementId` today) — drives color + client state. */
  key: string
  elementId: string
  /** Display name for legend, direct labels, and tooltip rows. */
  label: string
}

/** One chart panel — series sharing a y-axis format family. */
export interface ChartPanel {
  /** Panel heading (e.g. "Ratios"); null for the untyped fallback panel. */
  label?: string | null
  /** Shared format family; null → plain-number formatting. */
  itemType?: MetricItemType | string | null
  /** Per-panel mark — 'line' or 'bar' (only 'line' rendered today). */
  kind?: string
  series: ChartSeries[]
}

/** The chart arm: a list of format-family panels. */
export interface ChartProjection {
  panels: ChartPanel[]
}

/** One rendering row — the value carrier a series joins to by `elementId`. */
export interface ChartRenderingRow {
  elementId: string
  /** One entry per period column, aligned to `ChartRendering.periods`. */
  values: (number | null)[]
}

/** One period column — the x-axis position. `end` is an ISO date string. */
export interface ChartPeriod {
  start?: string
  end: string
  label?: string | null
}

/** The rendering slice a chart joins against — rows + periods. */
export interface ChartRendering {
  rows: ChartRenderingRow[]
  periods: ChartPeriod[]
}

/** A series resolved to plottable points — the output of `joinChartSeries`. */
export interface ChartSeriesData {
  key: string
  label: string
  /** Format family inherited from the panel (drives value formatting). */
  itemType?: MetricItemType | string | null
  /** One point per period — `y` is null where that period lacks the metric. */
  points: { x: string; y: number | null }[]
}
