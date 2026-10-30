# Vega Explorer

A browsable library of 65 Vega and Vega-Lite chart techniques. Each chart is auto-mapped to whichever dataset you pick. You can remap fields, change options, try themes and palettes, and edit the raw spec live.

```
./start.sh          # backend on :8000, frontend on :5173 (opens the browser)
```

To run them separately:

```
cd backend  && .venv/bin/uvicorn app.main:app --port 8000
cd frontend && npm run dev
```

## What's inside

**Backend** (`backend/app`, FastAPI + pandas)
- `mock_data.py` contains six seeded synthetic datasets, each built to exercise different chart families:
  - Retail Sales: timestamps, US lat/lon, a category → sub-category hierarchy
  - City Weather: daily seasonal series
  - Stock Prices: OHLC data
  - World Development: a Gapminder-style panel with real ISO codes for maps
  - Botanical Specimens: clustered multivariate data
  - Collaboration Network: an edge list
  - IPV Variance: month-end desk vs independent price verification, with division → business line → desk → book, product, fair-value level, IPV source, tolerances and breaches. It has planted stories: a Structured Credit shock in Apr 2025, an EM Rates mark drift, a Power & Gas cold snap in Jan 2026, and tighter quarter-ends.
- `store.py` handles uploads (CSV, TSV, JSON, JSON Lines). It infers field types (quantitative, temporal, nominal), profiles each field, and stores uploads in `backend/uploads/`. Uploads are capped at 50k rows by sampling.

**Frontend** (`frontend/src`, React + vega-embed)
- `templates/*.ts` holds the chart library. Each template declares typed *slots* (for example "Category: nominal") plus options, and has a `build(ctx)` function that returns a spec. Specs refer to the data as `"table"`; `render.ts` injects the rows at render time.
- `templates/index.ts` auto-assigns fields to slots, using type, cardinality and name hints. It also keeps your previous picks when you switch charts.
- Categories: Basics, Distributions, Part-to-whole, Relationships, Time series, Interactive (brushing, crossfilter, legend binding, sliders, drill-down), Maps, Composition & facets, Vega grammar (force graph, arc diagram, radial tree, word cloud, radar, contours, beeswarm, treemap, sunburst).

## Investigate mode (✦ in the top bar)

This is a prototype of an analytical experience where you follow leads by clicking charts, and the system picks the next chart.

1. **Structure setup.** `backend/app/structure.py` detects:
   - each field's role (dimension, measure, time, geo, ID)
   - whether each measure is additive (sum) or a level/rate (average)
   - hierarchies, found from functional dependencies (city → state → region)

   You confirm or edit these once per dataset. They're saved in `backend/structures/`.
2. **Gestures.** Click a bar to filter to that value. Click a point on a trend to filter to that period. Drag across a trend or a distribution to investigate that range. Each gesture adds a step to the investigation path.
3. **Lead engine** (`backend/app/investigate.py`). For the current selection, it compares against the records that differ only in the last filter, then scores four kinds of lead:
   - **breakdown:** how the selection splits along a dimension, compared with that comparison group
   - **like-for-like:** each value against *the same value* in the comparison group, as an average per record. Share-based breakdowns are cross-checked against it. When a value's bigger share comes from what the selection holds, not from how it behaves, the lead is tagged *mix effect* and ranked lower.
   - **trend:** the most anomalous period
   - **driver:** another measure that differs (Cohen's d)
   - **change:** after brushing a time range, which values drove the change versus the previous period

   The top lead becomes the next chart, and the rest are shown as lead cards. Every step stays on the page as a story. The bar or period you followed stays highlighted. Clicking something else in an earlier chart branches from that step.
4. **Honesty.** Every comparison is counted across the whole session, and p-values are Bonferroni-adjusted by that running total. Leads are labelled strong, suggestive, weak or descriptive.
5. **Trail.** Picking a different lead on an explored step forks the investigation. Breadcrumbs rewind it. Autopilot follows the strongest actionable lead for up to 4 hops.

## Adding a chart

Add an object to any array in `frontend/src/templates/` with `slots`, optional `options` and `build`. It appears in the sidebar and gallery automatically. Then run:

```
cd frontend && npm run test:render   # needs the backend running
```

This builds every template against every dataset and renders each one headlessly to SVG, so broken specs show up right away.
