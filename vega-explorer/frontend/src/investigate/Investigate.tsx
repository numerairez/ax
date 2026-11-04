import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import embed, { type Result } from 'vega-embed'
import { api } from '../api.ts'
import type { DatasetMeta } from '../types.ts'
import { StructureSetup } from './StructureSetup.tsx'
import { buildNarrative, narrativeMarkdown, type Narrative, type NarrativeNote } from './narrative.ts'
import { COUNT, type Baseline, type Filter, type Gesture, type Lead, type Step, type Structure } from './types.ts'
import { autoGesture, buildSpec, fmt, guideOf, iconOf, viewOf, type KeyItem } from './views.ts'

type Pending = { stepId: number; g: Gesture }

const BASELINES: { value: Baseline; label: string; title: string }[] = [
  { value: 'siblings', label: 'the rest', title: 'Compare the selection with the records that differ only in the last filter' },
  { value: 'prior', label: 'previous period', title: 'Compare the latest period (or the period you picked) with the one before it' },
  { value: 'yoy', label: 'a year earlier', title: 'Compare the latest period (or the period you picked) with the same period a year earlier' },
]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function Investigate({ meta, onExplain }: { meta: DatasetMeta; onExplain: (section?: string) => void }) {
  const [structure, setStructure] = useState<Structure | null>(null)
  const [editing, setEditing] = useState(false)
  const [steps, setSteps] = useState<Step[]>([])
  const [currentId, setCurrentId] = useState<number | null>(null)
  const [tests, setTests] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [pilot, setPilot] = useState(false)
  const [baseline, setBaseline] = useState<Baseline>('siblings')
  const [showStory, setShowStory] = useState(false)
  const testsRef = useRef(0)
  const nextId = useRef(1)
  const stepsRef = useRef<Step[]>([])
  const pilotRef = useRef(false)
  const storyEnd = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    stepsRef.current = steps
  }, [steps])

  const reset = useCallback(() => {
    setSteps([])
    stepsRef.current = []
    setCurrentId(null)
    setTests(0)
    testsRef.current = 0
    setPending(null)
  }, [])

  useEffect(() => {
    let stale = false
    reset()
    setStructure(null)
    api
      .structure(meta.id)
      .then((s) => {
        if (stale) return
        setStructure(s)
        setEditing(!s.confirmed)
      })
      .catch((e) => setError((e as Error).message))
    return () => {
      stale = true
    }
  }, [meta.id, reset])

  const chainOf = (id: number | null, all = stepsRef.current): Step[] => {
    const out: Step[] = []
    let cur = all.find((s) => s.id === id)
    while (cur) {
      out.unshift(cur)
      cur = all.find((s) => s.id === cur!.parent)
    }
    return out
  }

  const go = useCallback(
    async (filters: Filter[], measure: string, parent: number | null, via: string, base: Baseline): Promise<Step | null> => {
      setLoading(true)
      setError(null)
      setPending(null)
      try {
        const seen = chainOf(parent).map((s) => s.leadId)
        const res = await api.investigate(meta.id, {
          measure,
          baseline: base,
          filters: filters.map(({ field, op, value }) => ({ field, op, value })),
          testsSoFar: testsRef.current,
          seen,
        })
        testsRef.current += res.tests
        setTests(testsRef.current)
        const step: Step = { id: nextId.current++, parent, filters, measure, baseline: res.context.baseline, res, leadId: res.leads[0]?.id ?? '', via }
        stepsRef.current = [...stepsRef.current, step]
        setSteps(stepsRef.current)
        setCurrentId(step.id)
        return step
      } catch (e) {
        setError((e as Error).message)
        return null
      } finally {
        setLoading(false)
      }
    },
    // chainOf reads refs only
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [meta.id],
  )

  const start = useCallback((s: Structure, base: Baseline) => go([], s.primaryMeasure, null, 'start', base), [go])

  useEffect(() => {
    if (structure && !editing && stepsRef.current.length === 0) start(structure, 'siblings')
  }, [structure, editing, start])

  const current = steps.find((s) => s.id === currentId) ?? null

  // Bring the newest chart into view; earlier ones stay above it, siblings beside it.
  useEffect(() => {
    const card = mainRef.current?.querySelector('.story-card.current')
    if (card && !loading) card.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'nearest' })
    else if (currentId != null || loading) storyEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [currentId, loading])

  /** Delete a step and everything followed from it. The comparisons it ran stay counted. */
  const remove = (step: Step) => {
    const doomed = new Set([step.id])
    for (const s of stepsRef.current) if (s.parent != null && doomed.has(s.parent)) doomed.add(s.id)
    stepsRef.current = stepsRef.current.filter((s) => !doomed.has(s.id))
    setSteps(stepsRef.current)
    if (currentId != null && doomed.has(currentId)) {
      const sibling = stepsRef.current.filter((s) => s.parent === step.parent).at(-1)
      setCurrentId(sibling?.id ?? step.parent)
    }
    if (pending && doomed.has(pending.stepId)) setPending(null)
  }

  const follow = (g: Gesture, from: Step | null = current) => {
    if (!from) return Promise.resolve(null)
    const filters = [...from.filters.filter((f) => f.field !== g.filter.field), g.filter]
    return go(filters, from.measure, from.id, g.via, from.baseline)
  }

  const chooseLead = (step: Step, leadId: string) => {
    if (leadId === step.leadId) return
    const hasChildren = stepsRef.current.some((s) => s.parent === step.id)
    if (hasChildren) {
      // Keep history intact: viewing another lead from an explored step forks the trail.
      const title = step.res.leads.find((l) => l.id === leadId)?.title ?? leadId
      const fork: Step = { ...step, id: nextId.current++, leadId, via: `alternative: ${title}` }
      stepsRef.current = [...stepsRef.current, fork]
      setSteps(stepsRef.current)
      setCurrentId(fork.id)
    } else {
      stepsRef.current = stepsRef.current.map((s) => (s.id === step.id ? { ...s, leadId } : s))
      setSteps(stepsRef.current)
    }
    setPending(null)
  }

  const runPilot = async () => {
    if (pilotRef.current) {
      pilotRef.current = false
      setPilot(false)
      return
    }
    pilotRef.current = true
    setPilot(true)
    let step = current
    for (let hop = 0; hop < 4 && step && pilotRef.current; hop++) {
      const best = step.res.leads.find((l) => l.strength !== 'weak' && autoGesture(l))
      if (!best) break
      if (best.id !== step.leadId) {
        chooseLead(step, best.id)
        step = stepsRef.current.find((s) => s.id === step!.id) ?? step
        await sleep(1200)
      }
      if (!pilotRef.current) break
      const g = autoGesture(best)!
      step = await follow(g, step)
      if (!step || step.res.context.n < 30) break
      await sleep(1400)
    }
    pilotRef.current = false
    setPilot(false)
  }

  if (error && !structure) return <div className="error">⚠ {error}</div>
  if (!structure) return <div className="empty">Reading the dataset’s structure…</div>

  if (editing) {
    return (
      <StructureSetup
        key={JSON.stringify(structure)}
        meta={meta}
        initial={structure}
        onConfirm={async (s) => {
          const saved = await api.saveStructure(meta.id, s)
          reset()
          setStructure(saved)
          setEditing(false)
        }}
        onReset={async () => setStructure(await api.resetStructure(meta.id))}
        onCancel={structure.confirmed ? () => setEditing(false) : undefined}
      />
    )
  }

  const chain = current ? chainOf(current.id, steps) : []
  // Each level of the story shows every child of the same parent side by side; the path continues from the one on the chain.
  const rows = chain.map((step) => steps.filter((s) => s.parent === step.parent))
  const measures = structure.fields.filter((f) => f.role === 'measure')
  const shownBaseline = current?.baseline ?? baseline
  const story = buildNarrative(steps, meta.name, tests)

  return (
    <div className="inv">
      <div className="inv-bar">
        <nav className="crumbs-path" aria-label="Investigation path">
          <button className="crumb" onClick={() => chain[0] && setCurrentId(chain[0].id)}>
            All data
          </button>
          {current?.filters.map((f, i) => {
            const target = [...chain].reverse().find((s) => s.filters.length === i + 1)
            return (
              <span key={i}>
                <span className="sep">›</span>
                <button className="crumb" onClick={() => target && setCurrentId(target.id)}>
                  {f.label}
                </button>
              </span>
            )
          })}
        </nav>
        <div className="inv-actions">
          <label className="field inline">
            <span>Measure</span>
            <select
              value={current?.measure ?? structure.primaryMeasure}
              onChange={(e) =>
                current && go(current.filters, e.target.value, current.id, `measure → ${e.target.value === COUNT ? 'records' : e.target.value}`, current.baseline)
              }
            >
              <option value={COUNT}>Records</option>
              {measures.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.agg === 'mean' ? 'Avg' : 'Total'} {m.name}
                </option>
              ))}
              {structure.calcs.length > 0 && (
                <optgroup label="Calculated">
                  {structure.calcs.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <label className="field inline">
            <span>Compare with</span>
            <select
              value={shownBaseline}
              onChange={(e) => {
                const b = e.target.value as Baseline
                setBaseline(b)
                if (current) go(current.filters, current.measure, current.id, `compare → ${BASELINES.find((x) => x.value === b)?.label}`, b)
              }}
            >
              {BASELINES.map((b) => (
                <option key={b.value} value={b.value} disabled={b.value !== 'siblings' && !structure.timeField} title={b.title}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <button className={`btn ${showStory ? 'primary' : ''}`} onClick={() => setShowStory((v) => !v)} title="The findings from every chart you kept, as a tree">
            {showStory ? '◧ Charts' : '¶ Story'}
          </button>
          <button className={`btn ${pilot ? 'primary' : ''}`} onClick={runPilot} disabled={!current || (loading && !pilot)} title="Follow the strongest actionable lead, up to 4 steps">
            {pilot ? '■ Stop autopilot' : '✦ Autopilot'}
          </button>
          <button className="btn ghost" onClick={() => setEditing(true)}>
            Edit structure
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              reset()
              start(structure, baseline)
            }}
          >
            Restart
          </button>
        </div>
      </div>

      <div className="inv-grid">
        <aside className="inv-trail">
          <div className="inv-h">Trail</div>
          <Trail steps={steps} currentId={currentId} onPick={setCurrentId} />
          <div className="honesty" title="Every comparison the engine runs is counted. p-values are multiplied by this number (Bonferroni), so the more leads you chase, the stronger evidence must be to be called “strong”.">
            <b>{tests.toLocaleString()}</b> comparisons tested so far. Significance is adjusted for all of them.{' '}
            <button className="link" onClick={() => onExplain('honesty')}>
              Why?
            </button>
          </div>
        </aside>

        {showStory ? (
          <section className="inv-main">
            <StoryView
              story={story}
              currentId={currentId}
              onOpen={(id) => {
                setCurrentId(id)
                setShowStory(false)
              }}
              onRemove={pilot ? undefined : (id) => {
                const s = steps.find((x) => x.id === id)
                if (s) remove(s)
              }}
            />
          </section>
        ) : (
          <section className="inv-main" ref={mainRef}>
            {rows.map((row, i) => (
              <div key={i} className={row.length > 1 ? 'story-row' : undefined}>
                {row.map((step) => {
                  const onChain = step.id === chain[i].id
                  const next = onChain ? chain[i + 1] : undefined
                  const side = row.length > 1
                  return (
                    <div key={`${step.id}:${step.leadId}`} className="story-col">
                      {i > 0 && <Connector from={chain[i - 1]} to={step} brief={side} />}
                      <StoryCard
                        step={step}
                        index={i + 1}
                        side={side}
                        isCurrent={step.id === currentId}
                        picked={next ? addedFilter(step, next) : null}
                        pending={pending?.stepId === step.id ? pending.g : null}
                        onGesture={(g, immediate) => (immediate ? follow(g, step) : setPending({ stepId: step.id, g }))}
                        onFollowPending={() => pending && follow(pending.g, step)}
                        onClearPending={() => setPending(null)}
                        onFocus={() => setCurrentId(step.id)}
                        onRemove={pilot || (step.parent == null && row.length === 1) ? undefined : () => remove(step)}
                        focusLabel={onChain ? 'rewind here' : 'continue from here'}
                        onExplain={onExplain}
                      />
                    </div>
                  )
                })}
              </div>
            ))}
            {loading && (
              <div className="story-thinking">
                <span className="spinner" /> Choosing the next view…
              </div>
            )}
            {error && <div className="error">⚠ {error}</div>}
            <div ref={storyEnd} />
          </section>
        )}

        <aside className="inv-leads">
          <div className="inv-h">Leads from here</div>
          {current?.res.leads.map((l) => (
            <button key={l.id} className={`lead ${l.id === current.leadId ? 'active' : ''}`} onClick={() => chooseLead(current, l.id)}>
              <div className="lead-top">
                <span className="kind">{iconOf(l)}</span>
                <span className="lead-title">{l.title}</span>
                <StrengthBadge lead={l} small />
              </div>
              <div className="lead-reason">{l.reason}</div>
              {l.tags.length > 0 && (
                <div className="lead-tags">
                  {l.tags.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </aside>
      </div>
    </div>
  )
}

/** The narrative tree: one note per kept chart, children under the chart they were reached from. */
function StoryView({ story, currentId, onOpen, onRemove }: { story: Narrative; currentId: number | null; onOpen: (id: number) => void; onRemove?: (id: number) => void }) {
  const [copied, setCopied] = useState(false)
  const count = (ns: NarrativeNote[]): number => ns.reduce((a, x) => a + 1 + count(x.children), 0)
  const copy = async () => {
    await navigator.clipboard.writeText(narrativeMarkdown(story))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(story, null, 2)], { type: 'application/json' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `${story.dataset.replace(/\W+/g, '-').toLowerCase()}-story.json` })
    a.click()
    URL.revokeObjectURL(url)
  }
  const render = (x: NarrativeNote, root: boolean): ReactNode => (
    <li key={x.stepId}>
      <div className={`note ${x.stepId === currentId ? 'current' : ''}`}>
        {x.reachedBy && <div className="note-how">↳ {x.reachedBy}</div>}
        <div className="note-head">
          <button className="note-title" onClick={() => onOpen(x.stepId)} title="Show this chart">
            {x.headline}
          </button>
          <span className={`strength ${x.strength} small`}>{x.strength}</span>
          {onRemove && !(root && story.roots.length === 1) && (
            <button className="card-x" onClick={() => onRemove(x.stepId)} aria-label="Remove this chart" title="Remove this chart, its note and everything followed from it">
              ×
            </button>
          )}
        </div>
        <p className="note-finding">{x.finding}</p>
        <div className="note-scope">
          {x.path.length ? x.path.join(' › ') : 'All data'} · {x.records.toLocaleString()} records · {x.measure} vs {x.comparedWith}
          {x.window && ` · ${x.window} vs ${x.compareWindow}`}
        </div>
      </div>
      {x.children.length > 0 && <ul>{x.children.map((c) => render(c, false))}</ul>}
    </li>
  )
  return (
    <div className="story-view">
      <div className="story-view-head">
        <div>
          <h2>The story so far</h2>
          <p className="muted">
            {count(story.roots)} charts · {story.comparisons.toLocaleString()} comparisons tested. Removing a chart removes its note and the notes under it.
          </p>
        </div>
        <div className="story-view-actions">
          <button className="btn" onClick={copy} title="An indented outline, ready to paste into an LLM to summarize">
            {copied ? '✓ Copied' : 'Copy as Markdown'}
          </button>
          <button className="btn ghost" onClick={download}>
            Download JSON
          </button>
        </div>
      </div>
      <ul className="story-tree">{story.roots.map((r) => render(r, true))}</ul>
    </div>
  )
}

/** The filter a step added on top of its parent: the gesture that was followed. */
function addedFilter(step: Step, next: Step): Filter | null {
  const key = (f: Filter) => JSON.stringify([f.field, f.op, f.value])
  const had = new Set(step.filters.map(key))
  return next.filters.find((f) => !had.has(key(f))) ?? null
}

/** `brief` drops the verb so connectors above side-by-side cards stay on one line and the cards line up. */
function Connector({ from, to, brief }: { from: Step; to: Step; brief?: boolean }) {
  const f = addedFilter(from, to)
  const what = f ? f.label : to.via.replace(/^measure → /, 'measure to ').replace(/^compare → /, 'comparison to ')
  return (
    <div className={`story-link ${brief ? 'brief' : ''}`} title={brief ? what : undefined}>
      <span className="story-arrow">↓</span>
      <span className="story-link-what">
        {!brief && (to.via.startsWith('autopilot') ? 'Autopilot followed ' : /^(measure|compare) →/.test(to.via) ? 'Switched ' : 'You followed ')}
        <b>{what}</b>
      </span>
      <span className="muted">
        {from.res.context.n.toLocaleString()} → {to.res.context.n.toLocaleString()} records
      </span>
    </div>
  )
}

interface StoryCardProps {
  step: Step
  index: number
  /** One of several children shown side by side: smaller type, fitted chart, details folded away. */
  side: boolean
  isCurrent: boolean
  picked: Filter | null
  pending: Gesture | null
  onGesture: (g: Gesture, immediate: boolean) => void
  onFollowPending: () => void
  onClearPending: () => void
  onFocus: () => void
  /** Absent for the only starting step (use Restart) and while autopilot runs. */
  onRemove?: () => void
  focusLabel: string
  onExplain: (section?: string) => void
}

function StoryCard({ step, index, side, isCurrent, picked, pending, onGesture, onFollowPending, onClearPending, onFocus, onRemove, focusLabel, onExplain }: StoryCardProps) {
  const ctx = step.res.context
  const lead = step.res.leads.find((l) => l.id === step.leadId) ?? step.res.leads[0] ?? null
  return (
    <div className={`inv-card story-card ${isCurrent ? 'current' : 'past'} ${side ? 'side' : ''}`}>
      {onRemove && (
        <button className="card-x" onClick={onRemove} aria-label="Remove this chart" title="Remove this chart and everything followed from it">
          ×
        </button>
      )}
      <div className="inv-card-head">
        <div>
          <div className="story-meta">
            <span className="story-step">Step {index}</span>
            <span>
              <b>{ctx.n.toLocaleString()}</b> records · {ctx.measureLabel}: <b>{fmt(ctx.total)}</b>
            </span>
            {ctx.window && (
              <span className="window-chip" title={ctx.bgLabel}>
                {ctx.window} <span className="muted">vs</span> {ctx.compareWindow}
              </span>
            )}
            {ctx.bgN > 0 && <span className="muted">vs {ctx.bgN.toLocaleString()} {ctx.bgLabel}</span>}
            {!isCurrent && (
              <button className="link" onClick={onFocus} title="Make this the current step and see its leads">
                {focusLabel}
              </button>
            )}
          </div>
          {lead && (
            <>
              <h2>
                <span className="kind">{iconOf(lead)}</span> {lead.title}
              </h2>
              <p className="reason">{lead.reason}</p>
              <WhyChosen step={step} lead={lead} onExplain={onExplain} />
            </>
          )}
        </div>
        {lead && <StrengthBadge lead={lead} />}
      </div>
      {ctx.caution && isCurrent && <div className="banner warn">{ctx.caution}</div>}
      {lead ? (
        <>
          <LeadChart lead={lead} measureLabel={ctx.measureLabel} picked={picked} compact={!isCurrent || side} fit={side} onGesture={onGesture} />
          <ChartKey lead={lead} measureLabel={ctx.measureLabel} bgLabel={ctx.bgLabel} picked={picked} open={isCurrent && !side} />
        </>
      ) : (
        <div className="empty">Nothing stands out here. Try another measure or step back.</div>
      )}
      {(isCurrent || pending) && lead && (
        <div className="inv-foot">
          {pending ? (
            <>
              <button className="btn primary" onClick={onFollowPending}>
                Investigate {pending.filter.label} →
              </button>
              <button className="btn ghost" onClick={onClearPending}>
                Clear
              </button>
            </>
          ) : (
            <span className="muted">{viewOf(lead).hint(lead.view)}</span>
          )}
        </div>
      )}
      {!isCurrent && !pending && !side && <div className="story-fork-hint">Click a different bar or period here to open it beside the current view.</div>}
    </div>
  )
}

/** The ranking arithmetic for the lead a step shows: rank = score × evidence factor + adjustments. */
function WhyChosen({ step, lead, onExplain }: { step: Step; lead: Lead; onExplain: (section?: string) => void }) {
  const w = lead.why
  if (!w) return null
  const leads = step.res.leads
  const pos = leads.findIndex((l) => l.id === lead.id)
  const runnerUp = pos === 0 ? leads[1] : leads[0]
  const n = (x: number) => x.toFixed(2)
  const sign = (x: number) => (x >= 0 ? `+ ${n(x)}` : `− ${n(-x)}`)
  const evidence =
    lead.strength === 'descriptive'
      ? 'descriptive: no test applies'
      : `${lead.strength}: adjusted p ≈ ${fmtP(lead.pAdj)} (raw p ${fmtP(w.pRaw)} × ${w.tests.toLocaleString()} comparisons so far, capped at 1)`
  return (
    <details className="why">
      <summary>{pos === 0 ? 'Why this chart?' : `Why is this lead #${pos + 1}?`}</summary>
      <div className="why-body">
        <table>
          <tbody>
            <tr>
              <td>Effect size</td>
              <td className="num">{n(w.score)}</td>
              <td className="muted">how big the difference is, 0 to 1 ({lead.kind} score)</td>
            </tr>
            {w.scoreNotes.map((s) => (
              <tr key={s.label}>
                <td />
                <td className="num muted">(× {s.factor})</td>
                <td className="muted">already applied: {s.label}</td>
              </tr>
            ))}
            <tr>
              <td>× Evidence</td>
              <td className="num">{w.factor}</td>
              <td className="muted">{evidence}</td>
            </tr>
            {w.adjust.map((a) => (
              <tr key={a.label}>
                <td>{a.value >= 0 ? '+ Bonus' : '− Penalty'}</td>
                <td className="num">{sign(a.value)}</td>
                <td className="muted">{a.label}</td>
              </tr>
            ))}
            <tr className="total">
              <td>= Rank</td>
              <td className="num">{n(w.rank)}</td>
              <td className="muted">
                {pos === 0 ? '1st' : `#${pos + 1}`} of {step.res.candidates} candidate leads
                {runnerUp ? `; ${pos === 0 ? 'runner-up' : 'top'}: ${runnerUp.title} at ${n(runnerUp.why.rank)}` : ''}
              </td>
            </tr>
          </tbody>
        </table>
        <button className="link" onClick={() => onExplain('ranking')}>
          How ranking works →
        </button>
      </div>
    </details>
  )
}

function fmtP(p: number | null): string {
  if (p == null) return '—'
  return p < 0.0001 ? '<0.0001' : p.toPrecision(2)
}

/** "How to read this": what the chart shows and what each mark means. Open on the current step. */
function ChartKey({ lead, measureLabel, bgLabel, picked, open }: { lead: Lead; measureLabel: string; bgLabel: string; picked: Filter | null; open: boolean }) {
  const g = guideOf(lead, { measureLabel, bgLabel, picked })
  if (!g.read && !g.items.length) return null
  return (
    <details className="chart-key" open={open || undefined}>
      <summary>How to read this chart</summary>
      {g.read && <p>{g.read}</p>}
      {g.items.length > 0 && (
        <ul>
          {g.items.map((it) => (
            <li key={it.label}>
              <Swatch item={it} />
              {it.label}
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

/** A small drawing of a mark, styled the way the chart draws it. */
function Swatch({ item: { mark, color } }: { item: KeyItem }) {
  const line = (dash?: string) => <line x1="1" y1="6" x2="21" y2="6" stroke={color} strokeWidth={mark === 'line' ? 2.5 : 1.6} strokeDasharray={dash} />
  return (
    <svg className="swatch" width="22" height="12" viewBox="0 0 22 12" aria-hidden="true">
      {mark === 'bar' && <rect x="1" y="2" width="20" height="8" rx="2" fill={color} />}
      {mark === 'line' && line()}
      {mark === 'dash' && line('4 3')}
      {mark === 'dot' && line('1 3')}
      {mark === 'step' && <polyline points="1,9 8,9 8,3 15,3 15,7 21,7" fill="none" stroke={color} strokeWidth="1.6" strokeDasharray="6 3" />}
      {mark === 'point' && <circle cx="11" cy="6" r="4" fill={color} />}
      {mark === 'tick' && <line x1="11" y1="0" x2="11" y2="12" stroke={color} strokeWidth="2" />}
      {mark === 'band' && <rect x="1" y="0" width="20" height="12" fill={color} opacity="0.2" />}
      {mark === 'rule' && <line x1="11" y1="0" x2="11" y2="12" stroke={color} strokeWidth="2" strokeDasharray="2 2" />}
      {mark === 'outline' && <rect x="2" y="2" width="18" height="8" rx="2" fill="none" stroke={color} strokeWidth="2" />}
    </svg>
  )
}

function StrengthBadge({ lead, small }: { lead: Lead; small?: boolean }) {
  const title =
    lead.pAdj == null
      ? 'Descriptive: a summary, not a statistical comparison'
      : `Adjusted p ≈ ${lead.pAdj < 0.0001 ? '<0.0001' : lead.pAdj.toPrecision(2)} (Bonferroni over all comparisons so far)`
  return (
    <span className={`strength ${lead.strength} ${small ? 'small' : ''}`} title={title}>
      {lead.strength}
    </span>
  )
}

function Trail({ steps, currentId, onPick }: { steps: Step[]; currentId: number | null; onPick: (id: number) => void }) {
  const kids = (id: number | null) => steps.filter((s) => s.parent === id)
  const render = (s: Step, depth: number): ReactNode => {
    const lead = s.res.leads.find((l) => l.id === s.leadId)
    return (
      <li key={s.id}>
        <button className={`trail-node ${s.id === currentId ? 'active' : ''}`} style={{ paddingLeft: 8 + depth * 12 }} onClick={() => onPick(s.id)}>
          <span className="trail-via">{s.via === 'start' ? 'All data' : s.via}</span>
          <span className="trail-lead">
            {lead ? iconOf(lead) : ''} {lead?.title ?? '—'}
          </span>
        </button>
        {kids(s.id).length > 0 && <ul>{kids(s.id).map((k) => render(k, depth + 1))}</ul>}
      </li>
    )
  }
  return <ul className="trail">{kids(null).map((s) => render(s, 0))}</ul>
}

interface LeadChartProps {
  lead: Lead
  measureLabel: string
  picked?: Filter | null
  compact?: boolean
  /** Size the whole chart, axis labels included, to the card instead of reserving a fixed gutter for them. */
  fit?: boolean
  onGesture: (g: Gesture, immediate: boolean) => void
}

function LeadChart({ lead, measureLabel, picked, compact, fit, onGesture }: LeadChartProps) {
  const outer = useRef<HTMLDivElement>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const gesture = useRef(onGesture)
  const pickedRef = useRef(picked)
  const pickedKey = picked ? JSON.stringify([picked.field, picked.value]) : ''
  useEffect(() => {
    gesture.current = onGesture
    pickedRef.current = picked
  })

  useEffect(() => {
    // Measure the wrapper: vega-embed makes its own element inline-block (shrink-to-fit).
    const el = outer.current
    if (!el) return
    // fit: leave room only for the actions (…) button; otherwise reserve space for axis labels and titles.
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(fit ? 220 : 280, Math.floor(e.contentRect.width) - (fit ? 44 : 190))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let result: Result | undefined
    let cancelled = false
    const v = lead.view
    const def = viewOf(lead)
    let spec: Record<string, unknown>
    try {
      spec = buildSpec(lead, measureLabel, width, { picked: pickedRef.current, compact })
      if (fit) spec = { ...spec, autosize: { type: 'fit-x', contains: 'padding' } }
    } catch (e) {
      el.textContent = `Could not draw this view: ${(e as Error).message}`
      return
    }
    embed(el, spec as never, { actions: { export: true, source: true, compiled: false, editor: true }, renderer: 'svg' })
      .then((r) => {
        if (cancelled) return r.finalize()
        result = r
        if (def.click) {
          r.view.addEventListener('click', (_e, item) => {
            const d = (item as { datum?: Record<string, unknown> } | null)?.datum
            const g = d && def.click!(v, d)
            if (g) gesture.current(g, true)
          })
        }
        if (def.brush) {
          try {
            r.view.addSignalListener('brush', (_n, sel: Record<string, [number | Date, number | Date]>) => {
              const ext = sel && Object.values(sel)[0]
              if (!ext) return
              const [a, b] = ext.map((x) => (x instanceof Date ? x.getTime() : Number(x)))
              const g = def.brush!(v, [a, b])
              if (g) gesture.current(g, false)
            })
          } catch {
            /* this view has no brush signal */
          }
        }
      })
      .catch((e) => console.error(e))
    return () => {
      cancelled = true
      result?.finalize()
    }
    // pickedKey stands in for picked, which is a fresh object on every render
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [lead, measureLabel, width, pickedKey, compact, fit])

  return (
    <div ref={outer} className="inv-chart">
      <div ref={ref} />
    </div>
  )
}
