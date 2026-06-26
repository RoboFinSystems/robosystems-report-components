/**
 * Top-level renderer: a `NormalizedReport` → the entity header, every statement,
 * and an inline fact inspector wired to cell selection. This is the one
 * component a consuming app typically renders.
 */
import type { CSSProperties } from 'react'
import { useMemo, useState } from 'react'
import type { NormalizedReport, StatementRow } from '../model'
import { buildStatements } from '../project'
import { FactInspector } from './FactInspector'
import { StatementTable } from './StatementTable'

export interface ReportViewProps {
  report: NormalizedReport
  currencySymbol?: string
  /** Disable the click-to-inspect fact panel (render-only). */
  inspect?: boolean
}

interface Selection {
  statementIndex: number
  elementId: string
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
  entitySub: { fontSize: '0.85rem', color: 'var(--rs-muted, #6b7280)' },
  panel: { position: 'sticky', top: '1rem' },
}

export function ReportView({ report, currencySymbol = '$', inspect = true }: ReportViewProps) {
  const statements = useMemo(() => buildStatements(report), [report])
  const [selection, setSelection] = useState<Selection | null>(null)

  const selected = selection !== null ? statements[selection.statementIndex] : null
  const selectedRow = selected?.rows.find((r) => r.element.id === selection?.elementId) ?? null

  return (
    <div>
      {report.entity ? (
        <header style={styles.entity}>
          <h2 style={styles.entityName}>{report.entity.name}</h2>
          {report.entity.country ? (
            <div style={styles.entitySub}>{report.entity.country}</div>
          ) : null}
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
              statement={statement}
              currencySymbol={currencySymbol}
              selected={
                selection && selection.statementIndex === statementIndex
                  ? {
                      elementId: selection.elementId,
                      columnIndex: selection.columnIndex,
                    }
                  : null
              }
              onCellClick={
                inspect
                  ? (row: StatementRow, columnIndex: number) =>
                      setSelection({
                        statementIndex,
                        elementId: row.element.id,
                        columnIndex,
                      })
                  : undefined
              }
            />
          ))}
        </div>

        {inspect && selected && selectedRow && selection ? (
          <div style={styles.panel}>
            <FactInspector
              report={report}
              statement={selected}
              row={selectedRow}
              columnIndex={selection.columnIndex}
              currencySymbol={currencySymbol}
              onClose={() => setSelection(null)}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
