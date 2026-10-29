import { AGG, aggTransform, opt, P, vl, type ChartTemplate } from './core.ts'

const N = 'nominal' as const
const Q = 'quantitative' as const
const T = 'temporal' as const

const PX = [/gdp|petal_length|unit_price|temp_min|sepal_length|discount/i]
const PY = [/life|petal_width|profit|temp_max|sepal_width|rating/i]

export const relationships: ChartTemplate[] = [
  {
    id: 'regression',
    name: 'Scatter + regression',
    category: 'Relationships',
    lib: 'vega-lite',
    description: 'Fit linear, log, exponential, power or polynomial trends per group with the regression transform.',
    slots: [
      { key: 'x', label: 'X', types: [Q], prefer: PX },
      { key: 'y', label: 'Y', types: [Q], prefer: PY },
      { key: 'color', label: 'Group', types: [N], optional: true, maxUnique: 8, prefer: P.category },
    ],
    options: [{ key: 'method', label: 'Method', choices: ['linear', 'log', 'exp', 'pow', 'quad', 'poly'], default: 'linear' }],
    build: (c) => {
      const color = opt(c, 'color', { field: c.f.color, type: N })
      return vl(c, {
        encoding: {
          x: { field: c.f.x, type: Q, scale: { zero: false } },
          y: { field: c.f.y, type: Q, scale: { zero: false } },
          color,
        },
        layer: [
          { mark: { type: 'circle', opacity: 0.35, size: 24, tooltip: { content: 'data' } } },
          {
            mark: { type: 'line', strokeWidth: 3, ...(color ? {} : { color: '#e45756' }) },
            transform: [
              {
                regression: c.f.y,
                on: c.f.x,
                method: c.o.method,
                ...(c.o.method === 'poly' ? { order: 3 } : {}),
                groupby: c.f.color ? [c.f.color] : [],
              },
            ],
          },
        ],
      })
    },
  },
  {
    id: 'loess',
    name: 'LOESS smoothing',
    category: 'Relationships',
    lib: 'vega-lite',
    description: 'Locally-estimated scatterplot smoothing reveals non-linear trends.',
    slots: [
      { key: 'x', label: 'X', types: [Q, T], prefer: [/date|year|gdp|temp_min/i] },
      { key: 'y', label: 'Y', types: [Q], prefer: PY },
      { key: 'color', label: 'Group', types: [N], optional: true, maxUnique: 8, prefer: P.category },
    ],
    options: [{ key: 'bw', label: 'Bandwidth', choices: ['0.1', '0.2', '0.3', '0.5', '0.8'], default: '0.3' }],
    build: (c) => {
      const isT = c.fields.find((f) => f.name === c.f.x)?.type === 'temporal'
      const xType = isT ? T : Q
      return vl(c, {
        encoding: {
          x: { field: c.f.x, type: xType, ...(isT ? {} : { scale: { zero: false } }) },
          y: { field: c.f.y, type: Q, scale: { zero: false } },
          color: opt(c, 'color', { field: c.f.color, type: N }),
        },
        layer: [
          { mark: { type: 'point', filled: true, opacity: 0.25, size: 12 } },
          {
            mark: { type: 'line', strokeWidth: 3, ...(c.f.color ? {} : { color: '#e45756' }) },
            transform: [{ loess: c.f.y, on: c.f.x, bandwidth: Number(c.o.bw), groupby: c.f.color ? [c.f.color] : [] }],
          },
        ],
      })
    },
  },
  {
    id: 'splom',
    name: 'Scatter plot matrix (SPLOM)',
    category: 'Relationships',
    lib: 'vega-lite',
    description: 'Every pair of measures with repeat. Brush any cell — the selection highlights everywhere.',
    slots: [
      { key: 'dims', label: 'Measures', types: [Q], multi: 4, prefer: [/petal|sepal|stem|gdp|life|fertility|temp|unit_price|profit|discount/i] },
      { key: 'color', label: 'Color', types: [N], optional: true, maxUnique: 8, prefer: P.category },
    ],
    build: (c) => {
      const dims = c.m.dims
      const cell = Math.max(90, Math.min(160, Math.floor(c.w / dims.length) - 10))
      return {
        $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
        data: { name: 'table' },
        repeat: { row: dims, column: [...dims].reverse() },
        spec: {
          width: cell,
          height: cell,
          mark: { type: 'point', filled: true, size: 10, opacity: 0.6 },
          params: [{ name: 'brush', select: { type: 'interval', resolve: 'global' } }],
          encoding: {
            x: { field: { repeat: 'column' }, type: Q, scale: { zero: false } },
            y: { field: { repeat: 'row' }, type: Q, scale: { zero: false } },
            color: {
              condition: { param: 'brush', ...(c.f.color ? { field: c.f.color, type: N } : { value: '#4c78a8' }) },
              value: '#ddd',
            },
          },
        },
      }
    },
  },
  {
    id: 'parallel',
    name: 'Parallel coordinates',
    category: 'Relationships',
    lib: 'vega-lite',
    description: 'Each row is a polyline across normalized axes — built from fold, joinaggregate and calculate transforms.',
    slots: [
      { key: 'dims', label: 'Axes', types: [Q], multi: 5, prefer: [/petal|sepal|stem|gdp|life|fertility|co2|internet|temp|wind|humid|unit_price|profit|discount|rating/i] },
      { key: 'color', label: 'Color', types: [N], maxUnique: 10, prefer: P.category },
    ],
    build: (c) => {
      const dims = c.m.dims
      return vl(c, {
        transform: [
          { sample: 500 },
          { window: [{ op: 'count', as: 'index' }] },
          { fold: dims },
          { joinaggregate: [{ op: 'min', field: 'value', as: 'min' }, { op: 'max', field: 'value', as: 'max' }], groupby: ['key'] },
          { calculate: '(datum.value - datum.min) / (datum.max - datum.min)', as: 'norm_val' },
          { calculate: '(datum.min + datum.max) / 2', as: 'mid' },
        ],
        layer: [
          { mark: { type: 'rule', color: '#ccc' }, encoding: { detail: { aggregate: 'count' }, x: { field: 'key', type: N, sort: dims } } },
          {
            mark: { type: 'line', strokeWidth: 1 },
            encoding: {
              color: { field: c.f.color, type: N },
              detail: { field: 'index', type: N },
              opacity: { value: 0.35 },
              x: { field: 'key', type: N, sort: dims },
              y: { field: 'norm_val', type: Q, axis: null },
              tooltip: dims.map((f) => ({ field: f, type: Q })),
            },
          },
          {
            encoding: { x: { field: 'key', type: N, sort: dims }, y: { value: 0 } },
            layer: [
              { mark: { type: 'text', style: 'label' }, encoding: { text: { aggregate: 'max', field: 'max', format: '.3~g' } } },
              { mark: { type: 'tick', style: 'tick', size: 8, color: '#ccc' } },
            ],
          },
          {
            encoding: { x: { field: 'key', type: N, sort: dims }, y: { value: c.h } },
            layer: [
              { mark: { type: 'text', style: 'label' }, encoding: { text: { aggregate: 'min', field: 'min', format: '.3~g' } } },
              { mark: { type: 'tick', style: 'tick', size: 8, color: '#ccc' } },
            ],
          },
        ],
        config: {
          axisX: { domain: false, labelAngle: 0, tickColor: '#ccc', title: null },
          view: { stroke: null },
          style: { label: { baseline: 'middle', align: 'right', dx: -5 }, tick: { orient: 'horizontal' } },
        },
      })
    },
  },
  {
    id: 'annotated-heatmap',
    name: 'Annotated heatmap',
    category: 'Relationships',
    lib: 'vega-lite',
    description: 'Two categorical axes, color for the aggregated measure and text labels that flip color for contrast.',
    slots: [
      { key: 'x', label: 'Columns', types: [N], maxUnique: 20, prefer: [/category|channel|condition|sector|continent|site/i] },
      { key: 'y', label: 'Rows', types: [N], maxUnique: 25, prefer: [/region|city|segment|symbol|species|team/i] },
      { key: 'color', label: 'Measure', types: [Q], prefer: P.measure },
    ],
    options: [{ ...AGG, default: 'mean' }],
    build: (c) =>
      vl(c, {
        width: { step: Math.max(30, Math.floor(c.w / 10)) },
        height: { step: 28 },
        transform: [{ aggregate: [aggTransform(c, 'color', 'value')], groupby: [c.f.x, c.f.y] }],
        encoding: { x: { field: c.f.x, type: N, axis: { labelAngle: -30 } }, y: { field: c.f.y, type: N } },
        layer: [
          { mark: { type: 'rect', tooltip: true }, encoding: { color: { field: 'value', type: Q, title: `${c.o.agg} ${c.f.color ?? ''}`, scale: { scheme: c.seq } } } },
          {
            mark: { type: 'text', fontSize: 10 },
            transform: [{ joinaggregate: [{ op: 'max', field: 'value', as: 'vmax' }] }],
            encoding: {
              text: { field: 'value', type: Q, format: '.3~s' },
              color: { condition: { test: 'datum.value > datum.vmax * 0.55', value: 'white' }, value: 'black' },
            },
          },
        ],
      }),
  },
  {
    id: 'connected-scatter',
    name: 'Connected scatter plot',
    category: 'Relationships',
    lib: 'vega-lite',
    description: 'Two measures over time; the path order follows a time field. Pick a series to follow.',
    slots: [
      { key: 'x', label: 'X', types: [Q], prefer: [/gdp|close|temp_min/i, ...PX] },
      { key: 'y', label: 'Y', types: [Q], prefer: [/life|volume|temp_max/i, ...PY] },
      { key: 'order', label: 'Order by', types: [T, Q], prefer: [/year|date/i] },
      { key: 'series', label: 'Series', types: [N], maxUnique: 60, prefer: [/country|symbol|city|species/i] },
    ],
    options: [AGG_MEAN()],
    build: (c) => {
      const isT = c.fields.find((f) => f.name === c.f.order)?.type === 'temporal'
      const series = [...new Set(c.rows.map((r) => String(r[c.f.series])))].sort()
      return vl(c, {
        transform: [
          isT ? { timeUnit: 'year', field: c.f.order, as: 'step' } : { calculate: `datum[${JSON.stringify(c.f.order)}]`, as: 'step' },
          {
            aggregate: [
              { op: aggOp(c), field: c.f.x, as: c.f.x },
              { op: aggOp(c), field: c.f.y, as: c.f.y },
            ],
            groupby: ['step', c.f.series],
          },
        ],
        encoding: {
          x: { field: c.f.x, type: Q, scale: { zero: false } },
          y: { field: c.f.y, type: Q, scale: { zero: false } },
          order: { field: 'step' },
          color: { field: c.f.series, type: N, legend: series.length > 20 ? { columns: 2, symbolLimit: 60 } : {} },
          opacity: { condition: { param: 'pick', value: 1 }, value: 0.06 },
        },
        layer: [
          {
            params: [{ name: 'pick', value: series.slice(0, 3).map((s) => ({ [c.f.series]: s })), select: { type: 'point', fields: [c.f.series] }, bind: 'legend' }],
            mark: { type: 'line', strokeWidth: 2 },
          },
          { mark: { type: 'point', filled: true, size: 30, tooltip: true }, encoding: { tooltip: [{ field: c.f.series }, { field: 'step', ...(isT ? { type: T, timeUnit: 'year' } : {}) }, { field: c.f.x }, { field: c.f.y }] } },
        ],
      })
    },
  },
  {
    id: 'waterfall',
    name: 'Waterfall chart',
    category: 'Part-to-whole',
    lib: 'vega-lite',
    description: 'Running-total waterfall: each bar floats from the previous cumulative value; colors show sign.',
    slots: [
      { key: 'x', label: 'Step', types: [N, T], maxUnique: 40, prefer: [/date|sub_category|category/i] },
      { key: 'y', label: 'Change', types: [Q], prefer: [/profit|daily_return|return|change|delta/i, ...P.measure] },
    ],
    options: [{ key: 'tu', label: 'Time unit (if time)', choices: ['yearquarter', 'yearmonth', 'year'], default: 'yearquarter' }],
    build: (c) => {
      const isT = c.fields.find((f) => f.name === c.f.x)?.type === 'temporal'
      return vl(c, {
        transform: [
          isT ? { timeUnit: c.o.tu, field: c.f.x, as: 'step' } : { calculate: `datum[${JSON.stringify(c.f.x)}]`, as: 'step' },
          { aggregate: [{ op: 'sum', field: c.f.y, as: 'amount' }], groupby: ['step'] },
          { window: [{ op: 'sum', field: 'amount', as: 'sum' }], sort: [{ field: 'step' }] },
          { calculate: 'datum.sum - datum.amount', as: 'prev' },
          { calculate: "datum.amount >= 0 ? 'increase' : 'decrease'", as: 'direction' },
        ],
        encoding: {
          x: { field: 'step', type: 'ordinal', ...(isT ? { timeUnit: c.o.tu } : { sort: null }), title: null, axis: { labelAngle: -45 } },
        },
        layer: [
          {
            mark: { type: 'bar', size: Math.max(6, Math.floor(c.w / 30)), tooltip: true },
            encoding: {
              y: { field: 'prev', type: Q, title: `Cumulative ${c.f.y}` },
              y2: { field: 'sum' },
              color: { field: 'direction', type: N, scale: { domain: ['increase', 'decrease'], range: ['#4c9a5f', '#d6604d'] }, legend: null },
            },
          },
          { mark: { type: 'rule', strokeDash: [2, 2], opacity: 0.6 }, encoding: { y: { field: 'sum', type: Q } } },
        ],
      })
    },
  },
]

function aggOp(c: { o: Record<string, string> }) {
  return c.o.agg ?? 'mean'
}

function AGG_MEAN() {
  return { ...AGG, choices: ['mean', 'median', 'sum', 'max', 'min'], default: 'mean' }
}
