import { useState } from 'react'
import { TYPE_ICON } from '../components/Controls.tsx'
import type { DatasetMeta } from '../types.ts'
import { COUNT, type Calc, type Role, type StructField, type Structure } from './types.ts'

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: 'dimension', label: 'Dimension', hint: 'categories you can split and click into' },
  { value: 'measure', label: 'Measure', hint: 'numbers to aggregate and compare' },
  { value: 'time', label: 'Time', hint: 'the timeline of the data (one field)' },
  { value: 'lat', label: 'Latitude', hint: '' },
  { value: 'lon', label: 'Longitude', hint: '' },
  { value: 'id', label: 'Identifier', hint: 'unique per record, never aggregated' },
  { value: 'ignore', label: 'Ignore', hint: 'leave out of the investigation' },
]
const GRAINS = ['day', 'week', 'month', 'quarter', 'year']

interface Props {
  meta: DatasetMeta
  initial: Structure
  onConfirm: (s: Structure) => Promise<void>
  onReset: () => Promise<void>
  onCancel?: () => void
}

export function StructureSetup({ meta, initial, onConfirm, onReset, onCancel }: Props) {
  const [s, setS] = useState<Structure>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dims = s.fields.filter((f) => f.role === 'dimension').map((f) => f.name)
  const measures = s.fields.filter((f) => f.role === 'measure')
  const update = (name: string, patch: Partial<StructField>) =>
    setS((prev) => {
      const fields = prev.fields.map((f) => {
        if (f.name !== name) return f
        const next = { ...f, ...patch }
        if (next.role !== 'measure') next.agg = null
        else if (!next.agg) next.agg = 'sum'
        if (next.role !== 'dimension') next.parent = null
        if (next.role !== 'measure') next.target = null
        return next
      })
      // A field that stopped being a dimension can't be anyone's parent.
      const dimSet = new Set(fields.filter((f) => f.role === 'dimension').map((f) => f.name))
      for (const f of fields) if (f.parent && !dimSet.has(f.parent)) f.parent = null
      // Likewise for targets and calculated measures built on a field that stopped being a measure.
      const measureSet = new Set(fields.filter((f) => f.role === 'measure').map((f) => f.name))
      for (const f of fields) if (f.target && !measureSet.has(f.target)) f.target = null
      const usable = (n: string) => n === COUNT || measureSet.has(n)
      const calcs = prev.calcs.filter((c) => usable(c.num) && usable(c.den))
      // Only one time field.
      if (patch.role === 'time') for (const f of fields) if (f.name !== name && f.role === 'time') f.role = 'ignore'
      const timeField = fields.find((f) => f.role === 'time')?.name ?? null
      const primary =
        fields.some((f) => f.name === prev.primaryMeasure && f.role === 'measure') || calcs.some((c) => c.name === prev.primaryMeasure) ? prev.primaryMeasure : COUNT
      return { ...prev, fields, timeField, primaryMeasure: primary, calcs }
    })

  const setCalc = (i: number, patch: Partial<Calc>) =>
    setS((prev) => {
      const calcs = prev.calcs.map((c, j) => (j === i ? { ...c, ...patch } : c))
      const renamed = patch.name !== undefined && prev.primaryMeasure === prev.calcs[i].name
      return { ...prev, calcs, primaryMeasure: renamed ? (patch.name ?? COUNT) : prev.primaryMeasure }
    })
  const removeCalc = (i: number) =>
    setS((prev) => ({
      ...prev,
      calcs: prev.calcs.filter((_, j) => j !== i),
      primaryMeasure: prev.primaryMeasure === prev.calcs[i].name ? COUNT : prev.primaryMeasure,
    }))
  const addCalc = () =>
    setS((prev) => {
      const num = measures[0]?.name ?? COUNT
      return { ...prev, calcs: [...prev.calcs, { name: `${num} per record`, num, den: COUNT, scale: 1 }] }
    })

  const chains = hierarchyChains(s.fields)

  const confirm = async () => {
    setSaving(true)
    setError(null)
    try {
      await onConfirm({ ...s, timeGrain: s.timeField ? (s.timeGrain ?? 'month') : null })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="setup">
      <h1>How is “{meta.name}” structured?</h1>
      <p className="muted">
        The investigation engine uses this to choose the next chart: hierarchies decide where a click drills down, measure aggregation decides
        whether values are summed or averaged, targets power “vs target” leads, and the time field powers trend, “what changed” and
        prior-period comparisons. Everything below was detected
        automatically, so correct anything that looks wrong.
      </p>

      <div className="setup-summary">
        <div>
          <span className="k">Hierarchies</span>
          {chains.length ? (
            chains.map((c) => (
              <div key={c.join()} className="chain">
                {c.map((n, i) => (
                  <span key={n}>
                    {i > 0 && <span className="arrow"> → </span>}
                    <b>{n}</b>
                  </span>
                ))}
              </div>
            ))
          ) : (
            <div className="muted">None. Set a parent on a dimension to create one.</div>
          )}
        </div>
        <label className="control">
          <span className="control-label">Lead with measure</span>
          <select value={s.primaryMeasure} onChange={(e) => setS({ ...s, primaryMeasure: e.target.value })}>
            <option value={COUNT}>Records (count)</option>
            {measures.map((m) => (
              <option key={m.name} value={m.name}>
                {m.agg === 'mean' ? 'Avg' : 'Total'} {m.name}
              </option>
            ))}
            {s.calcs
              .filter((c) => c.name.trim())
              .map((c) => (
                <option key={`calc:${c.name}`} value={c.name}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="control">
          <span className="control-label">Time grain {s.timeField ? `(${s.timeField})` : ''}</span>
          <select value={s.timeGrain ?? 'month'} disabled={!s.timeField} onChange={(e) => setS({ ...s, timeGrain: e.target.value })}>
            {GRAINS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="table-wrap setup-table">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Role</th>
              <th>Aggregate as</th>
              <th>Parent (rolls up into)</th>
              <th>Judged against</th>
              <th>Sample</th>
            </tr>
          </thead>
          <tbody>
            {s.fields.map((f) => {
              const fm = meta.fields.find((x) => x.name === f.name)
              return (
                <tr key={f.name} className={`role-${f.role}`}>
                  <td>
                    <span className="type-icon">{fm ? TYPE_ICON[fm.type] : ''}</span> <b>{f.name}</b>
                  </td>
                  <td>
                    <select value={f.role} onChange={(e) => update(f.name, { role: e.target.value as Role })} title={ROLES.find((r) => r.value === f.role)?.hint}>
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {f.role === 'measure' ? (
                      <select value={f.agg ?? 'sum'} onChange={(e) => update(f.name, { agg: e.target.value as 'sum' | 'mean' })}>
                        <option value="sum">sum (additive)</option>
                        <option value="mean">average (a level or rate)</option>
                      </select>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {f.role === 'dimension' ? (
                      <select value={f.parent ?? ''} onChange={(e) => update(f.name, { parent: e.target.value || null })}>
                        <option value="">— top level —</option>
                        {dims
                          .filter((d) => d !== f.name)
                          .map((d) => (
                            <option key={d}>{d}</option>
                          ))}
                      </select>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {f.role === 'measure' ? (
                      <select value={f.target ?? ''} onChange={(e) => update(f.name, { target: e.target.value || null })} title="A plan, budget or limit for this measure">
                        <option value="">— no target —</option>
                        {measures
                          .filter((m) => m.name !== f.name)
                          .map((m) => (
                            <option key={m.name}>{m.name}</option>
                          ))}
                      </select>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="muted sample">{sample(fm)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <h2 className="setup-h">Calculated measures</h2>
      <p className="muted">
        Rates and ratios are summed on each side and then divided (total breaches ÷ records, total cost ÷ total revenue). Averaging per-row ratios
        would overweight small rows.
      </p>
      <div className="calcs">
        {s.calcs.map((c, i) => (
          <div key={i} className="calc-row">
            <input value={c.name} onChange={(e) => setCalc(i, { name: e.target.value })} placeholder="Name" aria-label="Measure name" />
            <span className="muted">=</span>
            <MeasurePick value={c.num} measures={measures} onChange={(num) => setCalc(i, { num })} />
            <span className="muted">÷</span>
            <MeasurePick value={c.den} measures={measures} onChange={(den) => setCalc(i, { den })} />
            <span className="muted">×</span>
            <input
              className="scale"
              type="number"
              value={c.scale}
              onChange={(e) => setCalc(i, { scale: Number(e.target.value) || 1 })}
              title="Scale, e.g. 100 for a percentage or 10000 for basis points"
              aria-label="Scale"
            />
            <button className="btn ghost small" onClick={() => removeCalc(i)} aria-label={`Remove ${c.name}`}>
              ✕
            </button>
          </div>
        ))}
        <button className="btn small" onClick={addCalc}>
          + Add ratio
        </button>
      </div>

      {error && <div className="error">⚠ {error}</div>}
      <div className="setup-actions">
        <button className="btn primary big" onClick={confirm} disabled={saving}>
          {saving ? 'Saving…' : 'Looks right, start investigating →'}
        </button>
        <button className="btn ghost" onClick={() => onReset().then(() => undefined)}>
          Re-detect
        </button>
        {onCancel && (
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

function MeasurePick({ value, measures, onChange }: { value: string; measures: StructField[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value={COUNT}>Records</option>
      {measures.map((m) => (
        <option key={m.name}>{m.name}</option>
      ))}
    </select>
  )
}

function sample(fm: DatasetMeta['fields'][number] | undefined): string {
  if (!fm) return ''
  if (fm.top) return fm.top.slice(0, 4).map((t) => t.value).join(', ') + (fm.unique > 4 ? ` … (${fm.unique})` : '')
  if (fm.stats) return `${String(fm.stats.min).slice(0, 10)} → ${String(fm.stats.max).slice(0, 10)}`
  return ''
}

function hierarchyChains(fields: StructField[]): string[][] {
  const parent = new Map(fields.filter((f) => f.parent).map((f) => [f.name, f.parent as string]))
  const isParent = new Set(parent.values())
  // Leaves: dimensions with a parent that nobody else rolls into.
  const leaves = [...parent.keys()].filter((n) => !isParent.has(n))
  return leaves.map((leaf) => {
    const chain = [leaf]
    let p = parent.get(leaf)
    while (p && !chain.includes(p)) {
      chain.unshift(p)
      p = parent.get(p)
    }
    return chain
  })
}
