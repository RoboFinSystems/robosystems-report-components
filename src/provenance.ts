/**
 * Words for a fact's provenance — the un-entitled projection a published report
 * carries: how the figure was made, who asserted it, and the hash a reader can
 * check the evidence against later. No account, no ledger row.
 */
import type { FactProvenance } from './model'

const KIND_WORDS: Record<string, string> = {
  pivot: "Summed from the ledger's accounts",
  rollup: 'Subtotal of the lines beneath it',
  derived: 'Computed from other figures',
  document: 'Bound to a document',
  asserted: 'Asserted directly',
  authored: 'Authored',
}

/** The origin in words; an unknown kind reads as itself, never as a claim. */
export function provenanceWords(kind: string | null | undefined): string | null {
  if (!kind) return null
  return KIND_WORDS[kind] ?? kind.replace(/[_-]+/g, ' ')
}

/** `sha256:680be1460dd6…` — the algorithm and the first dozen hex digits. */
export function shortHash(hash: string | null | undefined, digits = 12): string | null {
  if (!hash) return null
  const [algo, hex] = hash.includes(':') ? hash.split(/:(.*)/s) : [null, hash]
  const head = (hex ?? '').slice(0, digits)
  const tail = (hex ?? '').length > digits ? '…' : ''
  return algo ? `${algo}:${head}${tail}` : `${head}${tail}`
}

/** `rollup:calculation` → `calculation`; anything else as written. */
export function attributionWords(p: FactProvenance): string | null {
  const a = p.attributedTo
  if (!a) return null
  return a.startsWith('rollup:') ? a.slice('rollup:'.length) : a
}

export function isHttpIri(value: string | null | undefined): value is string {
  return !!value && /^https?:\/\//.test(value)
}
