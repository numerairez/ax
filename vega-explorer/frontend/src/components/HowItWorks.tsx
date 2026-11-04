import { useEffect, useState, type ReactNode } from 'react'
import { api, type Method } from '../api.ts'

/*
 * "How it works" as an infographic. Every section leads with a picture drawn in the same
 * visual language as the Investigate charts (indigo = this selection, grey = comparison,
 * gold = what stands out, green/red = up/down), and keeps the exact method one click away
 * in a "details" block. Colors come from CSS classes (ig-*) so dark mode follows the app.
 */

/** How each built-in lead kind is found, scored and tested. Plugin kinds fall back to their docstring. */
const KIND_DOC: Record<string, { asks: string; mini: ReactNode; gist: string; score: ReactNode; test: ReactNode; counts: string }> = {
  trend: {
    asks: 'Is any stretch of time unusual, or is it drifting?',
    mini: <MiniTrend />,
    gist: 'Each period vs its neighbours. Unusual only if it survives the adjustment.',
    score: (
      <>
        Each period is compared with its <b>typical</b> value: the median of the two periods either side, leaving the period itself out, so a
        spike can't raise its own baseline. The gap is scaled by the typical gap (median absolute deviation × 1.4826) to give a robust <i>z</i>. A
        period is <b>unusual</b> only if its p-value survives the adjustment for every comparison in the session, and consecutive unusual periods
        that deviate the same way form one <b>stretch</b>, peaking where the gap is largest. Score = min(1, |z| / 7) × min(1, |ratio − 1| / 0.3)
        at the peak of the strongest stretch. With no unusual stretch, the lead reports drift instead (the last third of the series against the
        first), scored |drift| and labelled descriptive. At the start it reports both.
      </>
    ),
    test: <>Two-sided normal tail of <i>z</i>, per period. The chart marks only what the text claims. Needs at least 6 periods.</>,
    counts: 'one per period in the series',
  },
  breakdown: {
    asks: 'How does the selection split, and how is that different from the comparison?',
    mini: <MiniBreakdown />,
    gist: 'Bars vs ticks: what you have vs what the comparison group predicts.',
    score: (
      <>
        <b>No comparison group</b> (the start, or a dimension nested under the value you just clicked): for summed measures, how concentrated the
        top 1 (≤ 5 values) or top 3 values are vs an even split: min(1, (top share − k/N) × 1.5 + 0.2). For levels and rates, the spread between
        the highest and lowest value in record standard deviations, ÷ 2.5.
        <br />
        <b>Summed measures vs comparison</b>: total variation distance between the share distributions × 1.8.
        <br />
        <b>Levels and rates vs comparison</b>: each value vs the same value in the comparison group, in pooled SDs, for values with ≥ 5 records;
        score = record-weighted mean |difference| ÷ 0.8.
      </>
    ),
    test: <>Shares: chi-square on record counts per value (Wilson–Hilferty). Levels: Welch's test on the standout value.</>,
    counts: 'one per share comparison, or one per value compared for levels',
  },
  driver: {
    asks: 'Does another measure behave differently in the selection?',
    mini: <MiniDriver />,
    gist: "Two distributions, two averages: the gap in SDs is Cohen's d.",
    score: (
      <>
        Cohen's <i>d</i>: the difference in per-record averages over the pooled standard deviation. Score = min(1, |d| / 1.2). Ratios built from the
        current measure are skipped. Needs 5 effective records on each side.
      </>
    ),
    test: <>Welch's test on the two averages.</>,
    counts: 'one per measure compared',
  },
  change: {
    asks: 'Between two time windows, which values drove the change?',
    mini: <MiniChange />,
    gist: 'Longest bars drove the movement; concentrated movement scores higher.',
    score: (
      <>
        Runs after you brush a time range (vs the same number of periods just before), or at every step with a time baseline. Concentration = the
        largest single movement ÷ the sum of all movements. Score = 0.45 × concentration + 0.55 × min(1, 2 × |relative change in the total|).
      </>
    ),
    test: <>Chi-square on record counts per value, before vs after.</>,
    counts: 'one per dimension',
  },
  target: {
    asks: 'Which values sit on the wrong side of their target?',
    mini: <MiniTarget />,
    gist: 'The exceptions: over target while the whole is under it (or vice versa).',
    score: (
      <>
        Needs a target for the measure. Score = 0.5 × min(1, |gap ÷ target|) + 0.5 × the exceptions' share of the total absolute gap; with no
        exceptions, 0.25 × min(1, |gap ÷ target|). Dimensions defined by the target (a breach status) are skipped as circular.
      </>
    ),
    test: <>None: a target comparison is descriptive.</>,
    counts: 'none',
  },
  relationship: {
    asks: 'Across groups, does a level or rate move with this measure?',
    mini: <MiniRelationship />,
    gist: 'A clue about why, from the second step on, weighted below direct evidence.',
    score: (
      <>
        From the second step on. For dimensions with 8–60 values (each with ≥ 3 records): the Spearman rank correlation <i>ρ</i> between the
        measure's per-record level and each level/rate field. Score = 0.7 × min(1, |ρ| / 0.8). Totals and calculated ratios are left out.
      </>
    ),
    test: <>Fisher transform of ρ, normal tail.</>,
    counts: 'one per dimension × field tried',
  },
}

const SECTIONS = [
  ['loop', 'The loop'],
  ['structure', 'Structure'],
  ['comparison', 'Comparison group'],
  ['kinds', 'Lead kinds'],
  ['ranking', 'Ranking'],
  ['honesty', 'Honesty'],
  ['stats', 'Statistics'],
  ['autopilot', 'Autopilot'],
  ['architecture', 'Architecture'],
  ['extending', 'Extending'],
] as const

export function HowItWorks({ section, onBack }: { section?: string; onBack?: () => void }) {
  const [m, setM] = useState<Method | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.method().then(setM, (e) => setError((e as Error).message))
  }, [])

  useEffect(() => {
    if (section && m) document.getElementById(`hiw-${section}`)?.scrollIntoView({ block: 'start' })
  }, [section, m])

  const strengths = m?.strengths ?? [
    { name: 'strong', pBelow: 0.001, factor: 1 },
    { name: 'suggestive', pBelow: 0.05, factor: 0.8 },
    { name: 'weak', pBelow: 1, factor: 0.4 },
  ]

  return (
    <div className="hiw">
      <nav className="hiw-toc" aria-label="Sections">
        <div className="hiw-toc-title">How it works</div>
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#hiw-${id}`} onClick={(e) => (e.preventDefault(), document.getElementById(`hiw-${id}`)?.scrollIntoView({ behavior: 'smooth' }))}>
            {label}
          </a>
        ))}
      </nav>

      <article className="hiw-body">
        {onBack && (
          <button className="btn ghost small hiw-back" onClick={onBack}>
            ← Back to the investigation
          </button>
        )}
        <h1>How Narra investigates</h1>
        <p className="lede">
          Click a chart and Narra picks the next one. Every step is a comparison, scored by <b>how big</b> the difference is and <b>how sure</b> we
          can be, so the story you follow is one the data supports. Values marked <span className="live">like this</span> are read from the running
          engine.
        </p>
        <Legend />
        {error && <div className="banner warn">Couldn't load the engine's constants ({error}). The rest of the page still applies.</div>}

        <Section id="loop" title="The loop" kicker="One step, from click to next chart">
          <LoopDiagram />
          <More>
            Clicking a bar or a point adds a filter, and the loop runs again on the smaller selection. Every step stays on the page, so the
            investigation reads as a story you can rewind or branch from.
          </More>
        </Section>

        <Section id="structure" title="Structure" kicker="Detected once per dataset, confirmed by you">
          <div className="ig-row">
            <Figure caption="Each field gets a role">
              <RolesDiagram />
            </Figure>
            <Figure caption="Hierarchies decide where a click drills down">
              <HierarchyDiagram />
            </Figure>
          </div>
          <div className="ig-row">
            <Figure caption="Adds up, or a level? It changes every comparison">
              <SumVsLevel />
            </Figure>
            <Figure caption="Ratios are totals divided, never averaged">
              <RatioDiagram />
            </Figure>
          </div>
          <More>
            <ul>
              <li>
                <b>Roles</b> come from the field's type, name and cardinality: text with nearly one value per row is an identifier, text with over 200
                values is ignored, densely numbered integers are row ids.
              </li>
              <li>
                <b>Hierarchies</b> come from functional dependencies: <i>A</i> rolls up into <i>B</i> when every value of <i>A</i> maps to exactly one
                value of <i>B</i>, and <i>B</i> has fewer values. One-to-one relabels (country / ISO code) keep only the first.
              </li>
              <li>
                <b>Targets</b> (plan, budget, limit) are detected from names like <code>_target</code>, <code>budget</code>, <code>tolerance</code>.
              </li>
              <li>
                <b>Time grain</b> from the span: over 8 years → year, over 120 days → month, over 21 days → week, else day.
              </li>
            </ul>
          </More>
        </Section>

        <Section id="comparison" title="Comparison group" kicker="Every lead is a comparison. Compare with what?">
          <div className="ig-row three">
            <Figure caption="the rest: siblings under the same parent">
              <SiblingsDiagram />
            </Figure>
            <Figure caption="previous period: the window just before">
              <TimelineDiagram gap={1} />
            </Figure>
            <Figure caption="a year earlier: same window, 12 months back">
              <TimelineDiagram gap={12} />
            </Figure>
          </div>
          <Figure caption="Mix check: a bigger share isn't the same as behaving differently" wide>
            <MixDiagram />
          </Figure>
          <More>
            <p>
              <b>The rest</b> means records that differ only in the last filter, so earlier choices don't leak into the comparison. Fields already
              fixed by a filter (and their parents) are left out. A dimension nested under the value you just clicked gets a description instead of a
              comparison, because its values can't appear among the siblings.
            </p>
            <p>
              <b>Mix effects.</b> For summed measures, each share comparison is cross-checked per record against the same value in the comparison
              group. If the like-for-like gap is small (under 0.2 SD, or within 0.8–1.25×) or points the other way, the lead is tagged{' '}
              <i>mix effect</i> and its score × 0.35.
            </p>
          </More>
        </Section>

        <Section id="kinds" title="Lead kinds" kicker="Each kind proposes views and scores them 0–1">
          <div className="ig-kinds">
            {(m?.kinds ?? Object.keys(KIND_DOC).map((name) => ({ name, icon: '', description: '', quota: 3, order: 0 }))).map((k) => {
              const doc = KIND_DOC[k.name]
              return (
                <div key={k.name} className="ig-kind">
                  <div className="ig-kind-head">
                    <span className="kind">{k.icon}</span> <b>{k.name}</b>
                  </div>
                  <div className="ig-kind-q">{doc?.asks ?? k.description}</div>
                  {doc ? doc.mini : <div className="ig-plugin">plugin</div>}
                  {doc && <div className="ig-kind-gist">{doc.gist}</div>}
                  {doc && (
                    <details className="ig-kind-more">
                      <summary>Formula & test</summary>
                      <dl>
                        <dt>Score</dt>
                        <dd>{doc.score}</dd>
                        <dt>Test</dt>
                        <dd>{doc.test}</dd>
                        <dt>Counted</dt>
                        <dd>{doc.counts}</dd>
                      </dl>
                    </details>
                  )}
                </div>
              )
            })}
          </div>
          <More>
            Dimensions with more than {m ? <Live>{m.maxValues}</Live> : '60'} values are skipped as too fine to chart. Additive measures also get a{' '}
            <b>like-for-like</b> lead per dimension: each value's per-record average vs the same value in the comparison group (≥ 3 records each
            side). Score = min(1, |d| / 0.8) × (0.5 + 0.5 × min(1, 2 × the value's share)). Test: Welch, one comparison per value.
          </More>
        </Section>

        <Section id="ranking" title="Ranking" kicker="Which lead becomes the next chart">
          <div className="hiw-formula">
            rank = <span>size</span> × <span>trust</span> + <span>context</span>
          </div>
          <Figure caption="A worked example: the trend that opens an investigation" wide>
            <RankWaterfall />
          </Figure>
          <Figure caption="Trust: the evidence factor, from the adjusted p-value" wide>
            <EvidenceScale strengths={strengths} descriptive={m?.descriptiveFactor ?? 0.75} />
          </Figure>
          <Figure caption="Context: what is useful next" wide>
            <div className="ig-chips">
              <Chip v="+0.4">trend, at the start</Chip>
              <Chip v="+0.1">top-level dimension, at the start</Chip>
              <Chip v="+0.2">drill one level below your click</Chip>
              <Chip v="+0.5">change leads after you brush time</Chip>
              <Chip v="+0.25">change leads with a time baseline</Chip>
              <Chip v={m ? String(m.seenPenalty) : '−0.3'} bad>
                already shown on this path
              </Chip>
              <Chip v="× 0.35" bad>
                mix effect (applied to size)
              </Chip>
            </div>
          </Figure>
          <Figure caption={`The menu: best ${m?.menuSize ?? 8} leads, with a quota per kind so it stays varied`} wide>
            <MenuDiagram m={m} />
          </Figure>
          <More>
            The highest rank becomes the chart and the rest fill the leads panel. Open <b>Why this chart?</b> on any step to see this arithmetic for the
            lead that was picked. Drill-down leads are exempt from quotas, so the next level of the hierarchy is always on offer; like-for-like leads
            have their own quota.
          </More>
        </Section>

        <Section id="honesty" title="Honesty" kicker="The more you look, the more proof a finding needs">
          <Figure caption="Drag to see how the bar rises as comparisons pile up (Bonferroni)" wide>
            <BonferroniExplorer strengths={strengths} />
          </Figure>
          <div className="ig-rules">
            <Rule icon="Σ" title="Every comparison counts">
              including the ones that found nothing
            </Rule>
            <Rule icon="n" title={`Under ${m?.smallSelection ?? 30} records`}>
              a caution, and autopilot stops
            </Rule>
            <Rule icon="≈" title="Mix is called out">
              not presented as performance
            </Rule>
            <Rule icon="⋰" title="Correlation weighted down">
              a clue, capped at 0.7
            </Rule>
            <Rule icon="↻" title="Circular is skipped">
              a breach status vs its own tolerance
            </Rule>
          </div>
        </Section>

        <Section id="stats" title="Statistics" kicker="Tests run on a few sums per group, never on raw rows">
          <Figure caption="From millions of rows to a test, in one query per group" wide>
            <StatsPipeline />
          </Figure>
          <More>
            <p>For a per-record value r = num ÷ den, weighted by den:</p>
            <div className="hiw-code">
              {'n = rows   s = Σ num   w = Σ den   q = Σ num²/den   w₂ = Σ den²\nmean = s / w     n_eff = w² / w₂ (Kish)     var = (q / w − mean²) × n_eff / (n_eff − 1)'}
            </div>
            <p>
              Plain fields are den = 1 (ordinary mean and sample variance); a ratio's mean is exactly Σ num ÷ Σ den. Groups pool by adding their sums.
              Welch uses a normal approximation, chi-square Wilson–Hilferty, trends a robust z.
            </p>
          </More>
        </Section>

        <Section id="autopilot" title="Autopilot" kicker="Follows the best clickable lead, up to 4 hops">
          <Figure caption="Each hop is an ordinary step you can rewind or branch from" wide>
            <AutopilotDiagram small={m?.smallSelection ?? 30} />
          </Figure>
        </Section>

        <Section id="architecture" title="Architecture" kicker="The data stays in the database">
          <Figure caption="Where the work happens" wide>
            <ArchitectureDiagram sample={m?.sampleRows ?? 50000} />
          </Figure>
        </Section>

        <Section id="extending" title="Extending" kicker="Drop in a file, get a new kind of lead">
          <Figure caption="A lead kind is a plugin on both sides" wide>
            <ExtendDiagram />
          </Figure>
          <pre className="hiw-code">{`@lead_kind("outliers", icon="⚑", order=70)
def outliers(e: Engine) -> list[dict]:
    g = e.stats(e.sel_w, "desk")         # one SQL query, all measures
    e.tests += 1                         # count every comparison
    lead = e.lead("outliers", "desk", title, reason, score, p, view)
    e.bonus(lead, 0.1, "why it helps")   # labelled, shown in "Why this chart?"
    return [lead]`}</pre>
        </Section>
      </article>
    </div>
  )
}

// ---------------------------------------------------------------------------
// page furniture
// ---------------------------------------------------------------------------

function Section({ id, title, kicker, children }: { id: string; title: string; kicker: string; children: ReactNode }) {
  return (
    <section id={`hiw-${id}`} className="hiw-section">
      <div className="ig-kicker">{kicker}</div>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Figure({ caption, wide, children }: { caption: string; wide?: boolean; children: ReactNode }) {
  return (
    <figure className={`ig-fig ${wide ? 'wide' : ''}`}>
      {children}
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

function More({ children }: { children: ReactNode }) {
  return (
    <details className="hiw-more">
      <summary>The details</summary>
      <div>{children}</div>
    </details>
  )
}

/** A value read from the running engine. */
function Live({ children }: { children: ReactNode }) {
  return (
    <span className="live" title="Read from the running engine">
      {children}
    </span>
  )
}

/** The visual language, shared with the Investigate charts. */
function Legend() {
  const items: [string, string][] = [
    ['ig-accent', 'this selection'],
    ['ig-under', 'comparison group'],
    ['ig-gold', 'what stands out'],
    ['ig-good', 'went up'],
    ['ig-bad', 'went down'],
  ]
  return (
    <div className="ig-legend" aria-label="Colour key">
      {items.map(([c, label]) => (
        <span key={c}>
          <svg width="12" height="12" aria-hidden="true">
            <circle cx="6" cy="6" r="5" className={c} />
          </svg>
          {label}
        </span>
      ))}
    </div>
  )
}

function Chip({ v, bad, children }: { v: string; bad?: boolean; children: ReactNode }) {
  return (
    <span className={`ig-chip ${bad ? 'bad' : ''}`}>
      <b>{v}</b> {children}
    </span>
  )
}

function Rule({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="ig-rule">
      <span className="ig-rule-icon">{icon}</span>
      <b>{title}</b>
      <span>{children}</span>
    </div>
  )
}

/** An arrow from (x1,y1) to (x2,y2) with a small head. */
function Arrow({ x1, y1, x2, y2, cls = 'ig-stroke-muted' }: { x1: number; y1: number; x2: number; y2: number; cls?: string }) {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const h = (s: number) => `${x2 - 7 * Math.cos(a + s)},${y2 - 7 * Math.sin(a + s)}`
  return (
    <g className={cls}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="1.5" />
      <polyline points={`${h(0.45)} ${x2},${y2} ${h(-0.45)}`} fill="none" strokeWidth="1.5" strokeLinejoin="round" />
    </g>
  )
}

// ---------------------------------------------------------------------------
// section diagrams
// ---------------------------------------------------------------------------

function LoopDiagram() {
  const steps: [string, string, ReactNode][] = [
    ['Selection', 'your filter path', <path key="i" d="M-9 -7 H9 L2 1 V8 L-2 6 V1 Z" className="ig-accent" />],
    [
      'Compare',
      'with a group',
      <g key="i">
        <rect x="-10" y="-7" width="8" height="14" rx="2" className="ig-accent" />
        <rect x="2" y="-7" width="8" height="14" rx="2" className="ig-under" />
      </g>,
    ],
    [
      'Propose',
      'every kind',
      <g key="i">
        <rect x="-10" y="-9" width="13" height="10" rx="2" className="ig-under" />
        <rect x="-6" y="-4" width="13" height="10" rx="2" className="ig-under" />
        <rect x="-2" y="1" width="13" height="10" rx="2" className="ig-accent" />
      </g>,
    ],
    [
      'Score & test',
      'size and p-value',
      <g key="i">
        <path d="M-9 5 A9 9 0 0 1 9 5" fill="none" strokeWidth="3" className="ig-stroke-under" />
        <path d="M-9 5 A9 9 0 0 1 4 -3.5" fill="none" strokeWidth="3" className="ig-stroke-accent" />
        <circle cx="0" cy="5" r="2" className="ig-ink" />
      </g>,
    ],
    [
      'Rank',
      'size × trust + context',
      <g key="i">
        <rect x="-10" y="-2" width="6" height="10" rx="1" className="ig-under" />
        <rect x="-3" y="-9" width="6" height="17" rx="1" className="ig-accent" />
        <rect x="4" y="1" width="6" height="7" rx="1" className="ig-under" />
      </g>,
    ],
    [
      'Show',
      'best = next chart',
      <g key="i">
        <polyline points="-9,6 -4,0 0,3 5,-5 9,-2" fill="none" strokeWidth="2" className="ig-stroke-accent" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="5" cy="-5" r="3" className="ig-gold ig-ring" />
      </g>,
    ],
  ]
  const W = 760
  const step = W / steps.length
  return (
    <svg viewBox={`0 0 ${W} 172`} className="ig-svg" role="img" aria-label="The loop: selection, compare, propose, score and test, rank, show; a click starts it again">
      {steps.map(([title, sub, icon], i) => {
        const cx = step * i + step / 2
        return (
          <g key={title}>
            {i > 0 && <Arrow x1={cx - step + 30} y1={46} x2={cx - 30} y2={46} />}
            <circle cx={cx} cy={46} r={24} className="ig-surface ig-stroke-border" strokeWidth="1.5" />
            <g transform={`translate(${cx},46)`}>{icon}</g>
            <text x={cx} y={92} textAnchor="middle" className="ig-ink ig-b">
              {title}
            </text>
            <text x={cx} y={109} textAnchor="middle" className="ig-faint ig-s">
              {sub}
            </text>
          </g>
        )
      })}
      <path d={`M ${W - step / 2} 120 C ${W - step / 2} 154, ${step / 2} 154, ${step / 2} 124`} fill="none" strokeWidth="1.5" strokeDasharray="4 4" className="ig-stroke-accent" />
      <polyline points={`${step / 2 - 5},${131} ${step / 2},${123} ${step / 2 + 5},${131}`} fill="none" strokeWidth="1.5" className="ig-stroke-accent" />
      <text x={W / 2} y={166} textAnchor="middle" className="ig-ink ig-s">
        you click a bar or a point → a smaller selection → again
      </text>
    </svg>
  )
}

function RolesDiagram() {
  const cols: [string, string, string, string][] = [
    ['cob_date', 'time', 'ig-good', '2025-04-30'],
    ['desk', 'dimension', 'ig-accent', 'EM Rates'],
    ['abs_var', 'measure|sum', 'ig-gold', '1.2M'],
    ['quote_age', 'measure|average', 'ig-gold', '3.4'],
    ['book_id', 'identifier', 'ig-under', 'ERS-02'],
  ]
  return (
    <svg viewBox="0 0 360 150" className="ig-svg" role="img" aria-label="Fields tagged with roles: time, dimension, measure, identifier">
      {cols.map(([name, role, cls, v], i) => {
        const x = 6 + i * 70
        return (
          <g key={name}>
            <rect x={x} y={4} width={66} height={30} rx={8} className={`${cls} ig-soft`} />
            {role.split('|').map((part, j, all) => (
              <text key={part} x={x + 33} y={all.length === 1 ? 23 : 16 + j * 12} textAnchor="middle" className="ig-ink ig-xxs ig-b">
                {part}
              </text>
            ))}
            <line x1={x + 33} y1={34} x2={x + 33} y2={42} strokeWidth="1.5" className="ig-stroke-border" />
            <rect x={x} y={42} width={66} height={98} rx={4} className="ig-surface ig-stroke-border" strokeWidth="1" />
            <text x={x + 33} y={58} textAnchor="middle" className="ig-ink ig-xxs ig-b">
              {name}
            </text>
            {[0, 1, 2, 3].map((r) => (
              <text key={r} x={x + 33} y={80 + r * 17} textAnchor="middle" className="ig-faint ig-xxs">
                {r === 0 ? v : '…'}
              </text>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

function HierarchyDiagram() {
  const levels = ['division', 'business line', 'desk', 'book']
  const counts = [2, 6, 19, 40]
  return (
    <svg viewBox="0 0 360 150" className="ig-svg" role="img" aria-label="Hierarchy: division, business line, desk, book; a click drills one level down">
      {levels.map((l, i) => {
        const y = 10 + i * 36
        const n = Math.min(counts[i], 8)
        const gap = 180 / Math.max(1, n - 1)
        return (
          <g key={l}>
            <text x={8} y={y + 12} className="ig-ink ig-s ig-b">
              {l}
            </text>
            <text x={8} y={y + 26} className="ig-faint ig-xs">
              {counts[i]} values
            </text>
            {Array.from({ length: n }, (_, j) => {
              const on = j === Math.floor((n - 1) / 3)
              return <circle key={j} cx={n === 1 ? 210 : 120 + j * gap} cy={y + 14} r={on ? 6 : 4.5} className={on ? 'ig-accent ig-ring' : 'ig-under'} />
            })}
            {i < levels.length - 1 && <Arrow x1={325} y1={y + 18} x2={325} y2={y + 44} cls="ig-stroke-accent" />}
          </g>
        )
      })}
      <text x={346} y={80} textAnchor="middle" className="ig-ink ig-xxs" transform="rotate(90 346 80)">
        click → drill down
      </text>
    </svg>
  )
}

function SumVsLevel() {
  return (
    <svg viewBox="0 0 360 140" className="ig-svg" role="img" aria-label="Summed measures stack into a total; levels average to a typical value">
      <text x={90} y={16} textAnchor="middle" className="ig-ink ig-s ig-b">
        adds up (revenue)
      </text>
      {[30, 22, 40].map((h, i) => (
        <rect key={i} x={24 + i * 22} y={120 - h} width={16} height={h} rx={3} className="ig-under" />
      ))}
      <text x={100} y={98} className="ig-faint ig-b">
        =
      </text>
      <rect x={120} y={28} width={22} height={92} rx={3} className="ig-accent" />
      <text x={131} y={134} textAnchor="middle" className="ig-ink ig-xs">
        total
      </text>
      <line x1={180} y1={20} x2={180} y2={130} strokeWidth="1" className="ig-stroke-border" />
      <text x={270} y={16} textAnchor="middle" className="ig-ink ig-s ig-b">
        a level (price, age)
      </text>
      {[56, 92, 74].map((y, i) => (
        <circle key={i} cx={222 + i * 34} cy={y} r={5} className="ig-under" />
      ))}
      <line x1={205} y1={74} x2={335} y2={74} strokeWidth="2" className="ig-stroke-accent" />
      <text x={335} y={66} textAnchor="end" className="ig-ink ig-xs">
        average
      </text>
      <text x={270} y={128} textAnchor="middle" className="ig-faint ig-xs">
        summing levels gives nonsense totals
      </text>
    </svg>
  )
}

function RatioDiagram() {
  return (
    <svg viewBox="0 0 360 140" className="ig-svg" role="img" aria-label="A ratio is the sum of numerators over the sum of denominators">
      <text x={180} y={20} textAnchor="middle" className="ig-ink ig-s ig-b">
        breach rate = Σ breaches ÷ Σ records
      </text>
      {[
        [1, 2],
        [0, 50],
        [3, 6],
      ].map(([a, b], i) => (
        <g key={i}>
          <rect x={20} y={36 + i * 26} width={60} height={20} rx={4} className="ig-under ig-soft" />
          <text x={50} y={50 + i * 26} textAnchor="middle" className="ig-ink ig-xs">
            {a} / {b}
          </text>
        </g>
      ))}
      <Arrow x1={88} y1={72} x2={120} y2={72} cls="ig-stroke-accent" />
      <rect x={124} y={56} width={84} height={32} rx={6} className="ig-accent ig-soft" />
      <text x={166} y={77} textAnchor="middle" className="ig-ink ig-s ig-b">
        4 / 58 = 7%
      </text>
      <text x={222} y={58} className="ig-faint ig-xs">
        not the average of
      </text>
      <text x={222} y={73} className="ig-faint ig-xs">
        50%, 0%, 50% = 33%,
      </text>
      <text x={222} y={88} className="ig-faint ig-xs">
        which lets tiny rows
      </text>
      <text x={222} y={103} className="ig-faint ig-xs">
        count like big ones
      </text>
    </svg>
  )
}

function SiblingsDiagram() {
  const desks = ['Rates', 'Credit', 'FX', 'Comm.']
  return (
    <svg viewBox="0 0 240 150" className="ig-svg" role="img" aria-label="Selection is one business line; the comparison is the other business lines under the same parent">
      <rect x={20} y={8} width={200} height={24} rx={6} className="ig-surface ig-stroke-border" strokeWidth="1" />
      <text x={120} y={24} textAnchor="middle" className="ig-ink ig-xs ig-b">
        division = FICC (already chosen)
      </text>
      {desks.map((d, i) => {
        const x = 20 + i * 51
        const sel = i === 1
        return (
          <g key={d}>
            <line x1={x + 23} y1={32} x2={x + 23} y2={48} strokeWidth="1" className="ig-stroke-border" />
            <rect x={x} y={48} width={46} height={42} rx={6} className={sel ? 'ig-accent' : 'ig-under'} />
            <text x={x + 23} y={73} textAnchor="middle" className={`ig-xs ig-b ${sel ? 'ig-on-mark' : 'ig-ink'}`}>
              {d}
            </text>
          </g>
        )
      })}
      <text x={43} y={108} textAnchor="middle" className="ig-ink ig-xs">
        ↑ you clicked
      </text>
      <text x={170} y={108} textAnchor="middle" className="ig-ink ig-xs">
        ↑ compared with these
      </text>
      <text x={120} y={136} textAnchor="middle" className="ig-faint ig-xs">
        Equities never enters the comparison
      </text>
    </svg>
  )
}

function TimelineDiagram({ gap }: { gap: 1 | 12 }) {
  const n = gap === 1 ? 10 : 16
  const w = 220 / n
  const now = n - 1
  const vs = now - gap
  const cx = (i: number) => 10 + i * w + w / 2
  return (
    <svg viewBox="0 0 240 150" className="ig-svg" role="img" aria-label={gap === 1 ? 'Latest month compared with the month before' : 'Latest month compared with the same month a year earlier'}>
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={10 + i * w + 1} y={56} width={w - 2} height={30} rx={3} className={i === now ? 'ig-accent' : i === vs ? 'ig-under' : 'ig-under ig-soft'} />
      ))}
      <text x={cx(now)} y={46} textAnchor="middle" className="ig-ink ig-xs ig-b">
        now
      </text>
      <text x={cx(vs)} y={46} textAnchor="middle" className="ig-ink ig-xs ig-b">
        vs
      </text>
      {gap === 12 && <path d={`M ${cx(vs)} 92 Q ${(cx(vs) + cx(now)) / 2} 124 ${cx(now)} 92`} fill="none" strokeWidth="1.5" strokeDasharray="3 3" className="ig-stroke-accent" />}
      <text x={10} y={104} className="ig-faint ig-xs">
        time →
      </text>
      <text x={120} y={140} textAnchor="middle" className="ig-faint ig-xs">
        {gap === 1 ? 'or the period you clicked or brushed' : '12 months apart: seasonal, or new?'}
      </text>
    </svg>
  )
}

function MixDiagram() {
  const share = [
    ['here', 60, 140, 'ig-accent'],
    ['elsewhere', 140, 60, 'ig-under'],
  ] as const
  const per = [
    ['B here', 92, 'ig-accent'],
    ['B elsewhere', 90, 'ig-under'],
  ] as const
  return (
    <svg viewBox="0 0 700 150" className="ig-svg" role="img" aria-label="Value B has a bigger share here but the same amount per record, so the difference is mix">
      <text x={20} y={20} className="ig-ink ig-s ig-b">
        1 · Share of the total
      </text>
      {share.map(([lab, a, b, cls], i) => (
        <g key={lab}>
          <text x={20} y={57 + i * 34} className="ig-faint ig-xs">
            {lab}
          </text>
          <rect x={86} y={44 + i * 34} width={a} height={18} rx={3} className={`${cls} ig-soft`} />
          <rect x={86 + a + 2} y={44 + i * 34} width={b} height={18} rx={3} className={cls} />
          <text x={86 + a + 2 + b / 2} y={57 + i * 34} textAnchor="middle" className={`ig-xs ig-b ${cls === 'ig-accent' ? 'ig-on-mark' : 'ig-ink'}`}>
            B {Math.round((b / 200) * 100)}%
          </text>
        </g>
      ))}
      <text x={20} y={128} className="ig-ink ig-xs">
        B looks over-represented here…
      </text>
      <Arrow x1={310} y1={70} x2={360} y2={70} cls="ig-stroke-accent" />
      <text x={380} y={20} className="ig-ink ig-s ig-b">
        2 · Per record, like-for-like
      </text>
      {per.map(([lab, v, cls], i) => (
        <g key={lab}>
          <text x={380} y={57 + i * 34} className="ig-faint ig-xs">
            {lab}
          </text>
          <rect x={460} y={44 + i * 34} width={v * 1.8} height={18} rx={3} className={cls} />
        </g>
      ))}
      <text x={380} y={122} className="ig-ink ig-xs">
        …but each B record is the same. That's <tspan className="ig-b">mix</tspan>,
      </text>
      <text x={380} y={138} className="ig-ink ig-xs">
        not performance: the lead is tagged and scored × 0.35.
      </text>
    </svg>
  )
}

function RankWaterfall() {
  const S = 500 // px per rank unit
  const x0 = 140
  const rows: { label: string; sub: string; from: number; to: number; cls: string; ghost?: number; val: string }[] = [
    { label: 'Size', sub: 'effect size, 0–1', from: 0, to: 0.45, cls: 'ig-accent ig-soft', val: '0.45' },
    { label: '× Trust', sub: 'suggestive: × 0.8', from: 0, to: 0.36, cls: 'ig-accent ig-soft', ghost: 0.45, val: '0.36' },
    { label: '+ Context', sub: 'start: trend first', from: 0.36, to: 0.76, cls: 'ig-good', val: '+0.40' },
    { label: '= Rank', sub: 'highest is shown', from: 0, to: 0.76, cls: 'ig-accent', val: '0.76' },
  ]
  return (
    <svg viewBox="0 0 700 192" className="ig-svg" role="img" aria-label="Worked example: size 0.45 times trust 0.8 is 0.36, plus 0.40 context is rank 0.76">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={x0 + t * S} y1={8} x2={x0 + t * S} y2={170} strokeWidth="1" className="ig-stroke-grid" />
          <text x={x0 + t * S} y={186} textAnchor="middle" className="ig-faint ig-xs">
            {t}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = 12 + i * 40
        return (
          <g key={r.label}>
            <text x={10} y={y + 14} className="ig-ink ig-s ig-b">
              {r.label}
            </text>
            <text x={10} y={y + 28} className="ig-faint ig-xs">
              {r.sub}
            </text>
            {r.ghost && (
              <rect x={x0 + r.to * S + 2} y={y + 4} width={(r.ghost - r.to) * S - 2} height={22} rx={4} fill="none" strokeDasharray="3 3" strokeWidth="1.2" className="ig-stroke-under" />
            )}
            <rect x={x0 + r.from * S + (r.from ? 2 : 0)} y={y + 4} width={(r.to - r.from) * S - (r.from ? 2 : 0)} height={22} rx={4} className={r.cls} />
            {i < rows.length - 1 && <line x1={x0 + r.to * S} y1={y + 26} x2={x0 + r.to * S} y2={y + 44} strokeWidth="1" strokeDasharray="2 2" className="ig-stroke-muted" />}
            <text x={x0 + Math.max(r.to, r.ghost ?? 0) * S + 8} y={y + 20} className="ig-ink ig-s ig-b">
              {r.val}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function EvidenceScale({ strengths, descriptive }: { strengths: Method['strengths']; descriptive: number }) {
  const lo = -5 // log10 p, from 1e-5 to 1
  const W = 560
  const x0 = 16
  const x = (p: number) => x0 + ((Math.log10(Math.max(p, 1e-5)) - lo) / -lo) * W
  const cls: Record<string, string> = { strong: 'ig-good', suggestive: 'ig-gold', weak: 'ig-under' }
  const ticks: [number, string][] = [
    [1e-5, '0.00001'],
    [1e-4, '0.0001'],
    [0.001, '0.001'],
    [0.01, '0.01'],
    [0.05, '0.05'],
    [1, '1'],
  ]
  return (
    <svg viewBox="0 0 700 118" className="ig-svg" role="img" aria-label="Evidence scale: adjusted p below 0.001 is strong; below 0.05 suggestive; otherwise weak; descriptive leads have no test">
      <text x={x0} y={18} className="ig-faint ig-xs">
        ← more convincing · adjusted p-value (log scale)
      </text>
      {strengths.map((s, i) => {
        const a = x(i === 0 ? 1e-5 : strengths[i - 1].pBelow)
        const b = x(s.pBelow)
        return (
          <g key={s.name}>
            <rect x={a + 1} y={28} width={b - a - 2} height={30} rx={4} className={`${cls[s.name] ?? 'ig-under'} ig-soft`} />
            <text x={(a + b) / 2} y={48} textAnchor="middle" className="ig-ink ig-s ig-b">
              {s.name} × {s.factor}
            </text>
          </g>
        )
      })}
      {ticks.map(([p, label]) => (
        <g key={label}>
          <line x1={x(p)} y1={58} x2={x(p)} y2={64} strokeWidth="1" className="ig-stroke-muted" />
          <text x={x(p)} y={78} textAnchor="middle" className="ig-faint ig-xs">
            {label}
          </text>
        </g>
      ))}
      <rect x={598} y={28} width={96} height={30} rx={4} className="ig-accent ig-soft" />
      <text x={646} y={48} textAnchor="middle" className="ig-ink ig-s ig-b">
        no test × {descriptive}
      </text>
      <text x={646} y={78} textAnchor="middle" className="ig-faint ig-xs">
        descriptive
      </text>
      <text x={x0} y={106} className="ig-faint ig-xs">
        adjusted p = raw p × comparisons so far (capped at 1)
      </text>
    </svg>
  )
}

function MenuDiagram({ m }: { m: Method | null }) {
  const kinds = m?.kinds ?? []
  const icon = (n: string) => kinds.find((k) => k.name === n)?.icon ?? '•'
  const quota = (n: string) => kinds.find((k) => k.name === n)?.quota ?? 3
  // An illustrative ranked list, worked through the same rules as the engine.
  const ranked = ['trend', 'breakdown', 'breakdown', 'driver', 'breakdown', 'breakdown', 'change', 'driver', 'driver', 'driver', 'target']
  const used: Record<string, number> = {}
  let shown = 0
  return (
    <svg viewBox="0 0 700 112" className="ig-svg" role="img" aria-label="Ranked leads left to right; leads over their kind's quota are skipped; the best eight are shown">
      <text x={10} y={16} className="ig-faint ig-xs">
        ranked best → worst
      </text>
      {ranked.map((k, i) => {
        const x = 10 + i * 62
        used[k] = (used[k] ?? 0) + 1
        const ok = used[k] <= quota(k)
        const inMenu = ok && shown < (m?.menuSize ?? 8)
        if (inMenu) shown++
        return (
          <g key={i} opacity={inMenu ? 1 : 0.5}>
            <rect x={x} y={26} width={54} height={44} rx={6} className={inMenu ? 'ig-accent ig-soft' : 'ig-surface ig-stroke-border'} strokeWidth="1" strokeDasharray={inMenu ? undefined : '3 3'} />
            <text x={x + 27} y={48} textAnchor="middle" className="ig-ink ig-b">
              {icon(k)}
            </text>
            <text x={x + 27} y={62} textAnchor="middle" className="ig-ink ig-xxs">
              {k}
            </text>
            {!inMenu && (
              <text x={x + 27} y={86} textAnchor="middle" className="ig-ink ig-xxs">
                {ok ? 'menu full' : 'over quota'}
              </text>
            )}
          </g>
        )
      })}
      <text x={10} y={106} className="ig-faint ig-xs">
        quotas: {kinds.length ? kinds.map((k) => `${k.name} ${k.quota}`).join(' · ') : '3 per kind'} · drill-downs exempt
      </text>
    </svg>
  )
}

function BonferroniExplorer({ strengths }: { strengths: Method['strengths'] }) {
  const [n, setN] = useState(33)
  const strong = strengths.find((s) => s.name === 'strong')?.pBelow ?? 0.001
  const sugg = strengths.find((s) => s.name === 'suggestive')?.pBelow ?? 0.05
  const W = 520
  const H = 140
  const x0 = 64
  const lx = (v: number) => x0 + (Math.log10(v) / 3) * W // 1..1000 comparisons
  const ly = (p: number) => 24 + ((Math.log10(p) + 1) / -7) * H // p from 0.1 down to 1e-8
  const curve = (alpha: number) =>
    Array.from({ length: 31 }, (_, i) => 10 ** (i / 10))
      .map((v, i) => `${i ? 'L' : 'M'} ${lx(v).toFixed(1)} ${ly(alpha / v).toFixed(1)}`)
      .join(' ')
  // Two significant digits, written out (0.0000001, not 1e-7).
  const fmt = (p: number) => p.toFixed(Math.max(0, 1 - Math.floor(Math.log10(p)))).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  return (
    <div className="ig-bonf">
      <label className="ig-slider">
        <span>
          comparisons made so far: <b>{n}</b>
        </span>
        <input
          type="range"
          min={0}
          max={300}
          value={Math.round((Math.log10(n) / 3) * 300)}
          onChange={(e) => setN(Math.max(1, Math.round(10 ** ((Number(e.target.value) / 300) * 3))))}
          aria-label="Comparisons made so far"
        />
      </label>
      <svg viewBox="0 0 700 212" className="ig-svg" role="img" aria-label={`With ${n} comparisons, strong needs raw p below ${fmt(strong / n)} and suggestive below ${fmt(sugg / n)}`}>
        {[1e-1, 1e-3, 1e-5, 1e-7].map((p) => (
          <g key={p}>
            <line x1={x0} y1={ly(p)} x2={x0 + W} y2={ly(p)} strokeWidth="1" className="ig-stroke-grid" />
            <text x={x0 - 6} y={ly(p) + 4} textAnchor="end" className="ig-faint ig-xs">
              {fmt(p)}
            </text>
          </g>
        ))}
        <text x={x0} y={10} className="ig-faint ig-xs">
          raw p needed (log scale)
        </text>
        {[1, 10, 100, 1000].map((v) => (
          <text key={v} x={lx(v)} y={H + 46} textAnchor="middle" className="ig-faint ig-xs">
            {v}
          </text>
        ))}
        <text x={x0 + W / 2} y={H + 64} textAnchor="middle" className="ig-faint ig-xs">
          comparisons (log scale)
        </text>
        <path d={curve(sugg)} fill="none" strokeWidth="2" strokeLinecap="round" className="ig-stroke-gold" />
        <path d={curve(strong)} fill="none" strokeWidth="2" strokeLinecap="round" className="ig-stroke-good" />
        <line x1={lx(n)} y1={20} x2={lx(n)} y2={H + 30} strokeWidth="1" strokeDasharray="3 3" className="ig-stroke-muted" />
        <circle cx={lx(n)} cy={ly(sugg / n)} r={5} className="ig-gold ig-ring" />
        <circle cx={lx(n)} cy={ly(strong / n)} r={5} className="ig-good ig-ring" />
        <text x={x0 + W + 10} y={ly(sugg / 1000) + 4} className="ig-ink ig-xs ig-b">
          suggestive
        </text>
        <text x={x0 + W + 10} y={ly(strong / 1000) + 4} className="ig-ink ig-xs ig-b">
          strong
        </text>
      </svg>
      <div className="ig-bonf-read">
        <span>
          <svg width="12" height="12" aria-hidden="true">
            <circle cx="6" cy="6" r="5" className="ig-good" />
          </svg>
          <b>strong</b> needs raw p &lt; {fmt(strong / n)}
        </span>
        <span>
          <svg width="12" height="12" aria-hidden="true">
            <circle cx="6" cy="6" r="5" className="ig-gold" />
          </svg>
          <b>suggestive</b> needs raw p &lt; {fmt(sugg / n)}
        </span>
        <span className="muted">each extra look raises the bar</span>
      </div>
    </div>
  )
}

function StatsPipeline() {
  const boxes: [string, string[], string][] = [
    ['Rows', ['millions, in DuckDB', 'never leave it'], 'ig-under'],
    ['One query per group', ['n, Σ num, Σ den,', 'Σ num²/den, Σ den²'], 'ig-accent'],
    ['Per group', ['mean, variance,', 'effective n'], 'ig-accent'],
    ['Tests', ['Welch · χ² · robust z', '· Spearman'], 'ig-good'],
  ]
  return (
    <svg viewBox="0 0 700 110" className="ig-svg" role="img" aria-label="Rows stay in DuckDB; one query per group returns a few sums; those give mean, variance and effective n; tests run on those">
      {boxes.map(([t, lines, cls], i) => {
        const x = 8 + i * 174
        return (
          <g key={t}>
            {i > 0 && <Arrow x1={x - 26} y1={55} x2={x - 6} y2={55} cls="ig-stroke-accent" />}
            <rect x={x} y={14} width={146} height={82} rx={8} className={`${cls} ig-soft`} />
            <text x={x + 73} y={40} textAnchor="middle" className="ig-ink ig-s ig-b">
              {t}
            </text>
            {lines.map((l, j) => (
              <text key={j} x={x + 73} y={60 + j * 16} textAnchor="middle" className="ig-ink ig-xs">
                {l}
              </text>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

function AutopilotDiagram({ small }: { small: number }) {
  const hops = ['All data', 'FICC', 'Credit', 'SC New York']
  return (
    <svg viewBox="0 0 700 130" className="ig-svg" role="img" aria-label={`Autopilot hops up to four times, skipping weak leads, stopping under ${small} records`}>
      {hops.map((h, i) => {
        const x = 50 + i * 150
        return (
          <g key={h}>
            {i > 0 && <Arrow x1={x - 128} y1={44} x2={x - 24} y2={44} cls="ig-stroke-accent" />}
            {i > 0 && (
              <text x={x - 76} y={34} textAnchor="middle" className="ig-faint ig-xs">
                hop {i}
              </text>
            )}
            <circle cx={x} cy={44} r={18} className={i === hops.length - 1 ? 'ig-gold ig-ring' : 'ig-accent'} />
            <text x={x} y={49} textAnchor="middle" className={`ig-xs ig-b ${i === hops.length - 1 ? 'ig-ink-dark' : 'ig-on-mark'}`}>
              {i + 1}
            </text>
            <text x={x} y={84} textAnchor="middle" className="ig-ink ig-xs ig-b">
              {h}
            </text>
          </g>
        )
      })}
      <rect x={560} y={22} width={132} height={44} rx={8} className="ig-bad ig-soft" />
      <text x={626} y={40} textAnchor="middle" className="ig-ink ig-xs ig-b">
        stops if
      </text>
      <text x={626} y={56} textAnchor="middle" className="ig-ink ig-xs">
        {`< ${small} records or no lead`}
      </text>
      <text x={20} y={118} className="ig-faint ig-xs">
        picks the best lead that isn't weak and has an obvious click: a standout bar, or the peak of an unusual stretch
      </text>
    </svg>
  )
}

function ArchitectureDiagram({ sample }: { sample: number }) {
  const box = (x: number, y: number, w: number, t: string, sub: string, cls: string) => (
    <g>
      <rect x={x} y={y} width={w} height={54} rx={8} className={`${cls} ig-soft`} />
      <text x={x + w / 2} y={y + 23} textAnchor="middle" className="ig-ink ig-s ig-b">
        {t}
      </text>
      <text x={x + w / 2} y={y + 40} textAnchor="middle" className="ig-ink ig-xs">
        {sub}
      </text>
    </g>
  )
  return (
    <svg viewBox="0 0 700 186" className="ig-svg" role="img" aria-label="Files and uploads go into DuckDB; the engine queries it in SQL; Investigate gets small summaries; the chart library gets a sample">
      {box(8, 62, 120, 'Your data', 'CSV · Parquet · JSON', 'ig-under')}
      {box(158, 62, 110, 'DuckDB', 'every row', 'ig-accent')}
      {box(298, 62, 140, 'Engine', 'lead kinds · SQL', 'ig-accent')}
      {box(468, 14, 224, 'Investigate', 'small summaries per lead', 'ig-good')}
      {box(468, 110, 224, 'Chart library', `${sample.toLocaleString()}-row sample`, 'ig-under')}
      <Arrow x1={130} y1={89} x2={156} y2={89} cls="ig-stroke-accent" />
      <Arrow x1={270} y1={89} x2={296} y2={89} cls="ig-stroke-accent" />
      <Arrow x1={440} y1={78} x2={466} y2={46} cls="ig-stroke-accent" />
      <Arrow x1={240} y1={118} x2={466} y2={140} cls="ig-stroke-muted" />
      <text x={8} y={180} className="ig-faint ig-xs">
        filters become WHERE clauses; grouping and sums run in the database, so millions of rows are fine
      </text>
    </svg>
  )
}

function ExtendDiagram() {
  const box = (x: number, t: string, sub: string, cls: string) => (
    <g>
      <rect x={x} y={20} width={196} height={56} rx={8} className={`${cls} ig-soft`} />
      <text x={x + 98} y={44} textAnchor="middle" className="ig-ink ig-s ig-b">
        {t}
      </text>
      <text x={x + 98} y={62} textAnchor="middle" className="ig-ink ig-xs">
        {sub}
      </text>
    </g>
  )
  return (
    <svg viewBox="0 0 700 96" className="ig-svg" role="img" aria-label="A Python file in engine/kinds registers a lead kind; its view is drawn by the frontend view registry or any library chart">
      {box(4, 'engine/kinds/your_kind.py', '@lead_kind · returns leads', 'ig-accent')}
      <Arrow x1={204} y1={48} x2={246} y2={48} cls="ig-stroke-accent" />
      {box(250, 'lead view (JSON)', 'type + rows', 'ig-under')}
      <Arrow x1={450} y1={48} x2={496} y2={48} cls="ig-stroke-accent" />
      {box(500, 'views.ts, or any chart', 'drawn, clickable, with a key', 'ig-good')}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// mini charts for the lead-kind cards (the same marks as the real views)
// ---------------------------------------------------------------------------

function Mini({ label, children }: { label: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 220 104" className="ig-svg ig-mini" role="img" aria-label={label}>
      {children}
    </svg>
  )
}

function MiniTrend() {
  const ys = [62, 58, 65, 60, 22, 38, 63, 59, 57, 62, 60]
  const pts = ys.map((y, i) => [12 + i * 19.6, y] as const)
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' ')
  return (
    <Mini label="Trend: a line with an unusual two-period stretch highlighted in gold">
      <rect x={pts[4][0] - 8} y={8} width={pts[5][0] - pts[4][0] + 16} height={80} rx={3} className="ig-gold ig-wash" />
      <path d={`${d} L ${pts[10][0]} 88 L ${pts[0][0]} 88 Z`} className="ig-accent ig-wash" />
      <path d="M 12 61 L 208 60" strokeDasharray="4 3" strokeWidth="1.2" className="ig-stroke-muted" />
      <path d={d} fill="none" strokeWidth="2" strokeLinejoin="round" className="ig-stroke-accent" />
      <circle cx={pts[4][0]} cy={pts[4][1]} r={4.5} className="ig-gold ig-ring" />
      <circle cx={pts[5][0]} cy={pts[5][1]} r={4.5} className="ig-gold ig-ring" />
      <text x={pts[4][0] + 9} y={pts[4][1] - 2} className="ig-ink ig-xxs ig-b">
        peak
      </text>
      <text x={208} y={54} textAnchor="end" className="ig-faint ig-xxs">
        typical
      </text>
      <line x1={8} y1={88} x2={212} y2={88} strokeWidth="1" className="ig-stroke-grid" />
    </Mini>
  )
}

function MiniBreakdown() {
  const rows: [string, number, number][] = [
    ['A', 128, 90],
    ['B', 104, 122],
    ['C', 78, 60],
    ['D', 44, 58],
  ]
  return (
    <Mini label="Breakdown: bars against black ticks; the standout bar outlined">
      {rows.map(([l, v, t], i) => {
        const y = 8 + i * 23
        const over = v > t
        return (
          <g key={l}>
            <text x={14} y={y + 12} textAnchor="middle" className="ig-faint ig-xxs">
              {l}
            </text>
            <rect x={26} y={y} width={v} height={16} rx={3} className={over ? 'ig-accent' : 'ig-under'} />
            {i === 0 && <rect x={25} y={y - 1} width={v + 2} height={18} rx={4} fill="none" strokeWidth="2" className="ig-stroke-bad" />}
            <line x1={26 + t} y1={y - 3} x2={26 + t} y2={y + 19} strokeWidth="2" className="ig-stroke-ink" />
          </g>
        )
      })}
      <text x={212} y={20} textAnchor="end" className="ig-ink ig-xxs">
        standout
      </text>
    </Mini>
  )
}

function MiniDriver() {
  const a = [2, 5, 10, 16, 20, 15, 8, 4]
  const b = [6, 12, 18, 15, 9, 5, 3, 1]
  return (
    <Mini label="Driver: two overlapping distributions with their averages">
      {b.map((h, i) => (
        <rect key={`b${i}`} x={16 + i * 24} y={86 - h * 3.6} width={22} height={h * 3.6} rx={2} className="ig-under ig-half" />
      ))}
      {a.map((h, i) => (
        <rect key={`a${i}`} x={16 + i * 24} y={86 - h * 3.6} width={22} height={h * 3.6} rx={2} className="ig-accent ig-half" />
      ))}
      <line x1={78} y1={4} x2={78} y2={88} strokeWidth="2" className="ig-stroke-under" />
      <line x1={126} y1={4} x2={126} y2={88} strokeWidth="2" className="ig-stroke-accent" />
      <text x={102} y={101} textAnchor="middle" className="ig-ink ig-xxs ig-b">
        d = gap ÷ SD
      </text>
      <line x1={8} y1={88} x2={212} y2={88} strokeWidth="1" className="ig-stroke-grid" />
    </Mini>
  )
}

function MiniChange() {
  const rows = [58, 30, -18, -46]
  return (
    <Mini label="Change: bars to the right went up, to the left went down">
      <line x1={110} y1={2} x2={110} y2={96} strokeWidth="1" className="ig-stroke-grid" />
      {rows.map((v, i) => (
        <rect key={i} x={v >= 0 ? 111 : 109 + v} y={8 + i * 22} width={Math.abs(v)} height={16} rx={3} className={v >= 0 ? 'ig-good' : 'ig-bad'} />
      ))}
      <text x={212} y={20} textAnchor="end" className="ig-ink ig-xxs ig-b">
        drove it
      </text>
    </Mini>
  )
}

function MiniTarget() {
  const rows: [number, number][] = [
    [70, 120],
    [132, 96],
    [60, 110],
    [40, 90],
  ]
  return (
    <Mini label="Target: bars against target ticks; one bar exceeds its target">
      {rows.map(([v, t], i) => {
        const y = 8 + i * 23
        return (
          <g key={i}>
            <rect x={20} y={y} width={v} height={16} rx={3} className={v > t ? 'ig-accent' : 'ig-under'} />
            <line x1={20 + t} y1={y - 3} x2={20 + t} y2={y + 19} strokeWidth="2" className="ig-stroke-ink" />
          </g>
        )
      })}
      <text x={160} y={43} className="ig-ink ig-xxs ig-b">
        exception
      </text>
      <text x={150} y={101} textAnchor="middle" className="ig-faint ig-xxs">
        tick = target
      </text>
    </Mini>
  )
}

function MiniRelationship() {
  const pts: [number, number][] = [
    [20, 82],
    [34, 74],
    [48, 78],
    [62, 64],
    [76, 66],
    [92, 56],
    [106, 60],
    [122, 46],
    [138, 44],
    [154, 36],
    [170, 30],
    [190, 18],
  ]
  return (
    <Mini label="Relationship: points rising from bottom-left to top-right">
      <line x1={14} y1={86} x2={200} y2={16} strokeDasharray="4 3" strokeWidth="1.2" className="ig-stroke-muted" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={4} className="ig-accent ig-ring" />
      ))}
      <text x={110} y={101} textAnchor="middle" className="ig-faint ig-xxs">
        each dot = one group
      </text>
      <line x1={8} y1={88} x2={212} y2={88} strokeWidth="1" className="ig-stroke-grid" />
    </Mini>
  )
}
