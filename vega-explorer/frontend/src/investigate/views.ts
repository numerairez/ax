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

export function buildSpec(lead: Lead, measureLabel: string, width: number): Record<string, unknown> {
  const v = lead.view
  switch (v.type) {
    case 'breakdown':
      return breakdown(v, measureLabel, width)
    case 'trend':
      return trend(v, measureLabel, width)
    case 'driver':
      return driver(v, width)
    case 'change':
      return change(v, measureLabel, width)
  }
}

function breakdown(v: LeadView, label: string, width: number) {
  const withExpected = v.mode !== 'overview'
  return {
    $schema: SCHEMA,
    width,
    height: { step: 22 },
    data: { values: v.rows },
    transform: withExpected ? [{ calculate: 'datum.actual >= datum.expected ? "more than expected" : "less than expected"', as: 'vs' }] : [],
    encoding: {
      y: { field: 'value', type: 'nominal', sort: null, title: v.field, axis: { labelLimit: 160 } },
    },
    layer: [
      {
        mark: { type: 'bar', cornerRadiusEnd: 3, cursor: 'pointer', tooltip: true },
        encoding: {
          x: { field: 'actual', type: 'quantitative', title: label },
          color: withExpected
            ? { field: 'vs', type: 'nominal', scale: { domain: ['more than expected', 'less than expected'], range: [ACCENT, UNDER] }, legend: { orient: 'bottom', title: null } }
            : { value: ACCENT },
          stroke: { condition: { test: `datum.value === ${JSON.stringify(v.highlight ?? null)}`, value: ALERT }, value: null },
          strokeWidth: { value: 2.5 },
          tooltip: [
            { field: 'value', title: v.field },
            { field: 'actual', format: ',.3~s', title: label },
            ...(withExpected ? [{ field: 'expected', format: ',.3~s', title: 'expected (like the rest)' }] : []),
            { field: 'n', title: 'records' },
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
    ],
  }
}

function trend(v: LeadView, label: string, width: number) {
  const x = { field: 't', type: 'temporal', title: null }
  const hasRest = v.rows.some((r) => r.rest != null)
  return {
    $schema: SCHEMA,
    width,
    height: 300,
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
    ],
  }
}

function driver(v: LeadView, width: number) {
  return {
    $schema: SCHEMA,
    width,
    height: 260,
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
    ],
  }
}

function change(v: LeadView, label: string, width: number) {
  return {
    $schema: SCHEMA,
    width,
    height: { step: 22 },
    data: { values: v.rows },
    mark: { type: 'bar', cornerRadiusEnd: 3, cursor: 'pointer' },
    encoding: {
      y: { field: 'value', type: 'nominal', sort: null, title: v.field },
      x: { field: 'delta', type: 'quantitative', title: `Change in ${label.toLowerCase()} vs the ${v.span}` },
      color: { condition: { test: 'datum.delta >= 0', value: '#2f9e6b' }, value: ALERT },
      tooltip: [
        { field: 'value', title: v.field },
        { field: 'before', format: ',.3~s' },
        { field: 'after', format: ',.3~s' },
        { field: 'delta', format: '+,.3~s' },
      ],
    },
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
