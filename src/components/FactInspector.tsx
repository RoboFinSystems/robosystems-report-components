/**
 * Click-a-fact inspection: the selected cell's element / period / unit, plus —
 * when the element is a calculation subtotal — the calculation rule it foots,
 * computed live in the browser (`13,550 + 900 = 14,450 ✓`).
 */
import type { CSSProperties, ReactNode } from 'react'
import { formatMoney, formatPeriod } from '../format'
import type { NormalizedReport, Statement, StatementRow } from '../model'
import { footCheck } from '../project'

export interface FactInspectorProps {
  report: NormalizedReport
  statement: Statement
  row: StatementRow
  columnIndex: number
  onClose?: () => void
  currencySymbol?: string
}

const styles: Record<string, CSSProperties> = {
  panel: {
    fontFamily: 'var(--rs-font-sans, ui-sans-serif, system-ui, sans-serif)',
    color: 'var(--rs-text, #111827)',
    border: '1px solid var(--rs-border, #e5e7eb)',
    borderRadius: '12px',
    padding: '1rem 1.25rem',
    background: 'var(--rs-panel-bg, #ffffff)',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    marginBottom: '0.75rem',
  },
  // `minWidth: 0` lets this flex child shrink below its content so the long
  // label / qname wrap inside the panel instead of overflowing it.
  headerText: { minWidth: 0 },
  label: { fontSize: '1rem', fontWeight: 700, margin: 0, overflowWrap: 'anywhere' },
  qname: {
    display: 'block',
    fontFamily: 'var(--rs-font-mono, ui-monospace, monospace)',
    fontSize: '0.8rem',
    color: 'var(--rs-primary-700, #1d4ed8)',
    // qnames are single unbroken tokens — break anywhere so they don't overflow.
    overflowWrap: 'anywhere',
  },
  close: {
    border: 'none',
    background: 'transparent',
    fontSize: '1.25rem',
    lineHeight: 1,
    cursor: 'pointer',
    color: 'var(--rs-muted, #6b7280)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '0.35rem 1rem',
    fontSize: '0.85rem',
    margin: '0.5rem 0',
  },
  key: { color: 'var(--rs-muted, #6b7280)' },
  mono: { fontFamily: 'var(--rs-font-mono, ui-monospace, monospace)' },
  footing: {
    marginTop: '0.85rem',
    paddingTop: '0.75rem',
    borderTop: '1px solid var(--rs-border, #e5e7eb)',
  },
  footTitle: {
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--rs-muted, #6b7280)',
    marginBottom: '0.4rem',
  },
  equation: {
    fontFamily: 'var(--rs-font-mono, ui-monospace, monospace)',
    fontSize: '0.85rem',
    lineHeight: 1.6,
  },
}

function Field({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <span style={styles.key}>{k}</span>
      <span>{children}</span>
    </>
  )
}

export function FactInspector({
  report,
  statement,
  row,
  columnIndex,
  onClose,
  currencySymbol = '$',
}: FactInspectorProps) {
  const { element } = row
  const cell = row.cells[columnIndex]
  const column = statement.columns[columnIndex]
  const unit = cell.fact?.unit ? report.units[cell.fact.unit] : null
  const foot = footCheck(report, statement, element.id, columnIndex)
  const sym = currencySymbol

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div style={styles.headerText}>
          <p style={styles.label}>{element.label}</p>
          <span style={styles.qname}>{element.qname}</span>
        </div>
        {onClose ? (
          <button style={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        ) : null}
      </div>

      <div style={styles.grid}>
        <Field k="Value">
          {cell.value === null && cell.textValue ? (
            <span>{cell.textValue}</span>
          ) : (
            <span style={styles.mono}>{formatMoney(cell.value, { currencySymbol: sym })}</span>
          )}
        </Field>
        <Field k="Period">
          {formatPeriod(column.period)} <span style={styles.key}>({column.period.type})</span>
        </Field>
        <Field k="Unit">{unit ? unit.label : '—'}</Field>
        {element.balance ? <Field k="Balance">{element.balance}</Field> : null}
        {cell.fact?.decimals ? <Field k="Decimals">{cell.fact.decimals}</Field> : null}
      </div>

      {foot ? (
        <div style={styles.footing}>
          <div style={styles.footTitle}>Calculation {foot.ok ? '✓ foots' : '⚠ does not foot'}</div>
          <div style={styles.equation}>
            {foot.terms.map((term, i) => {
              const op = i === 0 ? (term.weight < 0 ? '−' : '') : term.weight < 0 ? ' − ' : ' + '
              return (
                <span key={term.element.id} title={term.element.qname}>
                  {op}
                  {formatMoney(term.value === null ? 0 : Math.abs(term.value), {
                    currencySymbol: sym,
                  })}
                </span>
              )
            })}
            {' = '}
            <strong>{formatMoney(foot.expected, { currencySymbol: sym })}</strong>{' '}
            {foot.ok ? (
              <span style={{ color: 'var(--rs-success, #00875a)' }}>✓</span>
            ) : (
              <span style={{ color: 'var(--rs-error, #dc2626)' }}>
                ✗ (reported {formatMoney(foot.actual, { currencySymbol: sym })})
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
