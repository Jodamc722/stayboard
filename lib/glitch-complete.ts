// A DONE TASK AND A TOLD GUEST CLOSE THE LOOP (independent audit 2026-10-10: "a done task never
// closes its glitch"). When the "it's sorted" note Eve drafted for a glitch is actually SENT — by a
// person, from Slack or from the thread page — the glitch is parked in manager_review with the whole
// story stamped on it, exactly as if the sender had pressed "complete" on the board (Jon, 2026-10-02:
// manager approval before a card closes). A manager approves it there; nothing closes on its own.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

export async function requestGlitchCompletion(glitchId: string, by: string, note: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  const id = str(glitchId).trim()
  if (!id) return { ok: false, error: 'no glitch id' }
  const db = supabaseAdmin()
  try {
    const { data: g } = await db.from('glitches').select('id,status,history').eq('id', id).maybeSingle()
    if (!g) return { ok: false, error: 'glitch not found' }
    const status = str((g as any).status)
    if (status === 'closed' || status === 'manager_review') return { ok: true, status }
    const hist = Array.isArray((g as any).history) ? (g as any).history.slice(-60) : []
    const history = hist.concat([{ at: new Date().toISOString(), by: by || 'team', action: 'completion_requested', note: str(note).slice(0, 300) }])
    const { error } = await db.from('glitches').update({ status: 'manager_review', history, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) return { ok: false, error: error.message }
    try { const { bustDay } = await import('./bust'); bustDay() } catch { /* fine */ }
    return { ok: true, status: 'manager_review' }
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 200) } }
}

/** The glitch a draft was written for, when it was ("glitch:<id>" on the draft's subject). */
export function glitchIdOfDraft(payload: any): string | null {
  const s = str(payload?.subject)
  return s.startsWith('glitch:') ? s.slice(7) : null
}
