import { AGG, aggOp, aggTransform, measure, opt, P, timeEnc, TIME_UNIT, typeOf, uniq, vl, type ChartTemplate, type Ctx } from './core.ts'

const N = 'nominal' as const
const Q = 'quantitative' as const
const T = 'temporal' as const

/** Bucket the time field into "t" (or pass year-like numbers through). */
function bucket(c: Ctx, key: string, unit: string) {
  return typeOf(c, c.f[key]) === 'temporal' && unit !== 'none'
    ? { timeUnit: unit, field: c.f[key], as: 't' }
    : { calculate: `datum[${JSON.stringify(c.f[key])}]`, as: 't' }
}

function tEnc(c: Ctx, key: string, extra: Record<string, unknown> = {}) {
  return typeOf(c, c.f[key]) === 'temporal'
    ? { field: 't', type: T, title: c.f[key], ...extra }
    : { field: 't', type: Q, title: c.f[key], scale: { zero: false }, axis: { format: 'd' }, ...extra }
}

export const timeseries: ChartTemplate[] = [
  {
    id: 'calendar',
    name: 'Calendar heatmap',
    category: 'Time series',
    lib: 'vega-lite',
    description: 'GitHub-style calendar: week of year × weekday, one row per year.',
    slots: [
      { key: 'date', label: 'Date', types: [T], prefer: P.time },
      { key: 'v', label: 'Measure', types: [Q], prefer: [/temp_max|revenue|close|volume/i, ...P.measure] },
    ],
    options: [{ ...AGG, default: 'mean' }],
    build: (c) =>
      vl(c, {
        width: { step: 11 },
        height: { step: 11 },
        mark: { type: 'rect', cornerRadius: 2, tooltip: true },
        encoding: {
          x: { field: c.f.date, timeUnit: 'week', type: 'ordinal', title: null, axis: { labels: false, ticks: false, domain: false } },
          y: { field: c.f.date, timeUnit: 'day', type: 'ordinal', title: null, axis: { format: '%a', domain: false, ticks: false } },
          row: { field: c.f.date, timeUnit: 'year', type: 'ordinal', title: null, header: { labelAngle: 0, labelFontSize: 13, labelFontWeight: 'bold' } },
          color: measure(c, 'v', { scale: { scheme: c.seq }, legend: { orient: 'bottom' } }),
        },
        config: { view: { stroke: null } },
      }),
  },
  {
    id: 'punchcard',
    name: 'Hour × weekday punch card',
    category: 'Time series',
    lib: 'vega-lite',
    description: 'When does activity happen? Circles sized by an aggregate per hour of day and weekday.',
    slots: [
      { key: 'date', label: 'Timestamp', types: [T], prefer: [/order_date|timestamp|time/i, ...P.time] },
      { key: 'v', label: 'Measure', types: [Q], optional: true, prefer: P.measure },
    ],
    options: [{ ...AGG, default: 'count' }, { key: 'mark', label: 'Mark', choices: ['circle', 'rect'], default: 'circle' }],
    build: (c) =>
      vl(c, {
        mark: { type: c.o.mark, tooltip: true },
        encoding: {
          x: { field: c.f.date, timeUnit: 'hours', type: 'ordinal', title: 'Hour of day' },
          y: { field: c.f.date, timeUnit: 'day', type: 'ordinal', title: null },
          ...(c.o.mark === 'circle'
            ? { size: measure(c, 'v', { legend: null }), color: measure(c, 'v', { scale: { scheme: c.seq } }) }
            : { color: measure(c, 'v', { scale: { scheme: c.seq } }) }),
        },
      }),
  },
  {
    id: 'candlestick',
    name: 'Candlestick (OHLC)',
    category: 'Time series',
    lib: 'vega-lite',
    description: 'Open/high/low/close bars with a dropdown to switch series. Uses rule + bar layers and a bound parameter.',
    slots: [
      { key: 'date', label: 'Date', types: [T], prefer: P.time },
      { key: 'open', label: 'Open', types: [Q], prefer: [/open/i] },
      { key: 'high', label: 'High', types: [Q], prefer: [/high|max/i] },
      { key: 'low', label: 'Low', types: [Q], prefer: [/low|min/i] },
      { key: 'close', label: 'Close', types: [Q], prefer: [/close/i] },
      { key: 'series', label: 'Series', types: [N], optional: true, maxUnique: 60, prefer: [/symbol|ticker|city/i] },
    ],
    options: [{ key: 'days', label: 'Last N days', choices: ['60', '120', '250', '500'], default: '120' }],
    build: (c) => {
      const series = c.f.series ? uniq(c, c.f.series) : []
      return vl(c, {
        params: c.f.series ? [{ name: 'pick', value: series[0], bind: { input: 'select', options: series, name: `${c.f.series} ` } }] : [],
        transform: [
          ...(c.f.series ? [{ filter: `datum[${JSON.stringify(c.f.series)}] == pick` }] : []),
          { joinaggregate: [{ op: 'max', field: c.f.date, as: '_max' }] },
          { filter: `time(datum._max) - time(datum[${JSON.stringify(c.f.date)}]) <= ${Number(c.o.days)} * 864e5` },
        ],
        encoding: {
          x: { field: c.f.date, type: T, title: null },
          y: { type: Q, scale: { zero: false }, title: 'Price' },
          color: {
            condition: { test: `datum[${JSON.stringify(c.f.open)}] < datum[${JSON.stringify(c.f.close)}]`, value: '#06982d' },
            value: '#ae1325',
          },
        },
        layer: [
          { mark: 'rule', encoding: { y: { field: c.f.low }, y2: { field: c.f.high } } },
          { mark: { type: 'bar', tooltip: { content: 'data' } }, encoding: { y: { field: c.f.open }, y2: { field: c.f.close } } },
        ],
      })
    },
  },
  {
    id: 'index-chart',
    name: 'Interactive index chart',
    category: 'Time series',
    lib: 'vega-lite',
    description: 'Hover anywhere: every series is re-indexed to its value at that moment (lookup from a selection).',
    slots: [
      { key: 'date', label: 'Time', types: [T], prefer: P.time },
      { key: 'v', label: 'Value', types: [Q], prefer: [/close|price|gdp|temp_max|revenue/i] },
      { key: 'series', label: 'Series', types: [N], maxUnique: 12, prefer: [/symbol|country|city|category|species/i] },
    ],
    options: [AGG_MEAN()],
    build: (c) => {
      const isT = typeOf(c, c.f.date) === 'temporal'
      let initial: unknown
      if (isT) {
        const first = c.rows.reduce<string | null>((m, r) => {
          const v = r[c.f.date] as string | null
          return v && (!m || v < m) ? v : m
        }, null)
        const dt = new Date(first ?? '2020-01-01T00:00:00')
        initial = { year: dt.getFullYear(), month: dt.getMonth() + 1, date: 1 }
      } else {
        initial = Math.min(...c.rows.map((r) => Number(r[c.f.date])).filter(Number.isFinite))
      }
      const x = tEnc(c, 'date')
      return vl(c, {
        transform: [
          bucket(c, 'date', 'yearmonth'),
          { aggregate: [{ op: aggOp(c), field: c.f.v, as: 'v' }], groupby: ['t', c.f.series] },
        ],
        layer: [
          {
            params: [{ name: 'index', value: [{ x: initial }], select: { type: 'point', encodings: ['x'], on: 'pointerover', nearest: true } }],
            mark: 'point',
            encoding: { x, y: { field: 'v', type: Q, axis: null }, opacity: { value: 0 } },
          },
          {
            transform: [
              { lookup: c.f.series, from: { param: 'index', key: c.f.series } },
              { calculate: 'datum.index && datum.index.v > 0 ? (datum.v - datum.index.v) / datum.index.v : 0', as: 'indexed' },
            ],
            mark: { type: 'line', strokeWidth: 2 },
            encoding: {
              x,
              y: { field: 'indexed', type: Q, axis: { format: '%' }, title: `Change in ${c.f.v} vs. hovered date` },
              color: { field: c.f.series, type: N },
            },
          },
          { transform: [{ filter: { param: 'index' } }], mark: { type: 'rule', color: 'firebrick' }, encoding: { x } },
          {
            transform: [{ filter: { param: 'index' } }],
            mark: { type: 'text', color: 'firebrick', dy: -6 },
            encoding: { x, y: { value: 0 }, text: isT ? { field: 't', type: T, timeUnit: 'yearmonth' } : { field: 't', type: Q, format: 'd' } },
          },
        ],
        resolve: { scale: { y: 'independent' } },
      })
    },
  },
  {
    id: 'moving-average',
    name: 'Moving average',
    category: 'Time series',
    lib: 'vega-lite',
    description: 'Noisy daily values with a centered rolling mean from the window transform.',
    slots: [
      { key: 'date', label: 'Time', types: [T], prefer: P.time },
      { key: 'v', label: 'Measure', types: [Q], prefer: [/temp_max|close|revenue/i, ...P.measure] },
      { key: 'color', label: 'Series', types: [N], optional: true, maxUnique: 8, prefer: [/city|symbol|region|category/i] },
    ],
    options: [
      { ...AGG, default: 'mean' },
      { key: 'win', label: 'Window (days)', choices: ['7', '15', '30', '60', '90'], default: '30' },
    ],
    build: (c) => {
      const k = Math.floor(Number(c.o.win) / 2)
      const gb = c.f.color ? [c.f.color] : []
      return vl(c, {
        transform: [
          bucket(c, 'date', 'yearmonthdate'),
          { aggregate: [aggTransform(c, 'v', 'v')], groupby: ['t', ...gb] },
          { window: [{ op: 'mean', field: 'v', as: 'ma' }], frame: [-k, k], sort: [{ field: 't' }], groupby: gb },
        ],
        encoding: { x: tEnc(c, 'date'), color: opt(c, 'color', { field: c.f.color, type: N }) },
        layer: [
          { mark: { type: 'point', size: 6, opacity: 0.25, filled: true }, encoding: { y: { field: 'v', type: Q, title: c.f.v } } },
          { mark: { type: 'line', strokeWidth: 2.5, ...(c.f.color ? {} : { color: '#e45756' }) }, encoding: { y: { field: 'ma', type: Q } } },
        ],
      })
    },
  },
  {
    id: 'seasonal',
    name: 'Seasonal cycle by year',
    category: 'Time series',
    lib: 'vega-lite',
    description: 'Month on the x-axis, one line per year in a sequential palette — spot seasonality and drift.',
    slots: [
      { key: 'date', label: 'Date', types: [T], prefer: P.time },
      { key: 'v', label: 'Measure', types: [Q], prefer: [/temp_max|revenue|close/i, ...P.measure] },
    ],
    options: [{ ...AGG, default: 'mean' }],
    build: (c) =>
      vl(c, {
        mark: { type: 'line', point: true, interpolate: 'monotone', tooltip: true },
        encoding: {
          x: { field: c.f.date, timeUnit: 'month', type: 'ordinal', title: null },
          y: measure(c, 'v'),
          color: { field: c.f.date, timeUnit: 'year', type: 'ordinal', title: 'Year', scale: { scheme: c.seq } },
        },
      }),
  },
  {
    id: 'range-band',
    name: 'Range band',
    category: 'Time series',
    lib: 'vega-lite',
    description: 'Area between a low and high measure (e.g. min/max temperature) per series, with a midline.',
    slots: [
      { key: 'date', label: 'Time', types: [T], prefer: P.time },
      { key: 'lo', label: 'Low', types: [Q], prefer: [/min|low/i] },
      { key: 'hi', label: 'High', types: [Q], prefer: [/max|high/i] },
      { key: 'color', label: 'Series', types: [N], optional: true, maxUnique: 6, prefer: [/city|symbol/i] },
    ],
    options: [TIME_UNIT],
    build: (c) => {
      const gb = c.f.color ? [c.f.color] : []
      return vl(c, {
        transform: [
          bucket(c, 'date', c.o.tu),
          { aggregate: [{ op: 'mean', field: c.f.lo, as: 'lo' }, { op: 'mean', field: c.f.hi, as: 'hi' }], groupby: ['t', ...gb] },
          { calculate: '(datum.lo + datum.hi) / 2', as: 'mid' },
        ],
        encoding: { x: tEnc(c, 'date'), color: opt(c, 'color', { field: c.f.color, type: N }) },
        layer: [
          { mark: { type: 'area', opacity: 0.3, interpolate: 'monotone' }, encoding: { y: { field: 'lo', type: Q, title: `${c.f.lo} – ${c.f.hi}` }, y2: { field: 'hi' } } },
          { mark: { type: 'line', interpolate: 'monotone', tooltip: true }, encoding: { y: { field: 'mid', type: Q } } },
        ],
      })
    },
  },
  {
    id: 'bump',
    name: 'Bump chart (rank over time)',
    category: 'Time series',
    lib: 'vega-lite',
    description: 'How group rankings change period by period — aggregate, then rank with a window transform.',
    slots: [
      { key: 'date', label: 'Time', types: [T, Q], prefer: [/date|year/i] },
      { key: 'v', label: 'Measure', types: [Q], prefer: P.measure },
      { key: 'color', label: 'Group', types: [N], maxUnique: 25, prefer: [/sub_category|city|country|symbol|category/i] },
    ],
    options: [AGG, { key: 'tu', label: 'Time unit', choices: ['yearquarter', 'year', 'yearmonth'], default: 'yearquarter' }],
    build: (c) => {
      const isT = typeOf(c, c.f.date) === 'temporal'
      return vl(c, {
        transform: [
          bucket(c, 'date', c.o.tu),
          ...(isT ? [] : [{ filter: 'datum.t % 5 == 0' }]),
          { aggregate: [aggTransform(c, 'v', 'v')], groupby: ['t', c.f.color] },
          { window: [{ op: 'rank', as: 'rank' }], sort: [{ field: 'v', order: 'descending' }], groupby: ['t'] },
        ],
        encoding: {
          x: isT ? { field: 't', type: 'ordinal', timeUnit: c.o.tu, title: null } : { field: 't', type: 'ordinal', title: c.f.date },
          y: { field: 'rank', type: 'ordinal', title: 'Rank' },
          color: { field: c.f.color, type: N },
        },
        layer: [
          { mark: { type: 'line', interpolate: 'monotone', strokeWidth: 2.5 } },
          { mark: { type: 'circle', size: 70, opacity: 1, tooltip: true } },
        ],
      })
    },
  },
  {
    id: 'time-heatstrip',
    name: 'Time × group heat strips',
    category: 'Time series',
    lib: 'vega-lite',
    description: 'One colored strip per group, cells per time period. Dense yet readable for many series.',
    slots: [
      { key: 'date', label: 'Time', types: [T, Q], prefer: [/date|year/i] },
      { key: 'y', label: 'Group', types: [N], maxUnique: 50, prefer: [/city|symbol|country|sub_category/i] },
      { key: 'v', label: 'Measure', types: [Q], prefer: [/temp_max|daily_return|life|revenue/i] },
    ],
    options: [{ ...AGG, default: 'mean' }, { ...TIME_UNIT, default: 'yearmonth' }],
    build: (c) => {
      const isT = typeOf(c, c.f.date) === 'temporal'
      return vl(c, {
        height: { step: 16 },
        mark: { type: 'rect', tooltip: true },
        encoding: {
          x: isT ? { field: c.f.date, timeUnit: c.o.tu === 'none' ? 'yearmonth' : c.o.tu, type: 'ordinal', title: null, axis: { format: '%b %y', labelAngle: -60, labelOverlap: true } } : { field: c.f.date, type: 'ordinal' },
          y: { field: c.f.y, type: N, title: null, sort: { op: aggOp(c), field: c.f.v, order: 'descending' } },
          color: measure(c, 'v', { scale: { scheme: c.seq } }),
        },
        config: { view: { stroke: null }, axis: { domain: false, ticks: false } },
      })
    },
  },
  {
    id: 'streamgraph',
    name: 'Streamgraph',
    category: 'Time series',
    lib: 'vega-lite',
    description: 'Center-stacked, smoothly interpolated areas — an organic view of composition over time.',
    slots: [
      { key: 'x', label: 'Time', types: [T], prefer: P.time },
      { key: 'y', label: 'Measure', types: [Q], prefer: P.measure },
      { key: 'color', label: 'Series', types: [N], maxUnique: 20, prefer: [/sub_category|category|symbol|city|country/i] },
    ],
    options: [AGG, { ...TIME_UNIT, default: 'yearweek' }],
    build: (c) =>
      vl(c, {
        mark: { type: 'area', interpolate: 'basis', tooltip: true },
        encoding: {
          x: timeEnc(c, c.f.x, c.o.tu, { axis: { domain: false, tickSize: 0 } }),
          y: measure(c, 'y', { stack: 'center', axis: null }),
          color: { field: c.f.color, type: N },
        },
      }),
  },
]

function AGG_MEAN() {
  return { ...AGG, choices: ['mean', 'median', 'sum', 'max', 'min'], default: 'mean' }
}
