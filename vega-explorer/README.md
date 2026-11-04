# Narra

<img src="frontend/public/favicon.svg" width="64" alt="Narra logo: a narra tree whose branches are an investigation trail">

**Narra** is for *narrative*, and for the narra tree. You follow one story through the data, and it branches wherever a lead does. The logo is that tree: a broad narra crown, with the branch you followed drawn bold from root to a golden blossom, and the leads you didn't take beside it.

Narra has three parts:

- **Investigate:** click a chart and Narra picks the next one. Each step compares your selection with a comparison group, and leads are ranked by effect size and multiple-testing-adjusted evidence. Every step stays on the page as a story you can rewind or branch.
- **Chart library:** 65 Vega and Vega-Lite chart techniques, each auto-mapped to whichever dataset you pick. You can remap fields, change options, try themes and palettes, and edit the raw spec live.
- **How it works:** the method, inside the app, with the engine's live ranking constants.

## Running it

Once, and again whenever the frontend changes:

```
pip install -r backend/requirements.txt            # Python 3.11+, ideally in a virtualenv
cd frontend && npm install && npm run build && cd ..
```

Then, from this folder:

```
python backend/app/main.py          # Windows: python backend\app\main.py
```

That serves the API and the built frontend together at http://localhost:8000 and opens a browser tab. Options: `--port 8080`, `--host 0.0.0.0` (to reach it from other machines, on a trusted network only: anyone who can reach it can use Connect to read files on this machine), `--no-browser`.

**Developing the frontend** with hot reload: `./start.sh` runs the API on :8000 and Vite on :5173 (Vite proxies `/api` to the API). Or run them separately:

```
cd backend  && .venv/bin/uvicorn app.main:app --port 8000 --reload
cd frontend && npm run dev
```

## What's inside

**Backend** (`backend/app`, FastAPI + DuckDB)
- `mock_data.py` contains six seeded synthetic datasets, each built to exercise different chart families:
  - Retail Sales: timestamps, US lat/lon, a category → sub-category hierarchy
  - City Weather: daily seasonal series
  - Stock Prices: OHLC data
  - World Development: a Gapminder-style panel with real ISO codes for maps
  - Botanical Specimens: clustered multivariate data
  - Collaboration Network: an edge list
  - IPV Variance: month-end desk vs independent price verification, with division → business line → desk → book, product, fair-value level, IPV source, tolerances and breaches. It has planted stories: a Structured Credit shock in Apr 2025, an EM Rates mark drift, a Power & Gas cold snap in Jan 2026, and tighter quarter-ends.
- `db.py` holds the DuckDB connection (in memory by default; set `VEGA_DB` to a file path to persist it). Every dataset is a table, and the investigation engine pushes filtering and aggregation down to it in SQL, so there is no row cap.
- `store.py` handles uploads (CSV, TSV, JSON, JSON Lines, Parquet) and **connected files** (⛓ Connect: a path or glob such as `/data/marks/*.parquet`, read in place and re-read on ↻ Refresh). It infers field types (quantitative, temporal, nominal) and profiles each field in SQL. Uploads are stored in `backend/uploads/`. The chart library renders in the browser, so it gets a 50k-row sample of large datasets. Investigate always uses every row.

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
   - **targets**: the plan, budget or limit a measure is judged against (`revenue_target` → `revenue`, or a `tolerance` / `limit` / `budget` column → the primary measure)
   - **calculated measures**: ratios aggregated as `sum(num) / sum(den) × scale`, never as an average of per-row ratios. 0/1 flags are suggested as rates (breach rate = breaches ÷ records), and a measure over its target as a utilisation ratio.

   You confirm or edit these once per dataset. They're saved in `backend/structures/`.
2. **Compare with.** The comparison group is one of:
   - **the rest** (default): the records that differ only in the last filter
   - **previous period**: the latest period, or the period you clicked or brushed, compared with the one before it
   - **a year earlier**: the same window a year back

   With a time baseline, every step also gets "what drove the change" leads, and the trend shows the two windows.
3. **Gestures.** Click a bar to filter to that value. Click a point on a trend to filter to that period. Drag across a trend or a distribution to investigate that range. Each gesture adds a step to the investigation path.
4. **Lead engine** (`backend/app/engine/`). `core.py` turns the filter path and baseline into SQL for the selection and its comparison group. Tests run on grouped sufficient statistics (`stats.py`), so nothing is computed row by row in Python. Each lead kind is a plugin in `engine/kinds/`:
   - **breakdown:** how the selection splits along a dimension, compared with that comparison group
   - **like-for-like:** each value against *the same value* in the comparison group, as an average per record. Share-based breakdowns are cross-checked against it. When a value's bigger share comes from what the selection holds, not from how it behaves, the lead is tagged *mix effect* and ranked lower.
   - **trend:** unusual periods, each compared with the median of its two neighbours either side (never itself), and kept only if significant after adjusting for every comparison so far. Consecutive unusual periods form one stretch, labelled at its peak. With none, the lead reports the overall drift, and the chart marks only what the text claims.
   - **driver:** another measure that differs (Cohen's d)
   - **change:** after brushing a time range, or with a time baseline, which values drove the change
   - **target:** values on the other side of their target from the selection as a whole. Dimensions defined by the target, such as a breach/within-tolerance status, are skipped as circular.
   - **relationship:** across a dimension's values, another level or rate that moves with the measure (Spearman). It is drawn with the chart library's scatter template. It is offered from the second step on, since it explains a selection.

   The top lead becomes the next chart, and the rest are shown as lead cards. Every step stays on the page as a story. The bar or period you followed stays highlighted. Clicking something else in an earlier chart branches from that step.
5. **Honesty.** Every comparison is counted across the whole session, and p-values are Bonferroni-adjusted by that running total. Leads are labelled strong, suggestive, weak or descriptive.
6. **Trail.** Picking a different lead on an explored step forks the investigation. Breadcrumbs rewind it. Autopilot follows the strongest actionable lead for up to 4 hops.

## Adding a lead kind

Drop a module into `backend/app/engine/kinds/` (or list a module path in `$VEGA_LEAD_KINDS`):

```python
from app.engine import Engine, lead_kind

@lead_kind("outliers", icon="⚑", order=70)
def outliers(e: Engine) -> list[dict]:
    """One line shown in /api/lead-kinds."""
    g = e.stats(e.sel_w, "desk")          # n, v (value), mean, var, neff per desk, via one SQL query
    ...
    e.tests += 1                          # count every comparison you make
    return [e.lead("outliers", "desk", title, reason, score, p_value, view)]
```

`view` is drawn by the frontend view registry (`VIEWS` in `frontend/src/investigate/views.ts`), keyed by its `type`. You can reuse `breakdown`, `trend`, `driver` or `change`, register a new view there, or send `{"type": "template", "template": "<chart id>", "f": {slot: field}, "rows": [...], "fields": [...]}` to draw the lead with any chart from the library. Clicking a mark then filters on `view.field`.

## Adding a chart

Add an object to any array in `frontend/src/templates/` with `slots`, optional `options` and `build`. It appears in the sidebar and gallery automatically. Then run:

```
cd frontend && npm run test:render   # needs the backend running
```

This builds every template against every dataset and renders each one headlessly to SVG, so broken specs show up right away.
