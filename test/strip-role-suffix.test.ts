import { describe, expect, it } from 'vitest'
import { stripRoleSuffix } from '../src/constants'

// `stripRoleSuffix` runs over XBRL standard labels, which arrive from filings
// and graph data rather than from us. Its regex previously opened with `\s*`
// before a `[` that usually fails to match, so on a long run of spaces the
// engine retried from every offset — quadratic, and reachable from input we do
// not control (CodeQL js/polynomial-redos). The `\s*` was also redundant: the
// function trims the result. These tests pin both halves of that fix — the
// behaviour has to stay identical, and the blowup must not come back.
describe('stripRoleSuffix', () => {
  it('strips every bracketed role suffix XBRL uses', () => {
    const roles = [
      'Abstract',
      'Axis',
      'Member',
      'Table',
      'Line Items',
      'Domain',
      'Roll Forward',
      'Roll Up',
      'Text Block',
      'Policy Text Block',
      'Table Text Block',
      'Extensible List',
      'Extensible Enumeration',
      'Flag',
    ]
    for (const role of roles) {
      expect(stripRoleSuffix(`Operating Expenses [${role}]`)).toBe('Operating Expenses')
    }
  })

  it('matches the role tag case-insensitively', () => {
    expect(stripRoleSuffix('Land [member]')).toBe('Land')
    expect(stripRoleSuffix('Land [MEMBER]')).toBe('Land')
  })

  it('trims the whitespace the regex no longer consumes', () => {
    expect(stripRoleSuffix('Land  [Member]')).toBe('Land')
    expect(stripRoleSuffix('Land [Member]   ')).toBe('Land')
    expect(stripRoleSuffix('  Land [Member]  ')).toBe('Land')
    expect(stripRoleSuffix('Land[Member]')).toBe('Land')
  })

  it('keeps the original when stripping would empty the label', () => {
    expect(stripRoleSuffix('[Member]')).toBe('[Member]')
    expect(stripRoleSuffix('   [Member]   ')).toBe('   [Member]   ')
  })

  it('leaves labels without a trailing role tag alone', () => {
    expect(stripRoleSuffix('Assets')).toBe('Assets')
    expect(stripRoleSuffix('Land [Unknown]')).toBe('Land [Unknown]')
    expect(stripRoleSuffix('Land [Member] extra')).toBe('Land [Member] extra')
  })

  it('stays linear on long runs of whitespace', () => {
    // The vulnerable pattern took ~63ms at 10k spaces and ~860ms at 40k,
    // scaling with the square of the input. The fixed one is flat, so a
    // generous ceiling still fails loudly if the `\s*` is ever restored.
    const time = (input: string) => {
      const started = performance.now()
      stripRoleSuffix(input)
      return performance.now() - started
    }
    expect(time(' '.repeat(40_000) + 'x')).toBeLessThan(50)
    expect(time(' '.repeat(200_000) + 'x')).toBeLessThan(50)
  })
})
