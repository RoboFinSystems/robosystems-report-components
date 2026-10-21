import { describe, expect, it } from 'vitest'
import { parseJsonld } from '../src/adapters/jsonld'
import { attributionWords, provenanceWords, shortHash } from '../src/provenance'

const RS = 'https://robosystems.ai/vocab/'
const PROV = 'http://www.w3.org/ns/prov#'
const RSGAAP = 'https://robosystems.ai/taxonomy/rs-gaap/v1/'
const XBRLI = 'http://www.xbrl.org/2003/instance#'

const HASH = 'sha256:680be1460dd6a1c2b3d4e5f60718293a4b5c6d7e8f9012345678901234567890'

describe('a holon fact that says how it was made', () => {
  it('carries the un-entitled projection, and a plain fact carries nothing', async () => {
    const report = await parseJsonld({
      '@graph': [
        {
          '@id': 'http://ex/p1',
          '@type': `${RS}Period`,
          [`${XBRLI}instant`]: '2026-08-31',
          [`${XBRLI}periodType`]: 'instant',
        },
        {
          '@id': 'http://ex/f1',
          '@type': `${RS}Fact`,
          [`${RS}element`]: { '@id': `${RSGAAP}CashAndCashEquivalentsAtCarryingValue` },
          [`${RS}period`]: { '@id': 'http://ex/p1' },
          [`${RS}numericValue`]: '97152.59',
          [`${RS}sourceKind`]: 'pivot',
          [`${RS}contentHash`]: HASH,
          [`${PROV}wasAttributedTo`]: 'posted ledger',
        },
        {
          '@id': 'http://ex/f2',
          '@type': `${RS}Fact`,
          [`${RS}element`]: { '@id': `${RSGAAP}AssetsCurrent` },
          [`${RS}period`]: { '@id': 'http://ex/p1' },
          [`${RS}numericValue`]: '241157.64',
          [`${RS}sourceKind`]: 'rollup',
          [`${PROV}wasAttributedTo`]: 'rollup:calculation',
        },
        {
          '@id': 'http://ex/f3',
          '@type': `${RS}Fact`,
          [`${RS}element`]: { '@id': `${RSGAAP}Revenues` },
          [`${RS}period`]: { '@id': 'http://ex/p1' },
          [`${RS}numericValue`]: '1',
        },
      ],
    })
    const byId = Object.fromEntries(report.facts.map((f) => [f.id, f]))
    expect(byId['http://ex/f1'].provenance).toEqual({
      kind: 'pivot',
      source: null,
      contentHash: HASH,
      attributedTo: 'posted ledger',
    })
    expect(byId['http://ex/f2'].provenance).toMatchObject({ kind: 'rollup', contentHash: null })
    // A filing's fact has no provenance key at all — absence, not a null claim.
    expect('provenance' in byId['http://ex/f3']).toBe(false)
  })

  it('reads a source IRI as the IRI', async () => {
    const report = await parseJsonld({
      '@graph': [
        {
          '@id': 'http://ex/f1',
          '@type': `${RS}Fact`,
          [`${RS}element`]: { '@id': `${RSGAAP}Revenues` },
          [`${RS}numericValue`]: '1',
          [`${PROV}hadPrimarySource`]: { '@id': 'https://ex/evidence/tb-line-1' },
        },
      ],
    })
    expect(report.facts[0].provenance?.source).toBe('https://ex/evidence/tb-line-1')
  })
})

describe('the words', () => {
  it('say how a figure was made, and never invent a claim for an unknown kind', () => {
    expect(provenanceWords('pivot')).toBe("Summed from the ledger's accounts")
    expect(provenanceWords('rollup')).toBe('Subtotal of the lines beneath it')
    expect(provenanceWords('derived')).toBe('Computed from other figures')
    expect(provenanceWords('trial_balance_line')).toBe('trial balance line')
    expect(provenanceWords(null)).toBeNull()
  })
  it('shorten a hash and keep its algorithm', () => {
    expect(shortHash(HASH)).toBe('sha256:680be1460dd6…')
    expect(shortHash('abcdef')).toBe('abcdef')
    expect(shortHash(null)).toBeNull()
  })
  it('drop the rollup prefix from an attribution', () => {
    expect(
      attributionWords({
        kind: 'rollup',
        source: null,
        contentHash: null,
        attributedTo: 'rollup:calculation',
      })
    ).toBe('calculation')
    expect(
      attributionWords({
        kind: 'pivot',
        source: null,
        contentHash: null,
        attributedTo: 'posted ledger',
      })
    ).toBe('posted ledger')
  })
})
