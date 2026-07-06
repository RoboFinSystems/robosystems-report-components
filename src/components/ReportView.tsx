/**
 * Top-level renderer: a `NormalizedReport` → the entity header, every statement,
 * and an inline fact inspector wired to cell selection. This is the one
 * component a consuming app typically renders.
 */
import type { CSSProperties } from 'react'
import { useMemo, useState } from 'react'
import type { AspectKey, NormalizedReport, PivotRow } from '../model'
import { buildPivots, pivotDimensionsOn } from '../pivot'
import { FactInspector } from './FactInspector'
import { StatementTable } from './StatementTable'

export interface ReportViewProps {
  report: NormalizedReport
  /** Disable the click-to-inspect fact panel (render-only). */
  inspect?: boolean
  /** Initial placement for dimension breakdowns (default `rows`). */
  dimensionAxis?: 'rows' | 'columns'
}

interface Selection {
  statementIndex: number
  rowKey: string
  columnIndex: number
}

const isDim = (k: AspectKey): boolean => k.startsWith('dim:')

const styles: Record<string, CSSProperties> = {
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: '1.5rem',
    alignItems: 'start',
  },
  layoutWithPanel: {
    gridTemplateColumns: 'minmax(0, 1fr) 340px',
  },
  entity: {
    fontFamily: 'var(--rs-font-heading, var(--rs-font-sans, sans-serif))',
    textAlign: 'center',
    marginBottom: '1.5rem',
  },
  entityName: {
    fontSize: '1.5rem',
    fontWeight: 700,
    margin: 0,
    color: 'var(--rs-text, #111827)',
  },
  panel: { position: 'sticky', top: '1rem' },
  controls: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '1rem',
    fontSize: '0.8rem',
  },
  controlLabel: { color: 'var(--rs-muted, #6b7280)' },
  segmented: {
    display: 'inline-flex',
    border: '1px solid var(--rs-border, #e5e7eb)',
    borderRadius: '7px',
    overflow: 'hidden',
  },
  segment: {
    border: 'none',
    padding: '0.25rem 0.7rem',
    fontSize: '0.78rem',
    cursor: 'pointer',
    background: 'transparent',
    color: 'var(--rs-text, #111827)',
  },
  segmentActive: {
    background: 'var(--rs-primary-600, #2563eb)',
    color: '#ffffff',
    fontWeight: 600,
  },
}

export function ReportView({ report, inspect = true, dimensionAxis = 'rows' }: ReportViewProps) {
  const [dimAxis, setDimAxis] = useState<'rows' | 'columns'>(dimensionAxis)
  const [selection, setSelection] = useState<Selection | null>(null)

  const statements = useMemo(
    () => buildPivots(report, (_ib, cfg) => pivotDimensionsOn(cfg, dimAxis)),
    [report, dimAxis]
  )
  const hasDimensions = statements.some(
    (s) => s.config.rows.some(isDim) || s.config.columns.some(isDim)
  )

  const selected = selection !== null ? statements[selection.statementIndex] : null
  const selectedRow = selected?.rows.find((r) => r.key === selection?.rowKey) ?? null

  const setPlacement = (placement: 'rows' | 'columns'): void => {
    setSelection(null) // row/column keys differ between placements
    setDimAxis(placement)
  }

  return (
    <div>
      {report.entity ? (
        <header style={styles.entity}>
          <h2 style={styles.entityName}>{report.entity.name}</h2>
        </header>
      ) : null}

      {hasDimensions ? (
        <div style={styles.controls}>
          <span style={styles.controlLabel}>Dimensions</span>
          <div style={styles.segmented} role="group" aria-label="Dimension placement">
            {(['rows', 'columns'] as const).map((placement) => (
              <button
                key={placement}
                type="button"
                onClick={() => setPlacement(placement)}
                aria-pressed={dimAxis === placement}
                style={{
                  ...styles.segment,
                  ...(dimAxis === placement ? styles.segmentActive : {}),
                }}
              >
                {placement === 'rows' ? 'As rows' : 'As columns'}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div
        style={{
          ...styles.layout,
          ...(inspect && selectedRow ? styles.layoutWithPanel : {}),
        }}
      >
        <div>
          {statements.map((statement, statementIndex) => (
            <StatementTable
              key={statement.ib.id}
              table={statement}
              units={report.units}
              selected={
                selection && selection.statementIndex === statementIndex
                  ? { rowKey: selection.rowKey, columnIndex: selection.columnIndex }
                  : null
              }
              onCellClick={
                inspect
                  ? (row: PivotRow, columnIndex: number) =>
                      setSelection({ statementIndex, rowKey: row.key, columnIndex })
                  : undefined
              }
            />
          ))}
        </div>

        {inspect && selected && selectedRow && selection ? (
          <div style={styles.panel}>
            <FactInspector
              report={report}
              table={selected}
              row={selectedRow}
              columnIndex={selection.columnIndex}
              onClose={() => setSelection(null)}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
