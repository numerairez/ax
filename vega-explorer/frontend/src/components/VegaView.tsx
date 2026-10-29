import { useEffect, useRef, useState } from 'react'
import embed, { type Result } from 'vega-embed'

export const THEMES = [
  'default',
  'quartz',
  'vox',
  'fivethirtyeight',
  'ggplot2',
  'latimes',
  'urbaninstitute',
  'googlecharts',
  'powerbi',
  'excel',
  'carbonwhite',
  'carbong10',
  'dark',
  'carbong90',
  'carbong100',
] as const
export type Theme = (typeof THEMES)[number]
export const DARK_THEMES = new Set<Theme>(['dark', 'carbong90', 'carbong100'])

interface Props {
  spec: Record<string, unknown>
  lib: 'vega' | 'vega-lite'
  theme: Theme
  config?: Record<string, unknown>
  actions?: boolean
}

// Thumbnails render through a single queue so the gallery stays responsive.
const queue: (() => Promise<void>)[] = []
let pumping = false
async function pump() {
  if (pumping) return
  pumping = true
  while (queue.length) {
    await queue.shift()!().catch(() => undefined)
    await new Promise((r) => setTimeout(r, 0))
  }
  pumping = false
}

export function VegaView({ spec, lib, theme, config, actions = true }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let result: Result | undefined
    let cancelled = false
    const el = ref.current
    if (!el) return
    embed(el, spec as never, {
      mode: lib,
      renderer: 'svg',
      theme: theme === 'default' ? undefined : theme,
      config: config as never,
      actions: actions ? { export: true, source: true, compiled: lib === 'vega-lite', editor: true } : false,
      logLevel: 0,
    })
      .then((r) => {
        if (cancelled) r.finalize()
        else {
          result = r
          setError(null)
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message)
        }
      })
    return () => {
      cancelled = true
      result?.finalize()
    }
  }, [spec, lib, theme, config, actions])

  return (
    <>
      {error && <div className="error">⚠ {error}</div>}
      <div ref={ref} className="vega-host" />
    </>
  )
}

/** Lazily rendered, non-interactive preview for gallery cards. */
export function Thumbnail({ build, lib, theme, config }: { build: () => Record<string, unknown>; lib: 'vega' | 'vega-lite'; theme: Theme; config?: Record<string, unknown> }) {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let alive = true
    let result: Result | undefined
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        queue.push(async () => {
          if (!alive) return
          try {
            result = await embed(el, build() as never, {
              mode: lib,
              renderer: 'svg',
              theme: theme === 'default' ? undefined : theme,
              config: config as never,
              actions: false,
              logLevel: 0,
            })
            if (!alive) result.finalize()
            else setState('done')
          } catch {
            if (alive) setState('error')
          }
        })
        pump()
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => {
      alive = false
      io.disconnect()
      result?.finalize()
    }
  }, [build, lib, theme, config])

  return (
    <div className={`thumb ${state}`}>
      {state === 'idle' && <div className="thumb-loading" />}
      {state === 'error' && <div className="thumb-msg">Preview failed — open to see details</div>}
      <div ref={ref} className="thumb-host" />
    </div>
  )
}
