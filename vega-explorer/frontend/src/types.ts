export type FieldType = 'quantitative' | 'temporal' | 'nominal'

export interface FieldMeta {
  name: string
  type: FieldType
  missing: number
  unique: number
  integer?: boolean
  stats?: Record<string, number | string | null>
  top?: { value: string; count: number }[]
}

export interface DatasetMeta {
  id: string
  name: string
  description: string
  source: 'builtin' | 'upload' | 'connected'
  rows: number
  /** Set when the chart library gets a sample of this many rows (the engine always sees all). */
  sampled: number | null
  /** Connected datasets: the file or glob they read. */
  location: string | null
  fields: FieldMeta[]
}

export type Row = Record<string, unknown>

export interface Dataset {
  meta: DatasetMeta
  rows: Row[]
}
