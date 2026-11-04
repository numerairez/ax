import { COUNT, type Baseline, type Step } from './types.ts'

/**
 * The story of an investigation: one note per chart the user kept, arranged like the steps they came from.
 * Derived from the steps every time, so removing a chart removes its note and everything followed from it.
 */
export interface NarrativeNote {
  stepId: number
  /** Where the data was cut, outermost first ("category = Apparel"). */
  path: string[]
  /** How this chart was reached from its parent ("followed category = Apparel", "switched measure to units"). */
  reachedBy: string | null
  measure: string
  comparedWith: string
  records: number
  total: number | null
  window: string | null
  compareWindow: string | null
  headline: string
  finding: string
  kind: string
  strength: string
  /** Bonferroni-adjusted over every comparison made so far in the investigation. */
  pAdj: number | null
  tags: string[]
  children: NarrativeNote[]
}

export interface Narrative {
  dataset: string
  /** Comparisons tested across the whole investigation, including removed charts. */
  comparisons: number
  roots: NarrativeNote[]
}

const COMPARED: Record<Baseline, string> = { siblings: 'the rest', prior: 'the previous period', yoy: 'a year earlier' }

export function buildNarrative(steps: Step[], dataset: string, comparisons: number): Narrative {
  const note = (s: Step): NarrativeNote => {
    const ctx = s.res.context
    const lead = s.res.leads.find((l) => l.id === s.leadId) ?? s.res.leads[0]
    const parent = steps.find((p) => p.id === s.parent)
    return {
      stepId: s.id,
      path: s.filters.map((f) => f.label),
      reachedBy: parent ? reached(parent, s) : null,
      measure: ctx.measureLabel || (s.measure === COUNT ? 'Records' : s.measure),
      comparedWith: ctx.bgLabel || COMPARED[s.baseline],
      records: ctx.n,
      total: ctx.total,
      window: ctx.window,
      compareWindow: ctx.compareWindow,
      headline: lead?.title ?? 'Nothing stood out',
      finding: lead?.reason ?? 'No lead was strong enough to show at this step.',
      kind: lead?.kind ?? 'none',
      strength: lead?.strength ?? 'none',
      pAdj: lead?.pAdj ?? null,
      tags: lead?.tags ?? [],
      children: steps.filter((c) => c.parent === s.id).map(note),
    }
  }
  return { dataset, comparisons, roots: steps.filter((s) => s.parent == null).map(note) }
}

function reached(parent: Step, s: Step): string {
  const had = new Set(parent.filters.map((f) => f.label))
  const added = s.filters.find((f) => !had.has(f.label))
  if (s.via.startsWith('alternative:')) return `looked at another lead instead (${s.via.slice(12).trim()})`
  if (/^(measure|compare) →/.test(s.via)) return s.via.replace(/^measure → /, 'switched measure to ').replace(/^compare → /, 'switched comparison to ')
  return `${s.via.startsWith('autopilot') ? 'autopilot followed' : 'followed'} ${added?.label ?? s.via}`
}

/** A nested outline an LLM (or a person) can read: one bullet per chart, children indented under the chart they came from. */
export function narrativeMarkdown(n: Narrative): string {
  const lines = [
    `# Investigation of ${n.dataset}`,
    '',
    `Each bullet is a chart the analyst kept; indented bullets were reached from the chart above them. ` +
      `Evidence strength uses p-values adjusted (Bonferroni) for all ${n.comparisons.toLocaleString()} comparisons tested; ` +
      `"descriptive" findings are summaries, not tests.`,
    '',
  ]
  const walk = (x: NarrativeNote, depth: number) => {
    const pad = '  '.repeat(depth)
    const scope = x.path.length ? x.path.join(' › ') : 'All data'
    const when = x.window ? `, ${x.window} vs ${x.compareWindow}` : ''
    const p = x.pAdj == null ? '' : `, adjusted p ${x.pAdj < 0.0001 ? '<0.0001' : x.pAdj.toPrecision(2)}`
    lines.push(`${pad}- **${x.headline}** (${x.strength}${p})`)
    if (x.reachedBy) lines.push(`${pad}  - How: ${x.reachedBy}`)
    lines.push(`${pad}  - Scope: ${scope}; ${x.records.toLocaleString()} records; ${x.measure} vs ${x.comparedWith}${when}`)
    lines.push(`${pad}  - Finding: ${x.finding}`)
    if (x.tags.length) lines.push(`${pad}  - Tags: ${x.tags.join(', ')}`)
    x.children.forEach((c) => walk(c, depth + 1))
  }
  n.roots.forEach((r) => walk(r, 0))
  return lines.join('\n')
}
