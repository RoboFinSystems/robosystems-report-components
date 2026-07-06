/**
 * Pure formatting helpers shared by the projection and the components. No React
 * here, so the projection can depend on it without pulling in a renderer.
 */
import type { ElementInfo, NumericKind, PeriodInfo } from './model'

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

/** The effective numeric kind of an element (explicit, else derived from monetary). */
export function numericKindOf(el: ElementInfo): NumericKind {
  return el.numericKind ?? (el.monetary ? 'monetary' : 'other')
}

/** Common currency symbols by ISO-4217 code; null for a non-currency unit. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  CHF: 'CHF ',
  CAD: 'CA$',
  AUD: 'A$',
  HKD: 'HK$',
  INR: '₹',
  KRW: '₩',
}

/**
 * A display prefix for a monetary unit measure (`iso4217:USD` → `$`), else null.
 * Unknown currencies fall back to their code (`CHF `, `SEK `) rather than a wrong
 * dollar sign — this is what fixes non-USD facts rendering as `$`.
 */
export function currencySymbolFor(measure: string | null | undefined): string | null {
  if (!measure) return null
  const code = (measure.includes(':') ? measure.split(':').pop()! : measure).toUpperCase()
  if (CURRENCY_SYMBOLS[code]) return CURRENCY_SYMBOLS[code]
  // A currency-shaped code (3 letters) we don't have a glyph for → code prefix.
  return /^[A-Z]{3}$/.test(code) ? `${code} ` : null
}

export interface ValueFormat {
  /** Drives symbol, scaling opt-out, and decimal places. Defaults to `monetary`. */
  numericKind?: NumericKind
  /** Currency symbol for monetary/per-share values (from the fact's unit). */
  symbol?: string | null
  /** Divide monetary values by this (e.g. 1e6 to show millions); default 1. */
  scaleFactor?: number
}

/**
 * Format a fact value for display: accounting style (negatives in parentheses,
 * em-dash for absent), the fact's own currency symbol (never a hard-coded `$`),
 * and the section scale — with per-share amounts and share counts never rescaled
 * (an EPS of 4.93 stays 4.93 under "in millions").
 */
export function formatValue(value: number | null | undefined, fmt: ValueFormat = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const kind = fmt.numericKind ?? 'monetary'
  const scale = kind === 'monetary' ? (fmt.scaleFactor ?? 1) : 1
  const scaled = value / scale
  const fracDigits =
    kind === 'perShare' ? 2 : kind === 'monetary' ? (scale > 1 ? 0 : 2) : kind === 'percent' ? 1 : 0
  const abs = Math.abs(scaled).toLocaleString('en-US', {
    minimumFractionDigits: fracDigits,
    maximumFractionDigits: fracDigits,
  })
  const symbol = kind === 'monetary' || kind === 'perShare' ? (fmt.symbol ?? '') : ''
  const suffix = kind === 'percent' ? '%' : ''
  const body = `${symbol}${abs}${suffix}`
  return scaled < 0 ? `${symbol}(${abs}${suffix})` : body
}
