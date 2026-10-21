/**
 * Reading a figure's lineage: the contributions it was derived from, the
 * evidence hash recomputed from their members, and words for the ledger's own
 * vocabulary. Pure functions over the normalized model; no store, no DOM.
 */
import type { Fact, Lineage, LineageContribution, LineageLine, NormalizedReport } from './model'

/** The last path segment of a member IRI — the ledger's own id for the row. */
export function memberId(iri: string): string {
  return iri.slice(iri.lastIndexOf('/') + 1)
}

/** The contributions a fact was derived from, in the file's order; empty when
 * the report carries no lineage or the figure was not pivoted from the ledger. */
export function contributionsOf(report: NormalizedReport, fact: Fact): LineageContribution[] {
  const lineage = report.lineage
  if (!lineage || !fact.derivedFrom?.length) return []
  const out: LineageContribution[] = []
  for (const id of fact.derivedFrom) {
    const c = lineage.contributions[id]
    if (c) out.push(c)
  }
  return out
}

/** The described lines of a contribution, in posting order (date, then the
 * line's order within its entry). Members outside the described span have no
 * node and are not returned; `contribution.priorLineCount` says how many. */
export function describedLines(lineage: Lineage, contribution: LineageContribution): LineageLine[] {
  const lines: LineageLine[] = []
  for (const member of contribution.members) {
    const line = lineage.lines[member]
    if (line) lines.push(line)
  }
  const dateOf = (line: LineageLine): string => lineage.entries[line.entry]?.postingDate ?? ''
  return lines.sort(
    (a, b) =>
      dateOf(a).localeCompare(dateOf(b)) ||
      a.entry.localeCompare(b.entry) ||
      (a.lineOrder ?? 0) - (b.lineOrder ?? 0) ||
      a.id.localeCompare(b.id)
  )
}

export interface LineageCheck {
  /** The hash the report froze with the figure, when it carries one. */
  expected: string | null
  /** The hash recomputed from the contributions' member ids. */
  actual: string
  /** How many member lines the hash covers. */
  lineCount: number
  /** `true` when they agree, `false` when they differ, `null` when the figure carries no hash. */
  ok: boolean | null
}

/**
 * Recompute a figure's evidence hash the way the platform froze it: SHA-256
 * over the sorted member ids of every contribution, joined by newlines. The
 * members are complete even when their description is bounded, so this works
 * on any file that carries the lineage.
 */
export function checkFactLineage(report: NormalizedReport, fact: Fact): LineageCheck | null {
  const contributions = contributionsOf(report, fact)
  if (!contributions.length) return null
  const ids = contributions.flatMap((c) => c.members.map(memberId)).sort()
  const actual = `sha256:${sha256Hex(ids.join('\n'))}`
  const expected = fact.provenance?.contentHash ?? null
  return { expected, actual, lineCount: ids.length, ok: expected ? expected === actual : null }
}

const ADJUSTMENT_WORDS: Record<string, string> = {
  elimination_intercompany: 'Intercompany elimination',
  elimination_investment: 'Investment elimination',
  equity_method_pickup: 'Equity-method pickup',
  nci_allocation: 'Noncontrolling interest',
}

/** A consolidating entry's kind in words. */
export function adjustmentWords(kind: string | null | undefined): string | null {
  if (!kind) return null
  return ADJUSTMENT_WORDS[kind] ?? kind.replace(/[_-]+/g, ' ')
}

const RECORDED_BY_WORDS: Record<string, string> = {
  manual_entry: 'Manual entry',
  source_sync: 'Synced from the source',
  schedule_derived: 'Schedule',
  system_computed: 'Computed',
  event_handler: 'Event handler',
  ai_generated: 'AI draft',
}

/** How an entry was recorded, in words. */
export function recordedByWords(value: string | null | undefined): string | null {
  if (!value) return null
  return RECORDED_BY_WORDS[value] ?? value.replace(/[_-]+/g, ' ')
}

/** `invoice_issued` → `invoice issued`. */
export function eventWords(type: string | null | undefined): string | null {
  if (!type) return null
  return type.replace(/[_-]+/g, ' ')
}

// ── SHA-256, dependency-free ───────────────────────────────────────────────
//
// WebCrypto's digest is asynchronous and absent from some test DOMs; the hash
// here covers a few thousand short ids at most, so a plain implementation is
// both simpler to call and deterministic everywhere the component renders.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** SHA-256 of a UTF-8 string, as lowercase hex. */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const bitLength = bytes.length * 8
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000))
  view.setUint32(padded.length - 4, bitLength >>> 0)

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n))

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] ?? 0
      const w2 = w[i - 2] ?? 0
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = [
      h[0] ?? 0,
      h[1] ?? 0,
      h[2] ?? 0,
      h[3] ?? 0,
      h[4] ?? 0,
      h[5] ?? 0,
      h[6] ?? 0,
      h[7] ?? 0,
    ]
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] = ((h[0] ?? 0) + a) >>> 0
    h[1] = ((h[1] ?? 0) + b) >>> 0
    h[2] = ((h[2] ?? 0) + c) >>> 0
    h[3] = ((h[3] ?? 0) + d) >>> 0
    h[4] = ((h[4] ?? 0) + e) >>> 0
    h[5] = ((h[5] ?? 0) + f) >>> 0
    h[6] = ((h[6] ?? 0) + g) >>> 0
    h[7] = ((h[7] ?? 0) + hh) >>> 0
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('')
}
