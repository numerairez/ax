import type { ChartTemplate, Mapping, Slot } from '../templates/index.ts'
import { candidates } from '../templates/index.ts'
import type { FieldMeta, FieldType } from '../types.ts'

export const TYPE_ICON: Record<FieldType, string> = { quantitative: '#', temporal: '◷', nominal: 'Aa' }

interface Props {
  template: ChartTemplate
  fields: FieldMeta[]
  mapping: Mapping
  options: Record<string, string>
  onMapping: (m: Mapping) => void
  onOptions: (o: Record<string, string>) => void
}

export function Controls({ template, fields, mapping, options, onMapping, onOptions }: Props) {
  return (
    <div className="controls">
      {template.slots.map((slot) =>
        slot.multi ? (
          <MultiSlot key={slot.key} slot={slot} fields={fields} value={mapping.m[slot.key] ?? []} onChange={(v) => onMapping({ ...mapping, m: { ...mapping.m, [slot.key]: v } })} />
        ) : (
          <SingleSlot key={slot.key} slot={slot} fields={fields} value={mapping.f[slot.key] ?? ''} onChange={(v) => onMapping({ ...mapping, f: { ...mapping.f, [slot.key]: v } })} />
        ),
      )}
      {(template.options ?? []).map((o) => (
        <label key={o.key} className="control option">
          <span className="control-label">{o.label}</span>
          <select value={options[o.key] ?? o.default} onChange={(e) => onOptions({ ...options, [o.key]: e.target.value })}>
            {o.choices.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      ))}
    </div>
  )
}

function SingleSlot({ slot, fields, value, onChange }: { slot: Slot; fields: FieldMeta[]; value: string; onChange: (v: string) => void }) {
  const suggested = candidates(slot, fields)
  const names = new Set(suggested.map((f) => f.name))
  const others = fields.filter((f) => !names.has(f.name))
  const current = fields.find((f) => f.name === value)
  return (
    <label className="control">
      <span className="control-label">
        {slot.label}
        <span className="slot-types">{slot.types.map((t) => TYPE_ICON[t]).join(' ')}</span>
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={current ? `t-${current.type}` : 'empty'}>
        {slot.optional ? <option value="">— none —</option> : !value && <option value="">— pick a field —</option>}
        <optgroup label="Suggested">
          {suggested.map((f) => (
            <option key={f.name} value={f.name}>
              {TYPE_ICON[f.type]} {f.name}
            </option>
          ))}
        </optgroup>
        {others.length > 0 && (
          <optgroup label="Other fields">
            {others.map((f) => (
              <option key={f.name} value={f.name}>
                {TYPE_ICON[f.type]} {f.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  )
}

function MultiSlot({ slot, fields, value, onChange }: { slot: Slot; fields: FieldMeta[]; value: string[]; onChange: (v: string[]) => void }) {
  const pool = fields.filter((f) => f.type === 'quantitative')
  return (
    <div className="control multi">
      <span className="control-label">
        {slot.label} <span className="hint">({value.length} selected — click to toggle)</span>
      </span>
      <div className="chips">
        {pool.map((f) => {
          const on = value.includes(f.name)
          return (
            <button
              key={f.name}
              type="button"
              className={`chip ${on ? 'on' : ''}`}
              onClick={() => onChange(on ? value.filter((v) => v !== f.name) : [...value, f.name])}
            >
              {f.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
