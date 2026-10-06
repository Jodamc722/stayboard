'use client'
// OPS HEALTH, SHARED (Jon, 2026-10-06: "the health score can be part of the bulletin board too so
// it's not taking up more space … make it a part of the slide"). The score is computed where its
// inputs live — DayKpis, from the same counts as the tiles (lib/ops-health) — and published here;
// the Bulletin board renders it as its first postcard. A dimension chip on the card still opens the
// tile behind it, through the opener DayKpis registers.
import { useSyncExternalStore } from 'react'
import type { OpsHealth } from '@/lib/ops-health'

type State = { health: OpsHealth | null; open: ((tile: string) => void) | null }
let state: State = { health: null, open: null }
let sig = ''
const subs = new Set<() => void>()

export function publishHealth(health: OpsHealth, open: (tile: string) => void) {
  const next = JSON.stringify([health.score, health.band, health.headline, health.dims.map(d => [d.key, d.score, d.why])])
  if (next === sig && state.open) { state.open = open; return }
  sig = next
  state = { health, open }
  subs.forEach(f => f())
}
export function useHealth(): State {
  return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f) } }, () => state, () => state)
}
