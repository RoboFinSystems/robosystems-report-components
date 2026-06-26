/**
 * Renders one reconstructed `Statement` as a financial-statement table.
 *
 * Framework-agnostic plain React — no `next/*`, no CSS framework required. Styled
 * with inline styles that read CSS custom properties (`--rs-*`) so a host app can
 * theme it, with sensible RoboSystems defaults baked in as fallbacks.
 */
import type { CSSProperties } from 'react'
import { formatMoney, formatPeriod } from '../format'
import type { Statement, StatementRow } from '../model'

export interface StatementTableProps {
  statement: Statement
  /** Called when a value cell is clicked — drives fact inspection. */
  onCellClick?: (row: StatementRow, columnIndex: number) => void
  /** Currency symbol for values (default `$`). */
  currencySymbol?: string
  /** The currently-selected cell, highlighted. */
  selected?: { elementId: string; columnIndex: number } | null
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    fontFamily: 'var(--rs-font-sans, ui-sans-serif, system-ui, sans-serif)',
    color: 'var(--rs-text, #111827)',
    marginBottom: '2.5rem',
  },
  heading: {
    textAlign: 'center',
    marginBottom: '1rem',
  },
  title: {
    fontFamily: 'var(--rs-font-heading, var(--rs-font-sans, sans-serif))',
    fontSize: '1.15rem',
    fontWeight: 700,
    letterSpacing: '0.02em',
    margin: 0,
  },
  subtitle: {
    fontSize: '0.85rem',
    color: 'var(--rs-muted, #6b7280)',
    marginTop: '0.25rem',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.875rem',
  },
  th: {
    borderBottom: '2px solid var(--rs-border-strong, #9ca3af)',
    padding: '0.5rem 0.75rem',
    fontWeight: 600,
    color: 'var(--rs-muted, #6b7280)',
    fontSize: '0.8rem',
  },
  thConcept: { textAlign: 'left' },
  thNum: { textAlign: 'right', whiteSpace: 'nowrap' },
  labelCell: {
    padding: '0.3rem 0.75rem',
    whiteSpace: 'normal',
  },
  numCell: {
    padding: '0.3rem 0.75rem',
    textAlign: 'right',
    whiteSpace: 'nowrap',
    fontFamily: 'var(--rs-font-mono, ui-monospace, SFMono-Regular, monospace)',
    fontVariantNumeric: 'tabular-nums',
  },
}

export function StatementTable({
  statement,
  onCellClick,
  currencySymbol = '$',
  selected = null,
}: StatementTableProps) {
  const { columns, rows } = statement
  const periodCaption = columns.length === 1 ? formatPeriod(columns[0].period) : null

  return (
    <section style={styles.wrap}>
      <header style={styles.heading}>
        <h3 style={styles.title}>{statement.title}</h3>
        {statement.structureName ? (
          <div style={styles.subtitle}>{statement.structureName}</div>
        ) : null}
        {periodCaption ? <div style={styles.subtitle}>{periodCaption}</div> : null}
      </header>

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={{ ...styles.th, ...styles.thConcept }}>Concept</th>
            {columns.map((col) => (
              <th key={col.key} style={{ ...styles.th, ...styles.thNum }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isGrandTotal = row.isSubtotal && row.depth === 0
            const allZeroOrNull = row.cells.every((c) => c.value === null || c.value === 0)
            const rowStyle: CSSProperties = {
              backgroundColor: row.isSubtotal ? 'var(--rs-subtotal-bg, #f9fafb)' : undefined,
            }
            const labelStyle: CSSProperties = {
              ...styles.labelCell,
              paddingLeft: `${row.depth * 20 + 12}px`,
              fontWeight: row.isSubtotal ? 600 : 400,
              color: !row.isSubtotal && allZeroOrNull ? 'var(--rs-muted, #9ca3af)' : undefined,
              borderBottom: isGrandTotal ? '3px double var(--rs-text, #111827)' : undefined,
            }
            return (
              <tr key={row.element.id} style={rowStyle}>
                <td style={labelStyle} title={row.element.qname}>
                  {row.element.label}
                </td>
                {row.cells.map((cell, i) => {
                  const isSelected =
                    selected !== null &&
                    selected.elementId === row.element.id &&
                    selected.columnIndex === i
                  const clickable = onCellClick && cell.fact !== null
                  const numStyle: CSSProperties = {
                    ...styles.numCell,
                    fontWeight: row.isSubtotal ? 600 : 400,
                    borderBottom: isGrandTotal ? '3px double var(--rs-text, #111827)' : undefined,
                    cursor: clickable ? 'pointer' : 'default',
                    backgroundColor: isSelected ? 'var(--rs-selected-bg, #dbeafe)' : undefined,
                    color:
                      !row.isSubtotal && (cell.value === null || cell.value === 0)
                        ? 'var(--rs-muted, #9ca3af)'
                        : undefined,
                  }
                  return (
                    <td
                      key={columns[i].key}
                      style={numStyle}
                      onClick={clickable ? () => onCellClick?.(row, i) : undefined}
                    >
                      {formatMoney(cell.value, { currencySymbol })}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
