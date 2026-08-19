// ARRIVAL-DAY GMAIL DRAFTS for front-desk notices (Jon, 2026-08-18):
//
//   "Can we auto draft messages for the reservation front desk notices in the inbox the day of
//    arrival to share with the buildings."
//
// Every morning, each of TODAY's arrivals that has a notice on the desk and hasn't been sent gets
// a ready-to-send DRAFT in the configured Gmail mailbox — the same subject and body the desk's
// Draft button builds, addressed to the building. The human job left is: open Drafts, glance,
// send. Drafting rather than sending is deliberate: a building email that goes out wrong is a
// front-desk incident, so a person stays on the trigger.
//
// Exactly-once per notice via reservation_notices.draft_created_at. A notice already SENT (or
// marked sent in Guesty by the pull) never gets a draft. Elser-style PDF attachments cannot ride
// along automatically yet — those drafts get a bold reminder line at the top instead.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getSetting } from './app-settings'
import { mergeProperties, RESERVATION_EMAILS_KEY, type PropertyEmail } from './reservation-emails'
import { buildDraft, type Notice } from './reservation-draft'
import { draftGmail, draftStatus, foundInSent, deleteDraft, type GmailAttachment } from './gmail-send'
import { getTaskAutomation, type TaskAutomationCfg } from './auto-inspections'
import { elserPdfBase64 } from './elser-pdf'
import { getToken } from './guesty'
import { writeCustomFields, readCustomFields, fieldIdOf } from './guesty-custom-fields'

const str = (v: any) => typeof v === 'string' ? v : (v == null ? '' : String(v))
function ymdET(d: Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ── jsPDF ON THE SERVER, TWO WAYS (Jon, 2026-08-19: "please be able to attach the form, it
// should work"). First choice: the npm package, bundled with the function. If the serverless
// bundle ever drops it, fall back to fetching the UMD build from the CDN and evaluating it —
// Node cannot import an https URL, but it can run the fetched CommonJS body. Either way a
// failure now carries a real message into the cron's errors[] instead of dying silently.
let _srvJsPdf: any = null
async function loadServerJsPdf(): Promise<any> {
  if (_srvJsPdf) return _srvJsPdf
  try {
    const m: any = await import('jspdf')
    const ctor = m.jsPDF || m.default?.jsPDF || m.default
    if (ctor) { _srvJsPdf = ctor; return ctor }
  } catch (e) { console.error('notice-drafts: npm jspdf import failed, trying CDN', e) }
  const r = await fetch('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', { cache: 'no-store' })
  if (!r.ok) throw new Error('jsPDF unavailable: npm import failed and CDN answered ' + r.status)
  const code = await r.text()
  const mod: any = { exports: {} }
  const fn = new Function('module', 'exports', 'window', 'self', code + '\nreturn module.exports;')
  const out = fn(mod, mod.exports, undefined, undefined)
  const ctor = (out && (out.jsPDF || out.default?.jsPDF)) || mod.exports?.jsPDF
  if (!ctor) throw new Error('jsPDF UMD loaded but did not expose a constructor')
  _srvJsPdf = ctor
  return ctor
}

// Same field ids app/api/reservation-notices/mark-sent uses (proved against live bookings
// 2026-07-31 — see that route for why discovery-by-name does not work on this account).
const EMAIL_SENT_FIELD = '68dd868bcc0af00010bd8ebe'
const RES_NOTES_FIELD = '695f16830cb54c001400b3ff'
const isNotes = (c: any): boolean =>
  String(fieldIdOf(c) || '') === RES_NOTES_FIELD || /reservation[_ ]?notes/i.test(String(c?.fieldName || ''))

/**
 * SENT-DETECTION + GUESTY WRITE-BACK (Jon, 2026-08-19: "once sent, it should mark it in Guesty
 * as sent"). Gmail deletes a draft when it is sent, so each hourly run checks the drafts it
 * created: draft gone + a matching message in Sent = the team sent it. That marks the notice sent
 * locally AND ticks Guesty's "reservation email sent" flag + appends the dated Reservation-Notes
 * line — the exact same write the desk's Mark-sent button does, attributed 'CC' (customer care).
 * A draft that is gone but NOT in Sent was deleted unsent — it is re-armed so the next hourly run
 * drafts it again rather than letting a building silently go untold.
 */
async function reconcileSentDrafts(db: any, cfg: TaskAutomationCfg, props: PropertyEmail[], out: { sentDetected: number; rearmed: number; errors: string[] }) {
  const { data: rows } = await db.from('reservation_notices').select('*')
    .not('draft_id', 'is', null).not('draft_created_at', 'is', null).is('sent_at', null).is('deleted_at', null)
    .limit(40)
  const pById: Record<string, PropertyEmail> = {}
  for (const p of props) pById[p.id] = p
  for (const n of (rows || []) as any[]) {
    try {
      const st = await draftStatus(cfg.noticeDrafts.fromEmail, str(n.draft_id))
      // SELF-HEALING (Jon, 2026-08-19: "delete drafts you generated without them"): a draft that
      // still exists but is missing its required form (doc_path empty on an attachPdf property —
      // set only when the PDF actually rode along) is defective. Discard it and re-arm; the pass
      // below re-drafts it complete. An already-SENT draft is never touched.
      if (st === 'exists') {
        const p0 = pById[str(n.property_id)]
        if (p0?.attachPdf && !str(n.doc_name) && !str(n.doc_path)) {
          const gone = await deleteDraft(cfg.noticeDrafts.fromEmail, str(n.draft_id))
          if (gone) { await db.from('reservation_notices').update({ draft_id: null, draft_created_at: null }).eq('id', n.id); out.rearmed++ }
        }
        continue
      }
      if (st !== 'gone') continue
      const p = pById[str(n.property_id)]
      const subject = p ? buildDraft(p, n as Notice).subject : ''
      const since = Math.floor(new Date(n.draft_created_at).getTime() / 1000) - 3600
      const sent = subject ? await foundInSent(cfg.noticeDrafts.fromEmail, subject, since) : null
      if (sent === false) {
        // Deleted without sending — re-arm so the notice is drafted again, not lost.
        await db.from('reservation_notices').update({ draft_id: null, draft_created_at: null }).eq('id', n.id)
        out.rearmed++
        continue
      }
      if (sent !== true) continue   // could not verify — try again next hour, never guess
      const nowIso = new Date().toISOString()
      await db.from('reservation_notices').update({ sent_at: nowIso, sent_by: 'CC', updated_at: nowIso }).eq('id', n.id)
      out.sentDetected++
      // Guesty write-back, best-effort — the local record stands whatever Guesty does next.
      try {
        const rid = str(n.reservation_id)
        if (!rid) continue
        const token = await getToken().catch(() => '')
        if (!token) throw new Error('no Guesty token')
        const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
        const line = '[' + stamp + '] ' + (p?.name || str(n.property_id) || 'Building') + ' arrival email sent by CC (support inbox)'
        const live = await readCustomFields(rid, token)
        if (live === null) throw new Error('could not read the booking')
        const existingNote = live.find((c: any) => isNotes(c))
        const prior = existingNote && typeof existingNote.value === 'string' ? existingNote.value : ''
        const newNotes = prior.includes(line) ? prior : (prior ? prior + '\n' + line : line)
        const notesId = existingNote ? (fieldIdOf(existingNote) || RES_NOTES_FIELD) : RES_NOTES_FIELD
        const res = await writeCustomFields(rid, token, [
          { fieldId: EMAIL_SENT_FIELD, value: true },
          { fieldId: notesId, value: newNotes },
        ])
        if (!res.ok) throw new Error(res.note || 'write failed')
      } catch (e: any) {
        if (out.errors.length < 5) out.errors.push('guesty mark-sent ' + str(n.unit_no) + ': ' + String(e?.message || e).slice(0, 120))
      }
    } catch { /* next hour retries */ }
  }
}

export async function runNoticeDrafts(opts: { dryRun?: boolean } = {}): Promise<{
  ok: boolean; enabled: boolean; today: string; due: number; drafted: number; skipped: number; failed: number
  sentDetected: number; rearmed: number; errors: string[]
}> {
  const cfg = await getTaskAutomation()
  const today = ymdET(new Date())
  const base = { ok: true, enabled: cfg.noticeDrafts.enabled, today, due: 0, drafted: 0, skipped: 0, failed: 0, sentDetected: 0, rearmed: 0, errors: [] as string[] }
  if (!cfg.noticeDrafts.enabled && !opts.dryRun) return base

  const db = supabaseAdmin()
  const props: PropertyEmail[] = mergeProperties(await getSetting<any>(RESERVATION_EMAILS_KEY, null))

  // First: settle yesterday's-and-today's open drafts — sent ones get marked (here + Guesty),
  // deleted-unsent ones get re-armed so the pass below re-drafts them.
  if (!opts.dryRun) { try { await reconcileSentDrafts(db, cfg, props, base) } catch { /* drafting still runs */ } }

  const { data: rows } = await db.from('reservation_notices').select('*')
    .eq('arrival_date', today).is('deleted_at', null).is('sent_at', null).is('draft_created_at', null)
    .limit(100)
  const due = (rows || []) as any[]
  base.due = due.length
  if (!due.length || opts.dryRun) return base

  const pById: Record<string, PropertyEmail> = {}
  for (const p of props) pById[p.id] = p
  const draftedList: { unit: string; guest: string; property: string; form: boolean }[] = []

  // jsPDF for the server, loaded lazily on first use (see loadServerJsPdf below — npm first,
  // CDN UMD as the fallback, and a real error message if both fail).
  let jsPdfCtor: any = null

  for (const n of due) {
    const p = pById[str(n.property_id)]
    if (!p || !p.enabled || !str(p.to).trim()) { base.skipped++; continue }
    try {
      const d = buildDraft(p, n as Notice)

      // THE FORM RIDES ALONG (Jon, 2026-08-19: "why are the PDFs not attaching to the email
      // drafts"). For attachPdf properties (Elser), the registration form is generated server-side
      // and attached to the draft — and filed in the document store so the desk shows WHERE the
      // form lives, same as when a human builds it. The red "attach it yourself" line now appears
      // only if generation genuinely failed.
      let attachments: GmailAttachment[] | undefined
      let attachFailed = false
      let docName: string | null = null
      let docPath: string | null = null
      if (d.attach) {
        try {
          if (!jsPdfCtor) jsPdfCtor = await loadServerJsPdf()
          const b64 = await elserPdfBase64(n as Notice, undefined, jsPdfCtor)
          const bytes = Buffer.from(b64, 'base64')
          attachments = [{ filename: d.attachName, contentType: 'application/pdf', content: bytes }]
          // doc_name = the PDF made it onto the draft; doc_path additionally = filed in storage.
          docName = d.attachName
          try {
            // Same bucket + key scheme as /api/reservation-notices/document.
            await db.storage.createBucket('reservation-docs', { public: false }).catch(() => {})
            const key = 'reservations/' + str(n.id) + '.pdf'
            const up = await db.storage.from('reservation-docs').upload(key, bytes, { contentType: 'application/pdf', upsert: true })
            if (!up.error) docPath = key
            else if (base.errors.length < 6) base.errors.push('form filing ' + str(n.unit_no) + ': ' + str(up.error.message).slice(0, 100))
          } catch { /* the attachment on the draft is the part that matters */ }
        } catch (e: any) {
          attachFailed = true
          if (base.errors.length < 6) base.errors.push('form for ' + str(n.unit_no) + ': ' + String(e?.message || e).slice(0, 140))
          console.error('notice-drafts: form generation failed for', n.id, e)
        }
      }

      const reminder = attachFailed
        ? `<p style="color:#b91c1c;font-weight:bold">⚠ The form could not be generated automatically — attach ${esc(d.attachName)} before sending. (Delete this line.)</p>`
        : ''
      const html = reminder + '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;white-space:pre-wrap">' + esc(d.body) + '</div>'
      const r = await draftGmail({
        fromEmail: cfg.noticeDrafts.fromEmail,
        to: d.to.split(',').map(s => s.trim()).filter(Boolean),
        cc: d.cc.split(',').map(s => s.trim()).filter(Boolean),
        subject: d.subject, html, attachments,
      })
      if (!r.ok) throw new Error(r.error || 'draft failed')
      await db.from('reservation_notices').update({
        draft_created_at: new Date().toISOString(), draft_id: r.draftId || null,
        ...(docName ? { doc_name: docName } : {}), ...(docPath ? { doc_path: docPath } : {}),
      }).eq('id', n.id)
      base.drafted++
      draftedList.push({ unit: str(n.unit_no), guest: str(n.guest_name), property: str(p.name), form: !!attachments })
    } catch (e: any) {
      base.failed++
      if (base.errors.length < 5) base.errors.push(str(n.unit_no) + ': ' + String(e?.message || e).slice(0, 140))
    }
  }

  // TELL THE TEAM (Jon, 2026-08-19: "draft and then notify in customer care channel"). One message
  // per run that actually drafted something — the hourly checks between 7am and midnight stay
  // silent unless a NEW draft landed, so the channel hears news, not heartbeat.
  if (base.drafted > 0 && cfg.noticeDrafts.slackChannel) {
    try {
      const { postToChannel } = await import('./slack')
      const lines = draftedList.map(x =>
        `• *${x.unit}* — ${x.guest.split(' ')[0] || 'Guest'} (${x.property}${x.form ? ', registration form attached' : ''})`)
      const msg = `📬 *Front-desk notice draft${base.drafted === 1 ? '' : 's'} ready* — ${base.drafted} new in ${cfg.noticeDrafts.fromEmail}'s Gmail Drafts for today's arrivals:\n`
        + lines.join('\n')
        + `\nReview and send to the building${base.drafted === 1 ? '' : 's'}.`
      const res = await postToChannel(cfg.noticeDrafts.slackChannel, msg)
      if (!res.ok) base.errors.push('slack notify: ' + (res.error || 'failed') + (res.error === 'not_in_channel' ? ' — invite the Lighthouse bot to the channel' : ''))
    } catch (e: any) { base.errors.push('slack notify: ' + String(e?.message || e).slice(0, 120)) }
  }
  return base
}
