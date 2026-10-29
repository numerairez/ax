import { useState } from 'react'
import type { Dataset, FieldMeta } from '../types.ts'
import { TYPE_ICON } from './Controls.tsx'

const fmt = (v: unknown) => {
  if (v == null) return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 3 })
  return String(v)
}

export function DataPanel({ dataset }: { dataset: Dataset }) {
  const [limit, setLimit] = useState(100)
  const { meta, rows } = dataset
  return (
    <div className="data-panel">
      <p className="muted">
        {meta.rows.toLocaleString()} rows × {meta.fields.length} fields
        {meta.truncatedFrom ? ` (sampled from ${meta.truncatedFrom.toLocaleString()})` : ''} — {meta.description}
      </p>
      <div className="profiles">
        {meta.fields.map((f) => (
          <FieldProfile key={f.name} f={f} total={meta.rows} />
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {meta.fields.map((f) => (
                <th key={f.name} className={`t-${f.type}`}>
                  <span className="type-icon">{TYPE_ICON[f.type]}</span> {f.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r, i) => (
              <tr key={i}>
                {meta.fields.map((f) => (
                  <td key={f.name} className={f.type === 'quantitative' ? 'num' : ''}>
                    {fmt(r[f.name])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {limit < rows.length && (
        <button className="btn" onClick={() => setLimit(limit + 200)}>
          Show more rows ({(rows.length - limit).toLocaleString()} remaining)
        </button>
      )}
    </div>
  )
}

function FieldProfile({ f, total }: { f: FieldMeta; total: number }) {
  const max = Math.max(1, ...(f.top ?? []).map((t) => t.count))
  return (
    <div className={`profile t-${f.type}`}>
      <div className="profile-head">
        <span className="type-icon">{TYPE_ICON[f.type]}</span>
        <strong title={f.name}>{f.name}</strong>
      </div>
      <div className="profile-meta">
        {f.type} · {f.unique.toLocaleString()} distinct{f.missing ? ` · ${f.missing} missing (${((f.missing / total) * 100).toFixed(1)}%)` : ''}
      </div>
      {f.type === 'quantitative' && f.stats && (
        <dl className="stats">
          {(['min', '50%', 'mean', 'max'] as const).map((k) => (
            <div key={k}>
              <dt>{k === '50%' ? 'median' : k}</dt>
              <dd>{fmt(f.stats![k])}</dd>
            </div>
          ))}
        </dl>
      )}
      {f.type === 'temporal' && f.stats && (
        <div className="profile-range">
          {String(f.stats.min).slice(0, 10)} → {String(f.stats.max).slice(0, 10)}
        </div>
      )}
      {f.top && (
        <ul className="top">
          {f.top.slice(0, 5).map((t) => (
            <li key={t.value}>
              <span className="bar" style={{ width: `${(t.count / max) * 100}%` }} />
              <span className="label">{t.value}</span>
              <span className="count">{t.count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
