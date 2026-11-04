import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.ts'
import { Controls } from './components/Controls.tsx'
import { DataPanel } from './components/DataPanel.tsx'
import { HowItWorks } from './components/HowItWorks.tsx'
import { Investigate } from './investigate/Investigate.tsx'
import { SpecEditor } from './components/SpecEditor.tsx'
import { DARK_THEMES, THEMES, Thumbnail, VegaView, type Theme } from './components/VegaView.tsx'
import { schemeConfig, withData } from './render.ts'
import {
  autoAssign,
  CATEGORIES,
  defaultOptions,
  incompatibility,
  TEMPLATES,
  type ChartTemplate,
  type Ctx,
  type Mapping,
} from './templates/index.ts'
import type { Dataset, DatasetMeta } from './types.ts'
import './App.css'

const CAT_SCHEMES = ['tableau10', 'observable10', 'category10', 'set2', 'dark2', 'paired', 'accent', 'tableau20', 'pastel1', 'set1']
const SEQ_SCHEMES = ['viridis', 'magma', 'inferno', 'plasma', 'turbo', 'cividis', 'blues', 'greens', 'oranges', 'purples', 'teals', 'goldred', 'yelloworangered', 'bluepurple', 'redyellowblue', 'spectral']

// Kept from the app's earlier name so saved preferences survive the rename.
const STORE_KEY = 'vega-explorer:v1'
type Mode = 'library' | 'investigate' | 'method'
interface Saved {
  datasetId?: string
  templateId?: string | null
  theme?: Theme
  cat?: string
  seq?: string
  mode?: Mode
}
function load(): Saved {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')
  } catch {
    return {}
  }
}
function save(s: Saved) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable */
  }
}

export default function App() {
  const saved = useRef(load()).current
  const [metas, setMetas] = useState<DatasetMeta[]>([])
  const [datasetId, setDatasetId] = useState<string>(saved.datasetId ?? 'retail_sales')
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [templateId, setTemplateId] = useState<string | null>(saved.templateId ?? null)
  const [theme, setTheme] = useState<Theme>(saved.theme ?? 'default')
  const [cat, setCat] = useState(saved.cat ?? 'tableau10')
  const [seq, setSeq] = useState(saved.seq ?? 'viridis')
  const [mode, setMode] = useState<Mode>(saved.mode ?? 'library')
  const [methodSection, setMethodSection] = useState<string | undefined>()
  // Reading “How it works” from an investigation keeps the investigation alive underneath.
  const [returnTo, setReturnTo] = useState<Mode | null>(null)
  const openMethod = (section?: string) => {
    setMethodSection(section)
    setReturnTo(mode === 'method' ? returnTo : mode)
    setMode('method')
  }
  const [search, setSearch] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const cache = useRef(new Map<string, Dataset>())

  useEffect(() => save({ datasetId, templateId, theme, cat, seq, mode }), [datasetId, templateId, theme, cat, seq, mode])

  const refreshList = useCallback(async () => {
    try {
      const list = await api.list()
      setMetas(list)
      setLoadError(null)
      return list
    } catch (e) {
      setLoadError(`Can't reach the backend (${(e as Error).message}). Is it running on port 8000?`)
      return []
    }
  }, [])

  useEffect(() => {
    refreshList().then((list) => {
      if (list.length && !list.some((m) => m.id === datasetId)) setDatasetId(list[0].id)
    })
    // Only on mount; dataset changes are handled below.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!metas.some((m) => m.id === datasetId)) return
    const hit = cache.current.get(datasetId)
    if (hit) {
      setDataset(hit)
      return
    }
    let stale = false
    setBusy(true)
    api
      .get(datasetId)
      .then((d) => {
        cache.current.set(datasetId, d)
        if (!stale) setDataset(d)
      })
      .catch((e) => setLoadError((e as Error).message))
      .finally(() => setBusy(false))
    return () => {
      stale = true
    }
  }, [datasetId, metas])

  const onUpload = async (file: File) => {
    setBusy(true)
    try {
      const meta = await api.upload(file)
      await refreshList()
      setDatasetId(meta.id)
      setLoadError(null)
    } catch (e) {
      setLoadError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onConnect = async () => {
    const path = prompt('Path or glob of files on this machine to read in place (CSV, TSV, JSON, JSON Lines or Parquet), e.g. /data/marks/*.parquet')
    if (!path?.trim()) return
    setBusy(true)
    try {
      const meta = await api.connect(path.trim())
      await refreshList()
      setDatasetId(meta.id)
      setLoadError(null)
    } catch (e) {
      setLoadError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onRefresh = async () => {
    if (!dataset) return
    setBusy(true)
    try {
      await api.refresh(dataset.meta.id)
      cache.current.delete(dataset.meta.id)
      setDataset(null)
      await refreshList()
    } catch (e) {
      setLoadError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async () => {
    if (!dataset || dataset.meta.source === 'builtin') return
    const what = dataset.meta.source === 'connected' ? 'Disconnect' : 'Delete uploaded dataset'
    if (!confirm(`${what} “${dataset.meta.name}”?`)) return
    await api.remove(dataset.meta.id)
    cache.current.delete(dataset.meta.id)
    const list = await refreshList()
    setDatasetId(list[0]?.id ?? '')
  }

  const template = TEMPLATES.find((t) => t.id === templateId) ?? null
  const fields = dataset?.meta.fields ?? []
  const vlConfig = useMemo(() => schemeConfig(cat, seq), [cat, seq])
  const q = search.trim().toLowerCase()
  const visible = TEMPLATES.filter((t) => !q || `${t.name} ${t.description} ${t.category} ${t.lib}`.toLowerCase().includes(q))

  return (
    <div className={`app ${DARK_THEMES.has(theme) ? 'chart-dark' : ''}`}>
      <header className="topbar">
        <button className="brand" onClick={() => setTemplateId(null)} title="Back to gallery">
          <img className="logo" src="/favicon.svg" alt="" width={26} height={26} /> Narra
        </button>
        <div className="modes" role="tablist">
          <button role="tab" aria-selected={mode === 'library'} className={mode === 'library' ? 'active' : ''} onClick={() => setMode('library')}>
            Chart library
          </button>
          <button role="tab" aria-selected={mode === 'investigate'} className={mode === 'investigate' ? 'active' : ''} onClick={() => setMode('investigate')}>
            ✦ Investigate
          </button>
          <button
            role="tab"
            aria-selected={mode === 'method'}
            className={mode === 'method' ? 'active' : ''}
            onClick={() => mode !== 'method' && openMethod()}
          >
            How it works
          </button>
        </div>
        <div className="topbar-group">
          <label className="field">
            <span>Dataset</span>
            <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
              <optgroup label="Built-in mock data">
                {metas
                  .filter((m) => m.source === 'builtin')
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.rows.toLocaleString()})
                    </option>
                  ))}
              </optgroup>
              {(['upload', 'connected'] as const).map(
                (src) =>
                  metas.some((m) => m.source === src) && (
                    <optgroup key={src} label={src === 'upload' ? 'Uploaded' : 'Connected files'}>
                      {metas
                        .filter((m) => m.source === src)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.rows.toLocaleString()})
                          </option>
                        ))}
                    </optgroup>
                  ),
              )}
            </select>
          </label>
          <UploadButton onFile={onUpload} />
          <button className="btn ghost" onClick={onConnect} title="Read files on this machine in place, without uploading a copy">
            ⛓ Connect
          </button>
          {dataset?.meta.source === 'connected' && (
            <button className="btn ghost" onClick={onRefresh} title={`Re-read ${dataset.meta.location}`}>
              ↻ Refresh
            </button>
          )}
          {dataset && dataset.meta.source !== 'builtin' && (
            <button className="btn ghost" onClick={onDelete} title={dataset.meta.source === 'connected' ? 'Forget this connection (the files stay)' : 'Delete this uploaded dataset'}>
              {dataset.meta.source === 'connected' ? 'Disconnect' : 'Delete'}
            </button>
          )}
          {busy && <span className="spinner" aria-label="Loading" />}
        </div>
        <div className={`topbar-group right ${mode !== 'library' ? 'hidden' : ''}`}>
          <label className="field">
            <span>Theme</span>
            <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
              {THEMES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Categorical</span>
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              {CAT_SCHEMES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Sequential</span>
            <select value={seq} onChange={(e) => setSeq(e.target.value)}>
              {SEQ_SCHEMES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {loadError && (
        <div className="banner error">
          {loadError}
          <button className="btn ghost" onClick={() => setLoadError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {mode === 'method' && (
        <main className="main">
          <HowItWorks
            section={methodSection}
            onBack={returnTo === 'investigate' ? () => setMode('investigate') : undefined}
          />
        </main>
      )}
      {(mode === 'investigate' || (mode === 'method' && returnTo === 'investigate')) && (
        <main className="main investigate-main" hidden={mode !== 'investigate'}>
          {dataset ? <Investigate key={dataset.meta.id} meta={dataset.meta} onExplain={openMethod} /> : <div className="empty">Loading datasets…</div>}
        </main>
      )}
      {mode === 'library' && (
      <div className="layout">
        <aside className="sidebar">
          <input className="search" placeholder={`Search ${TEMPLATES.length} charts…`} value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className={`nav-item home ${templateId ? '' : 'active'}`} onClick={() => setTemplateId(null)}>
            ▦ Gallery
          </button>
          {CATEGORIES.map((c) => {
            const items = visible.filter((t) => t.category === c)
            if (!items.length) return null
            return (
              <div key={c} className="nav-group">
                <div className="nav-title">{c}</div>
                {items.map((t) => {
                  const why = dataset ? incompatibility(t, fields) : null
                  return (
                    <button
                      key={t.id}
                      className={`nav-item ${t.id === templateId ? 'active' : ''} ${why ? 'dim' : ''}`}
                      title={why ?? t.description}
                      onClick={() => setTemplateId(t.id)}
                    >
                      <span>{t.name}</span>
                      {t.lib === 'vega' && <span className="badge vega">Vega</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </aside>

        <main className="main">
          {!dataset ? (
            <div className="empty">{loadError ? 'No data loaded.' : 'Loading datasets…'}</div>
          ) : template ? (
            <Workbench
              key={template.id}
              template={template}
              dataset={dataset}
              theme={theme}
              cat={cat}
              seq={seq}
              vlConfig={vlConfig}
              onNavigate={setTemplateId}
              visible={visible}
            />
          ) : (
            <Gallery templates={visible} dataset={dataset} theme={theme} cat={cat} seq={seq} vlConfig={vlConfig} onOpen={setTemplateId} />
          )}
        </main>
      </div>
      )}
    </div>
  )
}

function UploadButton({ onFile }: { onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  return (
    <>
      <button
        className={`btn ${drag ? 'drag' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          const f = e.dataTransfer.files[0]
          if (f) onFile(f)
        }}
        title="CSV, TSV, JSON, JSON Lines or Parquet — click or drop a file here"
      >
        ⤒ Upload data
      </button>
      <input
        ref={input}
        type="file"
        accept=".csv,.tsv,.txt,.json,.jsonl,.ndjson,.parquet"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
    </>
  )
}

interface ViewProps {
  dataset: Dataset
  theme: Theme
  cat: string
  seq: string
  vlConfig: Record<string, unknown>
}

function makeCtx(d: Dataset, mapping: Mapping, options: Record<string, string>, w: number, h: number, cat: string, seq: string): Ctx {
  return { ...mapping, o: options, rows: d.rows, fields: d.meta.fields, w, h, cat, seq }
}

function Gallery({ templates, dataset, theme, cat, seq, vlConfig, onOpen }: ViewProps & { templates: ChartTemplate[]; onOpen: (id: string) => void }) {
  return (
    <div className="gallery">
      <div className="gallery-intro">
        <h1>Chart library</h1>
        <p>
          {TEMPLATES.length} Vega and Vega-Lite techniques, each auto-mapped to <strong>{dataset.meta.name}</strong>. Open one to remap fields, tweak
          options, edit the raw spec, or switch datasets and themes up top.
        </p>
      </div>
      {CATEGORIES.map((c) => {
        const items = templates.filter((t) => t.category === c)
        if (!items.length) return null
        return (
          <section key={c}>
            <h2>{c}</h2>
            <div className="cards">
              {items.map((t) => (
                <Card key={`${t.id}:${dataset.meta.id}`} t={t} dataset={dataset} theme={theme} cat={cat} seq={seq} vlConfig={vlConfig} onOpen={onOpen} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function Card({ t, dataset, theme, cat, seq, vlConfig, onOpen }: ViewProps & { t: ChartTemplate; onOpen: (id: string) => void }) {
  const why = incompatibility(t, dataset.meta.fields)
  const build = useCallback(() => {
    const ctx = makeCtx(dataset, autoAssign(t, dataset.meta.fields), defaultOptions(t), 420, 240, cat, seq)
    return withData(t.build(ctx), t.lib, dataset.rows)
  }, [t, dataset, cat, seq])
  return (
    <button className={`card ${why ? 'incompatible' : ''}`} onClick={() => onOpen(t.id)}>
      <div className="card-preview">
        {why ? <div className="thumb-msg">{why}</div> : <Thumbnail build={build} lib={t.lib} theme={theme} config={t.lib === 'vega-lite' ? vlConfig : undefined} />}
      </div>
      <div className="card-body">
        <div className="card-title">
          {t.name}
          <span className={`badge ${t.lib}`}>{t.lib === 'vega' ? 'Vega' : 'VL'}</span>
        </div>
        <div className="card-desc">{t.description}</div>
      </div>
    </button>
  )
}

function Workbench({
  template: t,
  dataset,
  theme,
  cat,
  seq,
  vlConfig,
  onNavigate,
  visible,
}: ViewProps & { template: ChartTemplate; onNavigate: (id: string) => void; visible: ChartTemplate[] }) {
  const fields = dataset.meta.fields
  const [mapping, setMapping] = useState<Mapping>(() => autoAssign(t, fields, lastMapping.current))
  const [options, setOptions] = useState<Record<string, string>>(() => defaultOptions(t))
  const [size, setSize] = useState({ w: 560, h: 320 })
  const [tab, setTab] = useState<'chart' | 'spec' | 'data'>('chart')
  const [override, setOverride] = useState<Record<string, unknown> | null>(null)

  // Re-map when the dataset changes under an open chart.
  const prevDataset = useRef(dataset.meta.id)
  useEffect(() => {
    if (prevDataset.current !== dataset.meta.id) {
      prevDataset.current = dataset.meta.id
      setMapping(autoAssign(t, fields))
      setOverride(null)
    }
  }, [dataset.meta.id, fields, t])

  useEffect(() => {
    lastMapping.current = mapping
  }, [mapping])

  const why = incompatibility(t, fields)
  const generated = useMemo<{ spec: Record<string, unknown> | null; error: string | null }>(() => {
    try {
      return { spec: t.build(makeCtx(dataset, mapping, options, size.w, size.h, cat, seq)), error: null }
    } catch (e) {
      return { spec: null, error: (e as Error).message }
    }
  }, [t, dataset, mapping, options, size, cat, seq])

  const active = override ?? generated.spec
  const rendered = useMemo(() => (active ? withData(active, t.lib, dataset.rows) : null), [active, t.lib, dataset.rows])
  const withRows = useCallback((s: Record<string, unknown>) => withData(s, t.lib, dataset.rows), [t.lib, dataset.rows])

  const idx = visible.findIndex((x) => x.id === t.id)
  const prev = visible[(idx - 1 + visible.length) % visible.length]
  const next = visible[(idx + 1) % visible.length]

  const change = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v)
    setOverride(null)
  }

  return (
    <div className="workbench">
      <div className="wb-head">
        <div>
          <div className="crumbs">
            {t.category} · <span className={`badge ${t.lib}`}>{t.lib === 'vega' ? 'Vega' : 'Vega-Lite'}</span>
          </div>
          <h1>{t.name}</h1>
          <p className="muted">{t.description}</p>
        </div>
        <div className="wb-nav">
          <button className="btn" onClick={() => onNavigate(prev.id)} title={prev.name}>
            ← Prev
          </button>
          <button className="btn" onClick={() => onNavigate(next.id)} title={next.name}>
            Next →
          </button>
        </div>
      </div>

      {why && <div className="banner warn">This dataset may not suit this chart: {why}. You can still map fields manually.</div>}

      <div className="wb-body">
        <div className="panel">
          <h3>Encodings & options</h3>
          <Controls template={t} fields={fields} mapping={mapping} options={options} onMapping={change(setMapping)} onOptions={change(setOptions)} />
          <h3>Size</h3>
          <label className="control">
            <span className="control-label">
              Width <span className="hint">{size.w}px</span>
            </span>
            <input type="range" min={200} max={1200} step={10} value={size.w} onChange={(e) => change(setSize)({ ...size, w: Number(e.target.value) })} />
          </label>
          <label className="control">
            <span className="control-label">
              Height <span className="hint">{size.h}px</span>
            </span>
            <input type="range" min={120} max={800} step={10} value={size.h} onChange={(e) => change(setSize)({ ...size, h: Number(e.target.value) })} />
          </label>
          <button
            className="btn ghost small"
            onClick={() => {
              setMapping(autoAssign(t, fields))
              setOptions(defaultOptions(t))
              setOverride(null)
            }}
          >
            Reset mapping
          </button>
        </div>

        <div className="stage-wrap">
          <div className="tabs" role="tablist">
            {(['chart', 'spec', 'data'] as const).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                {k === 'chart' ? 'Chart' : k === 'spec' ? 'Spec' : 'Data'}
                {k === 'spec' && override && <span className="dot" title="Edited" />}
              </button>
            ))}
          </div>
          {tab === 'chart' && (
            <div className="stage">
              {override && (
                <div className="banner info">
                  Showing your edited spec.{' '}
                  <button className="link" onClick={() => setOverride(null)}>
                    Reset to template
                  </button>
                </div>
              )}
              {generated.error && !override && <div className="error">⚠ Could not build spec: {generated.error}</div>}
              {rendered && <VegaView spec={rendered} lib={t.lib} theme={theme} config={t.lib === 'vega-lite' ? vlConfig : undefined} />}
            </div>
          )}
          {tab === 'spec' && generated.spec && <SpecEditor generated={generated.spec} override={override} withRows={withRows} onApply={setOverride} />}
          {tab === 'data' && <DataPanel dataset={dataset} />}
        </div>
      </div>
    </div>
  )
}

// Carry the last field picks across charts so exploring feels continuous.
const lastMapping: { current: Mapping | undefined } = { current: undefined }
