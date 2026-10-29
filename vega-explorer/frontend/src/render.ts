import type { Row } from './types.ts'

/**
 * Templates refer to the dataset by name ("table") so the spec stays readable.
 * This injects the rows right before rendering.
 */
export function withData(spec: Record<string, unknown>, lib: 'vega' | 'vega-lite', rows: Row[]): Record<string, unknown> {
  if (lib === 'vega-lite') {
    return { ...spec, datasets: { ...((spec.datasets as object) ?? {}), table: rows } }
  }
  const data = (spec.data as Record<string, unknown>[] | undefined) ?? []
  return {
    ...spec,
    data: data.map((d) => (d.name === 'table' && !d.source && !d.url && !d.values ? { ...d, values: rows } : d)),
  }
}

/** Vega-Lite config carrying the chosen color schemes. */
export function schemeConfig(cat: string, seq: string) {
  return {
    range: { category: { scheme: cat }, ordinal: { scheme: seq }, heatmap: { scheme: seq }, ramp: { scheme: seq } },
  }
}
