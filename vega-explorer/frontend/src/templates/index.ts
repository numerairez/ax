import type { FieldMeta } from '../types.ts'
import { basics } from './basics.ts'
import { composition } from './composition.ts'
import type { ChartTemplate, Ctx, Slot } from './core.ts'
import { distributions } from './distributions.ts'
import { interactive } from './interactive.ts'
import { maps } from './maps.ts'
import { relationships } from './relationships.ts'
import { timeseries } from './timeseries.ts'
import { vega } from './vega.ts'

export * from './core.ts'

export const TEMPLATES: ChartTemplate[] = [
  ...basics,
  ...distributions,
  ...relationships,
  ...timeseries,
  ...interactive,
  ...maps,
  ...composition,
  ...vega,
]

export interface Mapping {
  f: Record<string, string>
  m: Record<string, string[]>
}

// Fields that are rarely what you want as a generic measure.
const NOT_A_MEASURE = /(^|_)(id|lat|latitude|lon|lng|longitude|iso.*|year)$/i

/** Fields that can fill a slot, best first. */
export function candidates(slot: Slot, fields: FieldMeta[]): FieldMeta[] {
  const scored: { f: FieldMeta; s: number }[] = []
  for (const f of fields) {
    let s = 0
    const typeRank = slot.types.indexOf(f.type)
    if (typeRank >= 0) {
      s = 100 - typeRank * 10
    } else if (slot.types.includes('temporal') && f.type === 'quantitative' && /year/i.test(f.name)) {
      s = 60 // year-like numbers can stand in for time
    } else {
      continue
    }
    if (f.type === 'nominal') {
      if (f.unique <= 1) continue
      if (slot.maxUnique && f.unique > slot.maxUnique) s -= 70
      if (f.unique > 0.9 * Math.max(1, ...fields.map((x) => x.unique)) && f.unique > 50) s -= 30 // looks like an ID
    }
    if (slot.integer && f.type === 'quantitative' && !f.integer) continue
    if (f.type === 'quantitative' && NOT_A_MEASURE.test(f.name)) s -= 25
    const pi = slot.prefer?.findIndex((re) => re.test(f.name)) ?? -1
    if (pi >= 0) s += 40 - pi
    scored.push({ f, s })
  }
  return scored.sort((a, b) => b.s - a.s).map((x) => x.f)
}

function fits(slot: Slot, f: FieldMeta | undefined): boolean {
  if (!f) return false
  return slot.types.includes(f.type) || (slot.types.includes('temporal') && f.type === 'quantitative' && /year/i.test(f.name))
}

/** Assign fields to slots, keeping compatible picks from a previous mapping. */
export function autoAssign(t: ChartTemplate, fields: FieldMeta[], prev?: Mapping): Mapping {
  const byName = new Map(fields.map((f) => [f.name, f]))
  const used = new Set<string>()
  const out: Mapping = { f: {}, m: {} }
  // Required slots first so optional ones don't steal their best field.
  const order = [...t.slots].sort((a, b) => Number(!!a.optional) - Number(!!b.optional))
  for (const slot of order) {
    if (slot.multi) {
      const keep = (prev?.m[slot.key] ?? []).filter((n) => fits(slot, byName.get(n)))
      const pool = candidates(slot, fields).filter((f) => !used.has(f.name) && f.type === 'quantitative')
      const pick = keep.length >= 2 ? keep : pool.slice(0, slot.multi).map((f) => f.name)
      pick.forEach((n) => used.add(n))
      out.m[slot.key] = pick
      continue
    }
    const prevPick = prev?.f[slot.key]
    if (prevPick && !used.has(prevPick) && fits(slot, byName.get(prevPick))) {
      out.f[slot.key] = prevPick
      used.add(prevPick)
      continue
    }
    const best = candidates(slot, fields).find((f) => !used.has(f.name))
    const strongEnough = best && (!slot.optional || candidates(slot, fields).indexOf(best) >= 0)
    if (best && strongEnough && (!slot.optional || !(best.type === 'nominal' && slot.maxUnique && best.unique > slot.maxUnique))) {
      out.f[slot.key] = best.name
      used.add(best.name)
    } else {
      out.f[slot.key] = ''
    }
  }
  return out
}

/** Why a template can't be drawn with a dataset (null when it can). */
export function incompatibility(t: ChartTemplate, fields: FieldMeta[]): string | null {
  const m = autoAssign(t, fields)
  for (const slot of t.slots) {
    if (slot.optional) continue
    const missing = slot.multi ? (m.m[slot.key]?.length ?? 0) < 2 : !m.f[slot.key]
    if (missing) {
      const what = slot.types.join(' or ')
      return slot.multi ? `Needs at least 2 ${what} fields for “${slot.label}”` : `Needs another ${what} field for “${slot.label}”`
    }
  }
  return null
}

export function defaultOptions(t: ChartTemplate): Record<string, string> {
  return Object.fromEntries((t.options ?? []).map((o) => [o.key, o.default]))
}

export function buildSpec(t: ChartTemplate, ctx: Ctx): Record<string, unknown> {
  return t.build(ctx)
}
