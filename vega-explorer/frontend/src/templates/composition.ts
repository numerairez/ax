import { AGG, measure, P, timeEnc, TIME_UNIT, VL_SCHEMA, vl, type ChartTemplate } from './core.ts'

const N = 'nominal' as const
const Q = 'quantitative' as const
const T = 'temporal' as const

export const composition: ChartTemplate[] = [
  {
    id: 'small-multiples',
    name: 'Small multiples',
    category: 'Composition & facets',
    lib: 'vega-lite',
    description: 'The same area chart repeated per group with a wrapped facet. Toggle shared vs. independent y scales.',
    slots: [
      { key: 'x', label: 'Time', types: [T], prefer: P.time },
      { key: 'y', label: 'Measure', types: [Q], prefer: P.measure },
      { key: 'facet', label: 'Facet by', types: [N], maxUnique: 30, prefer: [/city|symbol|sub_category|country|category/i] },
    ],
    options: [AGG, TIME_UNIT, { key: 'y', label: 'Y scale', choices: ['shared', 'independent'], default: 'shared' }],
    build: (c) => ({
      $schema: VL_SCHEMA,
      data: { name: 'table' },
      facet: { field: c.f.facet, type: N, header: { labelFontWeight: 'bold' } },
      columns: 3,
      spec: {
        width: Math.floor(c.w / 3) - 10,
        height: 90,
        mark: { type: 'area', line: true, opacity: 0.4, interpolate: 'monotone', tooltip: true },
        encoding: { x: timeEnc(c, c.f.x, c.o.tu, { title: null }), y: measure(c, 'y', { axis: { tickCount: 3 } }) },
      },
      resolve: { scale: { y: c.o.y === 'independent' ? 'independent' : 'shared' } },
    }),
  },
  {
    id: 'trellis-bar',
    name: 'Trellis bar chart',
    category: 'Composition & facets',
    lib: 'vega-lite',
    description: 'Bar charts arranged in a grid by row and column facets.',
    slots: [
      { key: 'x', label: 'Bars', types: [N], maxUnique: 10, prefer: [/channel|segment|condition|site/i] },
      { key: 'y', label: 'Measure', types: [Q], prefer: P.measure },
      { key: 'col', label: 'Columns', types: [N], maxUnique: 8, prefer: [/region|category|species|sector/i] },
    ],
    options: [AGG],
    build: (c) => {
      const cols = new Set(c.rows.map((r) => r[c.f.col])).size || 1
      return vl(c, {
        width: Math.max(80, Math.floor(c.w / cols) - 10),
        height: 180,
        mark: { type: 'bar', tooltip: true },
        encoding: {
          x: { field: c.f.x, type: N, axis: { labelAngle: -45 }, title: null },
          y: measure(c),
          color: { field: c.f.x, type: N, legend: null },
          column: { field: c.f.col, type: N, header: { labelFontWeight: 'bold' } },
        },
      })
    },
  },
  {
    id: 'dual-axis',
    name: 'Bars + line, dual axis',
    category: 'Composition & facets',
    lib: 'vega-lite',
    description: 'Layered bar and line marks with independently resolved y scales.',
    slots: [
      { key: 'x', label: 'Time', types: [T], prefer: P.time },
      { key: 'y1', label: 'Bars', types: [Q], prefer: [/revenue|precip|volume/i] },
      { key: 'y2', label: 'Line', types: [Q], prefer: [/rating|temp_max|close|discount/i] },
    ],
    options: [{ ...TIME_UNIT, default: 'yearmonth' }],
    build: (c) =>
      vl(c, {
        encoding: { x: timeEnc(c, c.f.x, c.o.tu, { title: null }) },
        layer: [
          { mark: { type: 'bar', opacity: 0.6, color: '#9ecae9', tooltip: true }, encoding: { y: { field: c.f.y1, aggregate: 'sum', type: Q, axis: { titleColor: '#5e8fb9' } } } },
          { mark: { type: 'line', color: '#e45756', strokeWidth: 2.5, interpolate: 'monotone', point: true, tooltip: true }, encoding: { y: { field: c.f.y2, aggregate: 'mean', type: Q, scale: { zero: false }, axis: { titleColor: '#e45756' } } } },
        ],
        resolve: { scale: { y: 'independent' } },
      }),
  },
  {
    id: 'repeat-measures',
    name: 'Repeated measures over time',
    category: 'Composition & facets',
    lib: 'vega-lite',
    description: 'The repeat operator stacks one chart per measure, sharing the time axis.',
    slots: [
      { key: 'x', label: 'Time', types: [T], prefer: P.time },
      { key: 'dims', label: 'Measures', types: [Q], multi: 3, prefer: [/temp_max|precip|wind|humid|revenue|profit|units|close|volume|gdp|life/i] },
      { key: 'color', label: 'Series', types: [N], optional: true, maxUnique: 8, prefer: [/city|symbol|region|continent/i] },
    ],
    options: [{ ...AGG, default: 'mean' }, TIME_UNIT],
    build: (c) => ({
      $schema: VL_SCHEMA,
      data: { name: 'table' },
      repeat: { row: c.m.dims },
      spec: {
        width: c.w,
        height: 110,
        mark: { type: 'line', interpolate: 'monotone', tooltip: true },
        encoding: {
          x: timeEnc(c, c.f.x, c.o.tu, { title: null }),
          y: { field: { repeat: 'row' }, aggregate: c.o.agg === 'count' ? 'mean' : c.o.agg, type: Q, scale: { zero: false } },
          ...(c.f.color ? { color: { field: c.f.color, type: N } } : {}),
        },
      },
    }),
  },
  {
    id: 'marginals',
    name: 'Scatter with marginal histograms',
    category: 'Composition & facets',
    lib: 'vega-lite',
    description: 'A central binned heatmap with histograms on the top and right, composed with vconcat/hconcat.',
    slots: [
      { key: 'x', label: 'X', types: [Q], prefer: [/temp_min|gdp|petal_length|unit_price/i] },
      { key: 'y', label: 'Y', types: [Q], prefer: [/temp_max|life|petal_width|profit/i] },
    ],
    build: (c) => {
      const size = Math.min(c.w, c.h + 60)
      return {
        $schema: VL_SCHEMA,
        data: { name: 'table' },
        spacing: 12,
        bounds: 'flush',
        vconcat: [
          {
            mark: 'bar',
            height: 60,
            width: size,
            encoding: { x: { bin: { maxbins: 30 }, field: c.f.x, axis: null }, y: { aggregate: 'count', title: '' } },
          },
          {
            spacing: 12,
            bounds: 'flush',
            hconcat: [
              {
                mark: 'rect',
                width: size,
                height: size * 0.75,
                encoding: {
                  x: { bin: { maxbins: 30 }, field: c.f.x },
                  y: { bin: { maxbins: 30 }, field: c.f.y },
                  color: { aggregate: 'count', scale: { scheme: c.seq } },
                },
              },
              {
                mark: 'bar',
                width: 60,
                height: size * 0.75,
                encoding: { y: { bin: { maxbins: 30 }, field: c.f.y, axis: null }, x: { aggregate: 'count', title: '' } },
              },
            ],
          },
        ],
        config: { view: { stroke: 'transparent' } },
      }
    },
  },
]
