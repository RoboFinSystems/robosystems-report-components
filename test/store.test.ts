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

  it('reads Fact.contentType (markdown narratives declare text/markdown)', async () => {
    const doc = {
      '@graph': [
        {
          '@id': 'http://ex/f1',
          '@type': `${RS}Fact`,
          [`${RS}element`]: { '@id': 'http://ex/el1' },
          [`${RS}period`]: { '@id': 'http://ex/p1' },
          [`${RS}stringValue`]: '# Inventory Policy\n\nFIFO, lower of cost or NRV.',
          [`${RS}contentType`]: 'text/markdown',
          [`${RS}factType`]: 'nonnumeric',
        },
      ],
    }
    const model = await parseJsonld(doc)
    const fact = model.facts.find((f) => f.id === 'http://ex/f1')
    expect(fact?.contentType).toBe('text/markdown')

    // Undeclared content type stays null → treated as HTML downstream
    // (the SEC pipeline's text blocks carry HTML and no rs:contentType).
    const htmlDoc = {
      '@graph': [
        {
          '@id': 'http://ex/f2',
          '@type': `${RS}Fact`,
          [`${RS}element`]: { '@id': 'http://ex/el1' },
          [`${RS}period`]: { '@id': 'http://ex/p1' },
          [`${RS}stringValue`]: '<div>HTML narrative.</div>',
        },
      ],
    }
    const htmlModel = await parseJsonld(htmlDoc)
    expect(htmlModel.facts[0].contentType ?? null).toBeNull()
  })

  it('reads Fact.dimensions from rs:dimension (with axis/member labels)', async () => {
    const doc = {
      '@graph': [
        {
          '@id': 'http://ex/fd',
          '@type': `${RS}Fact`,
          [`${RS}element`]: { '@id': 'http://ex/rev' },
          [`${RS}period`]: { '@id': 'http://ex/p' },
          [`${RS}numericValue`]: 60,
          [`${RS}dimension`]: { '@id': 'http://ex/d1' },
        },
        {
          '@id': 'http://ex/d1',
          '@type': `${RS}Dimension`,
          [`${RS}axis`]: { '@id': 'http://ex/axis' },
          [`${RS}member`]: { '@id': 'http://ex/mem' },
          [`${RS}isExplicit`]: true,
        },
        { '@id': 'http://ex/axis', '@type': `${RS}Element`, [`${SKOS}prefLabel`]: 'Segments' },
        { '@id': 'http://ex/mem', '@type': `${RS}Element`, [`${SKOS}prefLabel`]: 'Product' },
      ],
    }
    const model = await parseJsonld(doc)
    const fact = model.facts.find((f) => f.id === 'http://ex/fd')
    expect(fact?.dimensions).toHaveLength(1)
    expect(fact?.dimensions?.[0]).toMatchObject({
      axis: 'http://ex/axis',
      member: 'http://ex/mem',
      axisLabel: 'Segments',
      memberLabel: 'Product',
      explicit: true,
    })
  })

  it('derives ElementInfo.numericKind from itemType (per-share opts out of scaling)', async () => {
    const doc = {
      '@graph': [
        { '@id': 'http://ex/eps', '@type': `${RS}Element`, [`${RS}itemType`]: 'perShare' },
        { '@id': 'http://ex/rev', '@type': `${RS}Element`, [`${RS}itemType`]: 'monetary' },
        { '@id': 'http://ex/dec', '@type': `${RS}Element`, [`${RS}itemType`]: 'decimal' },
      ],
    }
    const model = await parseJsonld(doc)
    expect(model.elements['http://ex/eps']?.numericKind).toBe('perShare')
    expect(model.elements['http://ex/rev']?.numericKind).toBe('monetary')
    expect(model.elements['http://ex/dec']?.numericKind).toBeUndefined()
  })

  it('reads ALL of a fact’s factSets, not just the first', async () => {
    // A summary concept (Total Assets) presented in several structures carries
    // multiple rs:factSet triples. Reading only the first orphaned it from every
    // section but one.
    const doc = {
      '@graph': [
        {
          '@id': 'http://ex/f-assets',
          '@type': `${RS}Fact`,
          [`${RS}element`]: { '@id': 'http://ex/Assets' },
          [`${RS}period`]: { '@id': 'http://ex/p' },
          [`${RS}numericValue`]: 900,
          [`${RS}factSet`]: [{ '@id': 'http://ex/fsNotes' }, { '@id': 'http://ex/fsBS' }],
        },
      ],
    }
    const model = await parseJsonld(doc)
    const fact = model.facts.find((f) => f.id === 'http://ex/f-assets')
    expect(fact?.factSets).toEqual(expect.arrayContaining(['http://ex/fsNotes', 'http://ex/fsBS']))
    expect(fact?.factSets).toHaveLength(2)
  })

  it('strips the XBRL role tag from element and dimension labels', async () => {
    // A holon's prefLabel is the filing's standard label, which tags structural
    // concepts with their role — `[Abstract]`, `[Table]`, `[Line Items]`,
    // `[Roll Forward]`, `[Member]`. These are metadata, not display names.
    const doc = {
      '@graph': [
        {
          '@id': 'http://ex/hdr',
          '@type': `${RS}Element`,
          [`${SKOS}prefLabel`]: "Statement of Stockholders' Equity [Abstract]",
        },
        {
          '@id': 'http://ex/tbl',
          '@type': `${RS}Element`,
          [`${SKOS}prefLabel`]: 'Statement [Table]',
        },
        {
          '@id': 'http://ex/li',
          '@type': `${RS}Element`,
          [`${SKOS}prefLabel`]: 'Statement [Line Items]',
        },
        {
          '@id': 'http://ex/rf',
          '@type': `${RS}Element`,
          [`${SKOS}prefLabel`]: 'Increase (Decrease) in Stockholders’ Equity [Roll Forward]',
        },
        {
          '@id': 'http://ex/fd',
          '@type': `${RS}Fact`,
          [`${RS}element`]: { '@id': 'http://ex/rf' },
          [`${RS}period`]: { '@id': 'http://ex/p' },
          [`${RS}numericValue`]: 60,
          [`${RS}dimension`]: { '@id': 'http://ex/d1' },
        },
        {
          '@id': 'http://ex/d1',
          '@type': `${RS}Dimension`,
          [`${RS}axis`]: { '@id': 'http://ex/axis' },
          [`${RS}member`]: { '@id': 'http://ex/mem' },
          [`${RS}isExplicit`]: true,
        },
        {
          '@id': 'http://ex/axis',
          '@type': `${RS}Element`,
          [`${SKOS}prefLabel`]: 'Equity Components [Axis]',
        },
        {
          '@id': 'http://ex/mem',
          '@type': `${RS}Element`,
          [`${SKOS}prefLabel`]: 'Common Stock [Member]',
        },
      ],
    }
    const model = await parseJsonld(doc)
    expect(model.elements['http://ex/hdr']?.label).toBe("Statement of Stockholders' Equity")
    expect(model.elements['http://ex/tbl']?.label).toBe('Statement')
    expect(model.elements['http://ex/li']?.label).toBe('Statement')
    expect(model.elements['http://ex/rf']?.label).toBe(
      'Increase (Decrease) in Stockholders’ Equity'
    )
    const dim = model.facts.find((f) => f.id === 'http://ex/fd')?.dimensions?.[0]
    expect(dim?.axisLabel).toBe('Equity Components')
    expect(dim?.memberLabel).toBe('Common Stock')
  })

  it('keeps a label that is only a role tag rather than emptying it', async () => {
    const doc = {
      '@graph': [
        { '@id': 'http://ex/bare', '@type': `${RS}Element`, [`${SKOS}prefLabel`]: '[Abstract]' },
      ],
    }
    const model = await parseJsonld(doc)
    expect(model.elements['http://ex/bare']?.label).toBe('[Abstract]')
  })
})
