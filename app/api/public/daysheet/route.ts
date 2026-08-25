// PUBLIC day sheet — same data as the app, gated by the share password (one standing link).
//
// MARKET-SCOPED AND LIVE (Jon, 2026-08-25: "can we make the Miami one, Broward one an actual live
// link as well — this shows active status, who clocked in, what people are working on"). The link
// takes ?market=Miami|Broward so each crew opens their own board, and the response now carries a
// CREW block: who is on the schedule, who has actually clocked in, and what each person is on
// right now. No wages, ever — this is a field link, and the crew reads it.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'
import { buildDaySheet } from '@/lib/daysheet'
import { getShifts, nameMatches } from '@/lib/homebase'
import { getTimecards } from '@/lib/homebase-labor'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'

const TZ = 'America/New_York'
const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** Who is working right now, and on what. Best-effort: the day sheet never waits on Homebase. */
async function crewNow(date: string, market: string) {
  const today = ymdET(new Date())
  if (date !== today) return null                      // "right now" only makes sense for today
  const [shifts, cards] = await Promise.all([
    getShifts(today, TZ).catch(() => [] as any[]),
    getTimecards(today, today).catch(() => [] as any[]),
  ])
  // What each person has on the board today, and what they are actually mid-way through.
  const db = supabaseAdmin()
  const [{ data: tRows }, { data: lRows }] = await Promise.all([
    db.from('breezeway_tasks_sync')
      .select('id,name,status,assignees,reference_property_id,started_at,finished_at')
      .eq('scheduled_date', today).limit(2000),
    db.from('guesty_listings').select('id,nickname,title,building,address_city').limit(2000),
  ])
  const meta: Record<string, { name: string; market: string }> = {}
  for (const l of ((lRows || []) as any[])) {
    const nm = l.nickname || l.title || 'Unit'
    meta[String(l.id)] = { name: nm, market: String(marketOf(l.building, l.address_city, nm) || '') }
  }
  const mine = (lid: any) => !market || market === 'all' || meta[String(lid)]?.market === market
  type Job = { id: string; unit: string; task: string; state: 'done' | 'running' | 'open' }
  const jobsFor: Record<string, Job[]> = {}
  for (const t of ((tRows || []) as any[])) {
    const st = str(t.status).toLowerCase()
    if (/delete|cancel/.test(st)) continue
    if (!mine(t.reference_property_id)) continue
    const job: Job = {
      id: str(t.id),
      unit: meta[String(t.reference_property_id)]?.name || 'Unit',
      task: str(t.name).slice(0, 70),
      state: (t.finished_at || /complete|finish|close|approv/.test(st)) ? 'done'
        : (t.started_at || /progress|started/.test(st)) ? 'running' : 'open',
    }
    for (const a of (Array.isArray(t.assignees) ? t.assignees : [])) {
      const who = str(a?.name || a).trim()
      if (who) (jobsFor[who] = jobsFor[who] || []).push(job)
    }
  }
  // CLOCKED IN NOW = an open card dated today (reference-homebase-and-kpis: `t.open` alone also
  // matches a stale card somebody forgot to close).
  const openNow = new Set(((cards || []) as any[])
    .filter(c => (c as any).open && str((c as any).date).slice(0, 10) === today)
    .map(c => str((c as any).name)))
  const clockedIn = (name: string) => Array.from(openNow).some(n => nameMatches(n, name))
  const namesOnShift = (shifts as any[]).filter(s => !s.open && s.startAt)
  const allPeople = namesOnShift.map(s => {
    const name = str(s.name)
    const jobs = Object.keys(jobsFor).filter(k => nameMatches(k, name)).flatMap(k => jobsFor[k])
    const seen = new Set<string>()
    const uniq = jobs.filter(j => (seen.has(j.id) ? false : (seen.add(j.id), true)))
    return {
      name, role: str(s.role), shift: str(s.label), clockedIn: clockedIn(name),
      onNow: uniq.filter(j => j.state === 'running').map(j => ({ id: j.id, unit: j.unit, task: j.task })),
      done: uniq.filter(j => j.state === 'done').length,
      left: uniq.filter(j => j.state !== 'done').length,
      jobs: uniq,
    }
  }).sort((a, b) => (b.clockedIn ? 1 : 0) - (a.clockedIn ? 1 : 0) || a.name.localeCompare(b.name))
  // HOMEBASE IS ONE LOCATION — a shift carries no market, so an unfiltered list puts Miami's
  // housekeepers on Broward's board reading "0 left", which is worse than not listing them.
  // On a market board a person belongs when they hold work in that market, or when Homebase's own
  // role text says so ("Housekeeper broward Atlantic") — that second rule is what keeps somebody
  // on shift here with NOTHING assigned visible, which is the whole point of the idle check.
  const belongs = (p: any) => !market || market === 'all'
    || p.jobs.length > 0
    || new RegExp(market, 'i').test(p.role || '')
  const people = allPeople.filter(belongs)
  const elsewhere = allPeople.length - people.length
  return {
    people,
    elsewhere,
    onShift: people.length,
    clockedIn: people.filter(p => p.clockedIn).length,
    openShifts: (shifts as any[]).filter(s => s.open).length,
    // Anybody mid-job who is NOT clocked in, and anybody clocked in with nothing running — the
    // two questions a supervisor asks at 10am.
    idle: people.filter(p => p.clockedIn && !p.onNow.length && p.left > 0).map(p => p.name),
    notClocked: people.filter(p => !p.clockedIn && p.left > 0).map(p => p.name),
  }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authed = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
  if (!authed) return NextResponse.json({ ok: false, needsPassword: true, error: 'Password required' }, { status: 401 })
  try {
    const sp = req.nextUrl.searchParams
    const date = sp.get('date') || ''
    const market = sp.get('market') || ''
    const sheet: any = await buildDaySheet(date, market)
    // Additive: a Homebase hiccup costs the crew card, never the day sheet.
    let crew: any = null
    try { crew = await crewNow(String(sheet.date || date), market) } catch { crew = null }
    return NextResponse.json({ ...sheet, market: market || 'all', crew })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
