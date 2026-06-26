/**
 * Pure formatting helpers shared by the projection and the components. No React
 * here, so the projection can depend on it without pulling in a renderer.
 */
import type { PeriodInfo } from './model'

/**
 * Accounting-style money: negatives in parentheses, no sign, an em-dash for
 * absent values. Matches the RoboLedger statement renderer.
 */
export function formatMoney(
  value: number | null | undefined,
  opts: { currencySymbol?: string } = {}
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const symbol = opts.currencySymbol ?? '$'
  const abs = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return value < 0 ? `${symbol}(${abs})` : `${symbol}${abs}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2024-03-31` → `Mar 31, 2024`. Falls back to the raw string if unparseable. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const [, year, month, day] = m
  const idx = Number(month) - 1
  return `${MONTHS[idx] ?? month} ${Number(day)}, ${year}`
}

/** A human description of a period — "As of …" for instants, a span for durations. */
export function formatPeriod(period: PeriodInfo): string {
  if (period.type === 'instant') {
    return `As of ${formatDate(period.instant ?? period.end)}`
  }
  return `${formatDate(period.startDate)} – ${formatDate(period.endDate ?? period.end)}`
}
