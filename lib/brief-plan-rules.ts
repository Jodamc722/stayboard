// THE BRIEFS — the plan each team reads in the morning, as one shape. Pure, so plain node can test it
// (lib/__tests__/brief-plans.test.mjs). The data is lib/brief-plans.ts; the page is /briefs.
//
// Jon, 2026-11-25: "Need market plans. Meaning 1 for Broward, 1 for Miami and 1 for North. This should
// be in ops." · "Briefs and we should create a new format. Arrivals, VIP, Cleans today, cleans not
// assigned, etc. Make them super nice and easy to view." · "We need 1 for Customer Care as well.
// Glitches, Claims, other important things." · "We should have a briefs page where we can see the
// briefs" · "make changes before they go out, add notes, etc."
// · "The Ops brief needs to show the top priorities, not necessarily the cleans, the schedule and any
// cleans not assigned, etc." (the Ops plan: every market on one page, a line a person, no clean lists)
//
// So a brief is a PLAN: a few numbers, then sections of rows. The page and the email are two drawings
// of the same plan, so what is read on the page is what is sent. Before it goes out a person can add a
// note at the top, add lines of their own, and take a row out. Those edits belong to one day: the next
// morning's plan starts clean.

export type PlanKey = 'ops' | 'broward' | 'miami' | 'north' | 'care'
export const PLAN_KEYS: PlanKey[] = ['ops', 'broward', 'miami', 'north', 'care']
export const PLAN_NAMES: Record<PlanKey, string> = { ops: 'Ops', broward: 'Broward', miami: 'Miami', north: 'North', care: 'Customer Care' }
export const PLAN_FOR: Record<PlanKey, string> = {
  ops: 'The operations team: every market on one page',
  broward: 'The Broward field team', miami: 'The Miami field team', north: 'North: the vendor-run homes in Palm Beach County', care: 'The customer care team',
}
export const isPlanKey = (v: unknown): v is PlanKey => PLAN_KEYS.indexOf(v as PlanKey) >= 0

export type Tone = 'red' | 'amber' | 'green' | 'none'
export type PlanTag = { text: string; tone?: Tone | 'gold' | 'grey' }
export type PlanRow = { id: string; title: string; meta?: string; note?: string; tags?: PlanTag[]; tone?: Tone; href?: string; hidden?: boolean; custom?: boolean; by?: string }
/** One person's day: `rows` is their cleans, in the order to run them; `also` is the other work on their name. */
export type PlanGroup = { name: string; meta?: string; rows: PlanRow[]; also?: PlanRow[]; more?: string }
export type PlanSection = { key: string; title: string; tone?: Tone; rows?: PlanRow[]; groups?: PlanGroup[]; empty?: string; more?: string }
export type PlanTile = { label: string; value: string; tone?: Tone; note?: string }
export type Plan = { key: PlanKey; name: string; forWhom: string; day: string; dayLabel: string; /** days from today: 0 today, 1 tomorrow … */ ahead?: number; tiles: PlanTile[]; sections: PlanSection[]; note?: string; noteBy?: string; builtAt: string; board?: { label: string; href: string } }

// ── What a person changed before it went out ────────────────────────────────────────────────────
export type PlanExtra = { id: string; text: string; by: string }
export type PlanEdits = { day: string; note: string; noteBy: string; hidden: string[]; extra: PlanExtra[] }
export const emptyEdits = (day: string): PlanEdits => ({ day, note: '', noteBy: '', hidden: [], extra: [] })
/** The edits as stored, for the day asked. Yesterday's edits are not today's: they come back empty. */
export function cleanEdits(v: unknown, day: string): PlanEdits {
  const x = (v && typeof v === 'object' ? v : {}) as any
  if (String(x.day || '') !== day) return emptyEdits(day)
  return {
    day, note: String(x.note || '').slice(0, 1200), noteBy: String(x.noteBy || '').slice(0, 80),
    hidden: (Array.isArray(x.hidden) ? x.hidden : []).map((h: any) => String(h)).filter(Boolean).slice(0, 300),
    extra: (Array.isArray(x.extra) ? x.extra : []).map((e: any) => ({ id: String(e?.id || ''), text: String(e?.text || '').replace(/\s+/g, ' ').trim().slice(0, 300), by: String(e?.by || '').slice(0, 80) })).filter((e: PlanExtra) => e.id && e.text).slice(0, 20),
  }
}
const rowsOf = (s: PlanSection): PlanRow[] => [...(s.rows || []), ...(s.groups || []).flatMap(g => [...g.rows, ...(g.also || [])])]
/** How many rows a section holds (hidden ones not counted). */
export const sectionCount = (s: PlanSection) => rowsOf(s).filter(r => !r.hidden).length
export const ALSO = 'also'
/**
 * The plan with a person's edits on it. On the page (`forSend` false) a hidden row stays, marked, so it
 * can be put back; in what is sent it is gone, and so is a group or section left with nothing. The
 * numbers at the top are the day's facts and never change with an edit.
 */
export function applyEdits(plan: Plan, edits: PlanEdits | null, forSend = false): Plan {
  const e = edits && edits.day === plan.day ? edits : emptyEdits(plan.day)
  const hidden = new Set(e.hidden)
  const mark = (r: PlanRow): PlanRow => (hidden.has(r.id) ? { ...r, hidden: true } : r)
  let sections: PlanSection[] = plan.sections.map(s => ({
    ...s,
    ...(s.rows ? { rows: s.rows.map(mark) } : {}),
    ...(s.groups ? { groups: s.groups.map(g => ({ ...g, rows: g.rows.map(mark), ...(g.also ? { also: g.also.map(mark) } : {}) })) } : {}),
  }))
  if (e.extra.length) {
    const also: PlanSection = { key: ALSO, title: 'Also ' + dayWord(plan.ahead), rows: e.extra.map(x => ({ id: x.id, title: x.text, custom: true, by: x.by, tone: 'amber' as Tone })) }
    sections = [also, ...sections]
  }
  const page: Plan = { ...plan, sections, note: e.note || undefined, noteBy: e.note ? e.noteBy || undefined : undefined }
  return forSend ? asSent(page) : page
}
/**
 * The plan as it is sent, from the plan as the page shows it: every row marked "left out" is gone, and
 * so is a person or a section left with nothing. The page's Preview draws the email from this, so what
 * is previewed is what is sent (Jon, 2026-11-25: "have a preview button so we can see").
 */
export function asSent(page: Plan): Plan {
  const keep = (rows: PlanRow[]) => rows.filter(r => !r.hidden)
  const sections = page.sections.map(s => ({
    ...s,
    ...(s.rows ? { rows: keep(s.rows) } : {}),
    ...(s.groups ? { groups: s.groups.map(g => ({ ...g, rows: keep(g.rows), ...(g.also ? { also: keep(g.also) } : {}) })).filter(g => g.rows.length || (g.also || []).length) } : {}),
  })).filter(s => rowsOf(s).length || s.empty)
  return { ...page, sections }
}

// ── The day ─────────────────────────────────────────────────────────────────────────────────────
// Jon, 2026-11-25: "can we add a calendar selection to briefs, briefs are designed for the morning. We
// should be able to look at tomorrow's brief." A plan can be built for today or any of the next seven
// days. Notes, added lines and rows left out are kept per day, so tomorrow's can be written tonight and
// are on the plan when it sends itself in the morning.
export const DAYS_AHEAD = 7
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
export function addDays(day: string, n: number): string {
  const t = Date.parse(day + 'T12:00:00Z')
  return Number.isFinite(t) ? new Date(t + n * 86400000).toISOString().slice(0, 10) : day
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000)
}
/** The day asked for when it is today or one of the next seven; otherwise today. */
export function cleanDay(v: unknown, today: string): string {
  const d = String(v || '')
  if (!DAY_RE.test(d) || !Number.isFinite(Date.parse(d + 'T12:00:00Z'))) return today
  const n = daysBetween(today, d)
  return n >= 0 && n <= DAYS_AHEAD ? d : today
}
/** "today", "tomorrow", or "that day" for anything further out (the date is in the plan's heading). */
export const dayWord = (ahead?: number) => (!ahead ? 'today' : ahead === 1 ? 'tomorrow' : 'that day')
/** Where a day's edits are kept. */
export const editsKey = (key: PlanKey, day: string) => `${key}@${day}`
/** Edits for days already gone are dropped when anything is saved. */
export function pruneEdits(all: Record<string, unknown>, today: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(all)) { const d = String((all[k] as any)?.day || ''); if (DAY_RE.test(d) && d >= today) out[k] = all[k] }
  return out
}

// ── Who gets it, and whether it goes out on its own ─────────────────────────────────────────────
export type PlanSetting = { to: string[]; auto: boolean; lastSent?: { day: string; at: string; by: string; n: number } | null }
export type PlanSettings = Record<PlanKey, PlanSetting>
const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/
/** Addresses out of what a person typed: commas, semicolons, spaces or new lines between them. */
export function parseEmails(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.join(',') : String(v || '')
  return Array.from(new Set(raw.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => EMAIL.test(x)))).slice(0, 40)
}
export function cleanSettings(v: unknown): PlanSettings {
  const x = (v && typeof v === 'object' ? v : {}) as any
  const one = (k: PlanKey): PlanSetting => ({ to: parseEmails(x[k]?.to), auto: !!x[k]?.auto, lastSent: x[k]?.lastSent && x[k].lastSent.day ? { day: String(x[k].lastSent.day), at: String(x[k].lastSent.at || ''), by: String(x[k].lastSent.by || ''), n: Number(x[k].lastSent.n) || 0 } : null })
  return { ops: one('ops'), broward: one('broward'), miami: one('miami'), north: one('north'), care: one('care') }
}

// ── Hours ───────────────────────────────────────────────────────────────────────────────────────
// Jon, 2026-11-25: "It should also show how many hours based on cleans expected, also other task they
// have assigned too." The hours are his labor KPI (lib/clean-rates): the expected labor cost of each
// clean divided by what a cleaner is paid an hour. They are a guide to where the day should land, so
// they are never coloured and never called too many. Other tasks carry no hours: nothing records how
// long one takes, so the plan lists them and counts them, and does not guess.
/** 7.5 → "7.5h", 8 → "8h". A day's total reads to the half hour; one clean (`step` 0.25) to the quarter: "1.75h". */
export function hoursText(h: number, step = 0.5): string {
  const n = Number(h) || 0
  if (n <= 0) return '0h'
  const r = Math.max(step, Math.round(n / step) * step)
  return String(Math.round(r * 100) / 100) + 'h'
}
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
/** The line beside a person's name: cleans, the hours they are expected to take, other tasks, then what is hot or done. */
export function personMeta(p: { cleans: number; hours: number; tasks: number; sameDay?: number; done?: number }): string {
  return [
    p.cleans ? count(p.cleans, 'clean', 'cleans') : '',
    p.cleans && p.hours > 0 ? 'about ' + hoursText(p.hours) : '',
    p.tasks ? count(p.tasks, p.cleans ? 'other task' : 'task', p.cleans ? 'other tasks' : 'tasks') : '',
    p.sameDay ? p.sameDay + ' same-day' : '',
    p.done ? p.done + ' done' : '',
  ].filter(Boolean).join(' · ')
}
/** "4 cleaners at 8h": the hours as people, a whole person at a time. */
export function crewFor(hours: number, shiftHours: number): string {
  const sh = shiftHours > 0 ? shiftHours : 8
  if (!(hours > 0)) return ''
  const n = Math.max(1, Math.ceil(hours / sh - 1e-9))
  return `${count(n, 'cleaner', 'cleaners')} at ${hoursText(sh)}`
}

// ── The email ───────────────────────────────────────────────────────────────────────────────────
// One white sheet on a warm page, the black masthead with the plan's name in serif, the day's numbers
// in a row, then sections under gold small-cap titles. A row is a bold name, small-cap words for its
// tags, one muted line under it, and a thin coloured rule at its left when it needs someone. The same
// palette as the other morning briefs (lib/briefs/ui), kept here so this file imports nothing.
const esc = (v: unknown) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const INK = '#101114', GOLD = '#8C6D3A', RULE = '#E7E4DD', SOFT = '#FAF8F4', MUTED = '#6B6C72', FAINT = '#9A9BA0', RED = '#B42318', AMBER = '#B26A00', GREEN = '#1F7A4D'
const F = `-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`, SERIF = `Georgia,'Times New Roman',serif`
const toneColor = (t?: string) => (t === 'red' ? RED : t === 'amber' ? AMBER : t === 'green' ? GREEN : t === 'gold' ? GOLD : MUTED)
const tagHtml = (t: PlanTag) => `<span style="font:700 10px/1.4 ${F};letter-spacing:.08em;text-transform:uppercase;color:${toneColor(t.tone)};white-space:nowrap">${esc(t.text)}</span>`
const safeUrl = (u?: string) => (u && /^https:\/\//.test(u) ? u : '')
function rowHtml(r: PlanRow, n: number | null, first: boolean): string {
  const bar = r.tone && r.tone !== 'none' ? toneColor(r.tone) : 'transparent'
  const tags = (r.tags || []).map(tagHtml).join(' &nbsp;')
  return `<tr><td style="width:3px;background:${bar};font-size:0;line-height:0">&nbsp;</td>`
    + (n != null ? `<td valign="top" style="width:22px;padding:8px 0 8px 10px;font:700 11.5px/1.6 ${F};color:${FAINT};${first ? '' : `border-top:1px solid #F1EFEA`}">${n}</td>` : '')
    + `<td valign="top" style="padding:8px 0 8px ${n != null ? '4px' : '11px'};font:13.5px/1.5 ${F};color:${INK};${first ? '' : `border-top:1px solid #F1EFEA`}"><b>${esc(r.title)}</b>${tags ? ' &nbsp;' + tags : ''}`
    + (r.meta ? `<div style="font:12.5px/1.5 ${F};color:${MUTED}">${esc(r.meta)}</div>` : '')
    + (r.note ? `<div style="font:12px/1.5 ${F};color:#6F5527">${esc(r.note)}</div>` : '')
    + (r.custom && r.by ? `<div style="font:11.5px/1.5 ${F};color:${FAINT}">Added by ${esc(r.by)}</div>` : '')
    + `</td></tr>`
}
const rowsTable = (rows: PlanRow[], numbered: boolean) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows.map((r, i) => rowHtml(r, numbered ? i + 1 : null, i === 0)).join('')}</table>`
const alsoHtml = (rows?: PlanRow[], more?: string, label = true) => (rows && rows.length ? (label ? `<p style="margin:6px 0 0 14px;font:700 9.5px/1.4 ${F};letter-spacing:.12em;text-transform:uppercase;color:${FAINT}">Other tasks</p>` : '') + rowsTable(rows, false) + (more ? `<p style="margin:2px 0 0 14px;font:11.5px/1.5 ${F};color:${FAINT}">${esc(more)}</p>` : '') : '')
function sectionHtml(s: PlanSection): string {
  const n = sectionCount(s)
  const title = `<p style="margin:0 0 6px;font:700 10.5px/1.4 ${F};letter-spacing:.16em;text-transform:uppercase;color:${s.tone === 'red' && n ? RED : GOLD}">${esc(s.title)}${n ? ` <span style="font-weight:400;letter-spacing:.04em;color:${FAINT}">&middot; ${n}</span>` : ''}</p>`
  let inner = ''
  if (s.groups && s.groups.length) {
    inner = s.groups.map((g, i) => `<p style="margin:${i ? 14 : 4}px 0 2px;font:14px/1.4 ${F};color:${INK}"><b>${esc(g.name)}</b>${g.meta ? ` <span style="font-size:12px;color:${MUTED}">&middot; ${esc(g.meta)}</span>` : ''}</p>` + (g.rows.length ? rowsTable(g.rows, true) : '') + alsoHtml(g.also, g.more, g.rows.length > 0)).join('')
  } else if (s.rows && s.rows.length) inner = rowsTable(s.rows, false)
  else inner = `<p style="margin:2px 0 0;font:13px/1.5 ${F};color:${MUTED}">${esc(s.empty || 'Nothing here today.')}</p>`
  if (s.more) inner += `<p style="margin:6px 0 0;font:11.5px/1.5 ${F};color:${FAINT}">${esc(s.more)}</p>`
  return `<div style="border-top:1px solid ${RULE};padding:18px 22px 16px">${title}${inner}</div>`
}
function tilesHtml(tiles: PlanTile[]): string {
  if (!tiles.length) return ''
  const per = 3, rows: string[] = []
  for (let i = 0; i < tiles.length; i += per) {
    rows.push(`<tr>${tiles.slice(i, i + per).map((t, j) => `<td valign="top" width="33%" style="padding:10px 8px 10px ${j ? '14px' : '0'};${j ? `border-left:1px solid ${RULE}` : ''}"><div style="font:700 10px/1.3 ${F};letter-spacing:.1em;text-transform:uppercase;color:${MUTED}">${esc(t.label)}</div><div style="font:27px/1.15 ${SERIF};margin-top:3px;color:${t.tone && t.tone !== 'none' && t.tone !== 'green' ? toneColor(t.tone) : INK}">${esc(t.value)}</div>${t.note ? `<div style="font:11px/1.4 ${F};color:${FAINT}">${esc(t.note)}</div>` : ''}</td>`).join('')}</tr>`)
  }
  return `<div style="background:${SOFT};padding:8px 22px 6px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows.join('')}</table></div>`
}
export const planSubject = (p: Plan) => `${p.name} plan · ${p.dayLabel}${p.tiles.length ? ' · ' + p.tiles.slice(0, 2).map(t => `${t.value} ${t.label.toLowerCase()}`).join(' · ') : ''}`
/** The email. Pass a plan that already has its edits applied for sending (applyEdits(plan, edits, true)). */
export function planEmailHtml(p: Plan): string {
  const board = p.board && safeUrl(p.board.href) ? `<a href="${esc(p.board.href)}" style="color:#6F5527;font-weight:600;text-decoration:none">${esc(p.board.label)}</a>` : ''
  const note = p.note ? `<div style="background:#FFF8E8;border-top:1px solid ${RULE};padding:14px 22px"><p style="margin:0 0 4px;font:700 10.5px/1.4 ${F};letter-spacing:.16em;text-transform:uppercase;color:${GOLD}">Note${p.noteBy ? ' from ' + esc(p.noteBy) : ''}</p><p style="margin:0;font:14.5px/1.55 ${F};color:${INK};white-space:pre-line">${esc(p.note)}</p></div>` : ''
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#F4F2EE;font-family:${F};color:${INK}"><div style="max-width:600px;margin:0 auto;padding:16px 10px 28px"><div style="background:#fff;border:1px solid ${RULE};border-radius:14px;overflow:hidden">`
    + `<div style="background:${INK};padding:20px 22px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="font:700 11px/1.4 ${F};letter-spacing:.34em;color:#fff">STAY <span style="font-weight:400;letter-spacing:.22em;color:#B9BAC0">HOSPITALITY</span></td><td align="right" style="font:10.5px/1.4 ${F};letter-spacing:.12em;text-transform:uppercase;color:#B9BAC0;white-space:nowrap">${esc(p.dayLabel)}</td></tr></table>`
    + `<p style="margin:16px 0 0;font:30px/1.1 ${SERIF};color:#fff">${esc(p.name)} plan</p><p style="margin:6px 0 0;font:12px/1.4 ${F};color:#B9BAC0">${esc(p.forWhom)}</p></div>`
    + tilesHtml(p.tiles) + note + p.sections.map(sectionHtml).join('')
    + `<div style="background:${SOFT};border-top:1px solid ${RULE};padding:14px 22px 16px;font:11px/1.6 ${F};color:${FAINT};text-align:center">${board ? board + '<br>' : ''}<span style="letter-spacing:.2em;text-transform:uppercase;font-size:9.5px">Lighthouse &middot; Stay Hospitality</span></div>`
    + `</div></div></body></html>`
}
