import type { FieldMeta, FieldType, Row } from '../types.ts'

export type Category =
  | 'Basics'
  | 'Distributions'
  | 'Part-to-whole'
  | 'Relationships'
  | 'Time series'
  | 'Interactive'
  | 'Maps'
  | 'Composition & facets'
  | 'Vega grammar'

export const CATEGORIES: Category[] = [
  'Basics',
  'Distributions',
  'Part-to-whole',
  'Relationships',
  'Time series',
  'Interactive',
  'Maps',
  'Composition & facets',
  'Vega grammar',
]

export interface Slot {
  key: string
  label: string
  types: FieldType[]
  optional?: boolean
  /** Multi-field slot; the number is how many fields to auto-assign. */
  multi?: number
  /** Field-name patterns to prefer during auto-assignment. */
  prefer?: RegExp[]
  /** Skip nominal fields with more distinct values than this when auto-assigning. */
  maxUnique?: number
  /** Only auto-assign integer-valued quantitative fields. */
  integer?: boolean
}

export interface OptionDef {
  key: string
  label: string
  choices: string[]
  default: string
}

export interface Ctx {
  /** Single-field slots ('' when an optional slot is empty). */
  f: Record<string, string>
  /** Multi-field slots. */
  m: Record<string, string[]>
  /** Option values. */
  o: Record<string, string>
  rows: Row[]
  fields: FieldMeta[]
  w: number
  h: number
  /** Categorical and sequential color schemes. */
  cat: string
  seq: string
}

export interface ChartTemplate {
  id: string
  name: string
  category: Category
  lib: 'vega-lite' | 'vega'
  description: string
  slots: Slot[]
  options?: OptionDef[]
  build: (c: Ctx) => Record<string, unknown>
}

export const VL_SCHEMA = 'https://vega.github.io/schema/vega-lite/v6.json'
export const VEGA_SCHEMA = 'https://vega.github.io/schema/vega/v6.json'
export const TOPO_US = 'https://cdn.jsdelivr.net/npm/vega-datasets@2.8.0/data/us-10m.json'
export const TOPO_WORLD = 'https://cdn.jsdelivr.net/npm/vega-datasets@2.8.0/data/world-110m.json'

/** Base Vega-Lite spec bound to the injected dataset named "table". */
export function vl(c: Ctx, rest: Record<string, unknown>): Record<string, unknown> {
  return { $schema: VL_SCHEMA, data: { name: 'table' }, width: c.w, height: c.h, ...rest }
}

export function typeOf(c: Ctx, field: string): FieldType | undefined {
  return c.fields.find((f) => f.name === field)?.type
}

/** Vega expression accessor for a field name. */
export function d(field: string): string {
  return `datum[${JSON.stringify(field)}]`
}

/** Vega field reference for a field name (safe for spaces and quotes). */
export function fieldRef(field: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(field) ? field : `datum[${JSON.stringify(field)}]`
}

export function uniq(c: Ctx, field: string, limit = 200): string[] {
  const seen = new Set<string>()
  for (const r of c.rows) {
    const v = r[field]
    if (v != null) seen.add(String(v))
    if (seen.size >= limit) break
  }
  return [...seen].sort()
}

export function numRange(c: Ctx, field: string): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const r of c.rows) {
    const v = Number(r[field])
    if (Number.isFinite(v)) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  return Number.isFinite(lo) ? [lo, hi] : [0, 1]
}

/**
 * Encoding for a "time-like" slot. Real temporal fields get a time unit;
 * year-like numeric fields fall back to an integer quantitative axis.
 */
export function timeEnc(c: Ctx, field: string, timeUnit?: string, extra: Record<string, unknown> = {}) {
  if (typeOf(c, field) === 'temporal') {
    return { field, type: 'temporal', ...(timeUnit && timeUnit !== 'none' ? { timeUnit } : {}), ...extra }
  }
  return { field, type: 'quantitative', scale: { zero: false }, axis: { format: 'd' }, ...extra }
}

/** Aggregated measure encoding driven by the "agg" option. */
export function measure(c: Ctx, key = 'y', extra: Record<string, unknown> = {}) {
  const op = c.o.agg ?? 'sum'
  if (op === 'count' || !c.f[key]) return { aggregate: 'count', type: 'quantitative', title: 'Count', ...extra }
  return { field: c.f[key], aggregate: op, type: 'quantitative', ...extra }
}

/** Name of the aggregated measure for use in transforms. */
export function aggOp(c: Ctx): string {
  return c.o.agg ?? 'sum'
}

export function aggTransform(c: Ctx, key: string, as: string) {
  const op = aggOp(c)
  return op === 'count' || !c.f[key] ? { op: 'count', as } : { op, field: c.f[key], as }
}

export const opt = (c: Ctx, key: string, enc: unknown) => (c.f[key] ? enc : undefined)

export const AGG: OptionDef = {
  key: 'agg',
  label: 'Aggregate',
  choices: ['sum', 'mean', 'median', 'count', 'max', 'min', 'distinct'],
  default: 'sum',
}
export const AGG_MEAN: OptionDef = { ...AGG, default: 'mean' }
export const TIME_UNIT: OptionDef = {
  key: 'tu',
  label: 'Time unit',
  choices: ['yearmonth', 'yearquarter', 'yearweek', 'yearmonthdate', 'year', 'none'],
  default: 'yearmonth',
}

/** Generic preference patterns used by many templates. */
export const P = {
  measure: [/revenue|sales|amount|value|price|close|gdp|temp_max|profit|count|total/i],
  category: [/category|region|continent|species|symbol|city|segment|channel|type|group|team|class/i],
  time: [/date|time|day|month|year|timestamp/i],
}
