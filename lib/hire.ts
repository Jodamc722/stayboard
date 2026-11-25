// NEW HIRE FORM — storage and the two decisions (lib/hire-rules.ts has the rules and Jon's words).
//
// Kept in app_settings (`team_hire`): the link's code and what people have sent. A handful of hires a
// month is one small JSON row, and it needs no migration. Read fresh before every change, because two
// managers can decide at the same moment and the settings reader keeps a copy for a minute.
import 'server-only'
import { randomBytes } from 'crypto'
import { getSettingFresh, setSetting } from './app-settings'
import { notify } from './notify'
import { HIRE_SETTING, HIRE_TRACKS, cleanHireState, cleanHire, addRequest, pendingOf, decidedOf, crewKey, type HireState, type HireRequest, type HireError } from './hire-rules'

const newCode = () => randomBytes(9).toString('base64url')
const siteOrigin = () => (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/$/, '')
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
export const hireUrl = (code: string) => siteOrigin() + '/hire/' + code

async function read(): Promise<HireState> { return cleanHireState(await getSettingFresh<unknown>(HIRE_SETTING, null).catch(() => null)) }
async function write(s: HireState, by: string): Promise<void> { const r = await setSetting(HIRE_SETTING, s, by); if (!r.ok) throw new Error(r.error || 'could not save') }

/** The link, made the first time someone asks for it. */
export async function hireLink(by: string): Promise<{ code: string; url: string; codeAt: string }> {
  let s = await read()
  if (!s.code) { s = { ...s, code: newCode(), codeAt: new Date().toISOString() }; await write(s, by) }
  return { code: s.code, url: hireUrl(s.code), codeAt: s.codeAt }
}
/** A new link: the old one stops working at once. What is already waiting stays. */
export async function rotateHireLink(by: string): Promise<{ code: string; url: string; codeAt: string }> {
  const s = await read()
  const next = { ...s, code: newCode(), codeAt: new Date().toISOString() }
  await write(next, by)
  return { code: next.code, url: hireUrl(next.code), codeAt: next.codeAt }
}
export async function hireCodeValid(code: string): Promise<boolean> {
  const s = await read()
  return !!s.code && code === s.code
}

/** What the form sent. Saved as "waiting"; the people who can approve get a notice in Lighthouse. */
export async function submitHire(code: string, raw: any): Promise<{ ok: true } | { ok: false; error: HireError; status: number }> {
  const s = await read()
  if (!s.code || code !== s.code) return { ok: false, status: 404, error: { field: 'form', en: 'This link is not active. Ask your manager for the current link.', es: 'Este enlace no está activo. Pídele a tu gerente el enlace actual.' } }
  const c = cleanHire(raw, todayET())
  if (!c.ok) return { ok: false, status: 400, error: c.error }
  if (c.spam) return { ok: true }
  const id = 'h' + Date.now().toString(36) + randomBytes(3).toString('hex')
  const r = addRequest(s, c.hire, id, new Date().toISOString())
  if (r.full) return { ok: false, status: 429, error: { field: 'form', en: 'We cannot take this right now. Please tell your manager.', es: 'No podemos recibirlo en este momento. Por favor avisa a tu gerente.' } }
  await write(r.state, 'hire-form')
  if (!r.replaced) {
    try {
      const { rosterForPicker } = await import('./mentions')
      const admins = (await rosterForPicker()).filter(p => p.role === 'admin').map(p => p.email)
      const job = HIRE_TRACKS.find(t => t.key === c.hire.track)?.en || c.hire.track
      if (admins.length) await notify(admins, { kind: 'approval', title: `New hire form to approve: ${c.hire.name} (${job}, ${c.hire.market})`, link: '/training?tab=people', entity: { type: 'hire', id } })
    } catch { /* the list on Training → People is the record; the notice is a courtesy */ }
  }
  return { ok: true }
}

export async function listHires(by: string): Promise<{ link: { code: string; url: string; codeAt: string }; pending: HireRequest[]; decided: HireRequest[] }> {
  const link = await hireLink(by)
  const s = await read()
  return { link, pending: pendingOf(s), decided: decidedOf(s).slice(0, 12) }
}

type Edits = { name?: string; email?: string; phone?: string; track?: string; market?: string; startDate?: string | null }
/**
 * Approve: the person's record, their track's training and the invite email, in that order, through
 * the same `onboard` a manager uses by hand. Only then is the request marked approved, so a failure
 * leaves it waiting and says why. Before migration 182 the track cannot be saved; the person still
 * gets their record and the invite to their page, and the reply says what is missing.
 */
export async function approveHire(id: string, edits: Edits, by: string): Promise<{ ok: true; request: HireRequest; emailed: boolean; emailError?: string; assigned: number; note?: string } | { ok: false; error: string }> {
  const s = await read()
  const req = s.requests.find(r => r.id === id)
  if (!req) return { ok: false, error: 'That form is no longer on the list.' }
  if (req.status !== 'pending') return { ok: false, error: `Already ${req.status}${req.decidedBy ? ' by ' + req.decidedBy : ''}.` }
  // A manager may correct what was typed before approving; everything is checked the same way as the form.
  const c = cleanHire({ ...req, ...Object.fromEntries(Object.entries(edits || {}).filter(([, v]) => v !== undefined)) }, todayET())
  if (!c.ok) return { ok: false, error: c.error.en }
  const h = c.hire
  const tm = await import('./team-member')
  let personKey = '', emailed = false, emailError: string | undefined, assigned = 0, note: string | undefined
  const r = await tm.onboard({ name: h.name, email: h.email, phone: h.phone, track: h.track, market: h.market, lang: h.lang, startDate: h.startDate }, by)
  if (r.ok) { personKey = r.person.key; emailed = r.emailed; emailError = r.emailError; assigned = r.assigned }
  else if (/migration/i.test(r.error)) {
    const { ensurePerson, updatePerson } = await import('./training')
    let p = await ensurePerson({ key: crewKey(h.name), name: h.name, email: h.email, dept: h.track, market: h.market, lang: h.lang })
    if (p.email !== h.email || p.lang !== h.lang) p = (await updatePerson(p.key, { email: h.email, lang: h.lang })) || p
    const inv = await tm.sendInvite(p, by)
    personKey = p.key; emailed = inv.ok; emailError = inv.error
    note = `Their page and invite are set up. Their role track and training list need migration ${tm.MIGRATION} run in Supabase.`
  } else return { ok: false, error: r.error }
  // Read again before writing: someone else may have decided another line in the meantime.
  const now = await read()
  const done: HireRequest = { ...req, ...h, status: 'approved', decidedBy: by, decidedAt: new Date().toISOString(), personKey, invite: emailed ? 'sent' : emailError ? 'failed' : 'none', ...(emailError ? { inviteError: emailError } : {}) }
  await write({ ...now, requests: now.requests.map(x => (x.id === id ? done : x)) }, by)
  return { ok: true, request: done, emailed, emailError, assigned, note }
}

/** Decline: nothing is created and nothing is sent to the person. */
export async function declineHire(id: string, noteIn: string, by: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await read()
  const req = s.requests.find(r => r.id === id)
  if (!req) return { ok: false, error: 'That form is no longer on the list.' }
  if (req.status !== 'pending') return { ok: false, error: `Already ${req.status}.` }
  await write({ ...s, requests: s.requests.map(x => (x.id === id ? { ...x, status: 'declined' as const, decidedBy: by, decidedAt: new Date().toISOString(), declineNote: String(noteIn || '').slice(0, 300) } : x)) }, by)
  return { ok: true }
}
