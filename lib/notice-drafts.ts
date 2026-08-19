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
import { draftGmail, draftStatus, deleteDraft, type GmailAttachment } from './gmail-send'
import { getTaskAutomation, type TaskAutomationCfg } from './auto-inspections'
import { elserPdfBase64 } from './elser-pdf'
// ONE SYSTEM, TWO SESSIONS' PARTS (2026-08-19). A parallel session built the support-draft WATCH:
// every 20 minutes (and on board load) it checks Gmail for drafts that left the Drafts folder and
// marks those notices sent — locally AND in Guesty. This engine therefore only DRAFTS (with the
// generated form + the Slack note) and REGISTERS each draft on that watch; it never marks sent
// itself, so Guesty is written by exactly one code path.
import { watchSupportDraft, checkSupportDrafts } from './support-drafts'
import { getSetting as getAppSetting } from './app-settings'

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

/**
 * DEFECTIVE-DRAFT REPAIR (Jon, 2026-08-19: "delete drafts you generated without them"). A draft
 * that still sits in Drafts but is missing its required form (no doc marker on an attachPdf
 * property) is defective — discard it and re-arm so the pass below re-drafts it complete.
 * SAFETY: never touch a draft that is on the support-draft WATCH list — the watch treats
 * "left Drafts" as "sent", so deleting a watched draft would falsely mark a building as told.
 */
async function repairDefectiveDrafts(db: any, cfg: TaskAutomationCfg, props: PropertyEmail[], out: { rearmed: number; errors: string[] }) {
  const { data: rows } = await db.from('reservation_notices').select('*')
    .not('draft_id', 'is', null).not('draft_created_at', 'is', null).is('sent_at', null).is('deleted_at', null)
    .limit(40)
  const pById: Record<string, PropertyEmail> = {}
  for (const p of props) pById[p.id] = p
  let watched = new Set<string>()
  try {
    const w = await getAppSetting<any[]>('support_draft_watch', [])
    watched = new Set((Array.isArray(w) ? w : []).map((x: any) => str(x?.nid)))
  } catch { /* treat as none watched — but then do not delete anything either */ return }
  for (const n of (rows || []) as any[]) {
    try {
      if (watched.has(str(n.id))) continue
      const p0 = pById[str(n.property_id)]
      if (!p0?.attachPdf || str(n.doc_name) || str(n.doc_path)) continue
      const st = await draftStatus(cfg.noticeDrafts.fromEmail, str(n.draft_id))
      if (st !== 'exists') continue
      const gone = await deleteDraft(cfg.noticeDrafts.fromEmail, str(n.draft_id))
      if (gone) { await db.from('reservation_notices').update({ draft_id: null, draft_created_at: null }).eq('id', n.id); out.rearmed++ }
    } catch { /* next run retries */ }
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

  // First: run the support-draft sweep (marks sent drafts, here + Guesty), then repair any
  // defective PDF-less drafts so the pass below re-drafts them complete.
  if (!opts.dryRun) {
    try { const sw = await checkSupportDrafts(); base.sentDetected = sw.markedSent } catch { /* drafting still runs */ }
    try { await repairDefectiveDrafts(db, cfg, props, base) } catch { /* drafting still runs */ }
  }

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
      // Register on the support-draft watch: the 20-minute sweep marks it sent (app + Guesty)
      // the moment it leaves Drafts, and the older auto-drafter skips notices it sees here.
      if (r.draftId) {
        try {
          await watchSupportDraft({
            nid: str(n.id), draftId: r.draftId, at: new Date().toISOString(),
            to: d.to, cc: d.cc, subject: d.subject, body: d.body,
          })
        } catch { /* the board-load sweep still covers it */ }
      }
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
