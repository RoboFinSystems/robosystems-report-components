import { describe, expect, it } from 'vitest'
import { parseJsonld } from '../src/adapters/jsonld'

// A full-fidelity holon carries no semantic blockType; the adapter must match a
// section to its structure by identity (rs:structure -> structureId) and order
// sections by the filer sequence (rs:structureOrder). Both were previously
// unread, so sections collided on blockType and fell into insertion order.
const RS = 'https://robosystems.ai/vocab/'
const SKOS = 'http://www.w3.org/2004/02/skos/core#'

describe('holon store adapter', () => {
  it('reads InformationBlock.structureId and Structure.order', async () => {
    const doc = {
      '@graph': [
        {
          '@id': 'http://ex/ib1',
          '@type': `${RS}InformationBlock`,
          [`${RS}structure`]: { '@id': 'http://ex/st1' },
          [`${RS}factSet`]: { '@id': 'http://ex/fs1' },
          [`${SKOS}prefLabel`]: 'Balance Sheet',
        },
        {
          '@id': 'http://ex/st1',
          '@type': `${RS}Structure`,
          [`${RS}structureOrder`]: 5,
          [`${RS}structureName`]: 'Balance Sheet',
          [`${RS}factSet`]: { '@id': 'http://ex/fs1' },
        },
      ],
    }
    const model = await parseJsonld(doc)
    const ib = model.informationBlocks.find((b) => b.id === 'http://ex/ib1')
    const st = model.structures.find((s) => s.id === 'http://ex/st1')
    expect(ib?.structureId).toBe('http://ex/st1')
    expect(st?.order).toBe(5)
  })

  it('reads Fact.textValue and Element.itemType (text-block disclosures)', async () => {
    const doc = {
      '@graph': [
        {
          '@id': 'http://ex/f1',
          '@type': `${RS}Fact`,
          [`${RS}element`]: { '@id': 'http://ex/el1' },
          [`${RS}period`]: { '@id': 'http://ex/p1' },
          [`${RS}stringValue`]: '<div>Accounting policy narrative.</div>',
          [`${RS}factType`]: 'nonnumeric',
        },
        {
          '@id': 'http://ex/el1',
          '@type': `${RS}Element`,
          [`${RS}itemType`]: 'textBlock',
          [`${SKOS}prefLabel`]: 'Significant Accounting Policies',
        },
      ],
    }
    const model = await parseJsonld(doc)
    const fact = model.facts.find((f) => f.id === 'http://ex/f1')
    expect(fact?.textValue).toBe('<div>Accounting policy narrative.</div>')
    expect(model.elements['http://ex/el1']?.itemType).toBe('textBlock')
  })
})
