import { AGG, aggTransform, numRange, opt, TOPO_US, TOPO_WORLD, vl, type ChartTemplate } from './core.ts'

const N = 'nominal' as const
const Q = 'quantitative' as const

const LAT = [/^lat|latitude/i]
const LON = [/^lon|^lng|longitude/i]
const PROJECTIONS = { key: 'proj', label: 'Projection', choices: ['equalEarth', 'naturalEarth1', 'mercator', 'orthographic', 'equirectangular'], default: 'equalEarth' }

export const maps: ChartTemplate[] = [
  {
    id: 'us-bubbles',
    name: 'US bubble map',
    category: 'Maps',
    lib: 'vega-lite',
    description: 'Albers USA projection with state outlines (TopoJSON) and circles at lat/lon sized by a measure.',
    slots: [
      { key: 'lat', label: 'Latitude', types: [Q], prefer: LAT },
      { key: 'lon', label: 'Longitude', types: [Q], prefer: LON },
      { key: 'size', label: 'Size', types: [Q], prefer: [/revenue|population|sales/i] },
      { key: 'color', label: 'Color', types: [N], optional: true, maxUnique: 10, prefer: [/region|continent|category/i] },
      { key: 'label', label: 'Label', types: [N], optional: true, prefer: [/city|country|name/i] },
    ],
    options: [AGG],
    build: (c) =>
      vl(c, {
        width: c.w,
        height: c.w * 0.6,
        projection: { type: 'albersUsa' },
        layer: [
          {
            data: { url: TOPO_US, format: { type: 'topojson', feature: 'states' } },
            mark: { type: 'geoshape', fill: '#e8e8e8', stroke: 'white' },
          },
          {
            transform: [
              { aggregate: [aggTransform(c, 'size', 'value')], groupby: [c.f.lat, c.f.lon, ...(c.f.color ? [c.f.color] : []), ...(c.f.label ? [c.f.label] : [])] },
            ],
            mark: { type: 'circle', opacity: 0.75, stroke: 'white', strokeWidth: 1 },
            encoding: {
              latitude: { field: c.f.lat, type: Q },
              longitude: { field: c.f.lon, type: Q },
              size: { field: 'value', type: Q, title: `${c.o.agg} ${c.f.size}`, scale: { range: [20, 1600] } },
              color: opt(c, 'color', { field: c.f.color, type: N }),
              tooltip: [...(c.f.label ? [{ field: c.f.label }] : []), { field: 'value', type: Q, format: ',.0f', title: `${c.o.agg} ${c.f.size}` }],
            },
          },
        ],
      }),
  },
  {
    id: 'world-bubbles',
    name: 'World bubble map',
    category: 'Maps',
    lib: 'vega-lite',
    description: 'Sphere, graticule and country shapes with proportional symbols. Try the orthographic globe.',
    slots: [
      { key: 'lat', label: 'Latitude', types: [Q], prefer: LAT },
      { key: 'lon', label: 'Longitude', types: [Q], prefer: LON },
      { key: 'size', label: 'Size', types: [Q], prefer: [/population|revenue|gdp/i] },
      { key: 'color', label: 'Color', types: [N], optional: true, maxUnique: 10, prefer: [/continent|region/i] },
      { key: 'label', label: 'Label', types: [N], optional: true, prefer: [/country|city|name/i] },
    ],
    options: [{ ...AGG, default: 'mean' }, PROJECTIONS],
    build: (c) =>
      vl(c, {
        width: c.w,
        height: c.w * 0.55,
        projection: { type: c.o.proj, ...(c.o.proj === 'orthographic' ? { rotate: [-20, -20, 0] } : {}) },
        layer: [
          { data: { sphere: true }, mark: { type: 'geoshape', fill: '#eef4fa' } },
          { data: { graticule: { step: [15, 15] } }, mark: { type: 'geoshape', stroke: '#ccd', strokeWidth: 0.4 } },
          {
            data: { url: TOPO_WORLD, format: { type: 'topojson', feature: 'countries' } },
            mark: { type: 'geoshape', fill: '#ddd', stroke: 'white', strokeWidth: 0.5 },
          },
          {
            transform: [
              { aggregate: [aggTransform(c, 'size', 'value')], groupby: [c.f.lat, c.f.lon, ...(c.f.color ? [c.f.color] : []), ...(c.f.label ? [c.f.label] : [])] },
            ],
            mark: { type: 'circle', opacity: 0.7, stroke: 'white', strokeWidth: 0.6 },
            encoding: {
              latitude: { field: c.f.lat, type: Q },
              longitude: { field: c.f.lon, type: Q },
              size: { field: 'value', type: Q, title: `${c.o.agg} ${c.f.size}`, scale: { range: [10, 1500] } },
              color: opt(c, 'color', { field: c.f.color, type: N }),
              tooltip: [...(c.f.label ? [{ field: c.f.label }] : []), { field: 'value', type: Q, format: ',.1f' }],
            },
          },
        ],
      }),
  },
  {
    id: 'choropleth',
    name: 'World choropleth + slider',
    category: 'Maps',
    lib: 'vega-lite',
    description: 'Countries colored by a measure via a lookup on ISO numeric codes. If a year field exists, a slider filters it.',
    slots: [
      { key: 'id', label: 'ISO numeric id', types: [Q], prefer: [/iso_numeric|iso_n|ccn|country_id|^id$/i] },
      { key: 'v', label: 'Measure', types: [Q], prefer: [/life|gdp|co2|internet|fertility/i] },
      { key: 'frame', label: 'Year (slider)', types: [Q], optional: true, integer: true, prefer: [/year/i] },
      { key: 'label', label: 'Name', types: [N], optional: true, prefer: [/country|name/i] },
    ],
    options: [PROJECTIONS, { key: 'scale', label: 'Color scale', choices: ['linear', 'log', 'quantile', 'quantize'], default: 'linear' }],
    build: (c) => {
      const [lo, hi] = c.f.frame ? numRange(c, c.f.frame) : [0, 0]
      return vl(c, {
        width: c.w,
        height: c.w * 0.55,
        projection: { type: c.o.proj, ...(c.o.proj === 'orthographic' ? { rotate: [-20, -20, 0] } : {}) },
        params: c.f.frame ? [{ name: 'year', value: hi, bind: { input: 'range', min: lo, max: hi, step: 1, name: `${c.f.frame} ` } }] : [],
        layer: [
          { data: { sphere: true }, mark: { type: 'geoshape', fill: '#eef4fa' } },
          {
            data: { url: TOPO_WORLD, format: { type: 'topojson', feature: 'countries' } },
            mark: { type: 'geoshape', fill: '#e2e2e2', stroke: 'white', strokeWidth: 0.5 },
          },
          {
            transform: [
              ...(c.f.frame ? [{ filter: `datum[${JSON.stringify(c.f.frame)}] == year` }] : []),
              { aggregate: [{ op: 'mean', field: c.f.v, as: 'value' }], groupby: [c.f.id, ...(c.f.label ? [c.f.label] : [])] },
              { lookup: c.f.id, from: { data: { url: TOPO_WORLD, format: { type: 'topojson', feature: 'countries' } }, key: 'id' }, as: 'geo' },
              { filter: 'datum.geo' },
            ],
            mark: { type: 'geoshape', stroke: 'white', strokeWidth: 0.5 },
            encoding: {
              shape: { field: 'geo', type: 'geojson' },
              color: {
                field: 'value',
                type: Q,
                title: c.f.v,
                scale: { type: c.o.scale, scheme: c.seq, domain: c.o.scale === 'linear' || c.o.scale === 'log' ? numRange(c, c.f.v) : undefined },
              },
              tooltip: [...(c.f.label ? [{ field: c.f.label }] : []), { field: 'value', type: Q, format: ',.2f', title: c.f.v }],
            },
          },
        ],
      })
    },
  },
]
