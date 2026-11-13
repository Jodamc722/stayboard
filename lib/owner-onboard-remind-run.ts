// Sending the owner reminders (rules: lib/owner-onboard-remind). Server-only.
import 'server-only'
import { listRecords, readRecord, saveRecord } from './owner-onboard-server'
import { emailMagicLink } from './owner-onboard-auth'
import { remindState, REMIND_LABEL, type RemindPlan } from './owner-onboard-remind'
import { notify } from './notify'
import type { OORecord } from './owner-onboard'

const push = (r: OORecord, e: NonNullable<OORecord['remind']>['log'][number]) => { r.remind = { ...(r.remind || {}), log: [...(r.remind?.log || []), e].slice(-120) } }

/** One reminder, sent and written to the record's log. The caller saves the record. */
export async function sendReminder(r: OORecord, p: RemindPlan, origin: string): Promise<{ ok: boolean; error?: string }> {
  const s = await emailMagicLink(r, origin, 'remind', p.owner, { kind: p.kind, n: p.n }).catch((e: any) => ({ ok: false, error: String(e?.message || e) }))
  if (s.ok) push(r, { at: new Date().toISOString(), kind: p.kind, owner: p.owner, to: p.email })
  return s
}

/** The daily pass: every open onboarding, every owner on it, whatever is due. `preview` sends nothing. */
export async function runReminders(o: { origin: string; preview?: boolean; now?: number }): Promise<{ checked: number; sent: any[]; escalated: any[]; failed: any[]; upcoming: any[] }> {
  const now = o.now || Date.now()
  const rows = (await listRecords()).filter(x => !x.archived && x.stage !== 'Live').slice(0, 400)
  const sent: any[] = [], escalated: any[] = [], failed: any[] = [], upcoming: any[] = []
  for (const x of rows) {
    if (sent.length >= 40) break                                    // a ceiling on one run, whatever the data says
    const r = await readRecord(x.code)
    if (!r) continue
    const st = remindState(r, now)
    if (!st.on) continue
    let dirty = false
    const where = [r.attach.property, r.attach.unitLabel ? 'Unit ' + r.attach.unitLabel : ''].filter(Boolean).join(' · ')
    for (const p of st.plans) {
      const row = { code: r.code, owner: p.name, to: p.email, kind: p.kind, n: p.n, where }
      if (!p.due) { upcoming.push({ ...row, dueAt: new Date(p.dueAt).toISOString() }); continue }
      if (o.preview) { sent.push({ ...row, preview: true }); continue }
      const s = await sendReminder(r, p, o.origin)
      if (s.ok) { sent.push(row); dirty = true } else failed.push({ ...row, error: s.error })
    }
    for (const e of st.escalate) {
      const row = { code: r.code, owner: e.name, kind: e.kind, where }
      escalated.push(o.preview ? { ...row, preview: true } : row)
      if (o.preview) continue
      try { await notify([r.createdBy, r.custom.gm.email, r.custom.from === 'sales' ? r.custom.sales.email : ''].filter(Boolean), { kind: 'owner_onboarding', title: `${e.name || 'An owner'} has not answered three reminders: ${REMIND_LABEL[e.kind].toLowerCase()}`, body: `${where || 'Owner onboarding'} — a call will probably do more than another email.`, link: '/owner-onboarding/' + r.code }) } catch { /* logged below either way */ }
      push(r, { at: new Date().toISOString(), kind: 'escalate', about: e.kind, owner: e.owner }); dirty = true
    }
    if (dirty) await saveRecord(r, 'reminders').catch(() => null)
  }
  return { checked: rows.length, sent, escalated, failed, upcoming }
}
