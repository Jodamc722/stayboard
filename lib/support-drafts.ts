// SUPPORT DRAFTS WATCH — close the loop between Gmail and the board (Jon, 2026-08-17: "if the
// email is sent it should mark sent in app").
//
// "Add to drafts" records {noticeId, gmailDraftId, the exact to/cc/subject/body} here. On every
// board load the watch list is checked against Gmail: a draft that has LEFT the Drafts folder was
// sent (or knowingly deleted — the desk treats both as handled), so the notice is marked sent in
// the app with the frozen copy, and Guesty gets the same flag + note the manual Mark-sent writes.
// A draft still sitting in Drafts changes nothing. 'unknown' (token/network trouble) changes
// nothing either — this only ever acts on a definite 404.
import 'server-only'
import { getSetting, setSetting } from './app-settings'
import { checkGmailDraftExists } from './gmail-send'
import { supabaseAdmin } from './supabase-admin'
import { getToken } from './guesty'
import { writeCustomFields, readCustomFields, fieldIdOf } from './guesty-custom-fields'

const KEY = 'support_draft_watch'
const SUPPORT_FROM = 'support@stay-hospitality.com'
const TABLE = 'reservation_notices'
// Same hardcoded Guesty field ids as /api/reservation-notices/mark-sent (proved 2026-07-31).
const EMAIL_SENT_FIELD = '68dd868bcc0af00010bd8ebe'
const RES_NOTES_FIELD = '695f16830cb54c001400b3ff'

export type DraftWatch = {
  nid: string; draftId: string; at: string
  to: string; cc: string; subject: string; body: string
}

export async function watchSupportDraft(entry: DraftWatch): Promise<void> {
  const cur = await getSetting<DraftWatch[]>(KEY, []).catch(() => [] as DraftWatch[])
  const list = (Array.isArray(cur) ? cur : []).filter(w => w && w.nid !== entry.nid)
  list.push(entry)
  // Cap the watch list; anything older than 30 days is stale paper, not a pending send.
  const cutoff = Date.now() - 30 * 864e5
  const trimmed = list.filter(w => new Date(w.at).getTime() > cutoff).slice(-100)
  await setSetting(KEY, trimmed, 'support-drafts').catch(() => null)
}

async function guestyMarkSent(reservationId: string, building: string): Promise<void> {
  try {
    const token = await getToken().catch(() => '')
    if (!token) return
    const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
    const line = '[' + stamp + '] ' + (building || 'Building') + ' arrival email sent from support@ (Gmail draft)'
    const live = await readCustomFields(reservationId, token)
    if (live === null) return
    const isNotes = (c: any) => String(fieldIdOf(c) || '') === RES_NOTES_FIELD || /reservation[_ ]?notes/i.test(String(c?.fieldName || ''))
    const existing = live.find(isNotes)
    const prior = existing && typeof existing.value === 'string' ? existing.value : ''
    const notes = prior.includes(line) ? prior : (prior ? prior + '\n' + line : line)
    await writeCustomFields(reservationId, token, [
      { fieldId: EMAIL_SENT_FIELD, value: true },
      { fieldId: existing ? (fieldIdOf(existing) || RES_NOTES_FIELD) : RES_NOTES_FIELD, value: notes },
    ])
  } catch { /* best effort — the app record stands regardless */ }
}

// ── AUTO-DRAFT ON ARRIVAL DAY (Jon, 2026-08-17: "auto draft them for the day of arrival") ────
// Every cron pass: for each of TODAY'S unsent notices with a configured recipient, create the
// support@ Gmail draft — addressed, written, registration form attached when one is filed — so
// the desk opens Gmail in the morning and the day's emails are already sitting in Drafts.
//
// Once per notice, never a stream of duplicates: a notice already in the watch list (draft still
// sitting in Drafts) is skipped, and a draft that LEFT Drafts was marked sent by the sweep above,
// which sets sent_at — also skipped. Deleting the draft in Gmail therefore counts as handled, not
// as a request for another copy tomorrow.
export async function autoDraftTodaysNotices(): Promise<{ considered: number; drafted: number; skipped: number; failed: number }> {
  const { getSetting: gs } = await import('./app-settings')
  const { RESERVATION_EMAILS_KEY, mergeProperties } = await import('./reservation-emails')
  const { buildDraft } = await import('./reservation-draft')
  const { createGmailDraft } = await import('./gmail-send')
  const db = supabaseAdmin()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const { data: rows } = await db.from(TABLE)
    .select('*').is('deleted_at', null).is('sent_at', null).eq('arrival_date', today).limit(60)
  const notices = (rows || []) as any[]
  if (!notices.length) return { considered: 0, drafted: 0, skipped: 0, failed: 0 }
  const watch = await getSetting<DraftWatch[]>(KEY, []).catch(() => [] as DraftWatch[])
  const watched: Record<string, boolean> = {}
  for (const w of (Array.isArray(watch) ? watch : [])) if (w && w.nid) watched[w.nid] = true
  let props: any[] = []
  try { props = mergeProperties(await gs<any>(RESERVATION_EMAILS_KEY, null)) } catch { /* no config, nothing to draft */ }
  let drafted = 0, skipped = 0, failed = 0
  for (const n of notices) {
    if (watched[String(n.id)]) { skipped++; continue }
    const prop = props.find((x: any) => x.id === n.property_id)
    if (!prop || !(prop.to || '').trim()) { skipped++; continue }
    let d: any
    try { d = buildDraft(prop, n) } catch { failed++; continue }
    const to = String(d.to || '').split(/[,;]+/).map((x: string) => x.trim()).filter(Boolean)
    const cc = String(d.cc || '').split(/[,;]+/).map((x: string) => x.trim()).filter(Boolean)
    if (!to.length) { skipped++; continue }
    const escT = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const html = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;white-space:pre-wrap">' + escT(String(d.body || '')) + '</div>'
    const attachments: { filename: string; content: Buffer; contentType: string }[] = []
    if (n.doc_path) {
      try {
        const dl = await db.storage.from('reservation-docs').download(String(n.doc_path))
        if (dl.data) attachments.push({ filename: String(n.doc_name || 'registration-form.pdf'), content: Buffer.from(await dl.data.arrayBuffer()), contentType: 'application/pdf' })
      } catch { /* draft still goes; the board flags a missing form */ }
    }
    const r = await createGmailDraft({ fromEmail: SUPPORT_FROM, to, cc, subject: String(d.subject || ''), html, attachments: attachments.length ? attachments : undefined })
    if (r.ok && r.id) {
      await watchSupportDraft({ nid: String(n.id), draftId: r.id, at: new Date().toISOString(), to: to.join(', '), cc: cc.join(', '), subject: String(d.subject || ''), body: String(d.body || '') }).catch(() => null)
      drafted++
    } else failed++
  }
  return { considered: notices.length, drafted, skipped, failed }
}

/** Check every watched draft; mark the sent ones. Returns how many were closed out. */
export async function checkSupportDrafts(): Promise<{ checked: number; markedSent: number }> {
  const cur = await getSetting<DraftWatch[]>(KEY, []).catch(() => [] as DraftWatch[])
  const list = Array.isArray(cur) ? cur.filter(w => w && w.nid && w.draftId) : []
  if (!list.length) return { checked: 0, markedSent: 0 }
  const db = supabaseAdmin()
  const keep: DraftWatch[] = []
  let marked = 0
  for (const w of list) {
    const state = await checkGmailDraftExists(SUPPORT_FROM, w.draftId)
    if (state !== 'gone') { keep.push(w); continue }
    // The draft left Gmail's Drafts — record the send with the exact frozen copy.
    try {
      const { data: notice } = await db.from(TABLE).select('id,sent_at,reservation_id,property_id').eq('id', w.nid).maybeSingle()
      if (notice && !(notice as any).sent_at) {
        const now = new Date().toISOString()
        const patch: any = {
          sent_at: now, sent_by: 'SUPPORT@', updated_at: now,
          sent_to: w.to, sent_cc: w.cc, sent_subject: w.subject, sent_body: w.body,
        }
        let { error } = await db.from(TABLE).update(patch).eq('id', w.nid)
        if (error && /column .* does not exist|schema cache|sent_body/i.test(String(error.message || ''))) {
          await db.from(TABLE).update({ sent_at: now, sent_by: 'SUPPORT@', updated_at: now }).eq('id', w.nid)
        }
        if ((notice as any).reservation_id) await guestyMarkSent(String((notice as any).reservation_id), String((notice as any).property_id || ''))
        marked++
      }
    } catch { keep.push(w); continue }
  }
  await setSetting(KEY, keep, 'support-drafts').catch(() => null)
  return { checked: list.length, markedSent: marked }
}
