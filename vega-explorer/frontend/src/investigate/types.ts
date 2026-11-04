import type { FieldMeta } from '../types.ts'

export type Role = 'dimension' | 'measure' | 'time' | 'lat' | 'lon' | 'id' | 'ignore'

export interface StructField {
  name: string
  role: Role
  agg: 'sum' | 'mean' | null
  parent: string | null
  /** Measures only: the plan, budget or limit this measure is judged against. */
  target: string | null
}

/** A ratio measure, aggregated as sum(num) / sum(den) × scale. */
export interface Calc {
  name: string
  num: string
  den: string
  scale: number
}

export interface Structure {
  fields: StructField[]
  timeField: string | null
  timeGrain: string | null
  primaryMeasure: string
  calcs: Calc[]
  confirmed: boolean
}

/** What the selection is compared with. */
export type Baseline = 'siblings' | 'prior' | 'yoy'

export const COUNT = '__count__'

export interface Filter {
  field: string
  op: 'eq' | 'range'
  value: string | [string | number, string | number]
  label: string
}

export type Strength = 'strong' | 'suggestive' | 'weak' | 'descriptive'

/** Drawn by the view registry in views.ts, keyed by `type`. */
export interface LeadView {
  type: string
  field: string
  rows: Record<string, unknown>[]
  mode?: 'overview' | 'share' | 'mean' | 'like' | 'target'
  xTitle?: string
  expectedTitle?: string
  highlight?: string
  grain?: string
  restLabel?: string
  means?: { selection: number; rest: number }
  span?: string
  brushable?: boolean
  /** "How to read this" text, for views the frontend can't explain on its own (templates). */
  guide?: string
  targetLabel?: string
  /** Prior-period baselines: the window being looked at and the one it is compared with. */
  window?: [string, string]
  /** Trend: consecutive unusual periods, first and last. */
  episode?: [string, string]
  compareWindow?: [string, string]
  /** type "template": draw with a chart-library template. */
  template?: string
  key?: string
  f?: Record<string, string>
  m?: Record<string, string[]>
  o?: Record<string, string>
  fields?: FieldMeta[]
}

export interface Lead {
  id: string
  kind: string
  icon?: string
  field: string
  title: string
  reason: string
  score: number
  rank: number
  strength: Strength
  pAdj: number | null
  tags: string[]
  view: LeadView
  /** How the rank was computed: rank = score × factor + Σ adjust. */
  why: {
    score: number
    scoreNotes: { label: string; factor: number }[]
    factor: number
    adjust: { label: string; value: number }[]
    rank: number
    pRaw: number | null
    tests: number
  }
}

export interface InvestigateResponse {
  context: {
    n: number
    total: number | null
    measure: string
    measureLabel: string
    agg: 'sum' | 'mean'
    baseline: Baseline
    window: string | null
    compareWindow: string | null
    bgLabel: string
    bgN: number
    caution: string | null
  }
  leads: Lead[]
  /** Leads scored before the menu was trimmed to the best few. */
  candidates: number
  tests: number
}

export interface Step {
  id: number
  parent: number | null
  filters: Filter[]
  measure: string
  baseline: Baseline
  res: InvestigateResponse
  leadId: string
  /** How we got here, in words ("clicked West", "autopilot"). */
  via: string
}

/** A chart gesture the user can turn into the next step. */
export type Gesture = { filter: Filter; via: string }
