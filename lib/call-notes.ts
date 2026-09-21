// FROM A RECORDED CALL TO A LINE ON THE BOOKING (2026-09-21).
//
// Jon: "track calls that we made with that guest and the data from those calls… it should live in
// the reservation level. We should push call notes to the reservation notes so that we can easily
// access whether the guest was called."
//
// So there are two places, deliberately different:
//
//   LIGHTHOUSE (talkroute_calls, shown as Contact history on the booking) keeps EVERYTHING — the
//   transcript, who asked what, what we promised, the recording, every attempt.
//
//   GUESTY reservation notes get a SUMMARY, because notes are an append-only text field shared with
//   everyone and anything noisy pollutes them permanently. The rules, agreed 2026-09-21:
//     · a call that connected            → one dated line with the two-sentence note
//     · a run of no-answers              → ONE line when the call closes ("Tried 3×, never reached"),
//                                          never one line per attempt
//     · a voicemail the GUEST left us    → one line with the first sentence of their message
//   Five lines tell the whole contact story of a stay; the detail is one click away in Lighthouse.
//
// The worker is idempotent at every step: transcript_status gates transcription, note_pushed_at
// gates the Guesty write, and both are set before the next stage runs.
import 'server-only'
import { trAllCallsSince, phoneDigits } from './talkroute'
import { transcribeUrl, transcriptScript, transcribeReady, getTranscribeSettings, transcribeFrom, TRANSCRIBE_DEFAULTS } from './transcribe'
import { readCall, type CallIntel } from './call-intel'
import { getToken as guestyToken } from './guesty'
import { appendReservationNote } from './guesty-res-notes'

const MATCH_LABEL: Record<string, string> = { welcome: 'Welcome call', post_checkout: 'Post-checkout call', stay: 'Guest call' }
const mins = (sec: number) => sec >= 60 ? `${Math.round(sec / 60)}m` : `${sec}s`

export type IntelReport = {
  considered: number; transcribed: number; summarised: number; notesPushed: number
  skipped: number; failed: number; expired: number; usd: number; errors: string[]; partial: boolean
}

/** Dollars spent on transcription today (ET), from our own rows — Deepgram has no per-call ledger. */
async function spentToday(sb: any): Promise<number> {
  try {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString()
    const { data } = await sb.from('talkroute_calls').select('cost_usd').gte('transcript_at', since).limit(2000)
    let usd = 0
    for (const r of (data || [])) usd += Number(r.cost_usd) || 0
    return Math.round(usd * 10000) / 10000
  } catch { return 0 }
}

/**
 * Re-read one call from Talkroute to mint a FRESH signed recording URL.
 *
 * The URL on a call record expires, so a transcript that failed because the link died cannot be
 * retried with the stored link — only with a new one. /call-history has no by-id lookup, so the
 * call is found by asking for a one-minute window around its start.
 */
async function freshRecordingUrl(callId: string, callAt: string): Promise<string> {
  try {
    const t = new Date(callAt).getTime()
    const rows = await trAllCallsSince(new Date(t - 60_000).toISOString(), 1)
    const hit = rows.find(r => String(r.id) === String(callId))
    return String(hit?.recording || '')
  } catch { return '' }
}

/**
 * The one line that goes into Guesty's reservation notes for a connected call.
 *
 * It does NOT repeat the call kind: appendReservationNote already writes "[date] <label> by
 * Talkroute: …", so a body starting "Guest call ·" produced "Guest call by Talkroute: Guest call ·"
 * in the live notes. The body opens with the direction and the length instead.
 */
export function noteLineFor(call: any, intel: CallIntel | null): string {
  const dir = call.direction === 'inbound' ? 'guest called in' : 'we called'
  const head = `${dir} · ${mins(Number(call.duration) || 0)}`
  const body = intel?.summary ? intel.summary : 'Connected; no note recorded.'
  const promised = intel?.promised?.length ? ` · We promised: ${intel.promised.join('; ')}.` : ''
  const issues = intel?.issues?.length ? ` · Flagged: ${intel.issues.join('; ')}.` : ''
  return `${head} — ${body}${promised}${issues}`.slice(0, 900)
}

/**
 * The queue worker. Walks recorded calls that are matched to a booking, transcribes, reads, and
 * pushes the note. Time-boxed like the rest of the Talkroute sync: it stops cleanly and the next
 * run picks up exactly where it left off, because every stage is recorded on the row.
 */
export async function processCallIntel(sb: any, opts: { deadline?: number; limit?: number } = {}): Promise<IntelReport> {
  const rep: IntelReport = { considered: 0, transcribed: 0, summarised: 0, notesPushed: 0, skipped: 0, failed: 0, expired: 0, usd: 0, errors: [], partial: false }
  const deadline = opts.deadline || (Date.now() + 40_000)
  const over = () => Date.now() > deadline
  const s = await getTranscribeSettings()
  const ready = await transcribeReady()
  const minSeconds = Number(s.minSeconds) || TRANSCRIBE_DEFAULTS.minSeconds
  const cap = Number(s.usdPerDay ?? TRANSCRIBE_DEFAULTS.usdPerDay)
  let spend = await spentToday(sb)

  // ONLY FROM THE BOUNDARY DAY ONWARD (Jon, 2026-09-21: "only record call moving forward or from
  // today"). Calls older than this are never transcribed — not skipped-and-retried, simply out of
  // scope — so switching transcription on never pays to read a back catalogue.
  const from = await transcribeFrom()
  const fromIso = new Date(from + 'T00:00:00-05:00').toISOString()

  // The queue: matched calls that connected, newest first.
  const { data: rows } = await sb.from('talkroute_calls')
    .select('id,direction,call_at,duration,result,recorded,recording_url,transcript,transcript_status,transcript_tries,summary,intel,reservation_id,match_kind,note_pushed_at,external_name')
    .not('reservation_id', 'is', null)
    .eq('result', 'answered')
    .gte('call_at', fromIso)
    .or('transcript_status.is.null,transcript_status.eq.pending')
    .order('call_at', { ascending: false })
    .limit(opts.limit || 40)

  for (const c of (rows || [])) {
    if (over()) { rep.partial = true; break }
    rep.considered++
    const seconds = Number(c.duration) || 0
    try {
      // ── 1. Should this call be transcribed at all? ──────────────────────────────────────────
      if (!c.recorded) { await mark(sb, c.id, { transcript_status: 'none' }); rep.skipped++; }
      else if (seconds < minSeconds) { await mark(sb, c.id, { transcript_status: 'skipped', transcript_error: `Under ${minSeconds}s` }); rep.skipped++ }
      else if (!ready) { rep.skipped++; continue }          // no key: leave it pending for later
      else if (cap > 0 && spend >= cap) { rep.skipped++; rep.errors.push(`Daily transcription cap $${cap} reached`); break }
      else if (!c.transcript) {
        // ── 2. Transcribe. A dead signed URL is re-minted once from Talkroute. ────────────────
        let url = String(c.recording_url || '')
        let t = url ? await transcribeUrl(url, { timeoutMs: Math.max(8_000, Math.min(60_000, deadline - Date.now() - 4_000)) }) : null
        if (!t || t.status === 'expired') {
          url = await freshRecordingUrl(String(c.id), String(c.call_at))
          if (url) t = await transcribeUrl(url, { timeoutMs: Math.max(8_000, Math.min(60_000, deadline - Date.now() - 4_000)) })
        }
        if (!t) { await mark(sb, c.id, { transcript_status: 'expired', transcript_tries: (c.transcript_tries || 0) + 1, transcript_error: 'No recording URL available.' }); rep.expired++; continue }
        if (!t.ok) {
          const tries = (c.transcript_tries || 0) + 1
          // Three goes and it stays failed — a bad recording must not be retried forever.
          await mark(sb, c.id, { transcript_status: tries >= 3 ? 'failed' : 'pending', transcript_tries: tries, transcript_error: t.error || 'failed', recording_url: url || c.recording_url })
          if (t.status === 'expired') rep.expired++; else rep.failed++
          if (t.error) rep.errors.push(`call ${c.id}: ${t.error}`)
          continue
        }
        spend += t.usd; rep.usd += t.usd; rep.transcribed++
        c.transcript = transcriptScript(t.lines, t.text)
        await mark(sb, c.id, {
          transcript: c.transcript, transcript_status: 'done', transcript_at: new Date().toISOString(),
          audio_seconds: t.seconds, cost_usd: t.usd, transcript_error: null, recording_url: url || c.recording_url,
          recording_seen_at: new Date().toISOString(),
        })
      }

      // ── 3. Read it. ───────────────────────────────────────────────────────────────────────
      let intel: CallIntel | null = (c.intel && typeof c.intel === 'object') ? c.intel as CallIntel : null
      if (c.transcript && !intel && !over()) {
        const { data: res } = await sb.from('guesty_reservations').select('guest_name,listing_name,check_in,check_out').eq('id', c.reservation_id).maybeSingle()
        const r = await readCall(String(c.transcript), {
          guest: res?.guest_name || c.external_name || '', unit: res?.listing_name || '',
          checkIn: res?.check_in || '', checkOut: res?.check_out || '',
          kind: String(c.match_kind || ''), direction: String(c.direction || ''), seconds,
        })
        if (r.ok) {
          intel = r.intel; rep.summarised++
          await mark(sb, c.id, { intel, summary: r.intel.summary, summary_at: new Date().toISOString() })
        } else if (r.error) rep.errors.push(`read ${c.id}: ${r.error}`)
      }

      // ── 4. One line to Guesty. ────────────────────────────────────────────────────────────
      if (!c.note_pushed_at && (intel || c.transcript_status === 'skipped' || c.transcript_status === 'none') && !over()) {
        const line = noteLineFor(c, intel)
        const r = await pushNote(sb, String(c.reservation_id), MATCH_LABEL[String(c.match_kind || '')] || 'Guest call', line)
        if (r.ok) { await mark(sb, c.id, { note_line: line, note_pushed_at: new Date().toISOString(), note_error: null }); rep.notesPushed++ }
        else { await mark(sb, c.id, { note_error: r.error || 'note push failed' }); rep.errors.push(`note ${c.id}: ${r.error}`) }
      }
    } catch (e: any) { rep.failed++; rep.errors.push(`call ${c.id}: ${String(e?.message || e).slice(0, 140)}`) }
  }
  rep.usd = Math.round(rep.usd * 10000) / 10000
  return rep
}

async function mark(sb: any, id: string, patch: Record<string, any>) {
  try { await sb.from('talkroute_calls').update(patch).eq('id', id) } catch { /* the next pass retries */ }
}

/** Append one line to the booking's Reservation Notes in Guesty. */
export async function pushNote(sb: any, reservationId: string, label: string, line: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: r } = await sb.from('guesty_reservations').select('custom_fields, raw').eq('id', reservationId).maybeSingle()
    if (!r) return { ok: false, error: 'reservation not found' }
    const current: any[] = Array.isArray(r.custom_fields) ? r.custom_fields : (Array.isArray(r.raw?.customFields) ? r.raw.customFields : [])
    const token = await guestyToken()
    const out = await appendReservationNote({ reservationId, token, current, label, by: 'Talkroute', note: line })
    if (!out.ok) return { ok: false, error: out.note || 'write failed' }
    // Mirror the merged array so the app shows the note before the next reservations sync.
    if (out.fields) {
      try { await sb.from('guesty_reservations').update({ custom_fields: out.fields, raw: { ...(r.raw || {}), customFields: out.fields } }).eq('id', reservationId) } catch { /* mirror best-effort */ }
    }
    return { ok: true }
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 160) } }
}

/**
 * THE ATTEMPT-RUN LINE. Called by the nightly close-out for a call that ended its window without
 * connecting: one line saying how many times we tried, instead of the N lines a per-attempt push
 * would have left behind.
 */
export async function pushAttemptRunNote(sb: any, reservationId: string, kind: 'welcome' | 'post_checkout', attempts: number): Promise<boolean> {
  if (attempts < 1) return false
  try {
    const { data: g } = await sb.from('guest_calls').select('attempts_note_at').eq('reservation_id', reservationId).eq('kind', kind).maybeSingle()
    if (g?.attempts_note_at) return false
    const label = kind === 'welcome' ? 'Welcome call' : 'Post-checkout call'
    const when = kind === 'welcome' ? 'before arrival' : 'after checkout'
    const line = `Tried ${attempts}×${attempts === 1 ? '' : ''} ${when} — never reached.`
    const r = await pushNote(sb, reservationId, label, line)
    if (!r.ok) return false
    await sb.from('guest_calls').update({ attempts_note_at: new Date().toISOString(), attempts_note_line: line }).eq('reservation_id', reservationId).eq('kind', kind)
    return true
  } catch { return false }
}

/**
 * A voicemail the GUEST left us, as one note line. Their own words are the most valuable thing on
 * the phone — a complaint is usually in the first sentence.
 */
export async function pushVoicemailNote(sb: any, vm: any): Promise<boolean> {
  if (!vm?.reservation_id || vm.note_pushed_at) return false
  const t = String(vm.transcript || '').replace(/\s+/g, ' ').trim()
  const first = t ? (t.match(/^.{0,220}?[.!?](\s|$)/)?.[0] || t.slice(0, 220)).trim() : ''
  const line = first ? `Guest left a voicemail (${mins(Number(vm.duration) || 0)}): "${first}"` : `Guest left a voicemail (${mins(Number(vm.duration) || 0)}) — no transcript.`
  const r = await pushNote(sb, String(vm.reservation_id), 'Voicemail', line)
  if (!r.ok) return false
  try { await sb.from('talkroute_voicemails').update({ note_pushed_at: new Date().toISOString() }).eq('id', vm.id) } catch { /* best effort */ }
  return true
}
