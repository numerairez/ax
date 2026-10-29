import { AGG, aggOp, aggTransform, measure, numRange, opt, P, timeEnc, TIME_UNIT, typeOf, uniq, VL_SCHEMA, vl, type ChartTemplate } from './core.ts'

const N = 'nominal' as const
const Q = 'quantitative' as const
const T = 'temporal' as const

export const interactive: ChartTemplate[] = [
  {
    id: 'brush-link',
    name: 'Brush & linked bars',
    category: 'Interactive',
    lib: 'vega-lite',
    description: 'Drag a rectangle on the scatter plot; the bar chart below recounts only the selected points.',
    slots: [
      { key: 'x', label: 'X', types: [Q], prefer: [/gdp|unit_price|petal_length|temp_min/i] },
      { key: 'y', label: 'Y', types: [Q], prefer: [/life|profit|petal_width|temp_max/i] },
      { key: 'cat', label: 'Bars by', types: [N], maxUnique: 20, prefer: P.category },
    ],
    build: (c) => ({
      $schema: VL_SCHEMA,
      data: { name: 'table' },
      vconcat: [
        {
          width: c.w,
          height: c.h * 0.75,
          params: [{ name: 'brush', select: { type: 'interval' } }],
          mark: { type: 'point', filled: true, size: 18 },
          encoding: {
            x: { field: c.f.x, type: Q, scale: { zero: false } },
            y: { field: c.f.y, type: Q, scale: { zero: false } },
            color: { condition: { param: 'brush', field: c.f.cat, type: N }, value: '#ccc' },
            opacity: { condition: { param: 'brush', value: 0.8 }, value: 0.3 },
          },
        },
        {
          width: c.w,
          transform: [{ filter: { param: 'brush' } }],
          mark: { type: 'bar', tooltip: true },
          encoding: {
            y: { field: c.f.cat, type: N, sort: '-x', title: null },
            x: { aggregate: 'count', type: Q, title: 'Selected points' },
            color: { field: c.f.cat, type: N, legend: null },
          },
        },
      ],
    }),
  },
  {
    id: 'crossfilter',
    name: 'Crossfilter histograms',
    category: 'Interactive',
    lib: 'vega-lite',
    description: 'Brush any histogram to filter all the others — repeat + layered background/foreground bars.',
    slots: [{ key: 'dims', label: 'Measures', types: [Q], multi: 3, prefer: [/temp_max|precip|wind|unit_price|discount|rating|gdp|life|fertility|petal|stem|daily_return|volume/i] }],
    build: (c) => ({
      $schema: VL_SCHEMA,
      data: { name: 'table' },
      repeat: { column: c.m.dims },
      spec: {
        width: Math.max(140, Math.floor(c.w / c.m.dims.length) - 20),
        height: 160,
        layer: [
          {
            params: [{ name: 'brush', select: { type: 'interval', encodings: ['x'] } }],
            mark: 'bar',
            encoding: {
              x: { field: { repeat: 'column' }, bin: { maxbins: 25 }, type: Q },
              y: { aggregate: 'count', type: Q },
              color: { value: '#ddd' },
            },
          },
          {
            transform: [{ filter: { param: 'brush' } }],
            mark: 'bar',
            encoding: {
              x: { field: { repeat: 'column' }, bin: { maxbins: 25 }, type: Q },
              y: { aggregate: 'count', type: Q },
            },
          },
        ],
      },
    }),
  },
  {
    id: 'interactive-legend',
    name: 'Clickable legend',
    category: 'Interactive',
    lib: 'vega-lite',
    description: 'Click legend entries (shift-click for several) to highlight series. Selection bound to the legend.',
    slots: [
      { key: 'x', label: 'Time', types: [T], prefer: P.time },
      { key: 'y', label: 'Measure', types: [Q], prefer: P.measure },
      { key: 'color', label: 'Series', types: [N], maxUnique: 16, prefer: [/sub_category|category|symbol|city|continent/i] },
    ],
    options: [AGG, TIME_UNIT],
    build: (c) =>
      vl(c, {
        params: [{ name: 'pick', select: { type: 'point', fields: [c.f.color] }, bind: 'legend' }],
        mark: { type: 'area', interpolate: 'monotone', tooltip: true },
        encoding: {
          x: timeEnc(c, c.f.x, c.o.tu),
          y: measure(c, 'y', { stack: 'zero' }),
          color: { field: c.f.color, type: N },
          opacity: { condition: { param: 'pick', value: 1 }, value: 0.12 },
        },
      }),
  },
  {
    id: 'focus-context',
    name: 'Overview + detail',
    category: 'Interactive',
    lib: 'vega-lite',
    description: 'Brush the small overview to zoom the detail chart (scale domain driven by a selection).',
    slots: [
      { key: 'x', label: 'Time', types: [T], prefer: P.time },
      { key: 'y', label: 'Measure', types: [Q], prefer: [/close|temp_max|revenue/i, ...P.measure] },
    ],
    options: [{ ...AGG, default: 'mean' }, { ...TIME_UNIT, default: 'yearmonthdate' }],
    build: (c) => {
      const x = timeEnc(c, c.f.x, c.o.tu)
      return {
        $schema: VL_SCHEMA,
        data: { name: 'table' },
        vconcat: [
          {
            width: c.w,
            height: c.h * 0.8,
            mark: { type: 'area', line: true, opacity: 0.6, tooltip: true },
            encoding: { x: { ...x, scale: { domain: { param: 'brush' } }, title: null }, y: measure(c) },
          },
          {
            width: c.w,
            height: 60,
            params: [{ name: 'brush', select: { type: 'interval', encodings: ['x'] } }],
            mark: { type: 'area', opacity: 0.5 },
            encoding: { x, y: measure(c, 'y', { axis: { tickCount: 3, grid: false }, title: null }) },
          },
        ],
      }
    },
  },
  {
    id: 'hover-rule',
    name: 'Hover rule with tooltip',
    category: 'Interactive',
    lib: 'vega-lite',
    description: 'Multi-series lines with a vertical rule that snaps to the nearest date and shows every series value (pivot transform).',
    slots: [
      { key: 'x', label: 'Time', types: [T, Q], prefer: [/date|year/i] },
      { key: 'y', label: 'Measure', types: [Q], prefer: P.measure },
      { key: 'color', label: 'Series', types: [N], maxUnique: 12, prefer: [/symbol|city|category|continent/i] },
    ],
    options: [{ ...AGG, default: 'mean' }, TIME_UNIT],
    build: (c) => {
      const isT = typeOf(c, c.f.x) === 'temporal'
      const series = uniq(c, c.f.color, 12)
      const tx = isT
        ? { field: 't', type: T, title: c.f.x }
        : { field: 't', type: Q, title: c.f.x, scale: { zero: false }, axis: { format: 'd' } }
      return vl(c, {
        transform: [
          isT && c.o.tu !== 'none' ? { timeUnit: c.o.tu, field: c.f.x, as: 't' } : { calculate: `datum[${JSON.stringify(c.f.x)}]`, as: 't' },
          { aggregate: [aggTransform(c, 'y', 'v')], groupby: ['t', c.f.color] },
        ],
        encoding: { x: tx },
        layer: [
          { encoding: { y: { field: 'v', type: Q, title: `${aggOp(c)} ${c.f.y}` }, color: { field: c.f.color, type: N } }, layer: [
            { mark: { type: 'line', interpolate: 'monotone' } },
            { transform: [{ filter: { param: 'hover', empty: false } }], mark: { type: 'point', filled: true, size: 50 } },
          ] },
          {
            transform: [{ pivot: c.f.color, value: 'v', groupby: ['t'] }],
            mark: { type: 'rule', color: 'gray' },
            encoding: {
              opacity: { condition: { value: 0.4, param: 'hover', empty: false }, value: 0 },
              tooltip: [
                isT ? { field: 't', type: T, title: c.f.x } : { field: 't', type: Q, format: 'd' },
                ...series.map((s) => ({ field: s, type: Q, format: ',.2f' })),
              ],
            },
            params: [{ name: 'hover', select: { type: 'point', fields: ['t'], nearest: true, on: 'pointerover', clear: 'pointerout' } }],
          },
        ],
      })
    },
  },
  {
    id: 'gapminder',
    name: 'Animated-style bubble slider',
    category: 'Interactive',
    lib: 'vega-lite',
    description: 'Gapminder-style bubbles. Drag the slider to step through time; hover a bubble to see its path.',
    slots: [
      { key: 'x', label: 'X', types: [Q], prefer: [/gdp|unit_price|fertility/i] },
      { key: 'y', label: 'Y', types: [Q], prefer: [/life|profit|internet/i] },
      { key: 'size', label: 'Size', types: [Q], prefer: [/population|revenue|volume/i] },
      { key: 'color', label: 'Color', types: [N], maxUnique: 10, prefer: [/continent|region|sector|category/i] },
      { key: 'id', label: 'Entity', types: [N], prefer: [/country|city|symbol|name/i] },
      { key: 'frame', label: 'Frame (integer)', types: [Q], integer: true, prefer: [/year/i] },
    ],
    options: [{ key: 'xscale', label: 'X scale', choices: ['log', 'linear'], default: 'log' }],
    build: (c) => {
      const [lo, hi] = numRange(c, c.f.frame)
      const fr = JSON.stringify(c.f.frame)
      const x = { field: c.f.x, type: Q, scale: { type: c.o.xscale, zero: false, domain: numRange(c, c.f.x).map((v) => (c.o.xscale === 'log' ? Math.max(v, 1) : v)) } }
      const y = { field: c.f.y, type: Q, scale: { zero: false, domain: numRange(c, c.f.y) } }
      return vl(c, {
        params: [
          { name: 'frame', value: lo, bind: { input: 'range', min: lo, max: hi, step: 1, name: `${c.f.frame} ` } },
        ],
        layer: [
          {
            data: { values: [{}] },
            mark: { type: 'text', text: { expr: 'frame' }, x: c.w / 2, y: c.h / 2, fontSize: 90, opacity: 0.08, fontWeight: 'bold' },
          },
          {
            transform: [{ filter: { param: 'hovered', empty: false } }],
            mark: { type: 'line', color: '#999', strokeDash: [3, 2] },
            encoding: { x, y, order: { field: c.f.frame }, detail: { field: c.f.id } },
          },
          {
            transform: [{ filter: `datum[${fr}] == frame` }],
            params: [{ name: 'hovered', select: { type: 'point', fields: [c.f.id], on: 'pointerover', clear: 'pointerout' } }],
            mark: { type: 'circle', opacity: 0.75, stroke: 'white', strokeWidth: 0.6 },
            encoding: {
              x,
              y,
              size: { field: c.f.size, type: Q, scale: { range: [20, 2500], domain: [0, numRange(c, c.f.size)[1]] } },
              color: { field: c.f.color, type: N },
              order: { field: c.f.size, sort: 'descending' },
              tooltip: [{ field: c.f.id }, { field: c.f.x }, { field: c.f.y }, { field: c.f.size }],
            },
          },
        ],
      })
    },
  },
  {
    id: 'zoom-pan',
    name: 'Zoom & pan scatter',
    category: 'Interactive',
    lib: 'vega-lite',
    description: 'Scroll to zoom and drag to pan — an interval selection bound to the scales. Double-click resets.',
    slots: [
      { key: 'x', label: 'X', types: [Q], prefer: [/gdp|unit_price|petal_length|temp_min|volume/i] },
      { key: 'y', label: 'Y', types: [Q], prefer: [/life|profit|petal_width|temp_max|daily_return/i] },
      { key: 'color', label: 'Color', types: [N], optional: true, maxUnique: 10, prefer: P.category },
    ],
    build: (c) =>
      vl(c, {
        params: [{ name: 'grid', select: 'interval', bind: 'scales' }],
        mark: { type: 'circle', opacity: 0.6, tooltip: { content: 'data' } },
        encoding: {
          x: { field: c.f.x, type: Q, scale: { zero: false } },
          y: { field: c.f.y, type: Q, scale: { zero: false } },
          color: opt(c, 'color', { field: c.f.color, type: N }),
        },
      }),
  },
  {
    id: 'dropdown-filter',
    name: 'Dropdown & radio filters',
    category: 'Interactive',
    lib: 'vega-lite',
    description: 'Parameters bound to HTML widgets: pick a category from a dropdown and a breakdown from radio buttons.',
    slots: [
      { key: 'x', label: 'Time', types: [T], prefer: P.time },
      { key: 'y', label: 'Measure', types: [Q], prefer: P.measure },
      { key: 'pick', label: 'Filter by', types: [N], maxUnique: 40, prefer: [/category|city|symbol|country|species/i] },
      { key: 'color', label: 'Color by', types: [N], maxUnique: 8, prefer: [/channel|segment|condition|sector|site/i] },
    ],
    options: [AGG, TIME_UNIT],
    build: (c) => {
      const values = uniq(c, c.f.pick)
      return vl(c, {
        params: [
          { name: 'choice', value: values[0], bind: { input: 'select', options: values, name: `${c.f.pick} ` } },
          { name: 'mark_type', value: 'line', bind: { input: 'radio', options: ['line', 'bar'], name: 'Style ' } },
        ],
        transform: [{ filter: `datum[${JSON.stringify(c.f.pick)}] == choice` }],
        layer: [
          { transform: [{ filter: "mark_type == 'line'" }], mark: { type: 'line', point: true, interpolate: 'monotone' } },
          { transform: [{ filter: "mark_type == 'bar'" }], mark: { type: 'bar' } },
        ],
        encoding: { x: timeEnc(c, c.f.x, c.o.tu), y: measure(c), color: { field: c.f.color, type: N }, tooltip: [{ field: c.f.color }, measure(c)] },
      })
    },
  },
  {
    id: 'drilldown',
    name: 'Click to drill down',
    category: 'Interactive',
    lib: 'vega-lite',
    description: 'Click a bar to filter the trend line below to that category. Click empty space to reset.',
    slots: [
      { key: 'cat', label: 'Category', types: [N], maxUnique: 25, prefer: P.category },
      { key: 'x', label: 'Time', types: [T, Q], prefer: [/date|year/i] },
      { key: 'y', label: 'Measure', types: [Q], prefer: P.measure },
    ],
    options: [AGG, TIME_UNIT],
    build: (c) => ({
      $schema: VL_SCHEMA,
      data: { name: 'table' },
      vconcat: [
        {
          width: c.w,
          height: 160,
          params: [{ name: 'sel', select: { type: 'point', fields: [c.f.cat] } }],
          mark: { type: 'bar', cursor: 'pointer', tooltip: true },
          encoding: {
            x: { field: c.f.cat, type: N, sort: '-y', axis: { labelAngle: -35 } },
            y: measure(c),
            color: { condition: { param: 'sel', field: c.f.cat, type: N, legend: null }, value: '#ddd' },
          },
        },
        {
          width: c.w,
          height: c.h * 0.6,
          transform: [{ filter: { param: 'sel' } }],
          mark: { type: 'area', line: true, opacity: 0.4, interpolate: 'monotone', tooltip: true },
          encoding: { x: timeEnc(c, c.f.x, c.o.tu), y: measure(c), color: { value: '#4c78a8' } },
        },
      ],
    }),
  },
]
