// Smoke test: build every template against every dataset and render it to SVG
// headlessly. Run with the backend up:  node scripts/render-all.ts [templateId]
import * as vegaLib from 'vega'
import { compile } from 'vega-lite'
import { autoAssign, defaultOptions, incompatibility, TEMPLATES } from '../src/templates/index.ts'
import { schemeConfig, withData } from '../src/render.ts'
import type { Dataset, DatasetMeta } from '../src/types.ts'

const API = process.env.API ?? 'http://127.0.0.1:8000'
const only = process.argv[2]

const metas: DatasetMeta[] = await (await fetch(`${API}/api/datasets`)).json()
let ok = 0
let skipped = 0
const failures: string[] = []

for (const meta of metas) {
  const ds: Dataset = await (await fetch(`${API}/api/datasets/${meta.id}`)).json()
  for (const t of TEMPLATES) {
    if (only && t.id !== only) continue
    if (incompatibility(t, meta.fields)) {
      skipped++
      continue
    }
    const map = autoAssign(t, meta.fields)
    const ctx = { ...map, o: defaultOptions(t), rows: ds.rows, fields: meta.fields, w: 560, h: 320, cat: 'tableau10', seq: 'viridis' }
    const label = `${t.id} × ${meta.id} ${JSON.stringify({ ...map.f, ...map.m })}`
    const warnings: string[] = []
    try {
      const spec = withData(t.build(ctx), t.lib, ds.rows)
      const vgSpec =
        t.lib === 'vega-lite'
          ? compile(spec as never, { config: schemeConfig('tableau10', 'viridis') as never, logger: quietLogger(warnings) as never }).spec
          : spec
      const view = new vegaLib.View(vegaLib.parse(vgSpec as never), { renderer: 'none', logger: quietLogger(warnings) as never })
      const svg = await view.toSVG()
      view.finalize()
      if (!svg.includes('<svg')) throw new Error('no svg output')
      if (process.env.OUT) (await import('node:fs')).writeFileSync(`${process.env.OUT}/${t.id}__${meta.id}.svg`, svg)
      const marks = (svg.match(/<(path|rect|circle|line|text)\b/g) ?? []).length
      if (marks < 5) throw new Error(`suspiciously empty (${marks} elements)`)
      if (warnings.length) console.log(`  warn ${label}: ${[...new Set(warnings)].slice(0, 3).join(' | ')}`)
      ok++
    } catch (e) {
      failures.push(`${label}\n    ${(e as Error).message}`)
    }
  }
}

console.log(`\n${ok} rendered, ${skipped} skipped (incompatible), ${failures.length} failed`)
for (const f of failures) console.log(`FAIL ${f}`)
process.exit(failures.length ? 1 : 0)

function quietLogger(sink: string[]) {
  let lvl = 0
  const l = {
    level(v?: number) {
      if (v === undefined) return lvl
      lvl = v
      return l
    },
    error: (...a: unknown[]) => sink.push(`error: ${a.join(' ')}`),
    warn: (...a: unknown[]) => sink.push(a.join(' ')),
    info: () => l,
    debug: () => l,
  }
  return l
}
