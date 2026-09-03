// PUBLIC TEAM SCHEDULER (Jon, 2026-09-03). See supabase/migrations/067_team_schedule_links.sql.
//
//   GET  /api/public/scheduler/<code>?weekStart=YYYY-MM-DD[&pass=]   → the market's week + cleaners
//   POST /api/public/scheduler/<code>  { action:'stage',  listingId, date, cleanerId, cleanerName, who, pass }
//   POST /api/public/scheduler/<code>  { action:'submit', weekStart, who, note, pass }
//
// The code is the capability; a passcode on the link is a second factor (signed-in users skip it).
// The market is FORCED from the link — a request can never reach another market's cleans. Picks go
// to schedule_staged (the board's "proposed" overlay); Submit snapshots the week and emails Jon.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { revalidateTag } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createClient } from '@/lib/supabase-server'
import { buildSchedule } from '@/lib/schedule-build'
import { getOpsPresets } from '@/lib/app-settings'
import { clusterAreas } from '@/lib/geo-areas'
import { planWeek } from '@/lib/team-plan'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'
import { sendGmail } from '@/lib/gmail-send'
import { sendResendEmail } from '@/lib/resend-send'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CODE_RE = /^[a-f0-9]{8,32}$/i
const str = (v: any) => (v == null ? '' : String(v)).trim()
const REVIEWER = 'jon@stay-hospitality.com'
const addDay = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

async function loadLink(code: string) {
  if (!CODE_RE.test(code)) return null
  const db = supabaseAdmin()
  const { data } = await db.from('schedule_links').select('*').eq('code', code.toLowerCase()).maybeSingle()
  if (!data || data.revoked_at) return null
  return data
}
async function unlocked(link: any, pass: string | null): Promise<boolean> {
  if (!link.passcode) return true
  try { const s = createClient(); const { data: { user } } = await s.auth.getUser(); if (user) return true } catch {}
  if (pass && pass === link.passcode) return true
  return shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
}
/** The week, cut down to one market — and to OUR cleans. Vendor-cleaned buildings (Botanica, Park
 *  Towers… — the list lives in /users → Ops presets, "Vendor-cleaned buildings") are not this team's
 *  work, so they never show on a team link. Each clean also gets an `area` (geo cluster, radius from
 *  the same presets) so the team can plan by run, not just by day. */
async function marketWeek(market: string, weekStart: string | null) {
  const [full, presets] = await Promise.all([buildSchedule('week', weekStart), getOpsPresets()])
  const hiddenNames = new Set<string>(); let hidden = 0
  const days = (full.days || []).map((d: any) => ({ date: d.date, dow: d.dow, cleans: (d.markets?.[market] || []).filter((c: any) => {
    if (c.movedTo) return false
    if (c.vendor || c.guestyOnly) { hidden++; hiddenNames.add(c.vendor || c.hub || 'vendor'); return false }
    return true
  }) }))
  // Areas: one clustering over the distinct units of the week, then label every clean.
  const byId: Record<string, any> = {}
  for (const d of days) for (const c of d.cleans) byId[c.listingId] = byId[c.listingId] || { listingId: c.listingId, unit: c.unit, city: c.city, lat: c.lat, lng: c.lng }
  const areaOf: Record<string, string> = {}
  try { for (const a of clusterAreas(Object.values(byId), presets.timing.areaRadiusKm || 4)) for (const u of a.units) areaOf[u.listingId] = a.label } catch {}
  for (const d of days) for (const c of d.cleans) c.area = areaOf[c.listingId] || c.city || c.hub || 'Other'
  const hk: any[] = full.housekeepers || []
  // The market's own people first (Breezeway region), then everyone else in housekeeping.
  const mine = hk.filter(p => String(p.region || '').toLowerCase().includes(market.toLowerCase()))
  const rest = hk.filter(p => !mine.includes(p))
  // Recommendations: stay in the building, fill a day before starting another, say what it does.
  let plan: any = null
  try { plan = planWeek(days, mine.map(p => ({ id: Number(p.id), name: String(p.name), region: p.region })), presets.timing) } catch {}
  return { weekStart: full.weekStart, weekEnd: full.weekEnd, today: full.today, prev: full.prev, next: full.next, days, housekeepers: [...mine, ...rest], teamIds: mine.map(p => p.id), syncedAt: full.syncedAt, hidden: { count: hidden, vendors: Array.from(hiddenNames).sort() }, plan }
}

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const link = await loadLink(params.code)
  if (!link) return NextResponse.json({ ok: false, error: 'This link is not active.' }, { status: 404 })
  const sp = req.nextUrl.searchParams
  if (!(await unlocked(link, sp.get('pass')))) return NextResponse.json({ ok: false, locked: true, label: link.label || link.market + ' team schedule' }, { status: 401 })
  const ws = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('weekStart') || '') ? sp.get('weekStart') : null
  try {
    const week = await marketWeek(link.market, ws)
    const db = supabaseAdmin()
    const { data: subs } = await db.from('schedule_submissions').select('id,week_start,week_end,submitted_by,note,status,feedback,reviewed_at,created_at').eq('link_code', link.code).order('created_at', { ascending: false }).limit(6)
    return NextResponse.json({ ok: true, link: { market: link.market, label: link.label || link.market + ' team schedule' }, ...week, submissions: subs || [] })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
}

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const link = await loadLink(params.code)
  if (!link) return NextResponse.json({ ok: false, error: 'This link is not active.' }, { status: 404 })
  const b = await req.json().catch(() => ({} as any))
  if (!(await unlocked(link, str(b.pass) || null))) return NextResponse.json({ ok: false, locked: true }, { status: 401 })
  const who = str(b.who).slice(0, 80)
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  try {
    if (b.action === 'stage') {
      const listingId = str(b.listingId); const date = str(b.date).slice(0, 10)
      if (!listingId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ ok: false, error: 'listingId and date required' }, { status: 400 })
      // Scope: the clean must be one of this market's cleans that week (built from the cached week, cheap).
      const week = await marketWeek(link.market, date)
      const inScope = week.days.some((d: any) => d.date === date && d.cleans.some((c: any) => String(c.listingId) === listingId))
      if (!inScope) return NextResponse.json({ ok: false, error: 'That clean is not on this team\'s board.' }, { status: 403 })
      const cleanerId = b.cleanerId != null && b.cleanerId !== '' ? Number(b.cleanerId) : null
      if (cleanerId == null || !Number.isFinite(cleanerId)) {
        await db.from('schedule_staged').delete().eq('listing_id', listingId).eq('date', date)
      } else {
        await db.from('schedule_staged').upsert({ listing_id: listingId, date, cleaner_id: cleanerId, cleaner_name: str(b.cleanerName).slice(0, 120) || null, updated_at: now, updated_by: 'link:' + link.market + (who ? ':' + who : '') }, { onConflict: 'listing_id,date' })
      }
      return NextResponse.json({ ok: true })
    }
    if (b.action === 'stageMany') {
      // Apply a batch of recommended picks in one go. Same scope rule as a single stage.
      const picks: any[] = Array.isArray(b.picks) ? b.picks.slice(0, 200) : []
      if (!picks.length) return NextResponse.json({ ok: false, error: 'no picks' }, { status: 400 })
      const week = await marketWeek(link.market, str(picks[0].date).slice(0, 10))
      const ok = new Set(week.days.flatMap((d: any) => d.cleans.map((c: any) => d.date + '|' + c.listingId)))
      const rows = picks.filter(p => ok.has(str(p.date).slice(0, 10) + '|' + str(p.listingId)) && Number.isFinite(Number(p.cleanerId)))
        .map(p => ({ listing_id: str(p.listingId), date: str(p.date).slice(0, 10), cleaner_id: Number(p.cleanerId), cleaner_name: str(p.cleanerName).slice(0, 120) || null, updated_at: now, updated_by: 'link:' + link.market + (who ? ':' + who : '') + ':plan' }))
      if (rows.length) { const { error } = await db.from('schedule_staged').upsert(rows, { onConflict: 'listing_id,date' }); if (error) throw new Error(error.message) }
      try { revalidateTag('schedule') } catch {}
      return NextResponse.json({ ok: true, applied: rows.length, skipped: picks.length - rows.length })
    }
    if (b.action === 'submit') {
      // Daily by default (Jon: "daily schedule submitted for the next day") — `date` submits one
      // day; `weekStart` without a date submits the whole week. A day is stored with
      // week_start = week_end = date, so the desk and the email read it as a day.
      const day = /^\d{4}-\d{2}-\d{2}$/.test(str(b.date)) ? str(b.date) : null
      const ws = /^\d{4}-\d{2}-\d{2}$/.test(str(b.weekStart)) ? str(b.weekStart) : null
      const week0 = await marketWeek(link.market, day || ws)
      const week = day ? { ...week0, weekStart: day, weekEnd: day, days: week0.days.filter((d: any) => d.date === day) } : week0
      if (day && !week.days.length) return NextResponse.json({ ok: false, error: 'That day is not in view.' }, { status: 400 })
      const snapshot = week.days.flatMap((d: any) => d.cleans.map((c: any) => ({ date: d.date, dow: d.dow, unit: c.unit, listingId: c.listingId, cleaner: (c.assignedNames || [])[0] || null, cleanerId: (c.assignedIds || [])[0] ?? null, staged: !!c.staged, sameDayTurn: !!c.sameDayTurn, checkOutTime: c.checkOutTime || null, bedrooms: c.bedrooms ?? null })))
      const unassigned = snapshot.filter((s: any) => !s.cleaner).length
      const { data: sub, error } = await db.from('schedule_submissions').insert({ link_code: link.code, market: link.market, week_start: week.weekStart, week_end: week.weekEnd, submitted_by: who || null, note: str(b.note).slice(0, 2000) || null, snapshot, status: 'submitted' }).select('id').single()
      if (error) throw new Error(error.message)
      // The email to Jon: the week as a table, the gaps called out, one link to the board.
      const origin = req.nextUrl.origin
      const byDay: Record<string, any[]> = {}; for (const s of snapshot) (byDay[s.date] = byDay[s.date] || []).push(s)
      const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[ch])
      const rows = Object.keys(byDay).sort().map(date => `<tr><td colspan="3" style="padding:10px 8px 4px;font-weight:700;color:#111;border-top:1px solid #e5e7eb">${esc(byDay[date][0].dow)} ${esc(date)} · ${byDay[date].length} clean${byDay[date].length === 1 ? '' : 's'}</td></tr>` + byDay[date].map((s: any) => `<tr><td style="padding:4px 8px;color:#111">${esc(s.unit)}${s.sameDayTurn ? ' <span style="color:#b45309;font-weight:700">same-day</span>' : ''}</td><td style="padding:4px 8px;color:#555">${s.checkOutTime ? 'out ' + esc(s.checkOutTime) : ''}${s.bedrooms != null ? ' · ' + s.bedrooms + 'BR' : ''}</td><td style="padding:4px 8px;font-weight:600;color:${s.cleaner ? '#065f46' : '#b91c1c'}">${s.cleaner ? esc(s.cleaner) : 'UNASSIGNED'}</td></tr>`).join('')).join('')
      const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#111">
<p style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;margin:0 0 4px">Lighthouse · Team schedule submitted</p>
<h2 style="margin:0 0 6px;font-size:20px">${esc(link.market)} · ${day ? esc(week.days[0].dow + ' ' + day) + (day === week0.today ? ' (today)' : day === addDay(week0.today, 1) ? ' (tomorrow)' : '') : 'week of ' + esc(week.weekStart) + ' → ' + esc(week.weekEnd)}</h2>
<p style="margin:0 0 12px;color:#374151">Submitted by <b>${esc(who || 'the ' + link.market + ' team')}</b> · ${snapshot.length} cleans · <b style="color:${unassigned ? '#b91c1c' : '#065f46'}">${unassigned ? unassigned + ' unassigned' : 'all assigned'}</b>${snapshot.some((s: any) => s.staged) ? ' · proposed picks are on the board as staged' : ''}</p>
${b.note ? `<div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:10px 12px;margin:0 0 12px"><b>Note from the team:</b> ${esc(b.note)}</div>` : ''}
<table style="border-collapse:collapse;width:100%;font-size:13px">${rows}</table>
<p style="margin:16px 0"><a href="${origin}/schedule?date=${esc(day || week.weekStart)}" style="background:#111;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700;display:inline-block">Review on the Scheduler</a>
&nbsp; <a href="${origin}/schedule/links" style="color:#4338ca;font-weight:600">Send feedback to the team</a></p>
<p style="color:#6b7280;font-size:12px">Picks made through the link are staged, not pushed — nothing reached Breezeway. Push from the Scheduler when you are happy with it.</p></div>`
      const subject = day
        ? `${day === addDay(week0.today, 1) ? "Tomorrow's schedule" : 'Schedule'} · ${link.market} · ${week.days[0].dow} ${day} · ${snapshot.length} cleans${unassigned ? ' · ' + unassigned + ' unassigned' : ''}`
        : `Schedule submitted · ${link.market} · week of ${week.weekStart}${unassigned ? ' · ' + unassigned + ' unassigned' : ''}`
      let sent = false
      try { const g = await sendGmail({ fromEmail: REVIEWER, to: [REVIEWER], subject, html }); sent = g.ok } catch {}
      if (!sent) { try { const r = await sendResendEmail({ to: [REVIEWER], subject, html }); sent = r.ok } catch {} }
      if (sent) await db.from('schedule_submissions').update({ emailed_at: now }).eq('id', sub.id)
      try { revalidateTag('schedule') } catch {}
      return NextResponse.json({ ok: true, id: sub.id, emailed: sent, cleans: snapshot.length, unassigned })
    }
    return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
}
