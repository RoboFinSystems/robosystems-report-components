/**
 * Click-a-fact inspection: the selected cell's aspects — concept, value, period,
 * entity, dimensions, unit, balance, rounding — plus, when the element is a
 * calculation subtotal, the rule it foots (computed live in the browser).
 *
 * Crucially the period, unit and dimensions are read from the *cell's own fact*,
 * not from the column — so a value never borrows a neighbouring period's metadata
 * (the bug the pivot rewrite set out to kill).
 */
import type { CSSProperties, ReactNode } from 'react'
import {
  currencySymbolFor,
  formatPeriod,
  formatValue,
  humanizeDuration,
  numericKindOf,
} from '../format'
import type { NormalizedReport, PivotRow, PivotTable, UnitInfo } from '../model'
import { footCheck } from '../project'

export interface FactInspectorProps {
  report: NormalizedReport
  table: PivotTable
  row: PivotRow
  columnIndex: number
  onClose?: () => void
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
  headerText: { minWidth: 0 },
  label: { fontSize: '1rem', fontWeight: 700, margin: 0, overflowWrap: 'anywhere' },
  qname: {
    display: 'block',
    fontFamily: 'var(--rs-font-mono, ui-monospace, monospace)',
    fontSize: '0.8rem',
    color: 'var(--rs-primary-700, #1d4ed8)',
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
  dims: { display: 'grid', gap: '0.15rem' },
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

function symbolFor(unit: UnitInfo | undefined): string {
  return unit?.symbol ?? currencySymbolFor(unit?.measure) ?? '$'
}

export function FactInspector({ report, table, row, columnIndex, onClose }: FactInspectorProps) {
  const { element } = row
  const cell = row.cells[columnIndex]
  const fact = cell?.fact ?? null
  const period = fact ? report.periods[fact.period] : null
  const unit = fact?.unit ? report.units[fact.unit] : undefined
  const kind = numericKindOf(element)
  const dims = fact?.dimensions ?? row.members
  const foot = footCheck(report, table, element.id, columnIndex)
  const sym = symbolFor(unit)

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
          {cell?.value === null && cell?.textValue ? (
            <span>{humanizeDuration(cell.textValue) ?? cell.textValue}</span>
          ) : (
            <span style={styles.mono}>
              {formatValue(cell?.value ?? null, { numericKind: kind, symbol: sym })}
            </span>
          )}
        </Field>
        {period ? (
          <Field k="Period">
            {formatPeriod(period)} <span style={styles.key}>({period.type})</span>
          </Field>
        ) : null}
        {report.entity ? <Field k="Entity">{report.entity.name}</Field> : null}
        {dims.length ? (
          <Field k="Dimensions">
            <span style={styles.dims}>
              {dims.map((d) => (
                <span key={d.axis}>
                  <span style={styles.key}>{d.axisLabel}:</span>{' '}
                  {d.explicit ? d.memberLabel : (d.typedValue ?? d.memberLabel)}
                </span>
              ))}
            </span>
          </Field>
        ) : null}
        <Field k="Unit">{unit ? unit.label : '—'}</Field>
        {element.balance ? <Field k="Balance">{element.balance}</Field> : null}
        {fact?.decimals ? <Field k="Decimals">{fact.decimals}</Field> : null}
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
                  {formatValue(term.value === null ? 0 : Math.abs(term.value), {
                    numericKind: 'monetary',
                    symbol: sym,
                  })}
                </span>
              )
            })}
            {' = '}
            <strong>
              {formatValue(foot.expected, { numericKind: 'monetary', symbol: sym })}
            </strong>{' '}
            {foot.ok ? (
              <span style={{ color: 'var(--rs-success, #00875a)' }}>✓</span>
            ) : (
              <span style={{ color: 'var(--rs-error, #dc2626)' }}>
                ✗ (reported {formatValue(foot.actual, { numericKind: 'monetary', symbol: sym })})
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
