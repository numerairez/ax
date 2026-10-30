import type { Filter, Lead, LeadView } from './types.ts'

const SCHEMA = 'https://vega.github.io/schema/vega-lite/v6.json'
const ACCENT = '#4f46e5'
const UNDER = '#a5a9b8'
const ALERT = '#e4572e'

export function fmt(v: unknown): string {
  const n = Number(v)
  if (v == null || !Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e9) return `${(n / 1e9).toPrecision(3)}B`
  if (a >= 1e6) return `${(n / 1e6).toPrecision(3)}M`
  if (a >= 1e4) return `${(n / 1e3).toPrecision(3)}k`
  if (a >= 100) return Math.round(n).toLocaleString()
  return n.toPrecision(3).replace(/\.?0+$/, '')
}

/** Local ISO without timezone, matching how the backend serializes dates. */
export function localIso(ms: number): string {
  const d = new Date(ms)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function periodLabel(iso: string, grain = 'month'): string {
  const d = new Date(iso)
  if (grain === 'year') return String(d.getFullYear())
  if (grain === 'quarter') return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`
  if (grain === 'month') return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** How a chart is drawn inside the story: `picked` is the gesture that led to the next step, kept visible. */
export interface ViewOpts {
  picked?: Filter | null
  compact?: boolean
}

export function buildSpec(lead: Lead, measureLabel: string, width: number, opts: ViewOpts = {}): Record<string, unknown> {
  const v = lead.view
  const picked = opts.picked?.field === v.field ? opts.picked : null
  switch (v.type) {
    case 'breakdown':
      return breakdown(v, measureLabel, width, picked)
    case 'trend':
      return trend(v, measureLabel, width, picked, opts.compact)
    case 'driver':
      return driver(v, width, picked, opts.compact)
    case 'change':
      return change(v, measureLabel, width, picked)
  }
}

/** Dim everything but the bar that was followed, and label it. */
function pickedBar(picked: Filter | null, x: string) {
  if (!picked) return { opacity: [], layers: [] }
  const test = `datum.value === ${JSON.stringify(picked.value)}`
  return {
    opacity: [{ opacity: { condition: { test, value: 1 }, value: 0.28 } }],
    layers: [
      {
        transform: [{ filter: test }],
        mark: { type: 'text', align: 'left', dx: 6, fontWeight: 700, color: ALERT, text: 'followed ↓' },
        encoding: { x: { field: x, type: 'quantitative' } },
      },
    ],
  }
}

/** Shade the range that was brushed or clicked. */
function pickedRange(picked: Filter | null, type: 'temporal' | 'quantitative') {
  if (!picked || picked.op !== 'range') return []
  const [a, b] = picked.value as [string | number, string | number]
  const datum = { data: { values: [{ a, b }] } }
  if (a === b)
    return [
      { ...datum, mark: { type: 'rule', color: ALERT, strokeWidth: 2 }, encoding: { x: { field: 'a', type } } },
      { ...datum, mark: { type: 'text', color: ALERT, fontWeight: 700, dy: -6, y: 0, text: 'followed ↓' }, encoding: { x: { field: 'a', type } } },
    ]
  return [
    { ...datum, mark: { type: 'rect', color: ALERT, opacity: 0.12 }, encoding: { x: { field: 'a', type }, x2: { field: 'b' } } },
    { ...datum, mark: { type: 'text', color: ALERT, fontWeight: 700, align: 'left', dx: 4, y: 0, dy: 10, text: 'followed ↓' }, encoding: { x: { field: 'a', type } } },
  ]
}

function breakdown(v: LeadView, label: string, width: number, picked: Filter | null) {
  const withExpected = v.mode !== 'overview'
  const pick = pickedBar(picked, 'actual')
  const like = v.mode === 'like'
  const [more, less] = like ? ['higher than elsewhere', 'lower than elsewhere'] : ['more than expected', 'less than expected']
  const xTitle = v.xTitle ?? label
  return {
    $schema: SCHEMA,
    width,
    height: { step: 22 },
    data: { values: v.rows },
    transform: withExpected ? [{ calculate: `datum.actual >= datum.expected ? ${JSON.stringify(more)} : ${JSON.stringify(less)}`, as: 'vs' }] : [],
    encoding: {
      y: { field: 'value', type: 'nominal', sort: null, title: v.field, axis: { labelLimit: 160 } },
    },
    layer: [
      {
        mark: { type: 'bar', cornerRadiusEnd: 3, cursor: 'pointer', tooltip: true },
        encoding: {
          x: { field: 'actual', type: 'quantitative', title: xTitle },
          color: withExpected
            ? { field: 'vs', type: 'nominal', scale: { domain: [more, less], range: [ACCENT, UNDER] }, legend: { orient: 'bottom', title: like ? '│ = same value elsewhere' : null } }
            : { value: ACCENT },
          stroke: { condition: { test: `datum.value === ${JSON.stringify(v.highlight ?? null)}`, value: ALERT }, value: null },
          strokeWidth: { value: 2.5 },
          ...pick.opacity[0],
          tooltip: [
            { field: 'value', title: v.field },
            { field: 'actual', format: ',.3~s', title: like ? 'here' : label },
            ...(withExpected ? [{ field: 'expected', format: ',.3~s', title: v.expectedTitle ?? 'expected (like the rest)' }] : []),
            { field: 'n', title: 'records' },
            ...(like ? [{ field: 'nb', title: 'records elsewhere' }] : []),
          ],
        },
      },
      ...(withExpected
        ? [
            {
              mark: { type: 'tick', color: '#111', thickness: 2, size: 18 },
              encoding: { x: { field: 'expected', type: 'quantitative' } },
            },
          ]
        : []),
      ...pick.layers,
    ],
  }
}

function trend(v: LeadView, label: string, width: number, picked: Filter | null, compact?: boolean) {
  const x = { field: 't', type: 'temporal', title: null }
  const hasRest = v.rows.some((r) => r.rest != null)
  return {
    $schema: SCHEMA,
    width,
    height: compact ? 170 : 300,
    data: { values: v.rows },
    encoding: { x },
    layer: [
      {
        params: [{ name: 'brush', select: { type: 'interval', encodings: ['x'] } }],
        mark: { type: 'area', opacity: 0.12, color: ACCENT, interpolate: 'monotone' },
        encoding: { y: { field: 'value', type: 'quantitative', title: label } },
      },
      { mark: { type: 'line', color: ACCENT, strokeWidth: 2.5, interpolate: 'monotone' }, encoding: { y: { field: 'value', type: 'quantitative' } } },
      {
        mark: { type: 'line', color: '#888', strokeDash: [4, 3], strokeWidth: 1.2, interpolate: 'monotone' },
        encoding: { y: { field: 'baseline', type: 'quantitative' } },
      },
      ...(hasRest
        ? [{ mark: { type: 'line', color: UNDER, strokeDash: [1, 3], strokeWidth: 1.5 }, encoding: { y: { field: 'rest', type: 'quantitative' } } }]
        : []),
      {
        mark: { type: 'point', filled: true, cursor: 'pointer', size: 45 },
        encoding: {
          y: { field: 'value', type: 'quantitative' },
          color: { condition: { test: 'datum.anomaly', value: ALERT }, value: ACCENT },
          size: { condition: { test: 'datum.anomaly', value: 120 }, value: 30 },
          tooltip: [
            { field: 't', type: 'temporal', title: 'period' },
            { field: 'value', format: ',.3~s', title: label },
            { field: 'baseline', format: ',.3~s', title: 'typical (rolling median)' },
            ...(hasRest ? [{ field: 'rest', format: ',.3~s', title: v.restLabel ?? 'rest' }] : []),
          ],
        },
      },
      ...(v.highlight
        ? [
            {
              data: { values: [{ t: v.highlight }] },
              mark: { type: 'rule', color: ALERT, strokeDash: [2, 2] },
              encoding: { x: { field: 't', type: 'temporal' } },
            },
          ]
        : []),
      ...pickedRange(picked, 'temporal'),
    ],
  }
}

function driver(v: LeadView, width: number, picked: Filter | null, compact?: boolean) {
  return {
    $schema: SCHEMA,
    width,
    height: compact ? 160 : 260,
    data: { values: v.rows },
    layer: [
      {
        params: [{ name: 'brush', select: { type: 'interval', encodings: ['x'] } }],
        mark: { type: 'bar', opacity: 0.55, binSpacing: 0, tooltip: true },
        encoding: {
          x: { field: 'x0', type: 'quantitative', bin: 'binned', title: v.field },
          x2: { field: 'x1' },
          y: { field: 'share', type: 'quantitative', stack: null, axis: { format: '%' }, title: 'Share of records' },
          color: { field: 'group', type: 'nominal', scale: { domain: ['selection', 'rest'], range: [ACCENT, UNDER] }, legend: { orient: 'top', title: null } },
        },
      },
      {
        data: { values: [{ group: 'selection', m: v.means?.selection }, { group: 'rest', m: v.means?.rest }] },
        mark: { type: 'rule', strokeWidth: 2.5 },
        encoding: {
          x: { field: 'm', type: 'quantitative' },
          color: { field: 'group', type: 'nominal', scale: { domain: ['selection', 'rest'], range: [ACCENT, UNDER] } },
        },
      },
      ...pickedRange(picked, 'quantitative'),
    ],
  }
}

function change(v: LeadView, label: string, width: number, picked: Filter | null) {
  const pick = pickedBar(picked, 'delta')
  return {
    $schema: SCHEMA,
    width,
    height: { step: 22 },
    data: { values: v.rows },
    encoding: { y: { field: 'value', type: 'nominal', sort: null, title: v.field } },
    layer: [
      {
        mark: { type: 'bar', cornerRadiusEnd: 3, cursor: 'pointer' },
        encoding: {
          x: { field: 'delta', type: 'quantitative', title: `Change in ${label.toLowerCase()} vs the ${v.span}` },
          color: { condition: { test: 'datum.delta >= 0', value: '#2f9e6b' }, value: ALERT },
          ...pick.opacity[0],
          tooltip: [
            { field: 'value', title: v.field },
            { field: 'before', format: ',.3~s' },
            { field: 'after', format: ',.3~s' },
            { field: 'delta', format: '+,.3~s' },
          ],
        },
      },
      ...pick.layers,
    ],
  }
}

/** The gesture autopilot would make on a view, if any. */
export function autoGesture(lead: Lead): { filter: Filter; via: string } | null {
  const v = lead.view
  if (v.type === 'breakdown' || v.type === 'change') {
    const target = v.highlight ?? (v.rows[0]?.value as string | undefined)
    if (!target) return null
    return { filter: { field: v.field, op: 'eq', value: target, label: `${v.field} = ${target}` }, via: `autopilot → ${target}` }
  }
  if (v.type === 'trend' && v.highlight && (lead.strength === 'strong' || lead.strength === 'suggestive')) {
    const t = v.highlight
    return { filter: { field: v.field, op: 'range', value: [t, t], label: periodLabel(t, v.grain) }, via: `autopilot → ${periodLabel(t, v.grain)}` }
  }
  return null
}
