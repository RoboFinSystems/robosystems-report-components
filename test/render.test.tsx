import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ReportView } from '../src'
import { parseJsonld } from '../src/adapters/jsonld'

const here = dirname(fileURLToPath(import.meta.url))
const holon = readFileSync(join(here, 'fixtures', 'seattle-method-case-1.holon.jsonld'), 'utf8')

describe('ReportView — renders into the DOM', () => {
  it('renders the entity, statement headings and the footed grand total from the holon', async () => {
    const report = await parseJsonld(holon)
    render(<ReportView report={report} inspect={false} />)

    // The entity appears both in the report header and each section's slicer bar.
    expect(screen.getAllByText(/Lemonade Stand/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Balance Sheet')).toBeTruthy()
    expect(screen.getByText('Income Statement')).toBeTruthy()

    // Assets and Liabilities and Equity both foot to $14,450.00.
    expect(screen.getAllByText('$14,450.00').length).toBeGreaterThanOrEqual(2)
    // A negative is rendered in accounting style (parentheses, no minus sign).
    expect(screen.getByText('$(150.00)')).toBeTruthy()
  })
})
