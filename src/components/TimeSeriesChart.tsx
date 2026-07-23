/**
 * A dependency-free SVG line chart for a metric time series — one chart per
 * chart-projection panel (a format family). Renders the series in
 * `joinChartSeries` output over the shared period x-axis.
 *
 * Framework-agnostic plain React + SVG — no chart library, no `next/*`, no CSS
 * framework. Marks follow the dataviz spec: 2px round-join lines, ≥8px end
 * markers ringed in the surface color, hairline recessive gridlines, a legend
 * whenever two or more series share the plot (identity never by color alone),
 * selective non-colliding end labels, and a hover/focus crosshair + tooltip.
 * Series colors read `--rs-chart-series-N` tokens (validated eight-hue order)
 * with light fallbacks; a host themes dark mode and its brand by setting those
 * tokens, exactly like the statement components' `--rs-*` pattern.
 *
 * The y-axis is data-driven (padded to the series range, not forced to zero) —
 * correct for a single-family line panel where the story is the shape of
 * change; the value scale is shared across the panel's series because they
 * share a format family.
 */
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { useId, useMemo, useRef, useState } from 'react'
import { formatMetricCompact, formatMetricValue } from '../chart/format'
import { seriesColor } from '../chart/palette'
import type { ChartSeriesData, MetricItemType } from '../chart/types'

export interface TimeSeriesChartProps {
  /** Series to plot — the `joinChartSeries` output for one panel. */
  series: ChartSeriesData[]
  /** Format family for axis + value formatting; defaults to the first series'. */
  itemType?: MetricItemType | string | null
  /** Optional panel heading (the format-family label). */
  title?: string
  /** Internal SVG coordinate width — the plot scales to its container. */
  width?: number
  /** Internal SVG coordinate height. */
  height?: number
}

const MARGIN = { top: 16, right: 104, bottom: 30, left: 60 }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-06-30` → `Jun '26` for x-axis ticks; raw string if unparseable. */
function shortMonth(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} '${m[1].slice(2)}`
}

/** A small set of "nice" tick values spanning [min, max]. */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min]
  const span = max - min
  const step0 = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const norm = step0 / mag
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 1e-6; v += step) ticks.push(Number(v.toFixed(10)))
  return ticks
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    fontFamily: 'var(--rs-font-sans, ui-sans-serif, system-ui, sans-serif)',
    color: 'var(--rs-text, #111827)',
  },
  title: {
    fontFamily: 'var(--rs-font-heading, var(--rs-font-sans, sans-serif))',
    fontSize: '0.9rem',
    fontWeight: 600,
    margin: '0 0 0.5rem',
  },
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.25rem 1rem',
    marginBottom: '0.5rem',
    fontSize: '0.78rem',
    color: 'var(--rs-muted, #6b7280)',
  },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: '0.4rem' },
  legendKey: { display: 'inline-block', width: 16, height: 2, borderRadius: 1 },
  empty: {
    padding: '2rem',
    textAlign: 'center',
    color: 'var(--rs-muted, #6b7280)',
    fontSize: '0.85rem',
  },
}

export function TimeSeriesChart({
  series,
  itemType,
  title,
  width = 720,
  height = 280,
}: TimeSeriesChartProps): React.JSX.Element {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [active, setActive] = useState<number | null>(null)
  const clipId = useId()

  const family = itemType ?? series[0]?.itemType ?? null
  const periodCount = series[0]?.points.length ?? 0

  const model = useMemo(() => {
    const values: number[] = []
    for (const s of series)
      for (const p of s.points) if (p.y !== null && !Number.isNaN(p.y)) values.push(p.y)
    if (!values.length) return null
    let min = Math.min(...values)
    let max = Math.max(...values)
    if (min === max) {
      const pad = Math.abs(min) * 0.1 || 1
      min -= pad
      max += pad
    } else {
      const pad = (max - min) * 0.08
      min -= pad
      max += pad
    }
    return { min, max }
  }, [series])

  if (!model || periodCount === 0) {
    return (
      <div style={styles.wrap}>
        {title && <p style={styles.title}>{title}</p>}
        <p style={styles.empty}>No data to plot for this period range.</p>
      </div>
    )
  }

  const innerW = width - MARGIN.left - MARGIN.right
  const innerH = height - MARGIN.top - MARGIN.bottom
  const { min, max } = model

  const xAt = (i: number): number =>
    periodCount === 1 ? MARGIN.left + innerW / 2 : MARGIN.left + (i / (periodCount - 1)) * innerW
  const yAt = (v: number): number => MARGIN.top + innerH - ((v - min) / (max - min)) * innerH

  const yTicks = niceTicks(min, max, 4)
  // Thin the x labels to ~6 so months don't collide.
  const xEvery = Math.max(1, Math.ceil(periodCount / 6))
  const periods = series[0].points

  // Direct end labels only when few enough series and they don't collide.
  const showEndLabels = series.length <= 4
  const placedLabelY: number[] = []

  const showLegend = series.length >= 2
  const ariaLabel =
    `${title ? `${title} — ` : ''}line chart of ${series.length} ` +
    `metric${series.length === 1 ? '' : 's'} over ${periodCount} periods`

  function handleMove(e: PointerEvent<SVGSVGElement>): void {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM?.()
    if (!svg || !ctm) return
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    if (periodCount === 1) {
      setActive(0)
      return
    }
    const frac = (pt.x - MARGIN.left) / innerW
    const idx = Math.round(frac * (periodCount - 1))
    setActive(Math.max(0, Math.min(periodCount - 1, idx)))
  }

  function handleKey(e: KeyboardEvent<SVGSVGElement>): void {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      setActive((a) => Math.min(periodCount - 1, (a ?? -1) + 1))
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setActive((a) => Math.max(0, (a ?? periodCount) - 1))
    } else if (e.key === 'Escape') {
      setActive(null)
    }
  }

  return (
    <div style={styles.wrap}>
      {title && <p style={styles.title}>{title}</p>}
      {showLegend && (
        <div style={styles.legend}>
          {series.map((s, i) => (
            <span key={s.key} style={styles.legendItem}>
              <span style={{ ...styles.legendKey, background: seriesColor(i) }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        style={{ display: 'block', outline: 'none', touchAction: 'none' }}
        onPointerMove={handleMove}
        onPointerLeave={() => setActive(null)}
        onKeyDown={handleKey}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={MARGIN.left} y={MARGIN.top} width={innerW} height={innerH} />
          </clipPath>
        </defs>

        {/* Y gridlines + ticks */}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + innerW}
              y1={yAt(t)}
              y2={yAt(t)}
              stroke="var(--rs-border, #e5e7eb)"
              strokeWidth={1}
            />
            <text
              x={MARGIN.left - 8}
              y={yAt(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill="var(--rs-muted, #6b7280)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatMetricCompact(family, t)}
            </text>
          </g>
        ))}

        {/* X ticks */}
        {periods.map((p, i) =>
          i % xEvery === 0 || i === periodCount - 1 ? (
            <text
              key={`x${p.x}`}
              x={xAt(i)}
              y={height - MARGIN.bottom + 18}
              textAnchor="middle"
              fontSize={11}
              fill="var(--rs-muted, #6b7280)"
            >
              {shortMonth(p.x)}
            </text>
          ) : null
        )}

        {/* Baseline */}
        <line
          x1={MARGIN.left}
          x2={MARGIN.left + innerW}
          y1={MARGIN.top + innerH}
          y2={MARGIN.top + innerH}
          stroke="var(--rs-border-strong, #9ca3af)"
          strokeWidth={1}
        />

        {/* Crosshair */}
        {active !== null && (
          <line
            x1={xAt(active)}
            x2={xAt(active)}
            y1={MARGIN.top}
            y2={MARGIN.top + innerH}
            stroke="var(--rs-border-strong, #9ca3af)"
            strokeWidth={1}
          />
        )}

        {/* Series lines + markers */}
        <g clipPath={`url(#${clipId})`}>
          {series.map((s, si) => {
            const color = seriesColor(si)
            const segs: string[] = []
            let pen = false
            s.points.forEach((pt, i) => {
              if (pt.y === null || Number.isNaN(pt.y)) {
                pen = false
                return
              }
              segs.push(`${pen ? 'L' : 'M'}${xAt(i)},${yAt(pt.y)}`)
              pen = true
            })
            return (
              <path
                key={s.key}
                d={segs.join(' ')}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )
          })}
        </g>

        {/* End markers + selective end labels */}
        {series.map((s, si) => {
          const color = seriesColor(si)
          // Last non-null point is the series' visual end.
          let endIdx = -1
          for (let i = s.points.length - 1; i >= 0; i--) {
            const y = s.points[i].y
            if (y !== null && !Number.isNaN(y)) {
              endIdx = i
              break
            }
          }
          if (endIdx < 0) return null
          const ey = yAt(s.points[endIdx].y as number)
          const ex = xAt(endIdx)
          let label: string | null = null
          if (showEndLabels && endIdx === periodCount - 1) {
            const collides = placedLabelY.some((py) => Math.abs(py - ey) < 13)
            if (!collides) {
              placedLabelY.push(ey)
              label = formatMetricValue(family, s.points[endIdx].y)
            }
          }
          return (
            <g key={`end${s.key}`}>
              <circle
                cx={ex}
                cy={ey}
                r={4}
                fill={color}
                stroke="var(--rs-surface, #ffffff)"
                strokeWidth={2}
              />
              {label && (
                <text
                  x={ex + 8}
                  y={ey}
                  dominantBaseline="middle"
                  fontSize={11}
                  fill="var(--rs-text, #111827)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {label}
                </text>
              )}
            </g>
          )
        })}

        {/* Active-point markers + tooltip */}
        {active !== null && (
          <ActiveReadout
            active={active}
            series={series}
            family={family}
            xAt={xAt}
            yAt={yAt}
            width={width}
            periodLabel={periods[active] ? shortMonth(periods[active].x) : ''}
            plotTop={MARGIN.top}
          />
        )}
      </svg>
    </div>
  )
}

interface ActiveReadoutProps {
  active: number
  series: ChartSeriesData[]
  family: MetricItemType | string | null
  xAt: (i: number) => number
  yAt: (v: number) => number
  width: number
  periodLabel: string
  plotTop: number
}

/** SVG-native tooltip — value-leads-label rows, keyed by a short line stroke. */
function ActiveReadout({
  active,
  series,
  family,
  xAt,
  yAt,
  width,
  periodLabel,
  plotTop,
}: ActiveReadoutProps): React.JSX.Element {
  const rows = series.map((s, i) => ({
    label: s.label,
    color: seriesColor(i),
    value: s.points[active]?.y ?? null,
    y: s.points[active]?.y,
  }))
  const rowH = 16
  const boxW = 176
  const boxH = 22 + rows.length * rowH
  const cx = xAt(active)
  const bx = cx + 12 + boxW > width ? cx - 12 - boxW : cx + 12
  const by = plotTop + 4

  return (
    <g pointerEvents="none">
      {rows.map((r) =>
        r.y !== null && r.y !== undefined && !Number.isNaN(r.y) ? (
          <circle
            key={`ap${r.label}`}
            cx={cx}
            cy={yAt(r.y)}
            r={4}
            fill={r.color}
            stroke="var(--rs-surface, #ffffff)"
            strokeWidth={2}
          />
        ) : null
      )}
      <rect
        x={bx}
        y={by}
        width={boxW}
        height={boxH}
        rx={6}
        fill="var(--rs-surface, #ffffff)"
        stroke="var(--rs-border, #e5e7eb)"
        strokeWidth={1}
      />
      <text x={bx + 10} y={by + 15} fontSize={11} fontWeight={600} fill="var(--rs-muted, #6b7280)">
        {periodLabel}
      </text>
      {rows.map((r, i) => {
        const ry = by + 22 + i * rowH + 11
        return (
          <g key={`tr${r.label}`}>
            <line
              x1={bx + 10}
              x2={bx + 24}
              y1={ry}
              y2={ry}
              stroke={r.color}
              strokeWidth={2}
              strokeLinecap="round"
            />
            <text
              x={bx + 30}
              y={ry}
              dominantBaseline="middle"
              fontSize={11}
              fill="var(--rs-muted, #6b7280)"
            >
              {r.label}
            </text>
            <text
              x={bx + boxW - 10}
              y={ry}
              dominantBaseline="middle"
              textAnchor="end"
              fontSize={11}
              fontWeight={600}
              fill="var(--rs-text, #111827)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatMetricValue(family, r.value)}
            </text>
          </g>
        )
      })}
    </g>
  )
}
