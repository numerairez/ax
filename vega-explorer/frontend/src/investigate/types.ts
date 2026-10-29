export type Role = 'dimension' | 'measure' | 'time' | 'lat' | 'lon' | 'id' | 'ignore'

export interface StructField {
  name: string
  role: Role
  agg: 'sum' | 'mean' | null
  parent: string | null
}

export interface Structure {
  fields: StructField[]
  timeField: string | null
  timeGrain: string | null
  primaryMeasure: string
  confirmed: boolean
}

export const COUNT = '__count__'

export interface Filter {
  field: string
  op: 'eq' | 'range'
  value: string | [string | number, string | number]
  label: string
}

export type Strength = 'strong' | 'suggestive' | 'weak' | 'descriptive'

export interface LeadView {
  type: 'breakdown' | 'trend' | 'driver' | 'change'
  field: string
  rows: Record<string, unknown>[]
  mode?: 'overview' | 'share' | 'mean'
  highlight?: string
  grain?: string
  restLabel?: string
  means?: { selection: number; rest: number }
  span?: string
}

export interface Lead {
  id: string
  kind: LeadView['type']
  field: string
  title: string
  reason: string
  score: number
  rank: number
  strength: Strength
  pAdj: number | null
  tags: string[]
  view: LeadView
}

export interface InvestigateResponse {
  context: {
    n: number
    total: number | null
    measure: string
    measureLabel: string
    agg: 'sum' | 'mean'
    bgLabel: string
    bgN: number
    caution: string | null
  }
  leads: Lead[]
  tests: number
}

export interface Step {
  id: number
  parent: number | null
  filters: Filter[]
  measure: string
  res: InvestigateResponse
  leadId: string
  /** How we got here, in words ("clicked West", "autopilot"). */
  via: string
}

/** A chart gesture the user can turn into the next step. */
export type Gesture = { filter: Filter; via: string }
