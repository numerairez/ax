import { opt, P, vl, type ChartTemplate } from './core.ts'

const N = 'nominal' as const
const Q = 'quantitative' as const
const T = 'temporal' as const

const BINS = { key: 'bins', label: 'Max bins', choices: ['10', '20', '30', '50', '80'], default: '30' }
const PREFER_DIST = [/temp_max|petal_length|unit_price|life|daily_return|revenue|sepal/i]

export const distributions: ChartTemplate[] = [
  {
    id: 'histogram',
    name: 'Histogram',
    category: 'Distributions',
    lib: 'vega-lite',
    description: 'Binned counts of a measure. Optionally stack or overlay groups.',
    slots: [
      { key: 'x', label: 'Measure', types: [Q], prefer: PREFER_DIST },
      { key: 'color', label: 'Group', types: [N], optional: true, maxUnique: 8, prefer: P.category },
    ],
    options: [BINS, { key: 'mode', label: 'Groups', choices: ['stacked', 'overlay'], default: 'stacked' }],
    build: (c) =>
      vl(c, {
        mark: { type: 'bar', tooltip: true, binSpacing: 1, opacity: c.f.color && c.o.mode === 'overlay' ? 0.5 : 1 },
        encoding: {
          x: { field: c.f.x, bin: { maxbins: Number(c.o.bins) }, type: Q },
          y: { aggregate: 'count', type: Q, stack: c.o.mode === 'overlay' ? null : 'zero' },
          color: opt(c, 'color', { field: c.f.color, type: N }),
        },
      }),
  },
  {
    id: 'density',
    name: 'Density plot (KDE)',
    category: 'Distributions',
    lib: 'vega-lite',
    description: 'Smoothed kernel density estimate per group using the density transform.',
    slots: [
      { key: 'x', label: 'Measure', types: [Q], prefer: PREFER_DIST },
      { key: 'color', label: 'Group', types: [N], optional: true, maxUnique: 8, prefer: P.category },
    ],
    options: [
      { key: 'bw', label: 'Bandwidth', choices: ['auto', '0.1', '0.5', '1', '2', '5', '20'], default: 'auto' },
      { key: 'stack', label: 'Stacking', choices: ['none', 'zero', 'normalize'], default: 'none' },
    ],
    build: (c) =>
      vl(c, {
        transform: [
          {
            density: c.f.x,
            groupby: c.f.color ? [c.f.color] : [],
            ...(c.o.bw !== 'auto' ? { bandwidth: Number(c.o.bw) } : {}),
            ...(c.o.stack !== 'none' ? { counts: true, steps: 200 } : {}),
          },
        ],
        mark: { type: 'area', opacity: c.o.stack === 'none' ? 0.45 : 0.9, line: c.o.stack === 'none', tooltip: true, interpolate: 'monotone' },
        encoding: {
          x: { field: 'value', type: Q, title: c.f.x },
          y: { field: 'density', type: Q, stack: c.o.stack === 'none' ? null : c.o.stack },
          color: opt(c, 'color', { field: c.f.color, type: N }),
        },
      }),
  },
  {
    id: 'boxplot',
    name: 'Box plot',
    category: 'Distributions',
    lib: 'vega-lite',
    description: 'Quartiles, whiskers and outliers per group with the composite boxplot mark.',
    slots: [
      { key: 'x', label: 'Group', types: [N], maxUnique: 20, prefer: P.category },
      { key: 'y', label: 'Measure', types: [Q], prefer: PREFER_DIST },
    ],
    options: [{ key: 'extent', label: 'Whiskers', choices: ['1.5', 'min-max', '3'], default: '1.5' }],
    build: (c) =>
      vl(c, {
        mark: { type: 'boxplot', extent: c.o.extent === 'min-max' ? 'min-max' : Number(c.o.extent), size: 28, median: { color: 'white' } },
        encoding: {
          x: { field: c.f.x, type: N, axis: { labelAngle: -30 } },
          y: { field: c.f.y, type: Q, scale: { zero: false } },
          color: { field: c.f.x, type: N, legend: null },
        },
      }),
  },
  {
    id: 'violin',
    name: 'Violin plot',
    category: 'Distributions',
    lib: 'vega-lite',
    description: 'Mirrored density per group via a density transform, center-stacked areas and column facets.',
    slots: [
      { key: 'g', label: 'Group', types: [N], maxUnique: 10, prefer: P.category },
      { key: 'y', label: 'Measure', types: [Q], prefer: PREFER_DIST },
    ],
    build: (c) => {
      const groups = new Set(c.rows.map((r) => r[c.f.g])).size || 1
      return vl(c, {
        width: Math.max(50, Math.floor(c.w / groups)),
        transform: [{ density: c.f.y, groupby: [c.f.g], as: ['value', 'density'] }],
        mark: { type: 'area', orient: 'horizontal', tooltip: true },
        encoding: {
          y: { field: 'value', type: Q, title: c.f.y },
          x: {
            field: 'density',
            type: Q,
            stack: 'center',
            impute: null,
            title: null,
            axis: { labels: false, values: [0], grid: false, ticks: true },
          },
          color: { field: c.f.g, type: N, legend: null },
          column: { field: c.f.g, type: N, spacing: 0, header: { titleOrient: 'bottom', labelOrient: 'bottom', labelPadding: 0 } },
        },
        config: { view: { stroke: null } },
      })
    },
  },
  {
    id: 'strip',
    name: 'Jittered strip plot',
    category: 'Distributions',
    lib: 'vega-lite',
    description: 'Every observation as a dot, spread with Gaussian jitter so overlapping points are visible.',
    slots: [
      { key: 'y', label: 'Group', types: [N], maxUnique: 12, prefer: P.category },
      { key: 'x', label: 'Measure', types: [Q], prefer: PREFER_DIST },
    ],
    build: (c) =>
      vl(c, {
        height: { step: 50 },
        transform: [{ calculate: 'sqrt(-2*log(random()))*cos(2*PI*random())', as: 'jitter' }],
        mark: { type: 'point', filled: true, size: 14, opacity: 0.45, tooltip: { content: 'data' } },
        encoding: {
          x: { field: c.f.x, type: Q, scale: { zero: false } },
          y: { field: c.f.y, type: N, title: null },
          yOffset: { field: 'jitter', type: Q },
          color: { field: c.f.y, type: N, legend: null },
        },
      }),
  },
  {
    id: 'binned-heatmap',
    name: '2D binned heatmap',
    category: 'Distributions',
    lib: 'vega-lite',
    description: 'Joint distribution of two measures as a grid of binned counts.',
    slots: [
      { key: 'x', label: 'X', types: [Q], prefer: [/temp_min|gdp|unit_price|petal_length|open/i] },
      { key: 'y', label: 'Y', types: [Q], prefer: [/temp_max|life|profit|petal_width|close/i] },
    ],
    options: [{ ...BINS, default: '30' }],
    build: (c) =>
      vl(c, {
        mark: { type: 'rect', tooltip: true },
        encoding: {
          x: { field: c.f.x, bin: { maxbins: Number(c.o.bins) }, type: Q },
          y: { field: c.f.y, bin: { maxbins: Number(c.o.bins) }, type: Q },
          color: { aggregate: 'count', type: Q, scale: { scheme: c.seq } },
        },
        config: { view: { stroke: 'transparent' } },
      }),
  },
  {
    id: 'ecdf',
    name: 'Cumulative distribution (ECDF)',
    category: 'Distributions',
    lib: 'vega-lite',
    description: 'Empirical CDF per group computed with a cume_dist window transform.',
    slots: [
      { key: 'x', label: 'Measure', types: [Q], prefer: PREFER_DIST },
      { key: 'color', label: 'Group', types: [N], optional: true, maxUnique: 10, prefer: P.category },
    ],
    build: (c) =>
      vl(c, {
        transform: [
          { window: [{ op: 'cume_dist', as: 'ecdf' }], sort: [{ field: c.f.x }], groupby: c.f.color ? [c.f.color] : [] },
        ],
        mark: { type: 'line', interpolate: 'step-after', tooltip: true },
        encoding: {
          x: { field: c.f.x, type: Q, scale: { zero: false } },
          y: { field: 'ecdf', type: Q, axis: { format: '%' }, title: 'Cumulative share' },
          color: opt(c, 'color', { field: c.f.color, type: N }),
        },
      }),
  },
  {
    id: 'ridgeline',
    name: 'Ridgeline plot',
    category: 'Distributions',
    lib: 'vega-lite',
    description: 'Overlapping distributions per group (or per month), filled by group mean. Uses row facets with flush bounds.',
    slots: [
      { key: 'x', label: 'Measure', types: [Q], prefer: [/temp_max|life|daily_return|petal/i, ...PREFER_DIST] },
      { key: 'g', label: 'Row (group or date → month)', types: [T, N], maxUnique: 16, prefer: [/date|species|continent|city/i] },
    ],
    options: [{ ...BINS, default: '30' }, { key: 'overlap', label: 'Overlap', choices: ['1', '2', '3', '4'], default: '2' }],
    build: (c) => {
      const isTime = c.fields.find((f) => f.name === c.f.g)?.type === 'temporal'
      const rowH = 22
      return vl(c, {
        height: rowH,
        transform: [
          isTime ? { timeUnit: 'month', field: c.f.g, as: 'row' } : { calculate: `datum[${JSON.stringify(c.f.g)}]`, as: 'row' },
          { joinaggregate: [{ op: 'mean', field: c.f.x, as: 'mean_val' }], groupby: ['row'] },
          { bin: { maxbins: Number(c.o.bins) }, field: c.f.x, as: ['bin_min', 'bin_max'] },
          { aggregate: [{ op: 'count', as: 'value' }], groupby: ['row', 'mean_val', 'bin_min', 'bin_max'] },
          { impute: 'value', groupby: ['row', 'mean_val'], key: 'bin_min', value: 0 },
        ],
        mark: { type: 'area', interpolate: 'monotone', fillOpacity: 0.85, stroke: 'lightgray', strokeWidth: 0.5 },
        encoding: {
          row: {
            field: 'row',
            type: isTime ? 'ordinal' : N,
            title: isTime ? 'Month' : c.f.g,
            header: { labelAngle: 0, labelAlign: 'left', ...(isTime ? { format: '%B', formatType: 'time' } : {}) },
          },
          x: { field: 'bin_min', type: Q, bin: 'binned', title: c.f.x },
          x2: { field: 'bin_max' },
          y: { field: 'value', type: Q, scale: { range: [{ expr: 'height' }, -rowH * Number(c.o.overlap)] }, axis: null },
          fill: { field: 'mean_val', type: Q, legend: null, scale: { scheme: c.seq } },
        },
        bounds: 'flush',
        config: { facet: { spacing: 0 }, view: { stroke: null } },
      })
    },
  },
]
