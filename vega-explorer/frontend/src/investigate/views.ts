import { withData } from '../render.ts'
import { defaultOptions, TEMPLATES, type Ctx } from '../templates/index.ts'
import type { Filter, Gesture, Lead, LeadView } from './types.ts'

const SCHEMA = 'https://vega.github.io/schema/vega-lite/v6.json'
const ACCENT = '#4f46e5'
const UNDER = '#a5a9b8'
const ALERT = '#e4572e'
const GOOD = '#2f9e6b'

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

/** One entry in a chart's key: a swatch drawn like the mark it explains. */
export interface KeyItem {
  mark: 'bar' | 'line' | 'dash' | 'dot' | 'step' | 'point' | 'tick' | 'band' | 'rule' | 'outline'
  color: string
  label: string
}

/** "How to read this": a sentence on what the chart shows, and its marks. */
export interface Guide {
  read: string
  items: KeyItem[]
}

/** What a guide can say about the step a chart belongs to. */
export interface GuideCtx {
  measureLabel: string
  bgLabel: string
  picked?: Filter | null
}

/**
 * How a lead's view is drawn and turned back into gestures. The backend picks the
 * `type` (app/engine/kinds); a new lead kind either reuses one of these, adds one
 * here, or uses "template" to draw itself with any chart from the library.
 */
export interface ViewDef {
  /** Shown when the lead kind doesn't send its own icon. */
  icon: string
  hint: (v: LeadView) => string
  build: (lead: Lead, measureLabel: string, width: number, opts: ViewOpts) => Record<string, unknown>
  guide: (lead: Lead, ctx: GuideCtx) => Guide
  /** A click on a mark: an immediate step. */
  click?: (v: LeadView, datum: Record<string, unknown>) => Gesture | null
  /** A drag across the "brush" selection: offered, then followed on confirm. */
  brush?: (v: LeadView, extent: [number, number]) => Gesture | null
  /** What autopilot would do with this view, if anything. */
  auto?: (lead: Lead) => Gesture | null
}

const eqGesture = (field: string, value: unknown, verb: string): Gesture => {
  const s = String(value)
  return { filter: { field, op: 'eq', value: s, label: `${field} = ${s}` }, via: `${verb} ${s}` }
}

const clickValue = (v: LeadView, d: Record<string, unknown>) => (d.value != null ? eqGesture(v.field, d.value, 'clicked') : null)

const autoBar = (lead: Lead): Gesture | null => {
  const v = lead.view
  const target = v.highlight ?? (v.rows[0]?.value as string | undefined)
  return target ? eqGesture(v.field, target, 'autopilot →') : null
}

const pickedFor = (v: LeadView, opts: ViewOpts) => (opts.picked?.field === v.field ? opts.picked : null)

export const VIEWS: Record<string, ViewDef> = {
  breakdown: {
    icon: '▤',
    hint: () => 'Click a bar to follow that lead.',
    build: (lead, label, width, opts) => breakdown(lead.view, label, width, pickedFor(lead.view, opts)),
    guide: breakdownGuide,
    click: clickValue,
    auto: autoBar,
  },
  trend: {
    icon: '〜',
    hint: () => 'Click a point to dig into that period, or drag across a stretch of time to ask what changed.',
    build: (lead, label, width, opts) => trend(lead.view, label, width, pickedFor(lead.view, opts), opts.compact),
    guide: trendGuide,
    click: (v, d) => {
      if (d.t == null) return null
      const iso = typeof d.t === 'string' ? d.t : localIso(Number(d.t instanceof Date ? d.t.getTime() : d.t))
      const label = periodLabel(iso, v.grain)
      return { filter: { field: v.field, op: 'range', value: [iso, iso], label }, via: `clicked ${label}` }
    },
    brush: (v, [a, b]) => {
      const lo = localIso(Math.min(a, b))
      const hi = localIso(Math.max(a, b))
      const label = `${periodLabel(lo, v.grain)} – ${periodLabel(hi, v.grain)}`
      return { filter: { field: v.field, op: 'range', value: [lo, hi], label }, via: `brushed ${label}` }
    },
    auto: (lead) => {
      const v = lead.view
      if (!v.highlight || (lead.strength !== 'strong' && lead.strength !== 'suggestive')) return null
      const t = v.highlight
      return { filter: { field: v.field, op: 'range', value: [t, t], label: periodLabel(t, v.grain) }, via: `autopilot → ${periodLabel(t, v.grain)}` }
    },
  },
  driver: {
    icon: '⇄',
    hint: (v) => (v.brushable === false ? 'Compare the two distributions.' : 'Drag across a range to investigate just those records.'),
    build: (lead, _label, width, opts) => driver(lead.view, width, pickedFor(lead.view, opts), opts.compact),
    guide: ({ view: v }, ctx) => ({
      read: `How ${v.field} is distributed: each bar is the share of records whose ${v.field} falls in that range, so the two shapes compare directly even though the groups differ in size.`,
      items: [
        { mark: 'bar', color: ACCENT, label: 'this selection' },
        { mark: 'bar', color: UNDER, label: `comparison: ${ctx.bgLabel || 'the rest'}` },
        { mark: 'rule', color: ACCENT, label: 'average, this selection' },
        { mark: 'rule', color: UNDER, label: 'average, comparison' },
        ...followedItem(v, ctx),
      ],
    }),
    brush: (v, [a, b]) => {
      if (v.brushable === false) return null
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      const label = `${v.field} ${fmt(lo)}–${fmt(hi)}`
      return { filter: { field: v.field, op: 'range', value: [lo, hi], label }, via: `brushed ${label}` }
    },
  },
  change: {
    icon: '±',
    hint: () => 'Click a bar to follow the biggest movers.',
    build: (lead, label, width, opts) => change(lead.view, label, width, pickedFor(lead.view, opts)),
    guide: ({ view: v }, ctx) => ({
      read: `Each bar is how much ${ctx.measureLabel.toLowerCase()} moved for one ${v.field} between the ${v.span} and now. The longest bars drove the change. Hover a bar for the before and after values.`,
      items: [
        { mark: 'bar', color: GOOD, label: 'went up' },
        { mark: 'bar', color: ALERT, label: 'went down' },
        ...followedItem(v, ctx),
      ],
    }),
    click: clickValue,
    auto: autoBar,
  },
  template: {
    icon: '◇',
    hint: (v) => `Click a mark to follow that ${v.key ?? v.field}.`,
    build: (lead, _label, width, opts) => fromTemplate(lead.view, width, opts),
    guide: ({ view: v }) => ({
      read: v.guide ?? `Drawn with the “${TEMPLATES.find((t) => t.id === v.template)?.name ?? v.template}” chart from the library.`,
      items: [],
    }),
    click: (v, d) => {
      const value = d[v.key ?? v.field]
      return value == null ? null : eqGesture(v.field, value, 'clicked')
    },
  },
}

const UNKNOWN: ViewDef = {
  icon: '•',
  hint: (v) => `This frontend has no view for “${v.type}”: add one to VIEWS in investigate/views.ts.`,
  guide: ({ view: v }) => ({ read: v.guide ?? '', items: [] }),
  build: (lead, _label, width) => ({
    $schema: SCHEMA,
    width,
    height: 60,
    data: { values: [{ t: `No view registered for “${lead.view.type}”` }] },
    mark: { type: 'text', fontSize: 13, color: '#888' },
    encoding: { text: { field: 't' } },
  }),
}

export const viewOf = (lead: Lead): ViewDef => VIEWS[lead.view.type] ?? UNKNOWN
export const iconOf = (lead: Lead): string => lead.icon ?? viewOf(lead).icon

export function buildSpec(lead: Lead, measureLabel: string, width: number, opts: ViewOpts = {}): Record<string, unknown> {
  return viewOf(lead).build(lead, measureLabel, width, opts)
}

/** The gesture autopilot would make on a view, if any. */
export function autoGesture(lead: Lead): Gesture | null {
  return viewOf(lead).auto?.(lead) ?? null
}

export function guideOf(lead: Lead, ctx: GuideCtx): Guide {
  const g = viewOf(lead).guide(lead, ctx)
  return { ...g, read: g.read.charAt(0).toUpperCase() + g.read.slice(1) }
}

function followedItem(v: LeadView, ctx: GuideCtx): KeyItem[] {
  return ctx.picked?.field === v.field ? [{ mark: 'outline', color: ALERT, label: 'followed ↓ the value you picked, which the next step zooms into' }] : []
}

function breakdownGuide({ view: v }: Lead, ctx: GuideCtx): Guide {
  const label = ctx.measureLabel.toLowerCase()
  const bg = ctx.bgLabel || 'the rest'
  const standout: KeyItem[] = v.highlight ? [{ mark: 'outline', color: ALERT, label: `red outline: the standout, ${v.highlight}` }] : []
  switch (v.mode) {
    case 'share':
      return {
        read: `Each bar is ${label} for one ${v.field} in this selection. The black tick is what it would be if this selection split across ${v.field} the same way as the comparison group, ${bg}. A bar past its tick means that value is over-represented here.`,
        items: [
          { mark: 'bar', color: ACCENT, label: 'more than expected' },
          { mark: 'bar', color: UNDER, label: 'less than expected' },
          { mark: 'tick', color: '#111', label: 'expected from the comparison group' },
          ...standout,
          ...followedItem(v, ctx),
        ],
      }
    case 'mean':
      return {
        read: `Each bar is ${label} for one ${v.field} in this selection. The black tick is the same ${v.field} in the comparison group, ${bg}. The gap between bar and tick is the difference.`,
        items: [
          { mark: 'bar', color: ACCENT, label: 'higher than the comparison' },
          { mark: 'bar', color: UNDER, label: 'lower than the comparison' },
          { mark: 'tick', color: '#111', label: `same ${v.field}, ${bg}` },
          ...standout,
          ...followedItem(v, ctx),
        ],
      }
    case 'like':
      return {
        read: `Like-for-like: each bar is the average per record for one ${v.field} here, and the black tick is the same ${v.field} in the comparison group, ${bg}. This removes mix: a value can hold a bigger share just because there are more of its records, without each record being different.`,
        items: [
          { mark: 'bar', color: ACCENT, label: 'higher per record than elsewhere' },
          { mark: 'bar', color: UNDER, label: 'lower per record than elsewhere' },
          { mark: 'tick', color: '#111', label: `same ${v.field}, ${bg}` },
          ...standout,
          ...followedItem(v, ctx),
        ],
      }
    case 'target':
      return {
        read: `Each bar is ${label} for one ${v.field}, and the black tick is its ${v.expectedTitle ?? 'target'}. Bars that end past their tick are above target. Sorted by the size of the gap.`,
        items: [
          { mark: 'bar', color: ACCENT, label: 'above target' },
          { mark: 'bar', color: UNDER, label: 'below target' },
          { mark: 'tick', color: '#111', label: v.expectedTitle ?? 'target' },
          ...standout,
          ...followedItem(v, ctx),
        ],
      }
    default:
      return {
        read: `Each bar is ${label} for one ${v.field} in this selection, largest first. There is no comparison group at this step, so this simply shows where the ${label} sits.`,
        items: [{ mark: 'bar', color: ACCENT, label: ctx.measureLabel }, ...followedItem(v, ctx)],
      }
  }
}

function trendGuide({ view: v }: Lead, ctx: GuideCtx): Guide {
  const has = (k: string) => v.rows.some((r) => r[k] != null)
  const items: KeyItem[] = [
    { mark: 'line', color: ACCENT, label: `${ctx.measureLabel} per ${v.grain ?? 'period'}` },
    { mark: 'dash', color: '#888', label: 'typical: median of the 5 surrounding periods' },
  ]
  if (has('rest')) items.push({ mark: 'dot', color: UNDER, label: `comparison: ${v.restLabel ?? 'rest'}` })
  if (has('target')) items.push({ mark: 'step', color: GOOD, label: v.targetLabel ?? 'target' })
  if (v.rows.some((r) => r.anomaly)) items.push({ mark: 'point', color: ALERT, label: 'unusual: far outside the normal period-to-period wobble' })
  if (v.highlight) items.push({ mark: 'rule', color: ALERT, label: 'the most unusual period' })
  if (v.window) items.push({ mark: 'band', color: ACCENT, label: 'now: the period being examined' })
  if (v.compareWindow) items.push({ mark: 'band', color: UNDER, label: 'vs: the period it is compared with' })
  items.push(...followedItem(v, ctx))
  return {
    read: `${ctx.measureLabel} over time for this selection. Points that break away from the dashed “typical” line are the ones worth a look.`,
    items,
  }
}

/** Draw a lead with a chart-library template; its rows stand in for the dataset. */
function fromTemplate(v: LeadView, width: number, opts: ViewOpts) {
  const t = TEMPLATES.find((x) => x.id === v.template)
  if (!t) throw new Error(`Unknown chart template “${v.template}”`)
  const ctx: Ctx = {
    f: v.f ?? {},
    m: v.m ?? {},
    o: { ...defaultOptions(t), ...v.o },
    rows: v.rows,
    fields: v.fields ?? [],
    w: width,
    h: opts.compact ? 170 : 300,
    cat: 'tableau10',
    seq: 'viridis',
  }
  const spec = t.build(ctx)
  // Clickable marks: a pointer says so.
  if (t.lib === 'vega-lite' && spec.mark && typeof spec.mark === 'object') spec.mark = { ...(spec.mark as object), cursor: 'pointer' }
  return withData(spec, t.lib, v.rows)
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

/** Mark a time window (a prior-period baseline's "now" and "vs" periods). */
function band([a, b]: [string, string], color: string, text: string) {
  const datum = { data: { values: [{ a, b }] } }
  const type = 'temporal'
  return [
    a === b
      ? { ...datum, mark: { type: 'rule', color, strokeWidth: 8, opacity: 0.18 }, encoding: { x: { field: 'a', type } } }
      : { ...datum, mark: { type: 'rect', color, opacity: 0.1 }, encoding: { x: { field: 'a', type }, x2: { field: 'b' } } },
    { ...datum, mark: { type: 'text', color, fontWeight: 700, fontSize: 10, y: 'height', dy: -4, text }, encoding: { x: { field: 'a', type } } },
  ]
}

function breakdown(v: LeadView, label: string, width: number, picked: Filter | null) {
  const withExpected = v.mode !== 'overview'
  const pick = pickedBar(picked, 'actual')
  const like = v.mode === 'like'
  const tgt = v.mode === 'target'
  const [more, less] = like ? ['higher than elsewhere', 'lower than elsewhere'] : tgt ? ['above target', 'below target'] : ['more than expected', 'less than expected']
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
            ? { field: 'vs', type: 'nominal', scale: { domain: [more, less], range: [ACCENT, UNDER] }, legend: null }
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
  const hasTarget = v.rows.some((r) => r.target != null)
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
      ...(hasTarget
        ? [{ mark: { type: 'line', color: GOOD, strokeDash: [6, 3], strokeWidth: 1.5, interpolate: 'step-after' }, encoding: { y: { field: 'target', type: 'quantitative' } } }]
        : []),
      ...(v.window ? band(v.window, ACCENT, 'now') : []),
      ...(v.compareWindow ? band(v.compareWindow, UNDER, 'vs') : []),
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
            ...(hasTarget ? [{ field: 'target', format: ',.3~s', title: v.targetLabel ?? 'target' }] : []),
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
          color: { field: 'group', type: 'nominal', scale: { domain: ['selection', 'rest'], range: [ACCENT, UNDER] }, legend: null },
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
