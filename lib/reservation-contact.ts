// CONTACT HISTORY FOR ONE BOOKING (2026-09-21).
//
// Jon: "track calls that we made with that guest and the data from those calls… it should live in
// the reservation level."
//
// Every time anyone from Stay and this guest were in touch, in one list: calls (with what was said),
// texts, voicemails, and the desk's own call log. This is the deep record; Guesty's notes get the
// summary lines (lib/call-notes). Read-only and fail-soft — a booking must still render if the
// phone tables are unreachable.
import 'server-only'
import { formatPhone, phoneKey } from './talkroute'
import type { CallIntel } from './call-intel'

export type ContactCall = {
  kind: 'call'
  id: string
  at: string
  direction: 'inbound' | 'outbound'
  result: string
  seconds: number
  matchKind: string
  recorded: boolean
  transcriptStatus: string
  transcript: string
  summary: string
  intel: CallIntel | null
  notePushed: boolean
}
export type ContactText = { kind: 'text'; id: string; at: string; direction: 'incoming' | 'outgoing'; body: string; by: string }
export type ContactVoicemail = { kind: 'voicemail'; id: string; at: string; seconds: number; transcript: string; audio: string }
export type ContactEvent = ContactCall | ContactText | ContactVoicemail

export type ContactHistory = {
  events: ContactEvent[]
  phone: string
  phoneDisplay: string
  /** the desk's own record for this booking, both kinds */
  log: { kind: string; outcome: string; attempts: number; calledBy: string; calledAt: string; note: string; source: string }[]
  totals: { calls: number; answered: number; talkSeconds: number; texts: number; voicemails: number }
  /** everything anyone promised the guest on a call, newest first — the follow-up list */
  promised: { at: string; item: string }[]
  openIssues: string[]
  lastContactAt: string
}

const iso = (v: any) => { const t = new Date(String(v || '')).getTime(); return Number.isFinite(t) ? new Date(t).toISOString() : '' }
const EMPTY: ContactHistory = {
  events: [], phone: '', phoneDisplay: '', log: [],
  totals: { calls: 0, answered: 0, talkSeconds: 0, texts: 0, voicemails: 0 },
  promised: [], openIssues: [], lastContactAt: '',
}

export async function loadContactHistory(sb: any, reservationId: string, guestPhone?: string | null): Promise<ContactHistory> {
  try {
    const key = phoneKey(guestPhone || '')
    // Calls, voicemails and the desk log are keyed to the booking by the matcher. Texts are keyed
    // to the NUMBER (a text thread has no booking of its own), so they come in by phone — which is
    // also why a booking with no phone on file shows calls but no texts.
    const [{ data: calls }, { data: vms }, { data: log }, convos] = await Promise.all([
      sb.from('talkroute_calls')
        .select('id,direction,call_at,duration,result,recorded,match_kind,transcript,transcript_status,summary,intel,note_pushed_at')
        .eq('reservation_id', reservationId).order('call_at', { ascending: true }).limit(200),
      sb.from('talkroute_voicemails')
        .select('id,created_at,duration,transcript,audio_link')
        .eq('reservation_id', reservationId).order('created_at', { ascending: true }).limit(50),
      sb.from('guest_calls')
        .select('kind,outcome,attempts,called_by,called_at,note,source')
        .eq('reservation_id', reservationId).limit(10),
      key
        ? sb.from('talkroute_conversations').select('id').eq('contact_number', key.length === 10 ? '1' + key : key).limit(5)
        : Promise.resolve({ data: [] }),
    ])
    const convoIds = ((convos as any)?.data || []).map((c: any) => String(c.id))
    const { data: texts } = convoIds.length
      ? await sb.from('talkroute_texts').select('id,direction,body,user_email,sent_at').in('conversation_id', convoIds).order('sent_at', { ascending: true }).limit(400)
      : { data: [] }

    const events: ContactEvent[] = []
    const totals = { calls: 0, answered: 0, talkSeconds: 0, texts: 0, voicemails: 0 }
    const promised: { at: string; item: string }[] = []
    const openIssues: string[] = []

    for (const c of (calls || [])) {
      const intel: CallIntel | null = (c.intel && typeof c.intel === 'object') ? c.intel : null
      const at = iso(c.call_at)
      totals.calls++
      if (String(c.result) === 'answered') { totals.answered++; totals.talkSeconds += Number(c.duration) || 0 }
      for (const p of (intel?.promised || [])) promised.push({ at, item: p })
      for (const i of (intel?.issues || [])) if (openIssues.indexOf(i) < 0) openIssues.push(i)
      events.push({
        kind: 'call', id: String(c.id), at,
        direction: c.direction === 'outbound' ? 'outbound' : 'inbound',
        result: String(c.result || ''), seconds: Number(c.duration) || 0,
        matchKind: String(c.match_kind || ''), recorded: !!c.recorded,
        transcriptStatus: String(c.transcript_status || ''), transcript: String(c.transcript || ''),
        summary: String(c.summary || ''), intel, notePushed: !!c.note_pushed_at,
      })
    }
    for (const v of (vms || [])) {
      totals.voicemails++
      events.push({ kind: 'voicemail', id: String(v.id), at: iso(v.created_at), seconds: Number(v.duration) || 0, transcript: String(v.transcript || ''), audio: String(v.audio_link || '') })
    }
    for (const t of (texts || [])) {
      totals.texts++
      events.push({ kind: 'text', id: String(t.id), at: iso(t.sent_at), direction: t.direction === 'outgoing' ? 'outgoing' : 'incoming', body: String(t.body || ''), by: String(t.user_email || '') })
    }
    events.sort((a, b) => a.at.localeCompare(b.at))
    promised.reverse()
    return {
      events, phone: key, phoneDisplay: formatPhone(key.length === 10 ? '1' + key : key),
      log: (log || []).map((l: any) => ({
        kind: String(l.kind || ''), outcome: String(l.outcome || ''), attempts: Number(l.attempts) || 0,
        calledBy: String(l.called_by || ''), calledAt: iso(l.called_at), note: String(l.note || ''), source: String(l.source || ''),
      })),
      totals, promised: promised.slice(0, 12), openIssues: openIssues.slice(0, 8),
      lastContactAt: events.length ? events[events.length - 1].at : '',
    }
  } catch { return EMPTY }
}
