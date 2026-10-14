// session-gauge: one band above the prompt for knowing when to compact or start fresh.
// Ideas borrowed (MIT) from anantraghunath/claude-code-usage-quota-mod: reading the plan
// limits live from Anthropic's usage service at session open, a blended pace forecast,
// and a one-click Compact. Display only: it never blocks or changes anything you do.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Gauge, Window } from '../types'

const empty: Gauge = { context: null, growth: null, turnsLeft: null, windows: [], source: 'none', readAt: null }
const gauge = atom({ plugin: 'session-gauge', key: 'gauge' } as const, empty)
const warned = atom({ plugin: 'session-gauge', key: 'warned' } as const, 0)
const isOn = atom({ plugin: 'session-gauge', key: 'isOn' } as const, true)
const isOpen = atom({ plugin: 'session-gauge', key: 'isOpen' } as const, false)

// Context: compact at the next break from 60%, start a new session from 80% (judgment, not an Anthropic figure)
export const COMPACT_AT = 60
export const NEW_SESSION_AT = 80
const HOUR = 3_600_000
const SPAN: Record<Window['kind'], number> = { five_hour: 5 * HOUR, seven_day: 7 * 24 * HOUR }
const LABEL: Record<Window['kind'], string> = { five_hour: '5h', seven_day: 'week' }
const LIVE_EVERY_MS = 120_000
const TYPICAL = 50 // assumed % a window reaches when this one has little history
const TRUST = 0.25 // the window's own pace takes over a quarter of the way in

let history: number[] = [] // context % after each reply, newest last
let backoffUntil = 0
let isCompacting = false

export function advice(context: number | null) {
  if (context === null) return { text: 'fresh', color: 'success' as const }
  if (context >= NEW_SESSION_AT) return { text: 'start a new session', color: 'error' as const }
  if (context >= COMPACT_AT) return { text: 'compact at the next break', color: 'warning' as const }
  return { text: 'healthy', color: 'success' as const }
}

// Projected % at reset: used + pace x time left, the pace a blend of this window's own and a typical one.
export function project(kind: Window['kind'], percent: number, resetsAt: number | null, now: number): number | null {
  if (resetsAt === null || resetsAt <= now) return null
  const span = SPAN[kind]
  const left = resetsAt - now
  const elapsed = Math.max(60_000, span - left)
  const weight = elapsed / (elapsed + span * TRUST)
  const rate = weight * (percent / elapsed) + (1 - weight) * (TYPICAL / span)
  return percent + rate * left
}

// Turns left before NEW_SESSION_AT at the recent average growth per reply.
export function turnsLeft(hist: number[], now: number | null): { growth: number | null; left: number | null } {
  if (now === null || hist.length < 2) return { growth: null, left: null }
  const recent = hist.slice(-6)
  const steps = recent.slice(1).map((v, i) => v - recent[i]!).filter(d => d > 0)
  if (steps.length === 0) return { growth: null, left: null }
  const growth = steps.reduce((a, b) => a + b, 0) / steps.length
  return { growth, left: Math.max(0, Math.floor((NEW_SESSION_AT - now) / growth)) }
}

const pct = (n: number | null) => (n === null ? '--' : `${Math.round(n)}%`)

function until(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.round(h / 24)}d`
}

// The full gauge as plain lines, for /gauge.
export function readout(g: Gauge, now: number): string {
  const a = advice(g.context)
  const lines = [`Context ${pct(g.context)}: ${a.text}`]
  lines.push(
    g.turnsLeft !== null
      ? `Replies left before ${NEW_SESSION_AT}%: ~${g.turnsLeft} at ~${g.growth!.toFixed(1)} points per reply (projected)`
      : 'Replies left: needs two more replies to estimate',
  )
  for (const kind of ['five_hour', 'seven_day'] as const) {
    const w = g.windows.find(x => x.kind === kind)
    if (!w) {
      lines.push(`${LABEL[kind]}: not read yet`)
      continue
    }
    const reset = w.resetsAt ? `, resets in ${until(w.resetsAt - now)}` : ''
    const proj = w.projected !== null ? `, on pace for ~${Math.round(w.projected)}% at reset (projected)` : ''
    lines.push(`${LABEL[kind]}: ${pct(w.percent)} used${reset}${proj}`)
  }
  const src = g.source === 'live' ? 'live from Anthropic' : g.source === 'reply' ? 'from the last reply' : 'not yet'
  lines.push(`Limits read ${src}. Compact from ${COMPACT_AT}%, new session from ${NEW_SESSION_AT}%.`)
  return lines.join('\n')
}

function toWindows(limits: SessionRateLimit[], now: number): Window[] {
  const out: Window[] = []
  for (const kind of ['five_hour', 'seven_day'] as const) {
    const l = limits.find(x => x.kind === kind)
    if (!l) continue
    const r = l.resetsAt ? Date.parse(l.resetsAt) : NaN
    const resetsAt = Number.isFinite(r) ? r : null
    out.push({ kind, percent: l.percentUsed, resetsAt, projected: project(kind, l.percentUsed, resetsAt, now) })
  }
  return out
}

// Plan limits straight from Anthropic's usage service, through the session's own login
// (the mod never sees the credential). Null when there is no Claude login or it refuses.
async function fetchLimits($: EngineInterface): Promise<SessionRateLimit[] | null> {
  const now = await $.clock.now()
  if (now < backoffUntil) return null
  try {
    const auth = await $.session.authorize()
    if (!auth || auth.kind !== 'bearer') return null
    const res = await $.http.fetch('https://api.anthropic.com/api/oauth/usage', {
      auth: auth.handle,
      headers: { 'anthropic-beta': 'oauth-2025-04-20', 'content-type': 'application/json' },
    })
    if (!res.ok) {
      backoffUntil = now + (res.status === 429 ? 15 : 5) * 60_000
      return null
    }
    const body = JSON.parse(res.text) as Record<string, { utilization?: number | null; resets_at?: string | null } | null>
    const out: SessionRateLimit[] = []
    for (const kind of ['five_hour', 'seven_day']) {
      const w = body[kind]
      if (w && typeof w.utilization === 'number') {
        out.push({ kind, percentUsed: Math.round(w.utilization * 10) / 10, resetsAt: w.resets_at ?? undefined })
      }
    }
    return out.length ? out : null
  } catch {
    backoffUntil = now + 5 * 60_000
    return null
  }
}

async function apply($: EngineInterface, context: number | undefined, limits: SessionRateLimit[] | null, source: Gauge['source'], isReply: boolean) {
  const now = await $.clock.now()
  const prev = await read($, gauge)
  const ctx = context ?? prev.context
  if (isReply && ctx !== null) {
    // a drop means the session was compacted: start the growth history over
    if (history.length && ctx < history[history.length - 1]! - 5) history = []
    history.push(ctx)
    history = history.slice(-12)
  }
  const t = turnsLeft(history, ctx)
  const windows = limits && limits.length ? toWindows(limits, now) : prev.windows.map(w => ({ ...w, projected: project(w.kind, w.percent, w.resetsAt, now) }))
  const next: Gauge = { context: ctx, growth: t.growth, turnsLeft: t.left, windows, source: limits && limits.length ? source : prev.source, readAt: now }
  await update($, gauge, () => next)

  const a = advice(ctx)
  const five = windows.find(w => w.kind === 'five_hour')
  const week = windows.find(w => w.kind === 'seven_day')
  $.ui.status(`Context ${pct(ctx)} | 5h ${pct(five?.percent ?? null)} | week ${pct(week?.percent ?? null)} | ${a.text}`)

  const level = ctx === null ? 0 : ctx >= NEW_SESSION_AT ? 2 : ctx >= COMPACT_AT ? 1 : 0
  const prior = await read($, warned)
  if (level > prior) {
    $.ui.toast(level === 2 ? `Context ${pct(ctx)}: start a new session` : `Context ${pct(ctx)}: compact at the next break`)
  }
  if (level !== prior) await update($, warned, () => level)
}

// Live limits when Anthropic's usage service answers; otherwise the limits the last reply
// carried, so the gauge has figures at once (a cloud session's live read is refused).
async function refreshLive($: EngineInterface) {
  const live = await fetchLimits($)
  let context: number | undefined
  let fromReply: SessionRateLimit[] = []
  try {
    const usage = await $.session.usage()
    context = usage.context.percent
    fromReply = usage.rateLimits
  } catch {
    context = undefined
  }
  if (live) await apply($, context, live, 'live', false)
  else await apply($, context, fromReply.length ? fromReply : null, 'reply', false)
}

function compactNow($: EngineInterface): void {
  if (isCompacting) return
  isCompacting = true
  $.clock.after(0, async () => {
    try {
      await $.command.run({ command: 'compact' })
    } finally {
      isCompacting = false
    }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'gauge', description: 'Print the session gauge (context, 5h and weekly limits, projections); /gauge on or off shows or hides the band' })
    const r = await next(e)
    history = []
    await refreshLive($)
    $.clock.every(LIVE_EVERY_MS, () => void refreshLive($))
    return r
  })

  on('session.measure', async ($, e, next) => {
    await apply($, e.context.percent, e.rateLimits, 'reply', e.changed.includes('context'))
    return next(e)
  })

  // /gauge prints the readout as a reply, which shows on every surface (a cloud session in the
  // desktop app draws no band); /gauge on and /gauge off show or hide the band where one is drawn.
  on('command.run', { command: 'gauge' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await update($, isOn, () => arg === 'on')
      return { text: arg === 'on' ? 'Session gauge band on.' : 'Session gauge band off.' }
    }
    return { text: readout(await read($, gauge), await $.clock.now()) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isOn))) return next(e)
    const g = await read($, gauge)
    const open = await read($, isOpen)
    const now = await $.clock.now()
    const { Box, Text, Button } = $.ui.resolve(e)
    const a = advice(g.context)
    const five = g.windows.find(w => w.kind === 'five_hour')
    const week = g.windows.find(w => w.kind === 'seven_day')
    const limitText = (w: Window | undefined, kind: Window['kind']) =>
      w ? `${LABEL[kind]} ${pct(w.percent)}${w.resetsAt ? ` (resets in ${until(w.resetsAt - now)})` : ''}` : `${LABEL[kind]} --`
    const projText = (w: Window | undefined, kind: Window['kind']) =>
      w && w.projected !== null ? `${LABEL[kind]} on pace for ~${Math.round(w.projected)}% at reset (projected)` : `${LABEL[kind]} projection --`

    return (
      <Box flexDirection="column">
        <Box>
          <Text dimColor>Context </Text>
          <Text color={a.color} bold>{pct(g.context)}</Text>
          <Text color={a.color}>{`  ${a.text}`}</Text>
          <Text dimColor>{`  |  ${limitText(five, 'five_hour')}  |  ${limitText(week, 'seven_day')}  `}</Text>
          <Button key="compact" label="Compact" onPress={() => compactNow($)} />
          <Text> </Text>
          <Button key="more" label={open ? 'Less' : 'More'} onPress={() => update($, isOpen, v => !v)} />
        </Box>
        {open ? (
          <Box flexDirection="column">
            <Text dimColor>
              {g.turnsLeft !== null
                ? `~${g.turnsLeft} replies until ${NEW_SESSION_AT}% at ~${g.growth!.toFixed(1)} points per reply (projected from the last replies)`
                : 'Replies left: needs two more replies to estimate'}
            </Text>
            <Text dimColor>{`${projText(five, 'five_hour')}  |  ${projText(week, 'seven_day')}`}</Text>
            <Text dimColor>{`Limits read ${g.source === 'live' ? 'live from Anthropic' : g.source === 'reply' ? 'from the last reply' : 'not yet'}; context bands: compact from ${COMPACT_AT}%, new session from ${NEW_SESSION_AT}%`}</Text>
          </Box>
        ) : null}
      </Box>
    )
  })
}
