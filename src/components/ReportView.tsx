/**
 * Top-level renderer: a `NormalizedReport` → the entity header, every statement,
 * and an inline fact inspector wired to cell selection. This is the one
 * component a consuming app typically renders.
 */
import type { CSSProperties } from 'react'
import { useMemo, useState } from 'react'
import type { NormalizedReport, PivotRow } from '../model'
import { buildPivots } from '../pivot'
import { FactInspector } from './FactInspector'
import { StatementTable } from './StatementTable'

export interface ReportViewProps {
  report: NormalizedReport
  /** Disable the click-to-inspect fact panel (render-only). */
  inspect?: boolean
}

interface Selection {
  statementIndex: number
  rowKey: string
  columnIndex: number
}

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
}

export function ReportView({ report, inspect = true }: ReportViewProps) {
  const statements = useMemo(() => buildPivots(report), [report])
  const [selection, setSelection] = useState<Selection | null>(null)

  const selected = selection !== null ? statements[selection.statementIndex] : null
  const selectedRow = selected?.rows.find((r) => r.key === selection?.rowKey) ?? null

  return (
    <div>
      {report.entity ? (
        <header style={styles.entity}>
          <h2 style={styles.entityName}>{report.entity.name}</h2>
        </header>
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
