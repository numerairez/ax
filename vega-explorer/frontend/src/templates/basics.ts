import { AGG, aggTransform, measure, opt, P, timeEnc, TIME_UNIT, vl, type ChartTemplate } from './core.ts'

const N = 'nominal' as const
const Q = 'quantitative' as const
const T = 'temporal' as const

export const basics: ChartTemplate[] = [
  {
    id: 'bar',
    name: 'Bar chart',
    category: 'Basics',
    lib: 'vega-lite',
    description: 'One bar per category, sized by an aggregated measure.',
    slots: [
      { key: 'x', label: 'Category', types: [N], maxUnique: 30, prefer: P.category },
      { key: 'y', label: 'Measure', types: [Q], prefer: P.measure },
    ],
    options: [AGG, { key: 'sort', label: 'Sort', choices: ['-y', 'y', 'x', 'none'], default: '-y' }],
    build: (c) =>
      vl(c, {
        mark: { type: 'bar', cornerRadiusEnd: 3, tooltip: true },
        encoding: {
          x: { field: c.f.x, type: N, sort: c.o.sort === 'none' ? null : c.o.sort, axis: { labelAngle: -35 } },
          y: measure(c),
        },
      }),
  },
  {
    id: 'hbar-labels',
    name: 'Ranked bars with labels',
    category: 'Basics',
    lib: 'vega-lite',
    description: 'Horizontal bars sorted by value, with value labels layered on top.',
    slots: [
      { key: 'y', label: 'Category', types: [N], maxUnique: 40, prefer: [/sub_category|city|country|name/i, ...P.category] },
      { key: 'x', label: 'Measure', types: [Q], prefer: P.measure },
    ],
    options: [AGG],
    build: (c) =>
      vl(c, {
        height: { step: 18 },
        encoding: {
          y: { field: c.f.y, type: N, sort: '-x', title: null },
          x: measure(c, 'x'),
        },
        layer: [
          { mark: { type: 'bar', cornerRadiusEnd: 3, tooltip: true } },
          { mark: { type: 'text', align: 'left', dx: 4, fontSize: 10 }, encoding: { text: { ...measure(c, 'x'), format: '~s' } } },
        ],
      }),
  },
  {
    id: 'grouped-bar',
    name: 'Grouped bar chart',
    category: 'Basics',
    lib: 'vega-lite',
    description: 'Side-by-side bars per sub-group using the xOffset channel.',
    slots: [
      { key: 'x', label: 'Category', types: [N], maxUnique: 12, prefer: P.category },
      { key: 'y', label: 'Measure', types: [Q], prefer: P.measure },
      { key: 'color', label: 'Group', types: [N], maxUnique: 8 },
    ],
    options: [AGG],
    build: (c) =>
      vl(c, {
        mark: { type: 'bar', tooltip: true },
        encoding: {
          x: { field: c.f.x, type: N, axis: { labelAngle: 0 } },
          xOffset: { field: c.f.color },
          y: measure(c),
          color: { field: c.f.color, type: N },
        },
      }),
  },
  {
    id: 'stacked-bar',
    name: 'Stacked bar chart',
    category: 'Basics',
    lib: 'vega-lite',
    description: 'Stacked bars; switch stacking to normalize for 100% bars or center for diverging layouts.',
    slots: [
      { key: 'x', label: 'Category', types: [N, T], maxUnique: 30, prefer: P.category },
      { key: 'y', label: 'Measure', types: [Q], prefer: P.measure },
      { key: 'color', label: 'Stack by', types: [N], maxUnique: 10 },
    ],
    options: [AGG, { key: 'stack', label: 'Stacking', choices: ['zero', 'normalize', 'center'], default: 'zero' }, TIME_UNIT],
    build: (c) =>
      vl(c, {
        mark: { type: 'bar', tooltip: true },
        encoding: {
          x:
            c.fields.find((f) => f.name === c.f.x)?.type === 'temporal'
              ? timeEnc(c, c.f.x, c.o.tu === 'none' ? 'yearmonth' : c.o.tu)
              : { field: c.f.x, type: N, axis: { labelAngle: -35 } },
          y: measure(c, 'y', { stack: c.o.stack, ...(c.o.stack === 'normalize' ? { axis: { format: '%' } } : {}) }),
          color: { field: c.f.color, type: N },
        },
      }),
  },
  {
    id: 'line',
    name: 'Line chart',
    category: 'Basics',
    lib: 'vega-lite',
    description: 'A measure over time, aggregated by a time unit. Try different interpolations.',
    slots: [
      { key: 'x', label: 'Time', types: [T], prefer: P.time },
      { key: 'y', label: 'Measure', types: [Q], prefer: P.measure },
    ],
    options: [
      AGG,
      TIME_UNIT,
      { key: 'interp', label: 'Interpolate', choices: ['monotone', 'linear', 'step', 'basis', 'cardinal'], default: 'monotone' },
      { key: 'points', label: 'Points', choices: ['yes', 'no'], default: 'yes' },
    ],
    build: (c) =>
      vl(c, {
        mark: { type: 'line', interpolate: c.o.interp, point: c.o.points === 'yes', tooltip: true },
        encoding: { x: timeEnc(c, c.f.x, c.o.tu), y: measure(c) },
      }),
  },
  {
    id: 'multi-line',
    name: 'Multi-series line',
    category: 'Basics',
    lib: 'vega-lite',
    description: 'One line per group, each colored by series.',
    slots: [
      { key: 'x', label: 'Time', types: [T], prefer: P.time },
      { key: 'y', label: 'Measure', types: [Q], prefer: P.measure },
      { key: 'color', label: 'Series', types: [N], maxUnique: 12, prefer: P.category },
    ],
    options: [AGG_MEAN_OR_SUM(), TIME_UNIT],
    build: (c) =>
      vl(c, {
        mark: { type: 'line', interpolate: 'monotone', strokeWidth: 2, tooltip: true },
        encoding: { x: timeEnc(c, c.f.x, c.o.tu), y: measure(c), color: { field: c.f.color, type: N } },
      }),
  },
  {
    id: 'area',
    name: 'Stacked area',
    category: 'Basics',
    lib: 'vega-lite',
    description: 'Stacked areas over time. Normalize to see shares change.',
    slots: [
      { key: 'x', label: 'Time', types: [T], prefer: P.time },
      { key: 'y', label: 'Measure', types: [Q], prefer: P.measure },
      { key: 'color', label: 'Stack by', types: [N], maxUnique: 10, prefer: P.category, optional: true },
    ],
    options: [AGG, TIME_UNIT, { key: 'stack', label: 'Stacking', choices: ['zero', 'normalize'], default: 'zero' }],
    build: (c) =>
      vl(c, {
        mark: { type: 'area', interpolate: 'monotone', line: !c.f.color, tooltip: true, opacity: 0.85 },
        encoding: {
          x: timeEnc(c, c.f.x, c.o.tu),
          y: measure(c, 'y', { stack: c.o.stack, ...(c.o.stack === 'normalize' ? { axis: { format: '%' } } : {}) }),
          color: opt(c, 'color', { field: c.f.color, type: N }),
        },
      }),
  },
  {
    id: 'scatter',
    name: 'Scatter plot',
    category: 'Basics',
    lib: 'vega-lite',
    description: 'Two measures plotted against each other, optionally colored and shaped by categories.',
    slots: [
      { key: 'x', label: 'X', types: [Q], prefer: [/gdp|petal_length|unit_price|temp_min|open/i] },
      { key: 'y', label: 'Y', types: [Q], prefer: [/life|petal_width|profit|temp_max|close/i] },
      { key: 'color', label: 'Color', types: [N], optional: true, maxUnique: 10, prefer: P.category },
      { key: 'shape', label: 'Shape', types: [N], optional: true, maxUnique: 6 },
    ],
    options: [
      { key: 'xscale', label: 'X scale', choices: ['linear', 'log', 'sqrt'], default: 'linear' },
      { key: 'filled', label: 'Filled', choices: ['yes', 'no'], default: 'yes' },
    ],
    build: (c) =>
      vl(c, {
        mark: { type: 'point', filled: c.o.filled === 'yes', opacity: 0.6, tooltip: { content: 'data' } },
        encoding: {
          x: { field: c.f.x, type: Q, scale: { type: c.o.xscale, zero: false } },
          y: { field: c.f.y, type: Q, scale: { zero: false } },
          color: opt(c, 'color', { field: c.f.color, type: N }),
          shape: opt(c, 'shape', { field: c.f.shape, type: N }),
        },
      }),
  },
  {
    id: 'bubble',
    name: 'Bubble chart',
    category: 'Basics',
    lib: 'vega-lite',
    description: 'Scatter plot where point area encodes a third measure.',
    slots: [
      { key: 'x', label: 'X', types: [Q], prefer: [/gdp|unit_price|petal_length|wind/i] },
      { key: 'y', label: 'Y', types: [Q], prefer: [/life|profit|petal_width|temp_max/i] },
      { key: 'size', label: 'Size', types: [Q], prefer: [/population|revenue|stem|precip|volume/i] },
      { key: 'color', label: 'Color', types: [N], optional: true, maxUnique: 10, prefer: P.category },
    ],
    options: [{ key: 'xscale', label: 'X scale', choices: ['linear', 'log'], default: 'linear' }],
    build: (c) =>
      vl(c, {
        mark: { type: 'circle', opacity: 0.55, stroke: 'white', strokeWidth: 0.5, tooltip: { content: 'data' } },
        encoding: {
          x: { field: c.f.x, type: Q, scale: { type: c.o.xscale, zero: false } },
          y: { field: c.f.y, type: Q, scale: { zero: false } },
          size: { field: c.f.size, type: Q, scale: { range: [4, 900] } },
          color: opt(c, 'color', { field: c.f.color, type: N }),
          order: { field: c.f.size, sort: 'descending' },
        },
      }),
  },
  {
    id: 'donut',
    name: 'Pie & donut',
    category: 'Basics',
    lib: 'vega-lite',
    description: 'Arc marks with theta encoding; adjust the inner radius to switch between pie and donut.',
    slots: [
      { key: 'color', label: 'Category', types: [N], maxUnique: 10, prefer: P.category },
      { key: 'theta', label: 'Measure', types: [Q], prefer: P.measure },
    ],
    options: [AGG, { key: 'inner', label: 'Inner radius', choices: ['0', '50', '80', '110'], default: '80' }],
    build: (c) => {
      const r = Math.min(c.w, c.h) / 2 - 10
      return vl(c, {
        width: c.h,
        encoding: {
          theta: measure(c, 'theta', { stack: true }),
          color: { field: c.f.color, type: N },
          order: { ...measure(c, 'theta'), sort: 'descending' },
        },
        layer: [
          { mark: { type: 'arc', innerRadius: Math.min(Number(c.o.inner), r - 20), outerRadius: r, padAngle: 0.01, cornerRadius: 3, tooltip: true } },
          {
            mark: { type: 'text', radius: r + 14, fontSize: 10 },
            encoding: { text: { ...measure(c, 'theta'), format: '.2~s' } },
          },
        ],
      })
    },
  },
  {
    id: 'lollipop',
    name: 'Lollipop chart',
    category: 'Basics',
    lib: 'vega-lite',
    description: 'A lighter-weight alternative to bars: a rule plus a dot.',
    slots: [
      { key: 'y', label: 'Category', types: [N], maxUnique: 40, prefer: [/sub_category|city|country/i, ...P.category] },
      { key: 'x', label: 'Measure', types: [Q], prefer: P.measure },
    ],
    options: [AGG_MEAN_OR_SUM()],
    build: (c) =>
      vl(c, {
        height: { step: 18 },
        encoding: { y: { field: c.f.y, type: N, sort: '-x', title: null }, x: measure(c, 'x') },
        layer: [
          { mark: { type: 'rule', strokeWidth: 2, opacity: 0.5 } },
          { mark: { type: 'circle', size: 90, opacity: 1, tooltip: true } },
        ],
      }),
  },
  {
    id: 'dot-plot',
    name: 'Cleveland dot plot',
    category: 'Basics',
    lib: 'vega-lite',
    description: 'Compare a measure across groups for each category with aligned dots and a connecting range.',
    slots: [
      { key: 'y', label: 'Category', types: [N], maxUnique: 30, prefer: [/sub_category|city|country/i, ...P.category] },
      { key: 'x', label: 'Measure', types: [Q], prefer: P.measure },
      { key: 'color', label: 'Compare', types: [N], maxUnique: 6, prefer: [/channel|segment|site|sector|cross/i] },
    ],
    options: [AGG_MEAN_OR_SUM('mean')],
    build: (c) =>
      vl(c, {
        height: { step: 20 },
        encoding: { y: { field: c.f.y, type: N, title: null, sort: '-x' }, x: measure(c, 'x', { scale: { zero: false } }) },
        layer: [
          { mark: { type: 'line', color: '#bbb' }, encoding: { detail: { field: c.f.y, type: N } } },
          { mark: { type: 'point', filled: true, size: 70, opacity: 1, tooltip: true }, encoding: { color: { field: c.f.color, type: N } } },
        ],
      }),
  },
  {
    id: 'rose',
    name: 'Radial (rose) chart',
    category: 'Basics',
    lib: 'vega-lite',
    description: 'Polar area chart: both angle and radius encode the value (sqrt radius keeps area honest).',
    slots: [
      { key: 'color', label: 'Category', types: [N], maxUnique: 16, prefer: [/sub_category|city|condition/i, ...P.category] },
      { key: 'theta', label: 'Measure', types: [Q], prefer: P.measure },
    ],
    options: [AGG],
    build: (c) => {
      const r = Math.min(c.w, c.h) / 2 - 24
      return vl(c, {
        width: c.h,
        transform: [{ aggregate: [aggTransform(c, 'theta', 'value')], groupby: [c.f.color] }],
        encoding: {
          theta: { field: 'value', type: Q, stack: true },
          radius: { field: 'value', type: Q, scale: { type: 'sqrt', zero: true, rangeMin: 20, rangeMax: r } },
          color: { field: c.f.color, type: N, legend: null },
        },
        layer: [
          { mark: { type: 'arc', innerRadius: 20, stroke: '#fff', tooltip: true } },
          { mark: { type: 'text', radiusOffset: 14, fontSize: 10 }, encoding: { text: { field: c.f.color, type: N } } },
        ],
      })
    },
  },
]

function AGG_MEAN_OR_SUM(def = 'sum') {
  return { ...AGG, default: def }
}
