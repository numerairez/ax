import type { Baseline, InvestigateResponse, Structure } from './investigate/types.ts'
import type { Dataset, DatasetMeta } from './types.ts'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      msg = (await res.json()).detail ?? msg
    } catch {
      /* not JSON */
    }
    throw new Error(msg)
  }
  return res.json()
}

export const api = {
  list: () => fetch('/api/datasets').then((r) => json<DatasetMeta[]>(r)),
  get: (id: string) => fetch(`/api/datasets/${encodeURIComponent(id)}`).then((r) => json<Dataset>(r)),
  upload: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return fetch('/api/datasets', { method: 'POST', body }).then((r) => json<DatasetMeta>(r))
  },
  structure: (id: string) => fetch(`/api/datasets/${encodeURIComponent(id)}/structure`).then((r) => json<Structure>(r)),
  saveStructure: (id: string, s: Structure) =>
    fetch(`/api/datasets/${encodeURIComponent(id)}/structure`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) }).then((r) =>
      json<Structure>(r),
    ),
  resetStructure: (id: string) => fetch(`/api/datasets/${encodeURIComponent(id)}/structure`, { method: 'DELETE' }).then((r) => json<Structure>(r)),
  connect: (path: string) =>
    fetch('/api/datasets/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }).then((r) => json<DatasetMeta>(r)),
  refresh: (id: string) => fetch(`/api/datasets/${encodeURIComponent(id)}/refresh`, { method: 'POST' }).then((r) => json<DatasetMeta>(r)),
  investigate: (
    id: string,
    body: { measure: string; baseline: Baseline; filters: { field: string; op: string; value: unknown }[]; testsSoFar: number; seen: string[] },
  ) =>
    fetch(`/api/datasets/${encodeURIComponent(id)}/investigate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) =>
      json<InvestigateResponse>(r),
    ),
  remove: (id: string) => fetch(`/api/datasets/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),
}
