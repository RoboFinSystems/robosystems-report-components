import type { PivotRow, PivotTable } from './model'

/**
 * A pivot table as CSV, row for row with `StatementTable`: each line indented
 * to its depth under its label, its concept, then one column per leaf column.
 * Numbers are written at full precision, not divided by the display scale, with
 * a negated preferred label's sign flipped as the table shows it. A text fact
 * is written as its text.
 */
export function pivotToCsv(table: PivotTable): string {
  const header = ['Line', 'Concept', ...leafHeaders(table)]
  const rows = table.rows.map((row) => [
    `${'  '.repeat(row.depth)}${rowLabel(row)}`,
    row.element.qname,
    ...row.cells.map((cell) => {
      if (cell.value === null) return cell.textValue ?? ''
      return String(row.negated ? -cell.value : cell.value)
    }),
  ])
  return [header, ...rows].map((r) => r.map(field).join(',')).join('\n')
}

/** Each leaf column's full heading: the labels of every header level above it
 *  (period over members), joined. */
function leafHeaders(table: PivotTable): string[] {
  const labels: string[][] = table.columns.map(() => [])
  for (const level of table.columnHeaders) {
    let index = 0
    for (const cell of level) {
      for (let i = 0; i < cell.span; i++) labels[index + i]?.push(cell.label)
      index += cell.span
    }
  }
  return table.columns.map((column, i) => {
    const above = labels[i].filter(Boolean)
    const parts = above.includes(column.label) ? above : [...above, column.label]
    return parts.filter(Boolean).join(' · ')
  })
}

function rowLabel(row: PivotRow): string {
  if (!row.members.length) return row.label ?? row.element.label
  return row.members.map((m) => m.memberLabel).join(' · ')
}

/** Quoted where needed; text that opens like a formula is prefixed so a
 *  spreadsheet never runs it. A number is written as it is. */
function field(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) && Number.isNaN(Number(value)) ? `'${value}` : value
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}
