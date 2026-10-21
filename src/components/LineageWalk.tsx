/**
 * The walk from a figure to the books, for a report whose file carries its
 * `#lineage` graph: each account the figure was summed from, the lines under
 * it in the report's span with a register-shaped table, the balance of what
 * lies before the described span, and the figure's evidence hash recomputed
 * in the browser against the one the report froze. A line opens onto its
 * entry, transaction, event and counterparty. Renders nothing when the file
 * carries no lineage or the figure was not pivoted from the ledger.
 */
import type { CSSProperties, ReactNode } from 'react'
import { useState } from 'react'
import { formatDate, formatValue } from '../format'
import {
  adjustmentWords,
  checkFactLineage,
  contributionsOf,
  describedLines,
  eventWords,
  recordedByWords,
} from '../lineage'
import type { Fact, Lineage, LineageContribution, LineageLine, NormalizedReport } from '../model'
import { shortHash } from '../provenance'

export interface LineageWalkProps {
  report: NormalizedReport
  fact: Fact
  /** The currency symbol the figure is shown with. */
  symbol?: string
}

const styles: Record<string, CSSProperties> = {
  section: {
    marginTop: '0.85rem',
    paddingTop: '0.75rem',
    borderTop: '1px solid var(--rs-border, #e5e7eb)',
  },
  title: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '0.5rem',
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--rs-muted, #6b7280)',
    marginBottom: '0.4rem',
  },
  ok: { color: 'var(--rs-success, #00875a)', textTransform: 'none', letterSpacing: 0 },
  bad: { color: 'var(--rs-error, #dc2626)', textTransform: 'none', letterSpacing: 0 },
  contribution: { marginTop: '0.6rem' },
  accountRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '0.75rem',
    alignItems: 'baseline',
    fontSize: '0.85rem',
  },
  accountName: { fontWeight: 600, overflowWrap: 'anywhere' },
  entityName: { color: 'var(--rs-muted, #6b7280)', fontSize: '0.75rem' },
  mono: { fontFamily: 'var(--rs-font-mono, ui-monospace, monospace)' },
  summary: { fontSize: '0.75rem', color: 'var(--rs-muted, #6b7280)', margin: '0.15rem 0 0.35rem' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' },
  th: {
    textAlign: 'left',
    fontWeight: 500,
    color: 'var(--rs-muted, #6b7280)',
    padding: '0.2rem 0.3rem',
    borderBottom: '1px solid var(--rs-border, #e5e7eb)',
  },
  td: {
    padding: '0.25rem 0.3rem',
    verticalAlign: 'top',
    borderBottom: '1px solid var(--rs-border, #f3f4f6)',
  },
  num: {
    textAlign: 'right',
    fontFamily: 'var(--rs-font-mono, ui-monospace, monospace)',
    whiteSpace: 'nowrap',
  },
  rowButton: { cursor: 'pointer' },
  badge: {
    display: 'inline-block',
    fontSize: '0.68rem',
    padding: '0 0.35rem',
    borderRadius: '999px',
    border: '1px solid var(--rs-border, #e5e7eb)',
    color: 'var(--rs-muted, #6b7280)',
    marginLeft: '0.35rem',
    whiteSpace: 'nowrap',
  },
  prior: { fontStyle: 'italic', color: 'var(--rs-muted, #6b7280)' },
  detail: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '0.2rem 0.75rem',
    fontSize: '0.78rem',
    padding: '0.4rem 0.3rem 0.5rem 1.2rem',
    background: 'var(--rs-panel-muted-bg, #f9fafb)',
  },
  key: { color: 'var(--rs-muted, #6b7280)' },
}

function Field({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <span style={styles.key}>{k}</span>
      <span>{children}</span>
    </>
  )
}

function money(value: number | null | undefined, symbol: string): string {
  return formatValue(value ?? null, { numericKind: 'monetary', symbol })
}

/** The day before an ISO date, for "balance at the close of" wording. */
function dayBefore(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function LineDetail({
  lineage,
  line,
  symbol,
}: {
  lineage: Lineage
  line: LineageLine
  symbol: string
}) {
  const entry = lineage.entries[line.entry]
  const transaction = entry?.transaction ? lineage.transactions[entry.transaction] : undefined
  const event = line.event ? lineage.events[line.event] : undefined
  const agent = event?.agent ? lineage.agents[event.agent] : undefined
  const reversedBy = entry?.reversedBy ? lineage.entries[entry.reversedBy] : undefined
  const reversalOf = entry?.reversalOf ? lineage.entries[entry.reversalOf] : undefined
  const adjusts = entry?.adjustsEntity ? lineage.entities[entry.adjustsEntity] : undefined
  return (
    <div style={styles.detail} data-testid="lineage-line-detail">
      {entry ? (
        <Field k="Entry">
          {entry.number ?? '—'}
          {entry.type && entry.type !== 'standard' ? ` · ${entry.type}` : ''}
          {recordedByWords(entry.recordedBy) ? ` · ${recordedByWords(entry.recordedBy)}` : ''}
          {entry.status === 'reversed' ? ' · reversed' : ''}
        </Field>
      ) : null}
      {entry?.memo ? <Field k="Memo">{entry.memo}</Field> : null}
      {line.description ? <Field k="Line">{line.description}</Field> : null}
      {entry?.adjustmentKind ? (
        <Field k="Consolidation">
          {adjustmentWords(entry.adjustmentKind)}
          {adjusts?.name ? ` · adjusts ${adjusts.name}` : ''}
        </Field>
      ) : null}
      {reversedBy ? <Field k="Reversed by">{reversedBy.number ?? 'a later entry'}</Field> : null}
      {reversalOf ? <Field k="Reverses">{reversalOf.number ?? 'an earlier entry'}</Field> : null}
      {event ? (
        <Field k="Event">
          {eventWords(event.type)}
          {event.occurredAt ? ` · ${formatDate(event.occurredAt)}` : ''}
          {event.amount !== null ? ` · ${money(event.amount, symbol)}` : ''}
          {event.status ? ` · ${event.status}` : ''}
        </Field>
      ) : null}
      {agent ? (
        <Field k="Counterparty">
          {agent.name}
          {agent.type ? ` (${agent.type})` : ''}
        </Field>
      ) : null}
      {transaction ? (
        <Field k="Transaction">
          {[transaction.merchantName, transaction.referenceNumber, transaction.description]
            .filter(Boolean)
            .join(' · ') ||
            (transaction.type ?? '—')}
          {transaction.dueDate ? ` · due ${formatDate(transaction.dueDate)}` : ''}
        </Field>
      ) : null}
      {line.flowConcept ? (
        <Field k="Cash flow">
          <span style={styles.mono}>{line.flowConcept}</span>
        </Field>
      ) : null}
      {line.dimensionMembers.length ? (
        <Field k="Dimensions">{line.dimensionMembers.join(', ')}</Field>
      ) : null}
    </div>
  )
}

function Contribution({
  lineage,
  contribution,
  symbol,
  showEntity,
  open,
  onToggle,
}: {
  lineage: Lineage
  contribution: LineageContribution
  symbol: string
  showEntity: boolean
  open: ReadonlySet<string>
  onToggle: (lineId: string) => void
}) {
  const account = lineage.accounts[contribution.account]
  const entity = lineage.entities[contribution.entity]
  const lines = describedLines(lineage, contribution)
  const accountLabel = account
    ? [account.code, account.name].filter(Boolean).join(' ')
    : contribution.account.slice(contribution.account.lastIndexOf('/') + 1)
  const hidden = contribution.lineCount - contribution.describedLineCount
  return (
    <div style={styles.contribution} data-testid="lineage-contribution">
      <div style={styles.accountRow}>
        <span>
          <span style={styles.accountName}>{accountLabel}</span>
          {showEntity && entity?.name ? (
            <span style={styles.entityName}>
              {' '}
              · {entity.name}
              {entity.role === 'consolidation' ? ' (consolidation entity)' : ''}
            </span>
          ) : null}
        </span>
        <span style={styles.mono}>{money(contribution.amount, symbol)}</span>
      </div>
      <div style={styles.summary}>
        {contribution.lineCount} {contribution.lineCount === 1 ? 'line' : 'lines'}
        {hidden > 0 && contribution.describedFrom
          ? `, ${contribution.describedLineCount} shown from ${formatDate(contribution.describedFrom)}`
          : ''}
      </div>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Date</th>
            <th style={styles.th}>Entry</th>
            <th style={styles.th}>Description</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Debit</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Credit</th>
          </tr>
        </thead>
        <tbody>
          {contribution.describedFrom && contribution.priorLineCount > 0 ? (
            <tr>
              <td style={{ ...styles.td, ...styles.prior }} colSpan={3}>
                Balance at {formatDate(dayBefore(contribution.describedFrom))} ·{' '}
                {contribution.priorLineCount} earlier{' '}
                {contribution.priorLineCount === 1 ? 'line' : 'lines'}
              </td>
              <td style={{ ...styles.td, ...styles.num, ...styles.prior }} colSpan={2}>
                {money(contribution.priorBalance, symbol)}
              </td>
            </tr>
          ) : null}
          {lines.map((line) => {
            const entry = lineage.entries[line.entry]
            const event = line.event ? lineage.events[line.event] : undefined
            const agent = event?.agent ? lineage.agents[event.agent] : undefined
            const isOpen = open.has(line.id)
            const description =
              entry?.memo ?? line.description ?? eventWords(event?.type) ?? entry?.type ?? ''
            return [
              <tr
                key={line.id}
                style={styles.rowButton}
                onClick={() => onToggle(line.id)}
                aria-expanded={isOpen}
                data-testid="lineage-line"
              >
                <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                  {formatDate(entry?.postingDate)}
                </td>
                <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{entry?.number ?? '—'}</td>
                <td style={styles.td}>
                  {description}
                  {agent ? <span style={styles.key}> · {agent.name}</span> : null}
                  {entry?.adjustmentKind ? (
                    <span style={styles.badge}>{adjustmentWords(entry.adjustmentKind)}</span>
                  ) : null}
                  {entry?.status === 'reversed' ? <span style={styles.badge}>reversed</span> : null}
                  {entry?.reversalOf ? <span style={styles.badge}>reversal</span> : null}
                </td>
                <td style={{ ...styles.td, ...styles.num }}>
                  {line.debit !== null ? money(line.debit, symbol) : ''}
                </td>
                <td style={{ ...styles.td, ...styles.num }}>
                  {line.credit !== null ? money(line.credit, symbol) : ''}
                </td>
              </tr>,
              isOpen ? (
                <tr key={`${line.id}-detail`}>
                  <td style={{ padding: 0 }} colSpan={5}>
                    <LineDetail lineage={lineage} line={line} symbol={symbol} />
                  </td>
                </tr>
              ) : null,
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}

export function LineageWalk({ report, fact, symbol = '$' }: LineageWalkProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const lineage = report.lineage
  const contributions = contributionsOf(report, fact)
  if (!lineage || !contributions.length) return null
  const check = checkFactLineage(report, fact)
  const entities = new Set(contributions.map((c) => c.entity))
  const toggle = (lineId: string): void => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(lineId)) next.delete(lineId)
      else next.add(lineId)
      return next
    })
  }
  return (
    <div style={styles.section} data-testid="fact-lineage">
      <div style={styles.title}>
        <span>Where it comes from</span>
        {check?.ok === true ? (
          <span style={styles.ok} title={check.actual}>
            ✓ hash verified · {check.lineCount} {check.lineCount === 1 ? 'line' : 'lines'}
          </span>
        ) : check?.ok === false ? (
          <span style={styles.bad} title={`file ${check.actual}, report ${check.expected ?? '—'}`}>
            ⚠ hash differs ({shortHash(check.actual)} in the file)
          </span>
        ) : null}
      </div>
      {contributions.map((c) => (
        <Contribution
          key={c.id}
          lineage={lineage}
          contribution={c}
          symbol={symbol}
          showEntity={entities.size > 1}
          open={open}
          onToggle={toggle}
        />
      ))}
    </div>
  )
}
