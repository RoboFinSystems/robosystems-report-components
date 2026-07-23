/**
 * Value formatting by metric format family — the client half of the M-2
 * `item_type` unit/format system. `monetary` reuses the accounting money
 * style; `percent` values are stored raw (0.0512) and shown ×100; `multiple`
 * carries an `×`; `ratio` is a plain 2-dp decimal; `days` is an integer.
 */
import { formatMoney } from '../format'
import type { MetricItemType } from './types'

const DASH = '—'

/** Full-precision display for tooltips and direct labels. */
export function formatMetricValue(
  itemType: MetricItemType | string | null | undefined,
  value: number | null | undefined
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH
  switch (itemType) {
    case 'monetary':
      return formatMoney(value)
    case 'percent':
      return `${(value * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
    case 'multiple':
      return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`
    case 'days':
      return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
    case 'ratio':
      return value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    default:
      return value.toLocaleString('en-US', { maximumFractionDigits: 4 })
  }
}

/** Compact form for axis ticks — abbreviated money, tighter decimals. */
export function formatMetricCompact(
  itemType: MetricItemType | string | null | undefined,
  value: number | null | undefined
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return ''
  if (itemType === 'monetary') {
    const abs = Math.abs(value)
    const sign = value < 0 ? '-' : ''
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`
    return `${sign}$${abs.toFixed(0)}`
  }
  if (itemType === 'percent') {
    return `${(value * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
  }
  if (itemType === 'multiple') {
    return `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}×`
  }
  if (itemType === 'days') {
    return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
  }
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
