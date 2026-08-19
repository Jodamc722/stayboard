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
import { draftGmail, draftStatus, deleteDraft, foundInSent, listGmailDrafts, type GmailAttachment } from './gmail-send'
import { getToken as getGuestyToken } from './guesty'
import { writeCustomFields, readCustomFields, fieldIdOf } from './guesty-custom-fields'
import { getTaskAutomation, type TaskAutomationCfg } from './auto-inspections'
import { elserPdfBase64 } from './elser-pdf'
// ONE SYSTEM, TWO SESSIONS' PARTS (2026-08-19). A parallel session built the support-draft WATCH:
// every 20 minutes (and on board load) it checks Gmail for drafts that left the Drafts folder and
// marks those notices sent — locally AND in Guesty. This engine therefore only DRAFTS (with the
// generated form + the Slack note) and REGISTERS each draft on that watch; it never marks sent
// itself, so Guesty is written by exactly one code path.
import { watchSupportDraft, checkSupportDrafts } from './support-drafts'
import { getSetting as getAppSetting, setSetting as setAppSetting } from './app-settings'

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
 * DEFECTIVE-DRAFT REPAIR (Jon, 2026-08-19: "delete drafts you generated without them"). A notice
 * whose draft is missing its required registration form (no doc marker on an attachPdf property)
 * is defective — possibly TWICE, because for one morning two auto-drafters ran side by side and
 * each filed its own PDF-less copy. The repair deletes EVERY draft tied to the notice (the one on
 * the notice row and any on the support-draft watch), removes the watch entries IN THE SAME PASS
 * (so "left Drafts" can never be misread as "sent"), and re-arms the notice — the drafting pass
 * below then files exactly one complete draft, form attached, watch registered.
 */
async function repairDefectiveDrafts(db: any, cfg: TaskAutomationCfg, props: PropertyEmail[], out: { rearmed: number; errors: string[] }) {
  const { data: rows } = await db.from('reservation_notices').select('*')
    .not('draft_id', 'is', null).not('draft_created_at', 'is', null).is('sent_at', null).is('deleted_at', null)
    .limit(40)
  const pById: Record<string, PropertyEmail> = {}
  for (const p of props) pById[p.id] = p
  let watch: any[] = []
  try {
    const w = await getAppSetting<any[]>('support_draft_watch', [])
    watch = Array.isArray(w) ? w : []
  } catch { return /* cannot read the watch — deleting anything would risk a false "sent" */ }

  const defective = ((rows || []) as any[]).filter(n => {
    const p0 = pById[str(n.property_id)]
    return p0?.attachPdf && !str(n.doc_name) && !str(n.doc_path)
  })
  if (!defective.length) return
  // UN-WATCH FIRST. The watch reads "left Drafts" as "sent", so the entries must be gone BEFORE
  // any draft is deleted — otherwise a sweep landing between the two steps stamps a building as
  // told when it never was. If this write fails, delete nothing.
  const bad = new Set(defective.map(n => str(n.id)))
  try {
    const res = await setAppSetting('support_draft_watch', watch.filter((w: any) => !bad.has(str(w?.nid))), 'notice-drafts repair')
    if (!res?.ok) return
  } catch { return }

  for (const n of defective) {
    try {
      // Every draft this notice owns, deduped: the row's own + any watch entries it had.
      const ids = Array.from(new Set(
        [str(n.draft_id), ...watch.filter((w: any) => str(w?.nid) === str(n.id)).map((w: any) => str(w?.draftId))].filter(Boolean)
      ))
      let allGone = true
      for (const id of ids) {
        const st = await draftStatus(cfg.noticeDrafts.fromEmail, id)
        if (st === 'exists') { if (!(await deleteDraft(cfg.noticeDrafts.fromEmail, id))) allGone = false }
        else if (st === 'error') allGone = false
      }
      if (!allGone) continue   // couldn't clear everything — unwatched now, retried next run
      await db.from('reservation_notices').update({ draft_id: null, draft_created_at: null }).eq('id', n.id)
      out.rearmed++
    } catch { /* next run retries */ }
  }
}

/**
 * SENT-AUDIT + ORPHAN SWEEP (2026-08-19). The watch reads "draft left Drafts" as "sent" — but a
 * DELETED draft leaves Drafts too, and on the one morning two drafters duplicated every notice,
 * a desk cleaning up the doubles looks exactly like a send. Gmail's Sent folder settles it:
 *   - subject found in Sent   → the building really was told (without the form — reported).
 *   - subject NOT in Sent     → nobody was told: reopen the notice (clear sent + draft columns,
 *     correct the Guesty flag/note) so the pass below drafts it again, complete this time.
 * Then delete every PDF-less draft still in the folder whose subject belongs to one of these
 * notices — those are the untracked duplicate copies, and sending one would hit the building
 * with a form-less second email.
 */
async function auditSentAndOrphans(db: any, cfg: TaskAutomationCfg, props: PropertyEmail[], today: string,
  out: { reopened: number; confirmedSentNoForm: number; orphansDeleted: number; errors: string[] }) {
  const { data: rows } = await db.from('reservation_notices').select('*')
    .eq('arrival_date', today).is('deleted_at', null).not('sent_at', 'is', null).eq('sent_by', 'SUPPORT@')
    .limit(40)
  const pById: Record<string, PropertyEmail> = {}
  for (const p of props) pById[p.id] = p
  const since = Math.floor(Date.now() / 1000) - 48 * 3600
  const subjects: string[] = []
  for (const n of (rows || []) as any[]) {
    try {
      const p0 = pById[str(n.property_id)]
      if (!p0?.attachPdf) continue
      if (str(n.doc_name) || str(n.doc_path)) continue // went out complete — nothing to audit
      let subject = str(n.sent_subject)
      if (!subject) { try { subject = str(buildDraft(p0, n as Notice).subject) } catch { /* below */ } }
      if (!subject) continue
      subjects.push(subject)
      const inSent = await foundInSent(cfg.noticeDrafts.fromEmail, subject, since)
      if (inSent === true) { out.confirmedSentNoForm++; continue }
      if (inSent === null) { out.errors.push('sent-audit inconclusive for unit ' + str(n.unit_no)); continue }
      // Definitely not in Sent: the draft was deleted, not sent. Reopen so it re-drafts complete.
      await db.from('reservation_notices').update({ sent_at: null, sent_by: null, draft_id: null, draft_created_at: null }).eq('id', n.id)
      out.reopened++
      // Correct Guesty — the sweep stamped "email sent" there for a send that never happened.
      try {
        if (str(n.reservation_id)) {
          const token = await getGuestyToken().catch(() => '')
          if (token) {
            const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
            const line = '[' + stamp + '] Correction: the arrival email draft was deleted before sending — a new draft with the registration form is in support@ Drafts.'
            const live = await readCustomFields(str(n.reservation_id), token)
            if (live !== null) {
              const isNotes = (c: any) => String(fieldIdOf(c) || '') === '695f16830cb54c001400b3ff' || /reservation[_ ]?notes/i.test(String(c?.fieldName || ''))
              const existing = (live as any[]).find(isNotes)
              const prior = existing && typeof existing.value === 'string' ? existing.value : ''
              await writeCustomFields(str(n.reservation_id), token, [
                { fieldId: '68dd868bcc0af00010bd8ebe', value: false },
                { fieldId: existing ? (fieldIdOf(existing) || '695f16830cb54c001400b3ff') : '695f16830cb54c001400b3ff', value: prior.includes(line) ? prior : (prior ? prior + '\n' + line : line) },
              ])
            }
          }
        }
      } catch { /* best effort — the local reopen stands */ }
    } catch (e: any) { out.errors.push('sent-audit: ' + String(e?.message || e).slice(0, 120)) }
  }
  if (!subjects.length) return
  // Untracked duplicate copies still in Drafts: PDF-less + one of these subjects = delete.
  try {
    const drafts = await listGmailDrafts(cfg.noticeDrafts.fromEmail, 30)
    for (const d of drafts || []) {
      if (d.hasPdf || !d.subject) continue
      if (!subjects.includes(d.subject)) continue
      if (await deleteDraft(cfg.noticeDrafts.fromEmail, d.id)) out.orphansDeleted++
    }
  } catch (e: any) { out.errors.push('orphan-sweep: ' + String(e?.message || e).slice(0, 120)) }
}

export async function runNoticeDrafts(opts: { dryRun?: boolean } = {}): Promise<{
  ok: boolean; enabled: boolean; today: string; due: number; drafted: number; skipped: number; failed: number
  sentDetected: number; rearmed: number; reopened: number; confirmedSentNoForm: number; orphansDeleted: number; errors: string[]
}> {
  const cfg = await getTaskAutomation()
  const today = ymdET(new Date())
  const base = { ok: true, enabled: cfg.noticeDrafts.enabled, today, due: 0, drafted: 0, skipped: 0, failed: 0, sentDetected: 0, rearmed: 0, reopened: 0, confirmedSentNoForm: 0, orphansDeleted: 0, errors: [] as string[] }
  if (!cfg.noticeDrafts.enabled && !opts.dryRun) return base

  const db = supabaseAdmin()
  const props: PropertyEmail[] = mergeProperties(await getSetting<any>(RESERVATION_EMAILS_KEY, null))

  // First: run the support-draft sweep (marks sent drafts, here + Guesty), then repair any
  // defective PDF-less drafts, then audit today's form-less "sent" notices against Gmail's Sent
  // folder (reopening the ones whose draft was deleted, not sent) — so the pass below re-drafts
  // everything that still owes the building a complete email.
  if (!opts.dryRun) {
    try { const sw = await checkSupportDrafts(); base.sentDetected = sw.markedSent } catch { /* drafting still runs */ }
    try { await repairDefectiveDrafts(db, cfg, props, base) } catch { /* drafting still runs */ }
    try { await auditSentAndOrphans(db, cfg, props, today, base) } catch { /* drafting still runs */ }
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
