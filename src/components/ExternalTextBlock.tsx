/**
 * Renders an *externalized* text-block fact — a large XBRL narrative/table
 * disclosure whose HTML body the platform offloaded to the public CDN, leaving
 * the fact's value as a `…/fact_<hash>.html` (or `.txt`) URL.
 *
 * The CDN serves these with `Access-Control-Allow-Origin: *`, so the browser can
 * fetch the body directly (no proxy). HTML bodies are self-contained fragments
 * (inline styles, no scripts) rendered inside a **sandboxed** iframe: `srcdoc`
 * plus `sandbox="allow-same-origin"` (note: no `allow-scripts`) means any script
 * in the payload is inert — XSS-safe — while the same-origin document stays
 * measurable so the frame auto-sizes to its content. Plain-text bodies render in
 * a `<pre>`.
 */
import { marked } from 'marked'
import type { CSSProperties } from 'react'
import { useEffect, useRef, useState } from 'react'

export interface ExternalTextBlockProps {
  url: string
}

type LoadState = 'loading' | 'ready' | 'error'

const styles: Record<string, CSSProperties> = {
  status: {
    fontFamily: 'var(--rs-font-sans, ui-sans-serif, system-ui, sans-serif)',
    fontSize: '0.85rem',
    color: 'var(--rs-muted, #6b7280)',
    padding: '0.75rem 0',
  },
  link: { color: 'var(--rs-primary-700, #1d4ed8)' },
  frame: { width: '100%', border: 'none', display: 'block' },
  pre: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: 'var(--rs-font-mono, ui-monospace, monospace)',
    fontSize: '0.85rem',
    color: 'var(--rs-text, #111827)',
    margin: 0,
  },
}

// Markdown-derived HTML carries bare tags (no inline styles the way SEC
// payloads do), so the host document supplies the typography: heading
// scale/spacing, bordered tables, list indentation, code/blockquote
// treatment. Applied only to converted-markdown payloads — SEC HTML keeps
// the minimal host so its own inline styles stay authoritative.
const MARKDOWN_CSS = `
    h1, h2, h3, h4 { line-height: 1.25; margin: 1.1em 0 0.45em; font-weight: 600; }
    h1 { font-size: 1.35em; margin-top: 0.2em; }
    h2 { font-size: 1.15em; }
    h3 { font-size: 1.05em; }
    p { margin: 0.55em 0; }
    ul, ol { margin: 0.55em 0; padding-left: 1.6em; }
    li { margin: 0.25em 0; }
    table { border-collapse: collapse; margin: 0.7em 0; }
    th, td { border: 1px solid #d1d5db; padding: 0.35em 0.6em; text-align: left; }
    th { background: #f3f4f6; font-weight: 600; }
    code { font-family: ui-monospace, monospace; font-size: 0.92em;
      background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 3px; }
    blockquote { margin: 0.7em 0; padding: 0.1em 1em; border-left: 3px solid #d1d5db;
      color: #4b5563; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 1em 0; }`

// A minimal host document: neutral typography, responsive media/tables, links
// open in a new tab. The payload's own inline styles ride on top.
function wrapHtml(body: string, extraCss = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
    :root { color-scheme: light; }
    body { margin: 0; color: #111827;
      font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px; line-height: 1.45; }
    img, svg { max-width: 100%; height: auto; }
    table { max-width: 100%; border-collapse: collapse; }
    a { color: #1d4ed8; }${extraCss}
  </style></head><body>${body}</body></html>`
}

/**
 * An *inline* text-block fact — the disclosure payload lives in the holon
 * itself (`rs:stringValue`), not an external CDN URL — rendered in the same
 * sandboxed frame as the externalized case. Used for holon-authored / offline
 * reports.
 *
 * `contentType` (rs:contentType) selects the payload interpretation:
 * `text/markdown` (RoboLedger-authored narratives) is converted to HTML with
 * marked before framing; anything else — including the SEC pipeline's
 * undeclared HTML text blocks — passes through as HTML.
 */
export function InlineTextBlock({
  html,
  contentType,
}: {
  html: string
  contentType?: string | null
}) {
  const md = isMarkdown(contentType)
  const body = md ? (marked.parse(html, { async: false }) as string) : html
  return <SandboxedHtml html={body} extraCss={md ? MARKDOWN_CSS : ''} />
}

function isMarkdown(contentType?: string | null): boolean {
  return (contentType ?? '').split(';')[0].trim().toLowerCase() === 'text/markdown'
}

function SandboxedHtml({ html, extraCss = '' }: { html: string; extraCss?: string }) {
  const ref = useRef<HTMLIFrameElement>(null)

  // Size the frame to its content. Content is script-free and static, so a
  // measure on load (plus one after fonts/images settle) is enough.
  const fit = () => {
    const frame = ref.current
    const doc = frame?.contentWindow?.document
    if (!frame || !doc) return
    try {
      frame.style.height = `${doc.documentElement.scrollHeight}px`
    } catch {
      // Same-origin read blocked (shouldn't happen with allow-same-origin) — leave default.
    }
  }

  return (
    <iframe
      ref={ref}
      title="Disclosure"
      sandbox="allow-same-origin"
      srcDoc={wrapHtml(html, extraCss)}
      style={styles.frame}
      onLoad={() => {
        fit()
        // Re-measure shortly after in case late layout (images/fonts) grew it.
        setTimeout(fit, 250)
      }}
    />
  )
}

export function ExternalTextBlock({ url }: ExternalTextBlockProps) {
  const [state, setState] = useState<LoadState>('loading')
  const [body, setBody] = useState('')
  const isHtml = /\.html$/i.test(url)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.text()
      })
      .then((text) => {
        if (cancelled) return
        setBody(text)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [url])

  if (state === 'loading') return <div style={styles.status}>Loading disclosure…</div>
  if (state === 'error') {
    return (
      <div style={styles.status}>
        Could not load this disclosure.{' '}
        <a style={styles.link} href={url} target="_blank" rel="noreferrer">
          Open it directly ↗
        </a>
      </div>
    )
  }
  if (!isHtml) return <pre style={styles.pre}>{body}</pre>
  return <SandboxedHtml html={body} />
}
