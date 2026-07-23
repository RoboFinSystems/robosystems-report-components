/**
 * Categorical series palette — the validated eight-hue order (dataviz
 * reference instance). Light-mode hexes are the fallbacks; a host app themes
 * dark mode (and its own brand) by setting the `--rs-chart-series-N` tokens,
 * the same `--rs-*` override pattern the statement components use.
 *
 * The order is the CVD-safety mechanism, not cosmetic: this sequence clears
 * every adjacent gate in both light and dark (worst adjacent CVD ΔE 9.1 light
 * / 8.4 dark; normal-vision ΔE 19.6 / 19.3). Series are assigned by fixed
 * index within a panel, never cycled — metric panels carry at most a handful
 * of series, well inside eight.
 */

/** Light-mode fallbacks (the validated default; host tokens override). */
export const SERIES_COLORS_LIGHT = [
  '#2a78d6', // 1 blue
  '#eb6834', // 2 orange
  '#1baf7a', // 3 aqua
  '#eda100', // 4 yellow
  '#e87ba4', // 5 magenta
  '#008300', // 6 green
  '#4a3aa7', // 7 violet
  '#e34948', // 8 red
] as const

/** Dark-mode steps (same eight hues re-stepped for the dark surface). */
export const SERIES_COLORS_DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
] as const

/**
 * The CSS color reference for series slot `index` (0-based): a `--rs-chart-
 * series-N` token with the validated light hex as its fallback. Slots past
 * eight reuse the last — metric panels never reach that, and a host with more
 * series should fold to "Other" per the categorical rule.
 */
export function seriesColor(index: number): string {
  const slot = Math.min(index, SERIES_COLORS_LIGHT.length - 1)
  return `var(--rs-chart-series-${slot + 1}, ${SERIES_COLORS_LIGHT[slot]})`
}
