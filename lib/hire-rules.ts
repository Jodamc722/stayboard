// NEW HIRE FORM — the rules, with nothing imported, so the page, the server and plain node
// (lib/__tests__/hire-rules.test.mjs) read one copy.
//
// Jon, 2026-11-25: "Have it where we have a shareable link where they can fill out a form, only sent
// after hiring. They will add full name, email, phone number, etc. Then it will go for approval, then
// when approved will get access to their portal." And: "invite will be sent."
//
// THE ORDER, and nothing skips a step:
//   1. A manager sends the hire link (/hire/<code>) to someone who has been hired.
//   2. They fill in the form themselves: full name, email, phone, the job, the area, a start date,
//      someone to call in an emergency. English or Spanish.
//   3. It waits on Training → People for a manager to approve or decline. Until then the person has
//      nothing: no page, no link, no email.
//   4. Approve → their record is made, their track's training is assigned, and the invite email goes
//      out with the link to their own page (lib/team-member `onboard`, the same step a manager could
//      already do by hand).
// The form asks for nothing a new hire should not type into a web form: no ID numbers, no bank details.

export const HIRE_SETTING = 'team_hire'
export type Lang = 'en' | 'es'
export type HireTrack = 'housekeeping' | 'maintenance' | 'ops' | 'ccs_admin'
export const HIRE_TRACKS: { key: HireTrack; en: string; es: string }[] = [
  { key: 'housekeeping', en: 'Housekeeping', es: 'Limpieza' },
  { key: 'maintenance', en: 'Maintenance', es: 'Mantenimiento' },
  { key: 'ops', en: 'Supervisor / Operations', es: 'Supervisor / Operaciones' },
  { key: 'ccs_admin', en: 'Customer care / Office', es: 'Atención al cliente / Oficina' },
]
export const HIRE_MARKETS = ['Miami', 'Broward', 'North'] as const
export const MARKET_WORD: Record<string, { en: string; es: string }> = { Miami: { en: 'Miami', es: 'Miami' }, Broward: { en: 'Broward', es: 'Broward' }, North: { en: 'Palm Beach', es: 'Palm Beach' } }

export type HireFields = {
  name: string; email: string; phone: string; track: HireTrack; market: string; lang: Lang
  startDate: string | null; emergencyName: string; emergencyPhone: string; note: string
}
export type HireRequest = HireFields & {
  id: string; at: string; status: 'pending' | 'approved' | 'declined'
  decidedBy?: string; decidedAt?: string; declineNote?: string
  /** The person record made on approval, and whether the invite email went out. */
  personKey?: string; invite?: 'sent' | 'failed' | 'none'; inviteError?: string
}
export type HireState = { code: string; codeAt: string; requests: HireRequest[] }

const str = (v: unknown) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim()
export const phoneDigits = (v: unknown) => str(v).replace(/\D+/g, '')
/** 9545268998 → (954) 526-8998; anything else is kept as typed. */
export function nicePhone(v: unknown): string {
  const d = phoneDigits(v), n = d.length === 11 && d[0] === '1' ? d.slice(1) : d
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : str(v)
}
/** "maria LOPEZ  garcia" → "Maria Lopez Garcia". Names typed on a phone come in every case. */
export function niceName(v: unknown): string {
  const s = str(v).slice(0, 80)
  return s === s.toLowerCase() || s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s'-])(\S)/g, (_m, a, b) => a + b.toUpperCase()) : s
}

export type HireError = { field: keyof HireFields | 'form'; en: string; es: string }
const E = (field: HireError['field'], en: string, es: string): { ok: false; error: HireError } => ({ ok: false, error: { field, en, es } })

/**
 * What a person typed, checked and tidied. `website` is a field no person sees: a robot that fills
 * every box fills it, and is told "thank you" like anyone else while nothing is saved (`spam`).
 */
export function cleanHire(raw: any, today: string): { ok: true; hire: HireFields; spam: boolean } | { ok: false; error: HireError } {
  const r = raw && typeof raw === 'object' ? raw : {}
  const name = niceName(r.name)
  if (name.split(' ').filter(w => w.length >= 2).length < 2) return E('name', 'Please enter your full name, first and last.', 'Escribe tu nombre completo, nombre y apellido.')
  const email = str(r.email).toLowerCase().slice(0, 160)
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) return E('email', 'That email does not look right.', 'Ese correo no parece correcto.')
  const digits = phoneDigits(r.phone)
  if (digits.length < 10 || digits.length > 15) return E('phone', 'Please enter your phone number with the area code.', 'Escribe tu teléfono con el código de área.')
  const track = HIRE_TRACKS.find(t => t.key === r.track)
  if (!track) return E('track', 'Please pick your job.', 'Elige tu puesto.')
  if (!(HIRE_MARKETS as readonly string[]).includes(str(r.market))) return E('market', 'Please pick the area you will work in.', 'Elige el área donde vas a trabajar.')
  const sd = str(r.startDate)
  let startDate: string | null = null
  if (sd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sd) || isNaN(Date.parse(sd + 'T12:00:00Z'))) return E('startDate', 'That start date does not look right.', 'Esa fecha de inicio no parece correcta.')
    // A start date is this year or next, not a birthday typed into the wrong box.
    const days = (Date.parse(sd + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000
    if (days < -120 || days > 366) return E('startDate', 'That start date looks too far away. Leave it empty if you are not sure.', 'Esa fecha de inicio está muy lejos. Déjala vacía si no estás seguro.')
    startDate = sd
  }
  const ep = phoneDigits(r.emergencyPhone)
  if (ep && (ep.length < 10 || ep.length > 15)) return E('emergencyPhone', 'The emergency phone number needs the area code.', 'El teléfono de emergencia necesita el código de área.')
  return {
    ok: true, spam: !!str(r.website),
    hire: { name, email, phone: nicePhone(r.phone), track: track.key, market: str(r.market), lang: r.lang === 'en' ? 'en' : 'es', startDate, emergencyName: niceName(r.emergencyName), emergencyPhone: ep ? nicePhone(r.emergencyPhone) : '', note: str(r.note).slice(0, 500) },
  }
}

// ── What is kept ────────────────────────────────────────────────────────────────────────────────
/** More than this waiting at once is not hiring, it is someone abusing the link: the form stops taking new ones. */
export const MAX_PENDING = 60
const KEEP_DECIDED_DAYS = 90
export function cleanHireState(v: unknown): HireState {
  const s = (v && typeof v === 'object' ? v : {}) as Partial<HireState>
  return { code: str(s.code), codeAt: str(s.codeAt), requests: Array.isArray(s.requests) ? s.requests.filter(r => r && r.id && r.name) : [] }
}
export const pendingOf = (s: HireState) => s.requests.filter(r => r.status === 'pending').sort((a, b) => a.at.localeCompare(b.at))
export const decidedOf = (s: HireState) => s.requests.filter(r => r.status !== 'pending').sort((a, b) => String(b.decidedAt || b.at).localeCompare(String(a.decidedAt || a.at)))

/**
 * Add what someone sent. The same email already waiting is the same person sending it again (a typo
 * fixed, a second tap): the newer answers replace the older, and it stays one line to approve.
 */
export function addRequest(s: HireState, hire: HireFields, id: string, now: string): { state: HireState; replaced: boolean; full: boolean } {
  const cutoff = new Date(Date.parse(now) - KEEP_DECIDED_DAYS * 86400000).toISOString()
  const kept = s.requests.filter(r => r.status === 'pending' || String(r.decidedAt || r.at) > cutoff)
  const dup = kept.find(r => r.status === 'pending' && r.email === hire.email)
  if (dup) return { state: { ...s, requests: kept.map(r => (r === dup ? { ...r, ...hire, at: now } : r)) }, replaced: true, full: false }
  if (kept.filter(r => r.status === 'pending').length >= MAX_PENDING) return { state: { ...s, requests: kept }, replaced: false, full: true }
  return { state: { ...s, requests: kept.concat([{ ...hire, id, at: now, status: 'pending' }]) }, replaced: false, full: false }
}

/** The key a person record is filed under: the same one onboarding by hand makes from the name. */
export const crewKey = (name: string) => 'crew:' + str(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// ── The words on the form ───────────────────────────────────────────────────────────────────────
export const HIRE_TEXT = {
  en: {
    eyebrow: 'Stay Hospitality', title: 'Welcome to the team', lead: 'Fill this in once. Your manager approves it, and then you get an email with your own page: your training, your schedule and your hours.',
    name: 'Full name', email: 'Email', emailHint: 'Your page is sent here', phone: 'Mobile phone', track: 'Your job', market: 'Where you will work', start: 'Start date', startHint: 'if you know it',
    emergency: 'Emergency contact', emergencyName: 'Their name', emergencyPhone: 'Their phone', note: 'Anything we should know', noteHint: 'optional', send: 'Send', sending: 'Sending…',
    doneTitle: 'Thank you', done: 'We have it. Once your manager approves it you will get an email with the link to your page. There is nothing else to do right now.',
    closedTitle: 'This link is not active', closed: 'Ask your manager for the current link.', privacy: 'We only ask for what we need to set you up. Do not send ID numbers or bank details here.', failed: 'That did not send. Check your connection and try again.',
  },
  es: {
    eyebrow: 'Stay Hospitality', title: 'Bienvenido al equipo', lead: 'Llena esto una sola vez. Tu gerente lo aprueba y después recibes un correo con tu propia página: tu capacitación, tu horario y tus horas.',
    name: 'Nombre completo', email: 'Correo electrónico', emailHint: 'Aquí enviamos tu página', phone: 'Teléfono celular', track: 'Tu puesto', market: 'Dónde vas a trabajar', start: 'Fecha de inicio', startHint: 'si la sabes',
    emergency: 'Contacto de emergencia', emergencyName: 'Su nombre', emergencyPhone: 'Su teléfono', note: 'Algo que debamos saber', noteHint: 'opcional', send: 'Enviar', sending: 'Enviando…',
    doneTitle: 'Gracias', done: 'Lo recibimos. Cuando tu gerente lo apruebe, recibirás un correo con el enlace a tu página. No tienes que hacer nada más por ahora.',
    closedTitle: 'Este enlace no está activo', closed: 'Pídele a tu gerente el enlace actual.', privacy: 'Solo pedimos lo necesario para registrarte. No envíes números de identificación ni datos bancarios aquí.', failed: 'No se envió. Revisa tu conexión e inténtalo de nuevo.',
  },
} as const
