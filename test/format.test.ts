import { describe, expect, it } from 'vitest'
import { currencySymbolFor, formatValue } from '../src/format'

describe('formatValue — numeric kinds', () => {
  it('scales a percent fact ×100 and suffixes % (0.10 → 10%)', () => {
    expect(formatValue(0.1, { numericKind: 'percent' })).toBe('10%')
    expect(formatValue(0.1025, { numericKind: 'percent' })).toBe('10.25%')
    // An egregious effective tax rate: −1.069 is −106.9%, not −1.1%.
    expect(formatValue(-1.069, { numericKind: 'percent' })).toBe('(106.9%)')
    expect(formatValue(0.001, { numericKind: 'percent' })).toBe('0.1%')
  })

  it('renders a pure ratio as a plain decimal, never a percentage', () => {
    expect(formatValue(2.5, { numericKind: 'pure' })).toBe('2.5')
    expect(formatValue(0.1, { numericKind: 'pure' })).toBe('0.1')
  })

  it('formats monetary values with the unit symbol and section scale', () => {
    expect(formatValue(1234.5, { numericKind: 'monetary', symbol: '$' })).toBe('$1,234.50')
    // In millions → 0 decimals, no fractional noise.
    expect(
      formatValue(157293000000, { numericKind: 'monetary', symbol: '$', scaleFactor: 1e6 })
    ).toBe('$157,293')
    // Non-USD units keep their own symbol (never a hard-coded $).
    expect(formatValue(1000, { numericKind: 'monetary', symbol: '€' })).toBe('€1,000.00')
    // Negatives in accounting parentheses.
    expect(formatValue(-150, { numericKind: 'monetary', symbol: '$' })).toBe('$(150.00)')
  })

  it('never rescales per-share amounts or share counts', () => {
    expect(formatValue(4.93, { numericKind: 'perShare', symbol: '$', scaleFactor: 1e6 })).toBe(
      '$4.93'
    )
    expect(formatValue(24441000000, { numericKind: 'shares', scaleFactor: 1e6 })).toBe(
      '24,441,000,000'
    )
  })

  it('renders absent values as an em-dash', () => {
    expect(formatValue(null)).toBe('—')
    expect(formatValue(undefined)).toBe('—')
  })
})

describe('currencySymbolFor', () => {
  it('maps ISO-4217 codes to symbols, falling back to the code (never a wrong $)', () => {
    expect(currencySymbolFor('iso4217:USD')).toBe('$')
    expect(currencySymbolFor('iso4217:EUR')).toBe('€')
    expect(currencySymbolFor('iso4217:GBP')).toBe('£')
    expect(currencySymbolFor('iso4217:SEK')).toBe('SEK ')
    expect(currencySymbolFor('xbrli:shares')).toBeNull()
    expect(currencySymbolFor(null)).toBeNull()
  })
})
