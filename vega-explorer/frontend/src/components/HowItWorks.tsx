import { useEffect, useState, type ReactNode } from 'react'
import { api, type Method } from '../api.ts'

/** How each built-in lead kind is found, scored and tested. Plugin kinds fall back to their docstring. */
const KIND_DOC: Record<string, { asks: string; score: ReactNode; test: ReactNode; counts: string }> = {
  trend: {
    asks: 'Is any period unusual for this selection, or is it drifting?',
    score: (
      <>
        Each period is compared with the median of the 5 periods around it. The gap is scaled by the typical gap (median absolute deviation × 1.4826)
        to give a robust <i>z</i>. Score = min(1, |z| / 7) × min(1, |ratio − 1| / 0.3), so a period needs to be both statistically and practically
        unusual. At the start, or when no period survives the adjustment, the lead instead reports drift: the last third of the series against the
        first, and score = max(that, |drift|).
      </>
    ),
    test: (
      <>
        Two-sided normal tail of the largest <i>z</i>. Periods with |z| ≥ 3 are drawn red. Needs at least 6 periods.
      </>
    ),
    counts: 'one per period in the series',
  },
  breakdown: {
    asks: 'How does the selection split along a dimension, and how does that differ from the comparison group?',
    score: (
      <>
        <b>No comparison group</b> (the start, or a dimension nested under the value you just clicked): for summed measures, how concentrated the
        top 1 (≤ 5 values) or top 3 values are compared with an even split: min(1, (top share − k/N) × 1.5 + 0.2). For levels and rates, the
        spread between the highest and lowest value in standard deviations of single records, divided by 2.5.
        <br />
        <b>Summed measures vs comparison</b>: the total variation distance between the two share distributions (half the sum of |share here − share
        there|) × 1.8.
        <br />
        <b>Levels and rates vs comparison</b>: each value against the same value in the comparison group, in pooled standard deviations, for values
        with at least 5 records. Score = the record-weighted average of |difference| / 0.8.
      </>
    ),
    test: (
      <>
        Shares: a chi-square test on the record counts per value (Wilson–Hilferty approximation). Levels: Welch's test on the standout value.
      </>
    ),
    counts: 'one per share comparison, or one per value compared for levels',
  },
  driver: {
    asks: 'Does another measure behave differently in the selection?',
    score: (
      <>
        Cohen's <i>d</i>: the difference in per-record averages over the pooled standard deviation. Score = min(1, |d| / 1.2). Ratios built from the
        current measure are skipped, because they would only restate it. Needs 5 effective records on each side.
      </>
    ),
    test: <>Welch's test on the two averages.</>,
    counts: 'one per measure compared',
  },
  change: {
    asks: 'Between two time windows, which values drove the change?',
    score: (
      <>
        Runs after you brush a time range (against the same number of periods just before it), or at every step with a previous-period or year-earlier
        baseline. Concentration = the largest single movement ÷ the sum of all movements. Score = 0.45 × concentration + 0.55 × min(1, 2 × |relative
        change in the total|).
      </>
    ),
    test: <>Chi-square on record counts per value, before vs after.</>,
    counts: 'one per dimension',
  },
  target: {
    asks: 'Which values sit on the wrong side of their target?',
    score: (
      <>
        Needs a target set for the measure in the structure. The story is the <b>exceptions</b>: values on the other side of their target from the
        selection as a whole (over a limit when the total is within it, for example). Score = 0.5 × min(1, |gap ÷ target|) + 0.5 × the exceptions'
        share of the total absolute gap. With no exceptions, score = 0.25 × min(1, |gap ÷ target|). Dimensions where every row of each value sits on
        one side of the target (such as a breach status) are skipped as circular.
      </>
    ),
    test: <>None: a target comparison is descriptive.</>,
    counts: 'none',
  },
  relationship: {
    asks: 'Across the values of a dimension, does a level or rate move with this measure?',
    score: (
      <>
        For dimensions with 8–60 values (each with at least 3 records), the Spearman rank correlation <i>ρ</i> between the measure's per-record level
        and each level/rate field. Score = 0.7 × min(1, |ρ| / 0.8). The 0.7 is deliberate: a correlation across groups is a clue about why, not
        evidence of it. Totals and calculated ratios are left out because they mostly restate group size or the measure itself.
      </>
    ),
    test: <>Fisher transform of ρ, normal tail.</>,
    counts: 'one per dimension × field tried',
  },
}

const SECTIONS = [
  ['loop', 'The investigation loop'],
  ['structure', 'Structure'],
  ['comparison', 'Selection and comparison group'],
  ['kinds', 'Lead kinds'],
  ['ranking', 'Ranking the next lead'],
  ['honesty', 'Honesty rules'],
  ['stats', 'Statistics on aggregates'],
  ['autopilot', 'Autopilot'],
  ['architecture', 'Architecture and scale'],
  ['extending', 'Extending it'],
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

  // Two significant digits, written out in full (0.000005, not 5e-6 or a rounded 0).
  const pct = (n: number) => n.toFixed(Math.max(0, 1 - Math.floor(Math.log10(n)))).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  const strong = m?.strengths.find((s) => s.name === 'strong')
  const suggestive = m?.strengths.find((s) => s.name === 'suggestive')

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
          Narra turns “click a chart, see the next one” into a reproducible procedure. Each step compares the records you selected with a
          comparison group, scores every candidate view by how big and how reliable the difference is, and shows the best one. This page describes
          that procedure exactly. The numbers marked <span className="live">live</span> are read from the running engine.
        </p>
        {error && <div className="banner warn">Couldn't load the engine's constants ({error}). The rest of the page still applies.</div>}

        <Section id="loop" title="The investigation loop">
          <ol className="hiw-flow">
            <li>
              <b>Selection</b>
              <span>the records matching your filter path</span>
            </li>
            <li>
              <b>Comparison group</b>
              <span>what the selection is measured against</span>
            </li>
            <li>
              <b>Candidate leads</b>
              <span>every lead kind proposes views</span>
            </li>
            <li>
              <b>Score and test</b>
              <span>effect size, p-value</span>
            </li>
            <li>
              <b>Rank</b>
              <span>evidence-weighted, with context adjustments</span>
            </li>
            <li>
              <b>Show</b>
              <span>the top lead is the chart, the rest are leads</span>
            </li>
          </ol>
          <p>
            Clicking a bar or a point adds a filter, and the loop runs again on the smaller selection. Every step stays on the page, so the
            investigation reads as a story you can rewind or branch from.
          </p>
        </Section>

        <Section id="structure" title="Structure">
          <p>Before investigating, the engine needs to know how to treat each field. It detects this once per dataset, and you confirm or edit it.</p>
          <table>
            <tbody>
              <tr>
                <th>Role</th>
                <td>
                  <b>dimension</b> (categories to split and click), <b>measure</b> (numbers to aggregate), <b>time</b>, latitude/longitude,
                  identifier, or ignore. Detected from the field's type, name and cardinality: text with nearly one value per row is an identifier,
                  text with more than 200 values is ignored, densely numbered integers are row ids.
                </td>
              </tr>
              <tr>
                <th>Aggregation</th>
                <td>
                  Whether a measure <b>adds up</b> (revenue: summed) or is a <b>level or rate</b> (price, rating, age: averaged). Summing a level
                  gives meaningless totals, so this changes every comparison.
                </td>
              </tr>
              <tr>
                <th>Calculated measures</th>
                <td>
                  Ratios defined as sum(numerator) ÷ sum(denominator) × scale, such as breach rate = breaches ÷ records. They are never computed as
                  an average of per-row ratios, which would let small rows count as much as big ones. 0/1 flags are suggested as rates.
                </td>
              </tr>
              <tr>
                <th>Hierarchy</th>
                <td>
                  Found from functional dependencies: <i>A</i> rolls up into <i>B</i> when every value of <i>A</i> maps to exactly one value of{' '}
                  <i>B</i> and <i>B</i> has fewer values (city → state → region). The most specific parent is kept. Two fields that relabel each
                  other one-to-one (country and ISO code) keep only the first. The hierarchy decides where a click drills down.
                </td>
              </tr>
              <tr>
                <th>Target</th>
                <td>
                  A measure's plan, budget or limit, such as tolerance for a price variance. Detected from names like <code>_target</code>,{' '}
                  <code>budget</code>, <code>tolerance</code>, <code>limit</code>.
                </td>
              </tr>
              <tr>
                <th>Time grain</th>
                <td>From the time span: over 8 years → year, over 120 days → month, over 21 days → week, otherwise day.</td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Section id="comparison" title="Selection and comparison group">
          <p>
            Every lead is a comparison, so what the selection is compared with matters as much as the selection. Pick it with <b>Compare with</b>:
          </p>
          <table>
            <thead>
              <tr>
                <th>Compare with</th>
                <th>Comparison group</th>
                <th>Answers</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>the rest</td>
                <td>
                  Records that differ <b>only in the last filter</b>. After clicking <i>desk = EM Rates</i> under <i>division = FICC</i>, that is the
                  other FICC desks, not the whole dataset, so earlier choices don't leak into the comparison.
                </td>
                <td>How is this different from its siblings?</td>
              </tr>
              <tr>
                <td>previous period</td>
                <td>The same selection in the window just before. The window is the latest period, or the period you clicked or brushed.</td>
                <td>What changed since last time?</td>
              </tr>
              <tr>
                <td>a year earlier</td>
                <td>The same selection, same window, one year back.</td>
                <td>Is this seasonal or new?</td>
              </tr>
            </tbody>
          </table>
          <p>
            Dimensions already fixed by a filter, and their parents, are left out, because they are constant in the selection. With “the rest”, a
            dimension nested under the value you just clicked (desks under a business line) gets a description rather than a comparison: its
            values can't appear in the comparison group, so any comparison would be trivially lopsided.
          </p>
          <p>
            <b>Mix effects.</b> For summed measures, a value can hold a bigger share of the total simply because the selection contains more of its
            records, without each record behaving differently. Each share comparison is therefore cross-checked like-for-like, per record, against the
            same value in the comparison group. When the like-for-like difference is small (under 0.2 SD, or within 0.8–1.25×) or points the other
            way, the lead is tagged <i>mix effect</i> and its score is multiplied by 0.35.
          </p>
        </Section>

        <Section id="kinds" title="Lead kinds">
          <p>
            A lead kind is a plugin that looks at the selection and proposes views. Each lead gets an <b>effect-size score</b> from 0 to 1 (how big the
            difference is, in a unit that compares across kinds) and, where a test makes sense, a <b>p-value</b> (how unlikely the difference is by
            chance). Dimensions with more than {m ? <Live>{m.maxValues}</Live> : '60'} values are skipped as too fine to chart.
          </p>
          {(m?.kinds ?? Object.keys(KIND_DOC).map((name) => ({ name, icon: '', description: '', quota: 3, order: 0 }))).map((k) => {
            const doc = KIND_DOC[k.name]
            return (
              <div key={k.name} className="hiw-kind">
                <h3>
                  <span className="kind">{k.icon}</span> {k.name}
                </h3>
                <p className="muted">{doc?.asks ?? k.description}</p>
                {doc ? (
                  <dl>
                    <dt>Score</dt>
                    <dd>{doc.score}</dd>
                    <dt>Test</dt>
                    <dd>{doc.test}</dd>
                    <dt>Comparisons counted</dt>
                    <dd>{doc.counts}</dd>
                  </dl>
                ) : (
                  <p className="muted">A plugin kind: see its module in backend/app/engine/kinds for how it scores leads.</p>
                )}
              </div>
            )
          })}
          <p>
            Additive measures also get a <b>like-for-like</b> lead per dimension. It compares each value's per-record average with the same value in the
            comparison group, for values with at least 3 records on both sides. Score = min(1, |d| / 0.8) × (0.5 + 0.5 × min(1, 2 × the value's share of
            the measure)), so a big difference in a tiny value counts for less. Test: Welch, one comparison per value.
          </p>
        </Section>

        <Section id="ranking" title="Ranking the next lead">
          <div className="hiw-formula">
            rank = <span>score</span> × <span>evidence factor</span> + <span>adjustments</span>
          </div>
          <p>
            The score says how big a difference is. The evidence factor says how far to trust it. The adjustments encode what is useful next. The
            highest rank becomes the chart; the next best fill the leads panel. Open <b>Why this chart?</b> on any step to see this arithmetic for the
            lead that was picked.
          </p>
          <h3>Evidence factor</h3>
          <table>
            <thead>
              <tr>
                <th>Strength</th>
                <th>When</th>
                <th>Factor</th>
              </tr>
            </thead>
            <tbody>
              {(m?.strengths ?? []).map((s, i, all) => (
                <tr key={s.name}>
                  <td>
                    <span className={`strength ${s.name} small`}>{s.name}</span>
                  </td>
                  <td>
                    adjusted p {i === 0 ? '<' : '≥'} {i === 0 ? pct(s.pBelow) : pct(all[i - 1].pBelow)}
                    {i > 0 && i < all.length - 1 ? ` and < ${pct(s.pBelow)}` : ''}
                  </td>
                  <td>
                    <Live>× {s.factor}</Live>
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <span className="strength descriptive small">descriptive</span>
                </td>
                <td>no test applies (an overview, a target comparison)</td>
                <td>{m && <Live>× {m.descriptiveFactor}</Live>}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted">
            A descriptive lead sits between suggestive and weak: it makes no claim that could be wrong, but it hasn't earned the trust of a passed test
            either.
          </p>
          <h3>Adjustments</h3>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Adjustment</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Start of an investigation, trend lead</td>
                <td>+0.4</td>
                <td>Over time is the natural first question.</td>
              </tr>
              <tr>
                <td>Start of an investigation, top-level dimension</td>
                <td>+0.1</td>
                <td>Start broad, before details.</td>
              </tr>
              <tr>
                <td>Breakdown one level below the value you just clicked</td>
                <td>+0.2</td>
                <td>Drilling down is where a click naturally leads.</td>
              </tr>
              <tr>
                <td>After brushing a time range, change leads</td>
                <td>+0.5</td>
                <td>Answer the question the brush asked, even on weak evidence.</td>
              </tr>
              <tr>
                <td>Previous-period or year-earlier baseline, change leads</td>
                <td>+0.25</td>
                <td>You asked what changed.</td>
              </tr>
              <tr>
                <td>Lead already shown earlier on this path</td>
                <td>{m ? <Live>{m.seenPenalty}</Live> : '−0.3'}</td>
                <td>Don't repeat yourself.</td>
              </tr>
              <tr>
                <td>Mix effect</td>
                <td>score × 0.35</td>
                <td>The difference is composition, not behaviour.</td>
              </tr>
            </tbody>
          </table>
          <h3>Keeping the menu varied</h3>
          <p>
            After sorting by rank, each kind may place at most its quota of leads (
            {m ? (
              <Live>
                {m.kinds.map((k) => `${k.name} ${k.quota}`).join(', ')}
              </Live>
            ) : (
              '3 each'
            )}
            ; like-for-like counts separately). Drill-down leads are exempt, so the next level of the hierarchy is always on offer. The best{' '}
            {m ? <Live>{m.menuSize}</Live> : '8'} are shown.
          </p>
        </Section>

        <Section id="honesty" title="Honesty rules">
          <ul>
            <li>
              <b>Every comparison is counted</b> across the whole session, including the ones that produced no lead (see “comparisons counted” per
              kind). Each p-value is multiplied by that running total (Bonferroni) before strength is assigned. The more you explore, the stronger the
              evidence must be: with 200 comparisons made, “strong” needs a raw p below {strong ? pct(strong.pBelow / 200) : '0.000005'}, and
              “suggestive” below {suggestive ? pct(suggestive.pBelow / 200) : '0.00025'}.
            </li>
            <li>
              <b>Small selections are flagged.</b> Under {m ? <Live>{m.smallSelection}</Live> : '30'} records, the step carries a caution, and
              autopilot stops.
            </li>
            <li>
              <b>Mix is called out</b> rather than presented as performance (see above).
            </li>
            <li>
              <b>Correlation is weighted down.</b> Relationship leads are capped at 0.7 of a direct comparison's score.
            </li>
            <li>
              <b>Circular comparisons are skipped</b>, such as a breach status against the tolerance that defines it.
            </li>
          </ul>
        </Section>

        <Section id="stats" title="Statistics on aggregates">
          <p>
            The data stays in the database. For each group, one SQL query returns a few <b>sufficient statistics</b> per measure, and every test runs
            on those, never on raw rows in the browser or in Python:
          </p>
          <div className="hiw-code">
            n = rows   s = Σ num   w = Σ den   q = Σ num²/den   w₂ = Σ den²   a = Σ |num|
          </div>
          <p>From these, for a per-record value r = num / den weighted by den:</p>
          <ul>
            <li>mean = s / w (for a ratio measure this is exactly Σ num / Σ den)</li>
            <li>effective sample size n_eff = w² / w₂ (Kish), which equals the record count for plain fields</li>
            <li>variance = (q / w − mean²) × n_eff / (n_eff − 1), the sample variance for plain fields</li>
          </ul>
          <p>
            Plain fields are the special case den = 1. Groups pool by adding their sums, so a comparison group's spread comes for free. Welch's test uses
            a normal approximation, chi-square uses the Wilson–Hilferty approximation, and trend anomalies use a robust z (rolling median and median
            absolute deviation) so one spike can't hide another.
          </p>
        </Section>

        <Section id="autopilot" title="Autopilot">
          <p>
            Autopilot follows the highest-ranked lead that is not weak and has an obvious next click: the standout bar of a breakdown or change, or
            the unusual period of a strong or suggestive trend. It repeats up to 4 times and stops early when a selection drops under{' '}
            {m ? m.smallSelection : 30} records. Every hop is a normal step, so you can rewind or branch from any of them.
          </p>
        </Section>

        <Section id="architecture" title="Architecture and scale">
          <ul>
            <li>
              <b>DuckDB</b> holds every dataset. Filters become SQL WHERE clauses, and grouping and aggregation run in the database, so the engine
              works on millions of rows without loading them into memory.
            </li>
            <li>
              <b>Connected files</b> (CSV, Parquet, JSON, including globs) are read in place, and Refresh picks up new data.
            </li>
            <li>
              The <b>chart library</b> renders in the browser, so it gets a sample of {m ? <Live>{m.sampleRows.toLocaleString()}</Live> : '50,000'}{' '}
              rows from large datasets. Investigate always uses every row.
            </li>
            <li>
              A step costs one query per dimension and comparison group (all measures together), plus a few for histograms. Results are cached within the
              step.
            </li>
          </ul>
        </Section>

        <Section id="extending" title="Extending it">
          <p>
            A lead kind is a Python function registered with <code>@lead_kind</code> in <code>backend/app/engine/kinds/</code>. It reads the selection
            and comparison group through the engine (<code>e.stats(...)</code>), counts its comparisons (<code>e.tests += 1</code>), labels any
            adjustment (<code>e.bonus(lead, 0.2, "why")</code>) and returns leads. Its view is drawn by the frontend view registry, or by any chart from
            the library. A new kind appears in this page's lead list automatically.
          </p>
        </Section>
      </article>
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={`hiw-${id}`} className="hiw-section">
      <h2>{title}</h2>
      {children}
    </section>
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
