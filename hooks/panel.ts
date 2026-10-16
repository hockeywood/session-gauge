// Panel feed: a cloud session shown in the Claude desktop app draws no band above the prompt,
// so the gauge also writes its figures to a live artifact page, the Session Gauge Panel, which
// can stay open beside the chat. One document per session (sessions/<id>), so sessions running
// at the same time never overwrite each other; the panel shows the freshest one first.
import type { EngineInterface } from 'claude-code'

import type { Gauge } from '../types'

export const PANEL_URL = 'https://claude.ai/artifact/LZxsh6DokWjHdXMCGAnMzT'
const MIN_GAP_MS = 30_000 // at most one write per 30 seconds (replies can come faster)
const SLOW_MS = 10_000 // a write this slow most likely waited on a permission dialog: stop writing

let docId: string | null = null
let version: number | null = null
let lastWrite = 0
let isOff = false
let isBusy = false
let failures = 0 // consecutive writes with no stored version: after 3 (say, no access to the panel) the feed stops

type StoreResult = { result?: { db_write?: { version?: number } }; text?: string }

export function panelDocId(sessionId: string): string {
  const clean = sessionId.replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 200)
  return clean || 'unknown'
}

export function versionFrom(r: StoreResult): number | null {
  const v = r.result?.db_write?.version
  if (typeof v === 'number') return v
  const m = /"version":\s*(\d+)/.exec(r.text ?? '') ?? /version (\d+)/.exec(r.text ?? '')
  return m ? Number(m[1]) : null
}

async function store($: EngineInterface, args: Record<string, unknown>): Promise<StoreResult> {
  return (await $.tool.call({ tool: 'ArtifactData', url: PANEL_URL, collection: 'sessions', doc_id: docId, ...args } as never)) as StoreResult
}

async function allowed($: EngineInterface): Promise<boolean> {
  try {
    const { decision } = await $.tool.check({ tool: 'ArtifactData', input: { action: 'set', url: PANEL_URL, collection: 'sessions' } })
    return decision !== 'deny'
  } catch {
    return false
  }
}

// Called after every gauge update; writes when 30 seconds have passed or when forced (the 2-minute tick).
export async function feedPanel($: EngineInterface, g: Gauge, force: boolean): Promise<void> {
  if (isOff || isBusy) return
  const now = await $.clock.now()
  if (!force && now - lastWrite < MIN_GAP_MS) return
  isBusy = true
  lastWrite = now
  try {
    if (docId === null) {
      docId = panelDocId(await $.session.id())
      if (!(await allowed($))) {
        isOff = true
        return
      }
    }
    let model = ''
    try {
      model = await $.session.model()
    } catch {}
    const data = { ...g, model, sessionId: docId, readAt: now }
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = await $.clock.now()
      try {
        const r = await store($, version === null ? { action: 'set', data } : { action: 'set', data, if_version: version })
        if ((await $.clock.now()) - started > SLOW_MS) isOff = true
        const v = versionFrom(r)
        if (v !== null) {
          version = v
          failures = 0
          return
        }
      } catch {}
      // unknown or stale version: read the document's current version, then try once more
      try {
        version = versionFrom(await store($, { action: 'get' }))
      } catch {
        version = null
      }
    }
    if (++failures >= 3) isOff = true
  } catch {
    // no session id or no store: the band and status line still work; the panel stays quiet
    isOff = true
  } finally {
    isBusy = false
  }
}
