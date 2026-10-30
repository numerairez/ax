import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import embed, { type Result } from 'vega-embed'
import { api } from '../api.ts'
import type { DatasetMeta } from '../types.ts'
import { StructureSetup } from './StructureSetup.tsx'
import { COUNT, type Filter, type Gesture, type Lead, type Step, type Structure } from './types.ts'
import { autoGesture, buildSpec, fmt, localIso, periodLabel } from './views.ts'

type Pending = { stepId: number; g: Gesture }

const KIND_ICON: Record<Lead['kind'], string> = { breakdown: '▤', trend: '〜', driver: '⇄', change: '±' }
const HINT: Record<Lead['kind'], string> = {
  breakdown: 'Click a bar to follow that lead.',
  trend: 'Click a point to dig into that period, or drag across a stretch of time to ask what changed.',
  driver: 'Drag across a range to investigate just those records.',
  change: 'Click a bar to follow the biggest movers.',
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function Investigate({ meta }: { meta: DatasetMeta }) {
  const [structure, setStructure] = useState<Structure | null>(null)
  const [editing, setEditing] = useState(false)
  const [steps, setSteps] = useState<Step[]>([])
  const [currentId, setCurrentId] = useState<number | null>(null)
  const [tests, setTests] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [pilot, setPilot] = useState(false)
  const testsRef = useRef(0)
  const nextId = useRef(1)
  const stepsRef = useRef<Step[]>([])
  const pilotRef = useRef(false)
  const storyEnd = useRef<HTMLDivElement>(null)

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
    async (filters: Filter[], measure: string, parent: number | null, via: string): Promise<Step | null> => {
      setLoading(true)
      setError(null)
      setPending(null)
      try {
        const seen = chainOf(parent).map((s) => s.leadId)
        const res = await api.investigate(meta.id, {
          measure,
          filters: filters.map(({ field, op, value }) => ({ field, op, value })),
          testsSoFar: testsRef.current,
          seen,
        })
        testsRef.current += res.tests
        setTests(testsRef.current)
        const step: Step = { id: nextId.current++, parent, filters, measure, res, leadId: res.leads[0]?.id ?? '', via }
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

  const start = useCallback((s: Structure) => go([], s.primaryMeasure, null, 'start'), [go])

  useEffect(() => {
    if (structure && !editing && stepsRef.current.length === 0) start(structure)
  }, [structure, editing, start])

  const current = steps.find((s) => s.id === currentId) ?? null

  // Bring the newest chart into view; earlier ones stay above it.
  useEffect(() => {
    if (currentId != null || loading) storyEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [currentId, loading])

  const follow = (g: Gesture, from: Step | null = current) => {
    if (!from) return Promise.resolve(null)
    const filters = [...from.filters.filter((f) => f.field !== g.filter.field), g.filter]
    return go(filters, from.measure, from.id, g.via)
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
  const measures = structure.fields.filter((f) => f.role === 'measure')

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
              onChange={(e) => current && go(current.filters, e.target.value, current.id, `measure → ${e.target.value === COUNT ? 'records' : e.target.value}`)}
            >
              <option value={COUNT}>Records</option>
              {measures.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.agg === 'mean' ? 'Avg' : 'Total'} {m.name}
                </option>
              ))}
            </select>
          </label>
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
              start(structure)
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
            <b>{tests.toLocaleString()}</b> comparisons tested so far. Significance is adjusted for all of them.
          </div>
        </aside>

        <section className="inv-main">
          {chain.map((step, i) => {
            const next = chain[i + 1]
            return (
              <div key={`${step.id}:${step.leadId}`}>
                {i > 0 && <Connector from={chain[i - 1]} to={step} />}
                <StoryCard
                  step={step}
                  index={i + 1}
                  isCurrent={!next}
                  picked={next ? addedFilter(step, next) : null}
                  pending={pending?.stepId === step.id ? pending.g : null}
                  onGesture={(g, immediate) => (immediate ? follow(g, step) : setPending({ stepId: step.id, g }))}
                  onFollowPending={() => pending && follow(pending.g, step)}
                  onClearPending={() => setPending(null)}
                  onFocus={() => setCurrentId(step.id)}
                />
              </div>
            )
          })}
          {loading && (
            <div className="story-thinking">
              <span className="spinner" /> Choosing the next view…
            </div>
          )}
          {error && <div className="error">⚠ {error}</div>}
          <div ref={storyEnd} />
        </section>

        <aside className="inv-leads">
          <div className="inv-h">Leads from here</div>
          {current?.res.leads.map((l) => (
            <button key={l.id} className={`lead ${l.id === current.leadId ? 'active' : ''}`} onClick={() => chooseLead(current, l.id)}>
              <div className="lead-top">
                <span className="kind">{KIND_ICON[l.kind]}</span>
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

/** The filter a step added on top of its parent: the gesture that was followed. */
function addedFilter(step: Step, next: Step): Filter | null {
  const key = (f: Filter) => JSON.stringify([f.field, f.op, f.value])
  const had = new Set(step.filters.map(key))
  return next.filters.find((f) => !had.has(key(f))) ?? null
}

function Connector({ from, to }: { from: Step; to: Step }) {
  const f = addedFilter(from, to)
  return (
    <div className="story-link">
      <span className="story-arrow">↓</span>
      <span>
        {to.via.startsWith('autopilot') ? 'Autopilot followed' : to.via.startsWith('measure') ? 'Switched' : 'You followed'}{' '}
        <b>{f ? f.label : to.via.replace(/^measure → /, 'measure to ')}</b>
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
  isCurrent: boolean
  picked: Filter | null
  pending: Gesture | null
  onGesture: (g: Gesture, immediate: boolean) => void
  onFollowPending: () => void
  onClearPending: () => void
  onFocus: () => void
}

function StoryCard({ step, index, isCurrent, picked, pending, onGesture, onFollowPending, onClearPending, onFocus }: StoryCardProps) {
  const ctx = step.res.context
  const lead = step.res.leads.find((l) => l.id === step.leadId) ?? step.res.leads[0] ?? null
  return (
    <div className={`inv-card story-card ${isCurrent ? 'current' : 'past'}`}>
      <div className="inv-card-head">
        <div>
          <div className="story-meta">
            <span className="story-step">Step {index}</span>
            <span>
              <b>{ctx.n.toLocaleString()}</b> records · {ctx.measureLabel}: <b>{fmt(ctx.total)}</b>
            </span>
            {ctx.bgN > 0 && <span className="muted">vs {ctx.bgN.toLocaleString()} {ctx.bgLabel}</span>}
            {!isCurrent && (
              <button className="link" onClick={onFocus} title="Rewind to this step and see its other leads">
                rewind here
              </button>
            )}
          </div>
          {lead && (
            <>
              <h2>
                <span className="kind">{KIND_ICON[lead.kind]}</span> {lead.title}
              </h2>
              <p className="reason">{lead.reason}</p>
            </>
          )}
        </div>
        {lead && <StrengthBadge lead={lead} />}
      </div>
      {ctx.caution && isCurrent && <div className="banner warn">{ctx.caution}</div>}
      {lead ? (
        <LeadChart lead={lead} measureLabel={ctx.measureLabel} picked={picked} compact={!isCurrent} onGesture={onGesture} />
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
            <span className="muted">{HINT[lead.kind]}</span>
          )}
        </div>
      )}
      {!isCurrent && !pending && <div className="story-fork-hint">Click a different bar or period here to branch off from this step.</div>}
    </div>
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
            {lead ? KIND_ICON[lead.kind] : ''} {lead?.title ?? '—'}
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
  onGesture: (g: Gesture, immediate: boolean) => void
}

function LeadChart({ lead, measureLabel, picked, compact, onGesture }: LeadChartProps) {
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
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width) - 190)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let result: Result | undefined
    let cancelled = false
    const v = lead.view
    embed(el, buildSpec(lead, measureLabel, width, { picked: pickedRef.current, compact }) as never, { actions: { export: true, source: true, compiled: false, editor: true }, renderer: 'svg' })
      .then((r) => {
        if (cancelled) return r.finalize()
        result = r
        r.view.addEventListener('click', (_e, item) => {
          const d = (item as { datum?: Record<string, unknown> } | null)?.datum
          if (!d) return
          if ((v.type === 'breakdown' || v.type === 'change') && d.value != null) {
            const value = String(d.value)
            gesture.current({ filter: { field: v.field, op: 'eq', value, label: `${v.field} = ${value}` }, via: `clicked ${value}` }, true)
          } else if (v.type === 'trend' && d.t != null) {
            const iso = typeof d.t === 'string' ? d.t : localIso(Number(d.t instanceof Date ? d.t.getTime() : d.t))
            const label = periodLabel(iso, v.grain)
            gesture.current({ filter: { field: v.field, op: 'range', value: [iso, iso], label }, via: `clicked ${label}` }, true)
          }
        })
        if (v.type === 'trend' || v.type === 'driver') {
          r.view.addSignalListener('brush', (_n, sel: Record<string, [number | Date, number | Date]>) => {
            const ext = sel && Object.values(sel)[0]
            if (!ext) return
            const [a, b] = ext.map((x) => (x instanceof Date ? x.getTime() : Number(x)))
            if (v.type === 'trend') {
              const lo = localIso(Math.min(a, b))
              const hi = localIso(Math.max(a, b))
              const label = `${periodLabel(lo, v.grain)} – ${periodLabel(hi, v.grain)}`
              gesture.current({ filter: { field: v.field, op: 'range', value: [lo, hi], label }, via: `brushed ${label}` }, false)
            } else {
              const lo = Math.min(a, b)
              const hi = Math.max(a, b)
              const label = `${v.field} ${fmt(lo)}–${fmt(hi)}`
              gesture.current({ filter: { field: v.field, op: 'range', value: [lo, hi], label }, via: `brushed ${label}` }, false)
            }
          })
        }
      })
      .catch((e) => console.error(e))
    return () => {
      cancelled = true
      result?.finalize()
    }
    // pickedKey stands in for picked, which is a fresh object on every render
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [lead, measureLabel, width, pickedKey, compact])

  return (
    <div ref={outer} className="inv-chart">
      <div ref={ref} />
    </div>
  )
}
