// PUBLIC (share-password gated) Botanica performance report for the hotel's Area GM.
// Daily stay-date rows since opening: inventory (phased), room nights sold, occupancy,
// revenue (ADR INCLUDES cleaning — matches every report already sent), cleaning revenue.
// No PII: numbers only, no guest data.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { cookies } from 'next/headers'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const CONFIRMED = ['confirmed', 'checked_in', 'checked_out']
const OPEN_DATE = '2026-05-01'
// Phased inventory (units live). A+B = 32 from May 4, Forrest +18 = 50 from Jun 17.
// When another building goes live, add a phase here.
const PHASES: { from: string; units: number }[] = [
  { from: '2026-05-04', units: 32 },
  { from: '2026-06-17', units: 50 },
]
function unitsOn(date: string): number {
  let u = 0
  for (const p of PHASES) { if (date >= p.from) u = p.units }
  return u
}
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(iso: string, n: number) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
function dow(iso: string) { return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }) }
function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function daysBetween(a: string, b: string): number {
  const ms = new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()
  return Math.round(ms / 86400000)
}

// Matches the "Botanica Report" project's methodology (May 2026 workbook): each stay's
// accommodation + cleaning (+ parking, $0 so far) divided by total stay nights = per-night
// value; only nights inside the window are summed, which splits cross-month stays correctly.
const fareOf = (m: any): number => num(m?.fareAccommodationAdjusted ?? m?.fareAccommodation) // 'Net Accom' — matches sheet to the cent (May $55,911.69 vs $55,911.71)
const cleaningOf = (m: any): number => num(m?.fareCleaning)

export async function GET(req: NextRequest) {
  const authed = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
  if (!authed) return NextResponse.json({ ok: false, needsPassword: true, error: 'Password required' }, { status: 401 })
  const debug = new URL(req.url).searchParams.get('debug') === '1'
  try {
    const db = supabaseAdmin()
    const today = ymd(new Date())

    // Botanica unit listings only — no "Full" combo listings, no retired listings.
    const { data: listings } = await db.from('guesty_listings').select('id,nickname,title,building,status,pictures')
    const ids: string[] = []
    const bannerCands: { name: string; url: string; count: number; full: boolean }[] = []
    for (const l of (listings || []) as any[]) {
      const name = str(l.nickname || l.title)
      if (!/botanica/i.test(str(l.building)) && !/botanica/i.test(name)) continue
      if (/inactive|disabled|archived|deleted/i.test(str(l.status))) continue
      const isFull = /\bfull\b/i.test(name)
      if (!isFull) ids.push(String(l.id))
      // Photos live on the mirror as an array of URL strings (see lib/guesty pictures map).
      const pics = Array.isArray(l.pictures) ? l.pictures.filter((p: any) => typeof p === 'string' && p.indexOf('https://') === 0) : []
      if (pics.length) bannerCands.push({ name, url: str(pics[0]), count: pics.length, full: isFull })
    }
    if (!ids.length) return NextResponse.json({ ok: false, error: 'No Botanica listings found' }, { status: 500 })
    // Banner photo: prefer a "Full"/building hero (usually the exterior), then the listing with the most photos.
    bannerCands.sort((a, b) => (a.full === b.full ? 0 : a.full ? -1 : 1) || b.count - a.count || a.name.localeCompare(b.name))
    const bannerImage = bannerCands.length ? bannerCands[0].url : null
    const bannerOptions = bannerCands.slice(0, 10).map(c => ({ name: c.name, url: c.url }))

    // All confirmed stays that touch [opening, today]. Paged — .in() + range like owner-report.
    let resv: any[] = []
    for (let i = 0; i < 10; i++) {
      const { data } = await db
        .from('guesty_reservations')
        .select('listing_id, check_in, check_out, nights, status, created_at, money:raw->money')
        .in('status', CONFIRMED)
        .in('listing_id', ids)
        .gt('check_out', OPEN_DATE)
        .lte('check_in', addDays(today, 400))
        .range(i * 1000, i * 1000 + 999)
      if (!data || data.length === 0) break
      resv = resv.concat(data)
      if (data.length < 1000) break
    }

    // Per stay-date accumulation. Nightly value = (fare + cleaning) / nights, so ADR includes
    // cleaning exactly like the reports Margaux already has; cleaning is also tracked on its own.
    const rns: Record<string, number> = {}
    const rev: Record<string, number> = {}
    const cln: Record<string, number> = {}
    // Arrival-keyed metrics, bucketed by CHECK-IN date: LOS (avg nights per stay) and booking
    // window (avg days between when a stay was booked and its check-in). Standard hotel convention.
    const arrCnt: Record<string, number> = {}
    const arrNts: Record<string, number> = {}
    const arrLead: Record<string, number> = {}
    const arrLeadCnt: Record<string, number> = {}
    // How far forward we show on-the-books nights: the last booked night, capped ~90 days out.
    // Nights past today are confirmed reservations that haven't arrived yet ("on the books").
    const FUTURE_CAP = 90
    const capDay = addDays(today, FUTURE_CAP)
    let lastDay = today
    for (const r of resv) {
      const co = str(r.check_out).slice(0, 10)
      if (co) { const ln = addDays(co, -1); if (ln > lastDay && ln <= capDay) lastDay = ln }
    }

    for (const r of resv) {
      const ci = str(r.check_in).slice(0, 10)
      const co = str(r.check_out).slice(0, 10)
      if (!ci || !co || co <= ci) continue
      const nights = Math.max(1, num(r.nights) || daysBetween(ci, co))
      const perNight = fareOf(r.money) / nights
      const perNightClean = cleaningOf(r.money) / nights
      // count LOS + booking window for stays that CHECK IN inside the shown window (incl. upcoming)
      if (ci >= OPEN_DATE && ci <= lastDay) {
        arrCnt[ci] = (arrCnt[ci] || 0) + 1
        arrNts[ci] = (arrNts[ci] || 0) + nights
        const cr = str(r.created_at).slice(0, 10)
        if (cr && cr <= ci) { arrLead[ci] = (arrLead[ci] || 0) + daysBetween(cr, ci); arrLeadCnt[ci] = (arrLeadCnt[ci] || 0) + 1 }
      }
      // walk the stay's nights, clipped to [opening, lastDay]
      let d = ci < OPEN_DATE ? OPEN_DATE : ci
      const stop = co <= lastDay ? co : addDays(lastDay, 1)
      while (d < stop) {
        rns[d] = (rns[d] || 0) + 1
        rev[d] = (rev[d] || 0) + perNight + perNightClean
        cln[d] = (cln[d] || 0) + perNightClean
        d = addDays(d, 1)
      }
    }

    const days: { date: string; dow: string; inv: number; rns: number; rev: number; cleaning: number; arr: number; arrNights: number; arrLead: number; arrLeadCnt: number }[] = []
    for (let d = OPEN_DATE; d <= lastDay; d = addDays(d, 1)) {
      days.push({ date: d, dow: dow(d), inv: unitsOn(d), rns: rns[d] || 0, rev: rev[d] || 0, cleaning: cln[d] || 0, arr: arrCnt[d] || 0, arrNights: arrNts[d] || 0, arrLead: arrLead[d] || 0, arrLeadCnt: arrLeadCnt[d] || 0 })
    }

    const { data: syncSt } = await db.from('guesty_sync_status').select('last_sync_at').eq('entity', 'reservations').maybeSingle()
    const lastSync = syncSt && syncSt.last_sync_at ? String(syncSt.last_sync_at) : null

    // ?debug=1 — monthly totals under each candidate fare field, to reconcile against the
    // spreadsheet the ownership team already has. Numbers only, still behind the share gate.
    let reconcile: any = undefined
    if (debug) {
      const CANDIDATES = ['fareAccommodation', 'fareAccommodationAdjusted', 'netIncome', 'hostPayout', 'subTotalPrice']
      reconcile = { months: {} as Record<string, any>, listingCount: ids.length, reservations: resv.length }
      for (const r of resv) {
        const ci = str(r.check_in).slice(0, 10)
        const co = str(r.check_out).slice(0, 10)
        if (!ci || !co || co <= ci) continue
        const nights = Math.max(1, num(r.nights) || daysBetween(ci, co))
        const cleanPer = cleaningOf(r.money) / nights
        let d = ci < OPEN_DATE ? OPEN_DATE : ci
        const stop = co <= today ? co : addDays(today, 1)
        while (d < stop) {
          const mk = d.slice(0, 7)
          const mo = reconcile.months[mk] || (reconcile.months[mk] = { rns: 0, cleaning: 0 })
          mo.rns += 1
          mo.cleaning += cleanPer
          for (const c of CANDIDATES) {
            mo[c] = (mo[c] || 0) + num((r.money || {})[c]) / nights + cleanPer
          }
          d = addDays(d, 1)
        }
      }
      for (const mk of Object.keys(reconcile.months)) {
        const mo = reconcile.months[mk]
        for (const k of Object.keys(mo)) mo[k] = Math.round(mo[k] * 100) / 100
      }
    }
    return NextResponse.json({ ok: true, label: 'Botanica', openedOn: PHASES[0].from, today, through: lastDay, bannerImage, bannerOptions, lastSync, phases: PHASES, days, reconcile })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
