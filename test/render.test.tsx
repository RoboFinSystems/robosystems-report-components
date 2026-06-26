import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ReportView } from '../src'
import { parseTrig } from '../src/adapters/trig'

const here = dirname(fileURLToPath(import.meta.url))
const trig = readFileSync(join(here, 'fixtures', 'seattle-method-case-1.holon.trig'), 'utf8')

describe('ReportView — renders into the DOM', () => {
  it('renders the entity, statement headings and the footed grand total', () => {
    const report = parseTrig(trig)
    render(<ReportView report={report} inspect={false} />)

    expect(screen.getByText(/Lemonade Stand/)).toBeTruthy()
    expect(screen.getByText('Balance Sheet')).toBeTruthy()
    expect(screen.getByText('Income Statement')).toBeTruthy()

    // Assets and Liabilities and Equity both foot to $14,450.00.
    expect(screen.getAllByText('$14,450.00').length).toBeGreaterThanOrEqual(2)
    // A negative is rendered in accounting style (parentheses, no minus sign).
    expect(screen.getByText('$(150.00)')).toBeTruthy()
  })
})
