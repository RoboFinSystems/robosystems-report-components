/**
 * Renders one `PivotTable` — a pivoted section of a report.
 *
 * The default view is the familiar statement layout (concept hierarchy on rows,
 * periods on columns), but because the engine is a general pivot, this component
 * also handles dimensions on columns (member sub-headers nested under each
 * period, à la Pesseract), single-member dimensions as slicer bars, abstract
 * `[Roll Up]` header rows, and unit- + scale-aware value formatting.
 *
 * Framework-agnostic plain React — no `next/*`, no CSS framework. Styled with
 * inline styles reading CSS custom properties (`--rs-*`) so a host app can theme
 * it, with sensible RoboSystems defaults baked in as fallbacks.
 */
import type { CSSProperties } from 'react'
import { isExternalFactUrl } from '../constants'
import { currencySymbolFor, formatValue, numericKindOf } from '../format'
import type { PivotRow, PivotTable, UnitInfo } from '../model'
import { ExternalTextBlock } from './ExternalTextBlock'

export interface StatementTableProps {
  table: PivotTable
  /** The report's units, to resolve each cell's currency symbol. */
  units?: Record<string, UnitInfo>
  /** Called when a value cell is clicked — drives fact inspection. */
  onCellClick?: (row: PivotRow, columnIndex: number) => void
  /** The currently-selected cell, highlighted. */
  selected?: { rowKey: string; columnIndex: number } | null
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    fontFamily: 'var(--rs-font-sans, ui-sans-serif, system-ui, sans-serif)',
    color: 'var(--rs-text, #111827)',
    marginBottom: '2.5rem',
  },
  heading: { textAlign: 'center', marginBottom: '0.75rem' },
  title: {
    fontFamily: 'var(--rs-font-heading, var(--rs-font-sans, sans-serif))',
    fontSize: '1.15rem',
    fontWeight: 700,
    letterSpacing: '0.02em',
    margin: 0,
  },
  subtitle: { fontSize: '0.85rem', color: 'var(--rs-muted, #6b7280)', marginTop: '0.25rem' },
  scaleCaption: {
    fontSize: '0.8rem',
    fontStyle: 'italic',
    color: 'var(--rs-muted, #6b7280)',
    marginTop: '0.25rem',
  },
  slicers: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem',
    margin: '0 0 0.75rem',
  },
  slicer: {
    display: 'inline-flex',
    gap: '0.4rem',
    alignItems: 'baseline',
    border: '1px solid var(--rs-border, #e5e7eb)',
    borderRadius: '6px',
    padding: '0.2rem 0.55rem',
    fontSize: '0.78rem',
    background: 'var(--rs-slicer-bg, #f9fafb)',
  },
  slicerLabel: {
    color: 'var(--rs-muted, #6b7280)',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    fontSize: '0.68rem',
  },
  slicerValue: { fontWeight: 600 },
  scroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' },
  th: {
    borderBottom: '2px solid var(--rs-border-strong, #9ca3af)',
    padding: '0.4rem 0.75rem',
    fontWeight: 600,
    color: 'var(--rs-muted, #6b7280)',
    fontSize: '0.8rem',
  },
  thGroup: {
    borderBottom: '1px solid var(--rs-border, #e5e7eb)',
    padding: '0.3rem 0.75rem',
    fontWeight: 600,
    color: 'var(--rs-muted, #6b7280)',
    fontSize: '0.8rem',
    textAlign: 'center',
  },
  thConcept: { textAlign: 'left', verticalAlign: 'bottom' },
  thNum: { textAlign: 'right', whiteSpace: 'nowrap' },
  labelCell: { padding: '0.3rem 0.75rem', whiteSpace: 'normal' },
  headerRowLabel: {
    padding: '0.4rem 0.75rem',
    fontWeight: 700,
    fontSize: '0.8rem',
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
    color: 'var(--rs-muted, #6b7280)',
  },
  numCell: {
    padding: '0.3rem 0.75rem',
    textAlign: 'right',
    whiteSpace: 'nowrap',
    fontFamily: 'var(--rs-font-mono, ui-monospace, SFMono-Regular, monospace)',
    fontVariantNumeric: 'tabular-nums',
  },
  textBlockCell: { padding: '0.75rem', borderTop: '1px solid var(--rs-border, #e5e7eb)' },
  textBlockLabel: {
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    fontWeight: 600,
    color: 'var(--rs-muted, #6b7280)',
    marginBottom: '0.5rem',
  },
}

/** The currency symbol for a cell's fact unit — never a hard-coded `$` for non-USD. */
function cellSymbol(unit: UnitInfo | undefined): string {
  return unit?.symbol ?? currencySymbolFor(unit?.measure) ?? '$'
}

export function StatementTable({
  table,
  units,
  onCellClick,
  selected = null,
}: StatementTableProps) {
  const { columns, rows, columnHeaders, scale } = table
  const totalCols = columns.length

  return (
    <section style={styles.wrap}>
      <header style={styles.heading}>
        <h3 style={styles.title}>{table.title}</h3>
        {table.structureName ? <div style={styles.subtitle}>{table.structureName}</div> : null}
        {scale.caption ? <div style={styles.scaleCaption}>{scale.caption}</div> : null}
      </header>

      {table.slicers.length ? (
        <div style={styles.slicers}>
          {table.slicers.map((s) => (
            <div key={s.aspect} style={styles.slicer}>
              <span style={styles.slicerLabel}>{s.label}</span>
              <span style={styles.slicerValue}>{s.valueLabel}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div style={styles.scroll}>
        <table style={styles.table}>
          <thead>
            {columnHeaders.map((level, levelIndex) => {
              const isLast = levelIndex === columnHeaders.length - 1
              let leaf = 0
              return (
                <tr key={levelIndex}>
                  {levelIndex === 0 ? (
                    <th
                      rowSpan={columnHeaders.length}
                      style={{ ...styles.th, ...styles.thConcept }}
                    >
                      Concept
                    </th>
                  ) : null}
                  {level.map((h, i) => {
                    const key = `${levelIndex}-${i}-${leaf}`
                    leaf += h.span
                    return (
                      <th
                        key={key}
                        colSpan={h.span}
                        style={isLast ? { ...styles.th, ...styles.thNum } : styles.thGroup}
                      >
                        {h.label}
                      </th>
                    )
                  })}
                </tr>
              )
            })}
          </thead>
          <tbody>
            {rows.map((row) => {
              // An abstract concept — a section header with no values.
              if (row.header) {
                return (
                  <tr key={row.key}>
                    <td
                      colSpan={totalCols + 1}
                      style={{
                        ...styles.headerRowLabel,
                        paddingLeft: `${row.depth * 20 + 12}px`,
                      }}
                      title={row.element.qname}
                    >
                      {row.element.label}
                    </td>
                  </tr>
                )
              }

              // An externalized text-block / policy disclosure: render its fetched
              // HTML full-width instead of a URL squeezed into a value cell.
              const textBlock = row.cells.find(
                (c) => c.value === null && isExternalFactUrl(c.textValue)
              )
              if (textBlock?.textValue) {
                return (
                  <tr key={row.key}>
                    <td colSpan={totalCols + 1} style={styles.textBlockCell}>
                      <div style={styles.textBlockLabel} title={row.element.qname}>
                        {rowLabel(row)}
                      </div>
                      <ExternalTextBlock url={textBlock.textValue} />
                    </td>
                  </tr>
                )
              }

              const kind = numericKindOf(row.element)
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
                <tr key={row.key} style={rowStyle}>
                  <td style={labelStyle} title={row.element.qname}>
                    {rowLabel(row)}
                  </td>
                  {row.cells.map((cell, i) => {
                    const isSelected =
                      selected !== null && selected.rowKey === row.key && selected.columnIndex === i
                    const clickable = onCellClick && cell.fact !== null
                    const isText =
                      cell.value === null && cell.textValue != null && cell.textValue !== ''
                    const unit = cell.fact?.unit && units ? units[cell.fact.unit] : undefined
                    const numStyle: CSSProperties = {
                      ...styles.numCell,
                      fontWeight: row.isSubtotal ? 600 : 400,
                      borderBottom: isGrandTotal ? '3px double var(--rs-text, #111827)' : undefined,
                      cursor: clickable ? 'pointer' : 'default',
                      backgroundColor: isSelected ? 'var(--rs-selected-bg, #dbeafe)' : undefined,
                      color:
                        !isText && !row.isSubtotal && (cell.value === null || cell.value === 0)
                          ? 'var(--rs-muted, #9ca3af)'
                          : undefined,
                      ...(isText
                        ? {
                            textAlign: 'left',
                            whiteSpace: 'normal',
                            fontFamily: 'var(--rs-font-sans, ui-sans-serif, system-ui, sans-serif)',
                          }
                        : {}),
                    }
                    return (
                      <td
                        key={columns[i].key}
                        style={numStyle}
                        onClick={clickable ? () => onCellClick?.(row, i) : undefined}
                      >
                        {isText
                          ? cell.textValue
                          : formatValue(cell.value, {
                              numericKind: kind,
                              symbol: cellSymbol(unit),
                              scaleFactor: scale.factor,
                            })}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** A concept label, suffixed with its member when the row is a dimensional breakdown. */
function rowLabel(row: PivotRow): string {
  if (!row.members.length) return row.element.label
  return `${row.element.label} — ${row.members.map((m) => m.memberLabel).join(', ')}`
}
