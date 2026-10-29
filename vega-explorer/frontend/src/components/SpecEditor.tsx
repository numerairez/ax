import { useEffect, useState } from 'react'

interface Props {
  /** Spec generated from the template (without data). */
  generated: Record<string, unknown>
  /** Currently applied override, if the user edited the spec. */
  override: Record<string, unknown> | null
  withRows: (spec: Record<string, unknown>) => Record<string, unknown>
  onApply: (spec: Record<string, unknown> | null) => void
}

export function SpecEditor({ generated, override, withRows, onApply }: Props) {
  const source = override ?? generated
  const [text, setText] = useState(() => JSON.stringify(source, null, 2))
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    setText(JSON.stringify(source, null, 2))
    setError(null)
  }, [source])

  const apply = () => {
    try {
      const parsed = JSON.parse(text)
      setError(null)
      onApply(parsed)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      setError('Clipboard not available in this browser context.')
    }
  }

  return (
    <div className="spec-editor">
      <div className="toolbar">
        <button className="btn primary" onClick={apply} title="Ctrl/⌘ + Enter">
          Apply changes
        </button>
        {override && (
          <button className="btn" onClick={() => onApply(null)}>
            Reset to template
          </button>
        )}
        <span className="spacer" />
        <button className="btn" onClick={() => copy('spec', text)}>
          {copied === 'spec' ? 'Copied ✓' : 'Copy spec'}
        </button>
        <button className="btn" onClick={() => copy('data', JSON.stringify(withRows(JSON.parse(text)), null, 2))}>
          {copied === 'data' ? 'Copied ✓' : 'Copy with data'}
        </button>
      </div>
      <p className="muted small">
        The dataset is referenced by name (<code>"table"</code>) and injected at render time. Edit freely — changes stay until you reset or change the
        mapping.
      </p>
      {error && <div className="error">⚠ {error}</div>}
      <textarea
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            apply()
          }
          if (e.key === 'Tab') {
            e.preventDefault()
            const t = e.currentTarget
            const { selectionStart: s, selectionEnd: end } = t
            setText(text.slice(0, s) + '  ' + text.slice(end))
            requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2))
          }
        }}
      />
    </div>
  )
}
