import { AGG, d, fieldRef, P, VEGA_SCHEMA, type ChartTemplate, type Ctx } from './core.ts'

const N = 'nominal' as const
const Q = 'quantitative' as const

/** Vega aggregate transform producing "value" (count when no measure is set). */
function vegaAgg(c: Ctx, groupby: string[], key: string) {
  const op = c.o.agg ?? 'sum'
  return op === 'count' || !c.f[key]
    ? { type: 'aggregate', groupby, ops: ['count'], as: ['value'] }
    : { type: 'aggregate', groupby, fields: [c.f[key]], ops: [op === 'distinct' ? 'distinct' : op], as: ['value'] }
}

function base(c: Ctx, rest: Record<string, unknown>) {
  return { $schema: VEGA_SCHEMA, width: c.w, height: c.h, padding: 5, ...rest }
}

/** Builds node list (with group) from an edge list via fold + aggregate. */
function nodesFromEdges(c: Ctx) {
  const tx: Record<string, unknown>[] = [{ type: 'fold', fields: [c.f.src, c.f.dst], as: ['role', 'name'] }]
  if (c.f.sg || c.f.tg) {
    const sg = c.f.sg ? d(c.f.sg) : "'—'"
    const tg = c.f.tg ? d(c.f.tg) : "'—'"
    tx.push({ type: 'formula', as: 'grp', expr: `datum.role === ${JSON.stringify(c.f.src)} ? ${sg} : ${tg}` })
  } else {
    tx.push({ type: 'formula', as: 'grp', expr: "'all'" })
  }
  tx.push({ type: 'aggregate', groupby: ['name', 'grp'], ops: ['count'], as: ['degree'] })
  return tx
}

const LEVEL1 = [/^category$/i, /continent|sector|species|team/i, /region/i]
const LEVEL2 = [/sub_category/i, /country|symbol|site/i, /city|target/i]

const EDGE_SLOTS = [
  { key: 'src', label: 'Source', types: [N], prefer: [/^source$|^from$|src/i] },
  { key: 'dst', label: 'Target', types: [N], prefer: [/^target$|^to$|dst|dest/i] },
  { key: 'w', label: 'Weight', types: [Q], optional: true, prefer: [/messages|weight|count|value/i] },
  { key: 'sg', label: 'Source group', types: [N], optional: true, maxUnique: 12, prefer: [/source.*(team|group)/i] },
  { key: 'tg', label: 'Target group', types: [N], optional: true, maxUnique: 12, prefer: [/target.*(team|group)/i] },
] satisfies ChartTemplate['slots']

export const vega: ChartTemplate[] = [
  {
    id: 'vega-bar',
    name: 'Bar chart in raw Vega',
    category: 'Vega grammar',
    lib: 'vega',
    description: 'The classic Vega example: explicit data, scales, axes, marks and a hover signal driving a tooltip label.',
    slots: [
      { key: 'x', label: 'Category', types: [N], maxUnique: 30, prefer: P.category },
      { key: 'y', label: 'Measure', types: [Q], prefer: P.measure },
    ],
    options: [AGG],
    build: (c) =>
      base(c, {
        signals: [
          {
            name: 'tooltip',
            value: {},
            on: [
              { events: 'rect:pointerover', update: 'datum' },
              { events: 'rect:pointerout', update: '{}' },
            ],
          },
        ],
        data: [{ name: 'table' }, { name: 'agg', source: 'table', transform: [vegaAgg(c, [c.f.x], 'y')] }],
        scales: [
          { name: 'xscale', type: 'band', domain: { data: 'agg', field: c.f.x, sort: { field: 'value', op: 'max', order: 'descending' } }, range: 'width', padding: 0.1, round: true },
          { name: 'yscale', domain: { data: 'agg', field: 'value' }, nice: true, range: 'height' },
        ],
        axes: [
          { orient: 'bottom', scale: 'xscale', labelAngle: -35, labelAlign: 'right' },
          { orient: 'left', scale: 'yscale', title: `${c.o.agg} of ${c.f.y}` },
        ],
        marks: [
          {
            type: 'rect',
            from: { data: 'agg' },
            encode: {
              enter: {
                x: { scale: 'xscale', field: c.f.x },
                width: { scale: 'xscale', band: 1 },
                y: { scale: 'yscale', field: 'value' },
                y2: { scale: 'yscale', value: 0 },
              },
              update: { fill: { value: 'steelblue' } },
              hover: { fill: { value: 'red' } },
            },
          },
          {
            type: 'text',
            encode: {
              enter: { align: { value: 'center' }, baseline: { value: 'bottom' }, fill: { value: '#333' } },
              update: {
                x: { scale: 'xscale', signal: `tooltip[${JSON.stringify(c.f.x)}]`, band: 0.5 },
                y: { scale: 'yscale', signal: 'tooltip.value', offset: -2 },
                text: { signal: "tooltip.value != null ? format(tooltip.value, ',.0f') : ''" },
                fillOpacity: [{ test: 'datum === tooltip', value: 0 }, { value: 1 }],
              },
            },
          },
        ],
      }),
  },
  {
    id: 'treemap',
    name: 'Treemap',
    category: 'Part-to-whole',
    lib: 'vega',
    description: 'Hierarchy from two categorical fields via the nest transform, laid out with squarify/binary/slice-dice.',
    slots: [
      { key: 'a', label: 'Parent', types: [N], maxUnique: 20, prefer: LEVEL1 },
      { key: 'b', label: 'Child', types: [N], maxUnique: 200, prefer: LEVEL2 },
      { key: 'size', label: 'Size', types: [Q], optional: true, prefer: P.measure },
    ],
    options: [AGG],
    build: (c) =>
      base(c, {
        autosize: 'none',
        signals: [
          { name: 'layout', value: 'squarify', bind: { input: 'select', options: ['squarify', 'binary', 'slicedice', 'dice', 'slice', 'resquarify'] } },
          { name: 'aspectRatio', value: 1.6, bind: { input: 'range', min: 0.5, max: 5, step: 0.1 } },
        ],
        data: [
          { name: 'table' },
          { name: 'agg', source: 'table', transform: [vegaAgg(c, [c.f.a, c.f.b], 'size'), { type: 'filter', expr: 'datum.value > 0' }] },
          {
            name: 'tree',
            source: 'agg',
            transform: [
              { type: 'nest', keys: [c.f.a], generate: true },
              {
                type: 'treemap',
                field: 'value',
                sort: { field: 'value' },
                round: true,
                method: { signal: 'layout' },
                ratio: { signal: 'aspectRatio' },
                paddingInner: 2,
                paddingTop: 16,
                size: [{ signal: 'width' }, { signal: 'height' }],
              },
            ],
          },
          { name: 'parents', source: 'tree', transform: [{ type: 'filter', expr: 'datum.depth === 1' }] },
          { name: 'leaves', source: 'tree', transform: [{ type: 'filter', expr: '!datum.children' }] },
        ],
        scales: [{ name: 'color', type: 'ordinal', domain: { data: 'agg', field: c.f.a }, range: { scheme: c.cat } }],
        marks: [
          {
            type: 'rect',
            from: { data: 'parents' },
            interactive: false,
            encode: {
              enter: { fill: { scale: 'color', field: 'key' }, fillOpacity: { value: 0.25 } },
              update: { x: { field: 'x0' }, y: { field: 'y0' }, x2: { field: 'x1' }, y2: { field: 'y1' } },
            },
          },
          {
            type: 'rect',
            from: { data: 'leaves' },
            encode: {
              enter: {
                fill: { scale: 'color', field: c.f.a },
                stroke: { value: '#fff' },
                tooltip: { signal: `{${JSON.stringify(c.f.a)}: ${d(c.f.a)}, ${JSON.stringify(c.f.b)}: ${d(c.f.b)}, value: format(datum.value, ',.0f')}` },
              },
              update: { x: { field: 'x0' }, y: { field: 'y0' }, x2: { field: 'x1' }, y2: { field: 'y1' }, fillOpacity: { value: 0.85 } },
              hover: { fillOpacity: { value: 0.55 } },
            },
          },
          {
            type: 'text',
            from: { data: 'parents' },
            interactive: false,
            encode: {
              enter: { fontWeight: { value: 'bold' }, fontSize: { value: 11 }, fill: { value: '#222' }, text: { field: 'key' } },
              update: { x: { signal: 'datum.x0 + 4' }, y: { signal: 'datum.y0 + 12' } },
            },
          },
          {
            type: 'text',
            from: { data: 'leaves' },
            interactive: false,
            encode: {
              enter: { fontSize: { value: 10 }, fill: { value: '#fff' }, align: { value: 'center' }, baseline: { value: 'middle' }, text: { field: c.f.b } },
              update: {
                x: { signal: '0.5 * (datum.x0 + datum.x1)' },
                y: { signal: '0.5 * (datum.y0 + datum.y1)' },
                opacity: { signal: '(datum.x1 - datum.x0) > 60 && (datum.y1 - datum.y0) > 16 ? 1 : 0' },
              },
            },
          },
        ],
      }),
  },
  {
    id: 'sunburst',
    name: 'Sunburst',
    category: 'Part-to-whole',
    lib: 'vega',
    description: 'Radial partition layout of a two-level hierarchy. Inner ring = parent, outer ring = children.',
    slots: [
      { key: 'a', label: 'Inner ring', types: [N], maxUnique: 20, prefer: LEVEL1 },
      { key: 'b', label: 'Outer ring', types: [N], maxUnique: 200, prefer: LEVEL2 },
      { key: 'size', label: 'Size', types: [Q], optional: true, prefer: P.measure },
    ],
    options: [AGG],
    build: (c) => {
      const s = Math.min(c.w, c.h + 120)
      return base(c, {
        width: s,
        height: s,
        autosize: 'none',
        data: [
          { name: 'table' },
          { name: 'agg', source: 'table', transform: [vegaAgg(c, [c.f.a, c.f.b], 'size'), { type: 'filter', expr: 'datum.value > 0' }] },
          {
            name: 'tree',
            source: 'agg',
            transform: [
              { type: 'nest', keys: [c.f.a], generate: true },
              { type: 'partition', field: 'value', sort: { field: 'value' }, size: [{ signal: '2 * PI' }, { signal: 'width / 2' }], as: ['a0', 'r0', 'a1', 'r1', 'depth', 'children'] },
              { type: 'filter', expr: 'datum.depth > 0' },
              { type: 'formula', as: 'grp', expr: `datum.depth === 1 ? datum.key : ${d(c.f.a)}` },
              { type: 'formula', as: 'label', expr: `datum.depth === 1 ? datum.key : ${d(c.f.b)}` },
            ],
          },
        ],
        scales: [{ name: 'color', type: 'ordinal', domain: { data: 'agg', field: c.f.a }, range: { scheme: c.cat } }],
        marks: [
          {
            type: 'arc',
            from: { data: 'tree' },
            encode: {
              enter: {
                x: { signal: 'width / 2' },
                y: { signal: 'height / 2' },
                fill: { scale: 'color', field: 'grp' },
                tooltip: { signal: "{title: datum.label, value: format(datum.value, ',.0f')}" },
              },
              update: {
                startAngle: { field: 'a0' },
                endAngle: { field: 'a1' },
                innerRadius: { field: 'r0' },
                outerRadius: { field: 'r1' },
                stroke: { value: 'white' },
                strokeWidth: { value: 0.75 },
                fillOpacity: { signal: 'datum.depth === 1 ? 1 : 0.6' },
                zindex: { value: 0 },
              },
              hover: { stroke: { value: '#222' }, strokeWidth: { value: 2 }, zindex: { value: 1 } },
            },
          },
          {
            type: 'text',
            from: { data: 'tree' },
            interactive: false,
            encode: {
              enter: {
                x: { signal: 'width / 2' },
                y: { signal: 'height / 2' },
                radius: { signal: '(datum.r0 + datum.r1) / 2' },
                theta: { signal: '(datum.a0 + datum.a1) / 2' },
                fill: { value: '#111' },
                fontSize: { signal: 'datum.depth === 1 ? 11 : 9' },
                align: { value: 'center' },
                baseline: { value: 'middle' },
                angle: { signal: '((datum.a0 + datum.a1) / 2 * 180 / PI) + (inrange((datum.a0 + datum.a1) / 2 % (2 * PI), [0, PI]) ? 270 : 90)' },
                text: { field: 'label' },
                opacity: { signal: '(datum.a1 - datum.a0) * (datum.r0 + datum.r1) / 2 > 12 && (datum.r1 - datum.r0) > 30 ? 1 : 0' },
              },
            },
          },
        ],
      })
    },
  },
  {
    id: 'radial-tree',
    name: 'Radial tree',
    category: 'Vega grammar',
    lib: 'vega',
    description: 'Tidy tree or cluster layout in polar coordinates with curved links (stratify via nest, tree, treelinks, linkpath).',
    slots: [
      { key: 'a', label: 'Level 1', types: [N], maxUnique: 20, prefer: LEVEL1 },
      { key: 'b', label: 'Level 2', types: [N], maxUnique: 200, prefer: LEVEL2 },
    ],
    build: (c) => {
      const s = Math.min(c.w, c.h + 140)
      return base(c, {
        width: s,
        height: s,
        autosize: 'none',
        signals: [
          { name: 'labels', value: true, bind: { input: 'checkbox' } },
          { name: 'radius', value: s / 2 - 90, bind: { input: 'range', min: 40, max: s / 2, step: 1 } },
          { name: 'extent', value: 360, bind: { input: 'range', min: 0, max: 360, step: 1 } },
          { name: 'rotate', value: 0, bind: { input: 'range', min: 0, max: 360, step: 1 } },
          { name: 'layout', value: 'tidy', bind: { input: 'radio', options: ['tidy', 'cluster'] } },
          { name: 'links', value: 'line', bind: { input: 'select', options: ['line', 'curve', 'diagonal', 'orthogonal'] } },
          { name: 'originX', update: 'width / 2' },
          { name: 'originY', update: 'height / 2' },
        ],
        data: [
          { name: 'table' },
          { name: 'agg', source: 'table', transform: [{ type: 'aggregate', groupby: [c.f.a, c.f.b], ops: ['count'], as: ['value'] }] },
          {
            name: 'tree',
            source: 'agg',
            transform: [
              { type: 'nest', keys: [c.f.a], generate: true },
              { type: 'tree', method: { signal: 'layout' }, size: [1, { signal: 'radius' }], as: ['alpha', 'radius', 'depth', 'children'] },
              { type: 'formula', expr: '(rotate + extent * datum.alpha + 270) % 360', as: 'angle' },
              { type: 'formula', expr: 'PI * datum.angle / 180', as: 'radians' },
              { type: 'formula', expr: 'inrange(datum.angle, [90, 270])', as: 'leftside' },
              { type: 'formula', expr: 'originX + datum.radius * cos(datum.radians)', as: 'x' },
              { type: 'formula', expr: 'originY + datum.radius * sin(datum.radians)', as: 'y' },
              { type: 'formula', expr: `datum.depth === 0 ? 'all' : datum.depth === 1 ? datum.key : ${d(c.f.b)}`, as: 'label' },
            ],
          },
          {
            name: 'links',
            source: 'tree',
            transform: [
              { type: 'treelinks' },
              {
                type: 'linkpath',
                shape: { signal: 'links' },
                orient: 'radial',
                sourceX: 'source.radians',
                sourceY: 'source.radius',
                targetX: 'target.radians',
                targetY: 'target.radius',
              },
            ],
          },
        ],
        scales: [{ name: 'color', type: 'ordinal', domain: { data: 'agg', field: c.f.a }, range: { scheme: c.cat } }],
        marks: [
          {
            type: 'path',
            from: { data: 'links' },
            encode: { update: { x: { signal: 'originX' }, y: { signal: 'originY' }, path: { field: 'path' }, stroke: { value: '#ccc' } } },
          },
          {
            type: 'symbol',
            from: { data: 'tree' },
            encode: {
              enter: { size: { value: 60 }, stroke: { value: '#fff' } },
              update: {
                x: { field: 'x' },
                y: { field: 'y' },
                fill: [{ test: 'datum.depth === 0', value: '#555' }, { scale: 'color', signal: `datum.depth === 1 ? datum.key : ${d(c.f.a)}` }],
                tooltip: { signal: "{title: datum.label, rows: datum.value}" },
              },
            },
          },
          {
            type: 'text',
            from: { data: 'tree' },
            encode: {
              enter: { text: { field: 'label' }, fontSize: { value: 9 }, baseline: { value: 'middle' } },
              update: {
                x: { field: 'x' },
                y: { field: 'y' },
                dx: { signal: '(datum.leftside ? -1 : 1) * 6' },
                angle: { signal: 'datum.leftside ? datum.angle - 180 : datum.angle' },
                align: { signal: "datum.leftside ? 'right' : 'left'" },
                opacity: { signal: 'labels ? 1 : 0' },
                fontWeight: { signal: "datum.depth === 1 ? 'bold' : 'normal'" },
              },
            },
          },
        ],
      })
    },
  },
  {
    id: 'force',
    name: 'Force-directed network',
    category: 'Vega grammar',
    lib: 'vega',
    description: 'Nodes derived from an edge list, positioned by a force simulation. Drag nodes; uncheck "static" to animate.',
    slots: EDGE_SLOTS,
    build: (c) =>
      base(c, {
        width: c.w,
        height: c.h + 120,
        autosize: 'none',
        signals: [
          { name: 'cx', update: 'width / 2' },
          { name: 'cy', update: 'height / 2' },
          { name: 'nodeRadius', value: 8, bind: { input: 'range', min: 1, max: 40, step: 1 } },
          { name: 'nodeCharge', value: -40, bind: { input: 'range', min: -150, max: 10, step: 1 } },
          { name: 'linkDistance', value: 40, bind: { input: 'range', min: 5, max: 150, step: 1 } },
          { name: 'static', value: true, bind: { input: 'checkbox' } },
          {
            name: 'fix',
            value: false,
            on: [
              { events: 'symbol:pointerout[!event.buttons], window:pointerup', update: 'false' },
              { events: 'symbol:pointerover', update: 'fix || true' },
              { events: '[symbol:pointerdown, window:pointerup] > window:pointermove!', update: 'xy()', force: true },
            ],
          },
          { name: 'node', value: null, on: [{ events: 'symbol:pointerover', update: 'fix === true ? item() : node' }] },
          { name: 'restart', value: false, on: [{ events: { signal: 'fix' }, update: 'fix && fix.length' }] },
        ],
        data: [
          { name: 'table' },
          { name: 'node-data', source: 'table', transform: nodesFromEdges(c) },
          {
            name: 'link-data',
            source: 'table',
            transform: [{ type: 'project', fields: [c.f.src, c.f.dst, ...(c.f.w ? [c.f.w] : [])], as: ['source', 'target', ...(c.f.w ? ['weight'] : [])] }],
          },
        ],
        scales: [
          { name: 'color', type: 'ordinal', domain: { data: 'node-data', field: 'grp' }, range: { scheme: c.cat } },
          ...(c.f.w ? [{ name: 'lw', type: 'sqrt', domain: { data: 'link-data', field: 'weight' }, range: [0.5, 5] }] : []),
        ],
        legends: c.f.sg || c.f.tg ? [{ fill: 'color', orient: 'top-left', title: 'Group' }] : [],
        marks: [
          {
            name: 'nodes',
            type: 'symbol',
            zindex: 1,
            from: { data: 'node-data' },
            on: [
              { trigger: 'fix', modify: 'node', values: 'fix === true ? {fx: node.x, fy: node.y} : {fx: fix[0], fy: fix[1]}' },
              { trigger: '!fix', modify: 'node', values: '{fx: null, fy: null}' },
            ],
            encode: {
              enter: { fill: { scale: 'color', field: 'grp' }, stroke: { value: 'white' }, tooltip: { signal: '{title: datum.name, group: datum.grp, connections: datum.degree}' } },
              update: { size: { signal: '2 * nodeRadius * nodeRadius' }, cursor: { value: 'pointer' } },
            },
            transform: [
              {
                type: 'force',
                iterations: 300,
                restart: { signal: 'restart' },
                static: { signal: 'static' },
                signal: 'force',
                forces: [
                  { force: 'center', x: { signal: 'cx' }, y: { signal: 'cy' } },
                  { force: 'collide', radius: { signal: 'nodeRadius' } },
                  { force: 'nbody', strength: { signal: 'nodeCharge' } },
                  { force: 'link', links: 'link-data', distance: { signal: 'linkDistance' }, id: 'datum.name' },
                ],
              },
            ],
          },
          {
            type: 'path',
            from: { data: 'link-data' },
            interactive: false,
            encode: {
              update: {
                stroke: { value: '#bbb' },
                strokeWidth: c.f.w ? { scale: 'lw', field: 'weight' } : { value: 0.8 },
              },
            },
            transform: [
              {
                type: 'linkpath',
                require: { signal: 'force' },
                shape: 'line',
                sourceX: 'datum.source.x',
                sourceY: 'datum.source.y',
                targetX: 'datum.target.x',
                targetY: 'datum.target.y',
              },
            ],
          },
          {
            type: 'text',
            from: { data: 'nodes' },
            interactive: false,
            zindex: 2,
            encode: {
              enter: { text: { field: 'datum.name' }, fontSize: { value: 9 }, fill: { value: '#333' }, dy: { value: -10 }, align: { value: 'center' } },
              update: { x: { field: 'x' }, y: { field: 'y' } },
            },
          },
        ],
      }),
  },
  {
    id: 'arc-diagram',
    name: 'Arc diagram',
    category: 'Vega grammar',
    lib: 'vega',
    description: 'Nodes on a line ordered by group, connected by arcs. Uses lookups against a named mark.',
    slots: EDGE_SLOTS,
    build: (c) =>
      base(c, {
        height: c.h,
        data: [
          { name: 'table' },
          {
            name: 'nodes',
            source: 'table',
            transform: [...nodesFromEdges(c), { type: 'window', ops: ['rank'], as: ['order'], sort: { field: ['grp', 'name'] } }],
          },
          {
            name: 'edges',
            source: 'table',
            transform: [{ type: 'project', fields: [c.f.src, c.f.dst, ...(c.f.w ? [c.f.w] : [])], as: ['s', 't', ...(c.f.w ? ['weight'] : [])] }],
          },
        ],
        scales: [
          { name: 'position', type: 'band', domain: { data: 'nodes', field: 'name', sort: { field: 'order', op: 'min' } }, range: 'width' },
          { name: 'color', type: 'ordinal', domain: { data: 'nodes', field: 'grp' }, range: { scheme: c.cat } },
          ...(c.f.w ? [{ name: 'lw', type: 'sqrt', domain: { data: 'edges', field: 'weight' }, range: [0.5, 5] }] : []),
        ],
        legends: c.f.sg || c.f.tg ? [{ fill: 'color', orient: 'top-left', title: 'Group' }] : [],
        marks: [
          {
            type: 'symbol',
            name: 'layout',
            interactive: false,
            from: { data: 'nodes' },
            encode: {
              enter: { opacity: { value: 0 } },
              update: { x: { scale: 'position', field: 'name', band: 0.5 }, y: { signal: 'height - 80' } },
            },
          },
          {
            type: 'path',
            from: { data: 'edges' },
            encode: {
              update: {
                stroke: { value: '#000' },
                strokeOpacity: { value: 0.18 },
                strokeWidth: c.f.w ? { scale: 'lw', field: 'weight' } : { value: 1 },
              },
            },
            transform: [
              { type: 'lookup', from: 'layout', key: 'datum.name', fields: ['datum.s', 'datum.t'], as: ['sourceNode', 'targetNode'] },
              {
                type: 'linkpath',
                sourceX: { expr: 'min(datum.sourceNode.x, datum.targetNode.x)' },
                targetX: { expr: 'max(datum.sourceNode.x, datum.targetNode.x)' },
                sourceY: { expr: 'datum.sourceNode.y' },
                targetY: { expr: 'datum.targetNode.y' },
                shape: 'arc',
              },
            ],
          },
          {
            type: 'symbol',
            from: { data: 'layout' },
            encode: {
              enter: { fill: { scale: 'color', field: 'datum.grp' }, stroke: { value: '#fff' }, tooltip: { signal: '{title: datum.datum.name, connections: datum.datum.degree}' } },
              update: { x: { field: 'x' }, y: { field: 'y' }, size: { signal: '30 + datum.datum.degree * 18' } },
            },
          },
          {
            type: 'text',
            from: { data: 'layout' },
            interactive: false,
            encode: {
              enter: { text: { field: 'datum.name' }, angle: { value: -90 }, align: { value: 'right' }, baseline: { value: 'middle' }, fontSize: { value: 9 }, fill: { value: '#333' } },
              update: { x: { field: 'x' }, y: { signal: 'datum.y + 10' } },
            },
          },
        ],
      }),
  },
  {
    id: 'wordcloud',
    name: 'Word cloud',
    category: 'Vega grammar',
    lib: 'vega',
    description: 'The wordcloud transform places category labels sized by an aggregated measure.',
    slots: [
      { key: 'word', label: 'Word', types: [N], maxUnique: 300, prefer: [/sub_category|city|country|name|source|target|condition/i] },
      { key: 'v', label: 'Size by', types: [Q], optional: true, prefer: P.measure },
    ],
    options: [AGG, { key: 'rot', label: 'Rotation', choices: ['mixed', 'flat', 'vertical'], default: 'mixed' }],
    build: (c) =>
      base(c, {
        autosize: 'none',
        data: [
          { name: 'table' },
          {
            name: 'words',
            source: 'table',
            transform: [
              vegaAgg(c, [c.f.word], 'v'),
              {
                type: 'formula',
                as: 'angle',
                expr: c.o.rot === 'flat' ? '0' : c.o.rot === 'vertical' ? '[0, 90][~~(random() * 2)]' : '[-45, 0, 45][~~(random() * 3)]',
              },
            ],
          },
        ],
        scales: [{ name: 'color', type: 'ordinal', domain: { data: 'words', field: c.f.word }, range: { scheme: c.cat } }],
        marks: [
          {
            type: 'text',
            from: { data: 'words' },
            encode: {
              enter: {
                text: { field: c.f.word },
                align: { value: 'center' },
                baseline: { value: 'alphabetic' },
                fill: { scale: 'color', field: c.f.word },
                tooltip: { signal: `{title: ${d(c.f.word)}, value: format(datum.value, ',.0f')}` },
              },
              update: { fillOpacity: { value: 1 } },
              hover: { fillOpacity: { value: 0.5 } },
            },
            transform: [
              {
                type: 'wordcloud',
                size: [{ signal: 'width' }, { signal: 'height' }],
                text: { field: 'text' },
                rotate: { field: 'datum.angle' },
                font: 'Helvetica Neue, Arial',
                fontSize: { field: 'datum.value' },
                fontWeight: 'bold',
                fontSizeRange: [11, 64],
                padding: 2,
              },
            ],
          },
        ],
      }),
  },
  {
    id: 'beeswarm',
    name: 'Beeswarm',
    category: 'Distributions',
    lib: 'vega',
    description: 'A force simulation packs every point along the measure axis without overlap, one swarm per group.',
    slots: [
      { key: 'x', label: 'Measure', types: [Q], prefer: [/petal_length|life|temp_max|unit_price|daily_return/i] },
      { key: 'g', label: 'Group', types: [N], maxUnique: 10, prefer: P.category },
    ],
    options: [{ key: 'n', label: 'Sample size', choices: ['150', '300', '600'], default: '300' }],
    build: (c) =>
      base(c, {
        signals: [
          { name: 'cy', update: 'height / 2' },
          { name: 'nodeRadius', value: 4, bind: { input: 'range', min: 1, max: 12, step: 0.5 } },
          { name: 'gravityX', value: 0.25, bind: { input: 'range', min: 0, max: 1 } },
          { name: 'gravityY', value: 0.1, bind: { input: 'range', min: 0, max: 1 } },
        ],
        data: [{ name: 'table' }, { name: 'sample', source: 'table', transform: [{ type: 'filter', expr: `isValid(${d(c.f.x)})` }, { type: 'sample', size: Number(c.o.n) }] }],
        scales: [
          { name: 'x', type: 'linear', domain: { data: 'sample', field: c.f.x }, range: 'width', nice: true, zero: false },
          { name: 'y', type: 'band', domain: { data: 'sample', field: c.f.g, sort: true }, range: 'height', padding: 0.05 },
          { name: 'color', type: 'ordinal', domain: { data: 'sample', field: c.f.g, sort: true }, range: { scheme: c.cat } },
        ],
        axes: [
          { orient: 'bottom', scale: 'x', title: c.f.x, grid: true, gridOpacity: 0.3 },
          { orient: 'left', scale: 'y', domain: false, ticks: false },
        ],
        marks: [
          {
            name: 'nodes',
            type: 'symbol',
            from: { data: 'sample' },
            encode: {
              enter: {
                fill: { scale: 'color', field: c.f.g },
                xfocus: { scale: 'x', field: c.f.x },
                yfocus: { scale: 'y', field: c.f.g, band: 0.5 },
                tooltip: { signal: `{${JSON.stringify(c.f.g)}: ${d(c.f.g)}, ${JSON.stringify(c.f.x)}: ${d(c.f.x)}}` },
              },
              update: { size: { signal: 'pow(2 * nodeRadius, 2)' }, stroke: { value: 'white' }, strokeWidth: { value: 0.75 }, zindex: { value: 0 } },
              hover: { stroke: { value: '#111' }, strokeWidth: { value: 2 }, zindex: { value: 1 } },
            },
            transform: [
              {
                type: 'force',
                iterations: 300,
                static: true,
                forces: [
                  { force: 'collide', iterations: 2, radius: { expr: 'nodeRadius' } },
                  { force: 'x', x: 'xfocus', strength: { signal: 'gravityX' } },
                  { force: 'y', y: 'yfocus', strength: { signal: 'gravityY' } },
                ],
              },
            ],
          },
        ],
      }),
  },
  {
    id: 'contours',
    name: 'Density contours',
    category: 'Relationships',
    lib: 'vega',
    description: '2D kernel density (kde2d) turned into isocontours, optionally one set per group, over the raw points.',
    slots: [
      { key: 'x', label: 'X', types: [Q], prefer: [/petal_length|sepal_length|gdp|temp_min/i] },
      { key: 'y', label: 'Y', types: [Q], prefer: [/petal_width|sepal_width|life|temp_max/i] },
      { key: 'g', label: 'Group', types: [N], optional: true, maxUnique: 8, prefer: P.category },
    ],
    build: (c) => {
      const grouped = !!c.f.g
      return base(c, {
        autosize: 'pad',
        signals: [
          { name: 'bandwidth', value: 14, bind: { input: 'range', min: 2, max: 50, step: 1 } },
          { name: 'levels', value: 8, bind: { input: 'range', min: 1, max: 20, step: 1 } },
          { name: 'showPoints', value: true, bind: { input: 'checkbox' } },
        ],
        data: [
          { name: 'table', transform: [{ type: 'filter', expr: `isValid(${d(c.f.x)}) && isValid(${d(c.f.y)})` }] },
          {
            name: 'density',
            source: 'table',
            transform: [
              {
                type: 'kde2d',
                groupby: grouped ? [c.f.g] : [],
                size: [{ signal: 'width' }, { signal: 'height' }],
                x: { expr: `scale('x', ${d(c.f.x)})` },
                y: { expr: `scale('y', ${d(c.f.y)})` },
                bandwidth: { signal: '[bandwidth, bandwidth]' },
              },
            ],
          },
          { name: 'contours', source: 'density', transform: [{ type: 'isocontour', field: 'grid', resolve: 'independent', levels: { signal: 'levels' } }] },
        ],
        scales: [
          { name: 'x', type: 'linear', round: true, nice: true, zero: false, domain: { data: 'table', field: c.f.x }, range: 'width' },
          { name: 'y', type: 'linear', round: true, nice: true, zero: false, domain: { data: 'table', field: c.f.y }, range: 'height' },
          grouped
            ? { name: 'color', type: 'ordinal', domain: { data: 'table', field: c.f.g, sort: true }, range: { scheme: c.cat } }
            : { name: 'color', type: 'linear', zero: true, domain: { data: 'contours', field: 'contour.value' }, range: { scheme: c.seq } },
        ],
        axes: [
          { scale: 'x', grid: true, domain: false, orient: 'bottom', title: c.f.x },
          { scale: 'y', grid: true, domain: false, orient: 'left', title: c.f.y },
        ],
        legends: grouped ? [{ stroke: 'color', symbolType: 'stroke' }] : [],
        marks: [
          {
            type: 'symbol',
            from: { data: 'table' },
            encode: {
              update: {
                x: { scale: 'x', field: fieldRef(c.f.x) },
                y: { scale: 'y', field: fieldRef(c.f.y) },
                size: { value: 6 },
                fill: { value: '#999' },
                opacity: { signal: 'showPoints ? 0.5 : 0' },
              },
            },
          },
          {
            type: 'path',
            clip: true,
            from: { data: 'contours' },
            encode: {
              enter: grouped
                ? { strokeWidth: { value: 1.2 }, stroke: { scale: 'color', field: c.f.g } }
                : { strokeWidth: { value: 0.6 }, stroke: { value: '#fff' }, fill: { scale: 'color', field: 'contour.value' }, fillOpacity: { value: 0.35 } },
            },
            transform: [{ type: 'geopath', field: 'datum.contour' }],
          },
        ],
      })
    },
  },
  {
    id: 'radar',
    name: 'Radar chart',
    category: 'Vega grammar',
    lib: 'vega',
    description: 'Group means across several measures, each axis normalized to its max, drawn in polar coordinates.',
    slots: [
      { key: 'dims', label: 'Axes', types: [Q], multi: 5, prefer: [/petal|sepal|stem|leaf|pollinator|temp|wind|humid|precip|gdp|life|fertility|internet|co2|rating|discount|units/i] },
      { key: 'g', label: 'Group', types: [N], maxUnique: 8, prefer: P.category },
    ],
    build: (c) => {
      const s = Math.min(c.w, c.h + 80)
      return base(c, {
        width: s - 200,
        height: s - 200,
        padding: { top: 60, bottom: 60, left: 110, right: 110 },
        autosize: { type: 'none', contains: 'content' },
        signals: [{ name: 'radius', update: 'width / 2' }],
        data: [
          { name: 'table' },
          {
            name: 'agg',
            source: 'table',
            transform: [
              { type: 'fold', fields: c.m.dims, as: ['key', 'raw'] },
              { type: 'aggregate', groupby: [c.f.g, 'key'], fields: ['raw'], ops: ['mean'], as: ['mean'] },
              { type: 'joinaggregate', groupby: ['key'], fields: ['mean'], ops: ['max'], as: ['kmax'] },
              { type: 'formula', as: 'value', expr: 'datum.kmax ? datum.mean / datum.kmax : 0' },
            ],
          },
          { name: 'keys', source: 'agg', transform: [{ type: 'aggregate', groupby: ['key'] }] },
        ],
        scales: [
          { name: 'angular', type: 'point', range: { signal: '[-PI, PI]' }, padding: 0.5, domain: c.m.dims },
          { name: 'radial', type: 'linear', range: { signal: '[0, radius]' }, zero: true, nice: false, domain: [0, 1] },
          { name: 'color', type: 'ordinal', domain: { data: 'agg', field: c.f.g }, range: { scheme: c.cat } },
        ],
        legends: [{ fill: 'color', orient: 'none', legendX: { signal: 'radius + 30' }, legendY: { signal: '-radius - 40' } }],
        encode: { enter: { x: { signal: 'radius' }, y: { signal: 'radius' } } },
        marks: [
          {
            type: 'group',
            name: 'categories',
            zindex: 1,
            from: { facet: { data: 'agg', name: 'facet', groupby: [c.f.g] } },
            marks: [
              {
                type: 'line',
                name: 'category-line',
                from: { data: 'facet' },
                encode: {
                  enter: {
                    interpolate: { value: 'linear-closed' },
                    x: { signal: "scale('radial', datum.value) * cos(scale('angular', datum.key))" },
                    y: { signal: "scale('radial', datum.value) * sin(scale('angular', datum.key))" },
                    stroke: { scale: 'color', field: c.f.g },
                    strokeWidth: { value: 2 },
                    fill: { scale: 'color', field: c.f.g },
                    fillOpacity: { value: 0.12 },
                  },
                },
              },
              {
                type: 'symbol',
                from: { data: 'facet' },
                encode: {
                  enter: {
                    x: { signal: "scale('radial', datum.value) * cos(scale('angular', datum.key))" },
                    y: { signal: "scale('radial', datum.value) * sin(scale('angular', datum.key))" },
                    fill: { scale: 'color', field: c.f.g },
                    size: { value: 30 },
                    tooltip: { signal: `{group: ${d(c.f.g)}, measure: datum.key, mean: format(datum.mean, ',.2f'), 'of max': format(datum.value, '.0%')}` },
                  },
                },
              },
            ],
          },
          {
            type: 'rule',
            from: { data: 'keys' },
            zindex: 0,
            encode: {
              enter: {
                x: { value: 0 },
                y: { value: 0 },
                x2: { signal: "radius * cos(scale('angular', datum.key))" },
                y2: { signal: "radius * sin(scale('angular', datum.key))" },
                stroke: { value: 'lightgray' },
                strokeWidth: { value: 1 },
              },
            },
          },
          ...[0.25, 0.5, 0.75, 1].map((r) => ({
            type: 'symbol',
            zindex: 0,
            interactive: false,
            encode: {
              enter: {
                x: { value: 0 },
                y: { value: 0 },
                shape: { value: 'circle' },
                size: { signal: `pow(2 * radius * ${r}, 2)` },
                stroke: { value: 'lightgray' },
                strokeWidth: { value: r === 1 ? 1 : 0.5 },
                fill: { value: null },
              },
            },
          })),
          {
            type: 'text',
            from: { data: 'keys' },
            zindex: 1,
            encode: {
              enter: {
                x: { signal: "(radius + 6) * cos(scale('angular', datum.key))" },
                y: { signal: "(radius + 6) * sin(scale('angular', datum.key))" },
                text: { field: 'key' },
                align: [{ test: "abs(scale('angular', datum.key)) > PI / 2", value: 'right' }, { value: 'left' }],
                baseline: [
                  { test: "scale('angular', datum.key) > 0", value: 'top' },
                  { test: "scale('angular', datum.key) == 0", value: 'middle' },
                  { value: 'bottom' },
                ],
                fill: { value: '#333' },
                fontWeight: { value: 'bold' },
                fontSize: { value: 10 },
              },
            },
          },
        ],
      })
    },
  },
]
