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
import { draftGmail, type GmailAttachment } from './gmail-send'
import { getTaskAutomation } from './auto-inspections'
import { elserPdfBase64 } from './elser-pdf'

const str = (v: any) => typeof v === 'string' ? v : (v == null ? '' : String(v))
function ymdET(d: Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function runNoticeDrafts(opts: { dryRun?: boolean } = {}): Promise<{
  ok: boolean; enabled: boolean; today: string; due: number; drafted: number; skipped: number; failed: number; errors: string[]
}> {
  const cfg = await getTaskAutomation()
  const today = ymdET(new Date())
  const base = { ok: true, enabled: cfg.noticeDrafts.enabled, today, due: 0, drafted: 0, skipped: 0, failed: 0, errors: [] as string[] }
  if (!cfg.noticeDrafts.enabled && !opts.dryRun) return base

  const db = supabaseAdmin()
  const { data: rows } = await db.from('reservation_notices').select('*')
    .eq('arrival_date', today).is('deleted_at', null).is('sent_at', null).is('draft_created_at', null)
    .limit(100)
  const due = (rows || []) as any[]
  base.due = due.length
  if (!due.length || opts.dryRun) return base

  const props: PropertyEmail[] = mergeProperties(await getSetting<any>(RESERVATION_EMAILS_KEY, null))
  const pById: Record<string, PropertyEmail> = {}
  for (const p of props) pById[p.id] = p

  // The npm jsPDF, loaded once per run, only when some property actually wants a form attached.
  // (lib/elser-pdf's own loader pulls from a CDN — a browser mechanism; on the server we hand the
  // real constructor in.)
  let jsPdfCtor: any = null
  if (due.some(n => pById[str(n.property_id)]?.attachPdf)) {
    try { const m: any = await import('jspdf'); jsPdfCtor = m.jsPDF || m.default?.jsPDF || m.default } catch (e) { console.error('notice-drafts: jspdf load failed', e) }
  }

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
      if (d.attach) {
        try {
          if (!jsPdfCtor) throw new Error('jspdf unavailable')
          const b64 = await elserPdfBase64(n as Notice, undefined, jsPdfCtor)
          const bytes = Buffer.from(b64, 'base64')
          attachments = [{ filename: d.attachName, contentType: 'application/pdf', content: bytes }]
          try {
            // Same bucket + key scheme as /api/reservation-notices/document.
            await db.storage.createBucket('reservation-docs', { public: false }).catch(() => {})
            const key = 'reservations/' + str(n.id) + '.pdf'
            const up = await db.storage.from('reservation-docs').upload(key, bytes, { contentType: 'application/pdf', upsert: true })
            if (!up.error) await db.from('reservation_notices').update({ doc_path: key, doc_name: d.attachName }).eq('id', n.id)
          } catch { /* the attachment on the draft is the part that matters */ }
        } catch (e) {
          attachFailed = true
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
      await db.from('reservation_notices').update({ draft_created_at: new Date().toISOString(), draft_id: r.draftId || null }).eq('id', n.id)
      base.drafted++
    } catch (e: any) {
      base.failed++
      if (base.errors.length < 5) base.errors.push(str(n.unit_no) + ': ' + String(e?.message || e).slice(0, 140))
    }
  }
  return base
}
