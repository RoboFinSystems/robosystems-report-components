import { describe, expect, it } from 'vitest'
import { checkFactLineage, memberId, sha256Hex } from '../src/lineage'
import type { NormalizedReport } from '../src/model'

// The hash the platform freezes with a figure is SHA-256 over the sorted
// member line ids joined by newlines; the file lists every member, so a reader
// recomputes it without the ledger.

describe('sha256Hex', () => {
  it('matches the published test vectors', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    )
  })

  it('hashes across block boundaries and non-ASCII text', () => {
    expect(sha256Hex('a'.repeat(1000))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3'
    )
    expect(sha256Hex('Driftline — café')).toHaveLength(64)
  })
})

describe('memberId', () => {
  it('is the last path segment of the member IRI', () => {
    expect(memberId('https://robosystems.ai/report/rpt_1/line/li_01ABC')).toBe('li_01ABC')
  })
})

function report(hash: string | null): NormalizedReport {
  return {
    reportId: 'r',
    reportIri: null,
    entity: null,
    informationBlocks: [],
    structures: [],
    facts: [
      {
        id: 'f',
        element: 'e',
        period: 'p',
        unit: null,
        entity: null,
        factSet: null,
        value: 3,
        decimals: null,
        provenance: { kind: 'pivot', source: null, contentHash: hash, attributedTo: null },
        derivedFrom: ['c2', 'c1'],
      },
    ],
    elements: {},
    periods: {},
    units: {},
    calcAssociations: [],
    presAssociations: [],
    lineage: {
      contributions: {
        c1: {
          id: 'c1',
          fact: 'f',
          entity: 'ent',
          account: 'acct',
          amount: 2,
          frozenAt: null,
          windowStart: null,
          windowEnd: null,
          lineCount: 2,
          describedLineCount: 2,
          describedFrom: null,
          priorLineCount: 0,
          priorBalance: null,
          members: ['x/line/li_b', 'x/line/li_a'],
        },
        c2: {
          id: 'c2',
          fact: 'f',
          entity: 'ent',
          account: 'acct2',
          amount: 1,
          frozenAt: null,
          windowStart: null,
          windowEnd: null,
          lineCount: 1,
          describedLineCount: 1,
          describedFrom: null,
          priorLineCount: 0,
          priorBalance: null,
          members: ['x/line/li_c'],
        },
      },
      lines: {},
      entries: {},
      transactions: {},
      events: {},
      agents: {},
      accounts: {},
      entities: {},
    },
  }
}

describe('checkFactLineage', () => {
  const expected = `sha256:${sha256Hex(['li_a', 'li_b', 'li_c'].join('\n'))}`

  it('recomputes the frozen hash from the member ids across every contribution', () => {
    const r = report(expected)
    const check = checkFactLineage(r, r.facts[0]!)
    expect(check).toEqual({ expected, actual: expected, lineCount: 3, ok: true })
  })

  it('says so when the file and the report disagree', () => {
    const r = report('sha256:deadbeef')
    expect(checkFactLineage(r, r.facts[0]!)?.ok).toBe(false)
  })

  it('cannot judge a figure that carries no hash, and reports nothing without lineage', () => {
    const r = report(null)
    expect(checkFactLineage(r, r.facts[0]!)?.ok).toBeNull()
    const plain = { ...r, lineage: undefined }
    expect(checkFactLineage(plain, plain.facts[0]!)).toBeNull()
  })
})
