// CONFIRM WHAT SHE LEARNED (2026-11-10).
//
// Most of what Eve holds was never said to her on purpose: it was overheard in a Slack room or
// concluded in her nightly reflection, and nobody ever looked at it. Those rows are UNCONFIRMED
// (lib/eve/memory.ts isPendingMemory): she may still recall one when it bears on a question, tagged
// as unconfirmed, but it never reads as a standing rule. This file is the other half — the list a
// person works through in Settings → Eve → Memory, grouped by building, each with the words it came
// from:
//
//   APPROVE  a person now stands behind it. The row becomes theirs (source 'jon' for the owner,
//            'staff' for a named teacher), at their tier's weight, and stops fading with time. Where
//            it was heard, when, and who confirmed it stay on the row (evidence), so the prompt can
//            say "overheard in #vr-ops, Nov 3 — confirmed by Jon, Nov 10".
//   EDIT     the same, with the wording corrected first.
//   REJECT   it leaves every prompt (expired today, marked rejected with who and when). Nothing is
//            deleted, and if the rooms say it again it is recognised as the same rejected thought
//            rather than learned afresh.
//
// Only the owner and the named teachers approve: an approval is what turns hearsay into a rule.
// No new column — the state lives in evidence.status ('pending' | 'confirmed' | 'rejected').
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildingOf } from '@/lib/segments'
import { pageRows } from './ctx'
import { isPendingMemory } from './memory'
import { teacherSource, type Teacher } from './teachers'

export type PendingFact = {
  id: string
  kind: string
  text: string
  why: string | null
  scope: string
  weight: number
  source: string
  created_at: string
  /** 'slack' — overheard in a room; 'reflection' — her own nightly conclusion; 'eve' — anything else she filed herself. */
  origin: 'slack' | 'reflection' | 'eve'
  /** The words it came from, as far as they were kept. */
  quote: { where: string; speaker: string | null; at: string | null; text: string | null; permalink: string | null }
  /** The person-written memory this one disputes, when the write-time check found one. */
  disputes: { id: string; text: string } | null
}

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const evOf = (r: any): Record<string, any> => (r?.evidence && typeof r.evidence === 'object' && !Array.isArray(r.evidence) ? r.evidence : {})

/** Who may approve: the owner and the named teachers (lib/eve/teachers.ts), nobody else. */
export function mayApprove(t: Teacher | null | undefined): boolean {
  return !!t && t.teacher && (t.tier === 'jon' || t.tier === 'named')
}

function originOf(r: any): PendingFact['origin'] {
  const ev = evOf(r)
  if (str(r.source) === 'slack' || ev.learned_from === 'slack') return 'slack'
  if (ev.from === 'sleep') return 'reflection'
  return 'eve'
}

/** Every live unconfirmed row, newest first. Rows only; no grouping. */
async function pendingRows(): Promise<any[]> {
  const db = supabaseAdmin()
  const today = new Date().toISOString().slice(0, 10)
  const { rows } = await pageRows<any>((a, b) => db.from('eve_memory')
    .select('id,kind,text,why,scope,weight,source,confidence,evidence,created_by,created_at,expires_on')
    .is('superseded_by', null).in('source', ['slack', 'eve'])
    .order('created_at', { ascending: false }).order('id').range(a, b), 4)
  return rows.filter(r => !(r.expires_on && str(r.expires_on) < today) && isPendingMemory(r))
}

/** How many are waiting. 0 on any failure, so a badge never breaks a page. */
export async function countPending(): Promise<number> {
  try { return (await pendingRows()).length } catch { return 0 }
}

export async function listPending(limit = 300): Promise<{ total: number; shown: number; groups: { group: string; items: PendingFact[] }[] }> {
  const db = supabaseAdmin()
  const all = await pendingRows()
  const rows = all.slice(0, Math.max(1, Math.min(limit, 600)))

  // A unit-scoped fact is listed under its building.
  const unitIds = Array.from(new Set(rows.map(r => str(r.scope)).filter(s => s.startsWith('unit:')).map(s => s.slice(5))))
  const unitBuilding: Record<string, string> = {}
  if (unitIds.length) {
    try {
      const { data } = await db.from('guesty_listings').select('id,nickname,title,building').in('id', unitIds.slice(0, 300))
      for (const l of ((data || []) as any[])) unitBuilding[str(l.id)] = buildingOf(str(l.building), str(l.nickname || l.title)) || 'Other units'
    } catch { /* they fall under "Other units" */ }
  }
  // The person-written rows these dispute, so the list can show both sides.
  const disputedIds = Array.from(new Set(rows.map(r => str(evOf(r).conflicts_with)).filter(Boolean)))
  const disputed: Record<string, string> = {}
  if (disputedIds.length) {
    try {
      const { data } = await db.from('eve_memory').select('id,text').in('id', disputedIds.slice(0, 200))
      for (const m of ((data || []) as any[])) disputed[str(m.id)] = str(m.text).slice(0, 300)
    } catch { /* shown without the other side */ }
  }

  const groupOf = (r: any): string => {
    const sc = str(r.scope)
    if (sc.startsWith('building:')) return sc.slice(9) || 'Other'
    if (sc.startsWith('unit:')) return unitBuilding[sc.slice(5)] || 'Other units'
    if (sc.startsWith('channel:')) return 'Channel rules'
    if (sc.startsWith('person:')) return 'People'
    return 'Whole portfolio'
  }
  const by: Record<string, PendingFact[]> = {}
  for (const r of rows) {
    const ev = evOf(r)
    const origin = originOf(r)
    const room = ev.channel_name ? '#' + str(ev.channel_name).replace(/^#/, '') : ''
    const fact: PendingFact = {
      id: str(r.id), kind: str(r.kind), text: str(r.text), why: r.why ? str(r.why) : null, scope: str(r.scope),
      weight: Number(r.weight) || 0, source: str(r.source), created_at: str(r.created_at), origin,
      quote: {
        where: origin === 'slack' ? (room || (/#\S+/.exec(str(r.why)) || [''])[0] || 'Slack') : origin === 'reflection' ? 'her nightly reflection' : 'her own note',
        speaker: ev.speaker ? str(ev.speaker).slice(0, 60) : null,
        at: ev.said_at ? str(ev.said_at) : (ev.day ? str(ev.day) : null),
        text: ev.quote ? str(ev.quote).slice(0, 400) : null,
        permalink: ev.permalink ? str(ev.permalink).slice(0, 300) : null,
      },
      disputes: ev.conflicts_with && disputed[str(ev.conflicts_with)] ? { id: str(ev.conflicts_with), text: disputed[str(ev.conflicts_with)] } : null,
    }
    const g = groupOf(r)
    ;(by[g] = by[g] || []).push(fact)
  }
  const last = ['Whole portfolio', 'Channel rules', 'People', 'Other units', 'Other']
  const groups = Object.keys(by)
    .sort((a, b) => (last.indexOf(a) - last.indexOf(b)) || (by[b].length - by[a].length) || a.localeCompare(b))
    .map(g => ({ group: g, items: by[g] }))
  return { total: all.length, shown: rows.length, groups }
}

/**
 * Approve: the row becomes the approver's, at their tier's weight, with where it came from kept.
 * `text` (single id only) corrects the wording first. Rows that are not waiting are skipped.
 */
export async function approvePending(ids: string[], approver: { email: string; teacher: Teacher }, opts: { text?: string } = {}): Promise<{ ok: boolean; approved: number; skipped: number; error?: string }> {
  if (!mayApprove(approver.teacher)) return { ok: false, approved: 0, skipped: 0, error: 'Only Jon or a named teacher can approve what she learned.' }
  const want = Array.from(new Set((ids || []).map(String).filter(Boolean))).slice(0, 300)
  if (!want.length) return { ok: false, approved: 0, skipped: 0, error: 'nothing selected' }
  const db = supabaseAdmin()
  const t = teacherSource(approver.teacher, 8)
  const now = new Date().toISOString()
  const today = now.slice(0, 10)
  const newText = want.length === 1 && opts.text != null ? str(opts.text).trim().slice(0, 1000) : ''
  if (opts.text != null && want.length === 1 && newText.length < 8) return { ok: false, approved: 0, skipped: 0, error: 'Say a little more — one sentence she can follow.' }
  try {
    const { data, error } = await db.from('eve_memory')
      .select('id,text,weight,source,confidence,evidence,created_by,created_at,expires_on,superseded_by').in('id', want)
    if (error) return { ok: false, approved: 0, skipped: 0, error: error.message.slice(0, 200) }
    const rows = ((data || []) as any[]).filter(r => !r.superseded_by && !(r.expires_on && str(r.expires_on) < today) && isPendingMemory(r))
    let approved = 0
    for (let i = 0; i < rows.length; i += 10) {
      const res = await Promise.all(rows.slice(i, i + 10).map(async r => {
        const ev = evOf(r)
        const origin = originOf(r)
        const patch: any = {
          source: t.source,
          created_by: approver.email,
          weight: Math.min(10, Math.max(Number(r.weight) || 0, t.weight)),
          confidence: Math.max(Number(r.confidence) || 0, t.source === 'jon' ? 0.95 : 0.85),
          evidence: {
            ...ev, status: 'confirmed', verified_by: approver.email, verified_at: now,
            learned_from: origin === 'slack' ? 'slack' : 'reflection', learned_at: ev.learned_at || r.created_at,
            original_source: str(r.source), original_created_by: r.created_by || null,
            ...(t.source === 'staff' ? { teacher: approver.teacher.label || approver.email } : {}),
            ...(newText && newText !== str(r.text) ? { original_text: str(r.text).slice(0, 1000) } : {}),
          },
          updated_at: now,
        }
        if (newText) patch.text = newText
        const up = await db.from('eve_memory').update(patch).eq('id', r.id).is('superseded_by', null)
        return !up.error
      }))
      approved += res.filter(Boolean).length
    }
    return { ok: true, approved, skipped: want.length - approved }
  } catch (e: any) { return { ok: false, approved: 0, skipped: 0, error: String(e?.message || e).slice(0, 200) } }
}

/** Reject: out of every prompt from today, marked with who and when. Never deleted. */
export async function rejectPending(ids: string[], approver: { email: string; teacher: Teacher }): Promise<{ ok: boolean; rejected: number; error?: string }> {
  if (!mayApprove(approver.teacher)) return { ok: false, rejected: 0, error: 'Only Jon or a named teacher can reject what she learned.' }
  const want = Array.from(new Set((ids || []).map(String).filter(Boolean))).slice(0, 300)
  if (!want.length) return { ok: false, rejected: 0, error: 'nothing selected' }
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  // Yesterday, not today: a row is read as live through the day it expires on, and a rejected one leaves at once.
  const gone = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
  try {
    const { data, error } = await db.from('eve_memory').select('id,source,evidence,expires_on,superseded_by').in('id', want)
    if (error) return { ok: false, rejected: 0, error: error.message.slice(0, 200) }
    // Only what is actually waiting: a person's memory is never retired from this list.
    const rows = ((data || []) as any[]).filter(r => !r.superseded_by && isPendingMemory(r))
    let rejected = 0
    for (let i = 0; i < rows.length; i += 10) {
      const res = await Promise.all(rows.slice(i, i + 10).map(async r => {
        const up = await db.from('eve_memory').update({
          expires_on: gone, updated_at: now,
          evidence: { ...evOf(r), status: 'rejected', rejected_by: approver.email, rejected_at: now },
        }).eq('id', r.id).in('source', ['slack', 'eve'])
        return !up.error
      }))
      rejected += res.filter(Boolean).length
    }
    return { ok: true, rejected }
  } catch (e: any) { return { ok: false, rejected: 0, error: String(e?.message || e).slice(0, 200) } }
}
