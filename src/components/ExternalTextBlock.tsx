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

// A minimal host document: neutral typography, responsive media/tables, links
// open in a new tab. The payload's own inline styles ride on top.
function wrapHtml(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
    :root { color-scheme: light; }
    body { margin: 0; color: #111827;
      font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px; line-height: 1.45; }
    img, svg { max-width: 100%; height: auto; }
    table { max-width: 100%; border-collapse: collapse; }
    a { color: #1d4ed8; }
  </style></head><body>${body}</body></html>`
}

function SandboxedHtml({ html }: { html: string }) {
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
      srcDoc={wrapHtml(html)}
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
