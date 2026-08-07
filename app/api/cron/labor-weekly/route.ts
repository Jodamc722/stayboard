// Weekly labor recap - manager email, Mondays. Includes dollar amounts.
// Covers the last FULL workweek (Sunday-Saturday by default, labor_settings.week_start).
// Recipients live in app_settings key 'labor_weekly': { enabled, fromEmail, to: string[] }.
// GET ?preview=1 (signed in) returns the HTML. GET ?test=1 sends to YOU only.
// Safe by default: nothing sends to the list until enabled + recipients are set.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting } from '@/lib/app-settings'
import { getOpsPresets } from '@/lib/app-settings'
import { vendorRegex } from '@/lib/ops-presets'
import { getShifts, nameMatches, type Shift } from '@/lib/homebase'
import { getTimecards } from '@/lib/homebase-labor'
import { getLaborSettings } from '@/lib/labor-settings'
import { sendGmail } from '@/lib/gmail-send'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5)
const r1 = (n: number) => Math.round(n * 10) / 10
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

type Cfg = { enabled?: boolean; fromEmail?: string; to?: string[] }
const DEFAULT_FROM = 'jon@stay-hospitality.com'

async function me(): Promise<string | null> {
  try {
    const s = createClient()
    const { data: { user } } = await s.auth.getUser()
    return user?.email ? String(user.email).toLowerCase() : null
  } catch { return null }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const isCron = secret ? auth === 'Bearer ' + secret : !!req.headers.get('x-vercel-cron') || auth === ''
  const who = await me()
  const sp = new URL(req.url).searchParams
  const test = !!sp.get('test'), preview = !!sp.get('preview')
  if ((test || preview) && !who) return NextResponse.json({ error: 'sign in' }, { status: 401 })
  if (!isCron && !who) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const cfg = await getSetting<Cfg>('labor_weekly', {})
    const fromEmail = String(cfg.fromEmail || DEFAULT_FROM)
    const settings = await getLaborSettings('default')
    const weekStart = (settings as any).week_start === 'monday' ? 'monday' : 'sunday'
    const now = new Date()
    const localDow = new Date(now.toLocaleString('en-US', { timeZone: TZ })).getDay()
    const offset = weekStart === 'sunday' ? localDow : (localDow + 6) % 7
    const thisWeekStart = addDays(now, -offset)
    const start = dISO(addDays(thisWeekStart, -7))
    const end = dISO(addDays(thisWeekStart, -1))

    const timecards = await getTimecards(start, end)
    const dates: string[] = []
    for (let d = new Date(start + 'T12:00:00Z'); dISO(d) <= end; d = addDays(d, 1)) dates.push(dISO(d))
    const perDay = await Promise.all(dates.map(async date => {
      try { return await getShifts(date, TZ) } catch { return [] as Shift[] }
    }))
    let schedCost = 0
    for (const day of perDay) for (const s of day as any[]) schedCost += (s as any).scheduledCost ?? 0

    const db = supabaseAdmin()
    const [lr, rr, tr] = await Promise.all([
      db.from('guesty_listings').select('id,nickname,title,building,address_city').limit(2000),
      db.from('guesty_reservations').select('listing_id,check_out,status,cleaning:raw->money->>fareCleaning')
        .gte('check_out', start).lte('check_out', end)
        .not('status', 'in', '("canceled","cancelled","declined")').limit(4000),
      db.from('breezeway_tasks_sync').select('id,name,type_department,assignee_name,finished_by_name,reference_property_id,finished_at,rate_paid')
        .gte('finished_at', start).lte('finished_at', end + 'T23:59:59').limit(5000),
    ])
    const presets = await getOpsPresets()
    const VEN = vendorRegex(presets.vendorBuildings)
    const lmap: Record<string, { vendor: boolean }> = {}
    for (const l of (lr.data || []) as any[]) {
      const nm = String(l.nickname || l.title || '')
      lmap[String(l.id)] = { vendor: VEN.test(String(l.building || '')) || VEN.test(nm) }
    }

    const cleanTasks = ((tr.data || []) as any[]).filter(t =>
      /clean|housekeep|turn/.test((String(t.type_department || '') + ' ' + String(t.name || '')).toLowerCase()))
    const doer = (t: any): string | null => t.assignee_name || t.finished_by_name || null
    const used: Record<string, boolean> = {}
    const atts: { fee: number | null; who: string | null; vendor: boolean }[] = []
    for (const r of (rr.data || []) as any[]) {
      const co = String(r.check_out).slice(0, 10)
      const coN = dISO(addDays(new Date(co + 'T12:00:00Z'), 1))
      const m = cleanTasks.find(t => !used[String(t.id)] &&
        String(t.reference_property_id) === String(r.listing_id) &&
        [co, coN].indexOf(String(t.finished_at).slice(0, 10)) >= 0)
      if (m) used[String(m.id)] = true
      const fee = Number((r as any).cleaning)
      atts.push({ fee: Number.isFinite(fee) ? fee : null, who: m ? doer(m) : null, vendor: !!lmap[String(r.listing_id)]?.vendor })
    }
    let inhouseFees = 0, vendorFees = 0
    for (const a of atts) { if (a.fee == null) continue; if (a.vendor) vendorFees += a.fee; else inhouseFees += a.fee }

    const payroll = timecards.reduce((a, t) => a + (t.laborCost ?? 0), 0)
    const hours = timecards.reduce((a, t) => a + (t.hours ?? 0), 0)
    const ot = timecards.reduce((a, t) => a + (t.overtimeHours ?? 0), 0)
    const pct = inhouseFees > 0 && payroll > 0 ? Math.round((payroll / inhouseFees) * 1000) / 10 : null
    const band = pct == null ? 'no data' : pct <= Number(settings.pct_good) ? 'on target' : pct <= Number(settings.pct_bad) ? 'watch' : 'over target'

    const names: string[] = []
    for (const t of timecards) if (names.indexOf(t.name) < 0) names.push(t.name)
    const people = names.map(name => {
      const mine = timecards.filter(t => t.name === name)
      const h = mine.reduce((a, t) => a + (t.hours ?? 0), 0)
      const o = mine.reduce((a, t) => a + (t.overtimeHours ?? 0), 0)
      const p = mine.reduce((a, t) => a + (t.laborCost ?? 0), 0)
      const cleans = cleanTasks.filter(t => { const d = doer(t); return !!d && nameMatches(d, name) }).length
      let rev = 0
      for (const a of atts) if (!a.vendor && a.fee != null && a.who && nameMatches(a.who, name)) rev += a.fee
      return { name, h: r1(h), o: r1(o), p, cleans, rev, per: p > 0 ? Math.round((rev / p) * 100) / 100 : null }
    }).sort((a, b) => b.rev - a.rev)

    const td = 'padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:left'
    const th = 'padding:6px 8px;border-bottom:2px solid #111827;font-size:11px;text-transform:uppercase;letter-spacing:.04em;text-align:left;color:#6b7280'
    const rows = people.map(x =>
      '<tr><td style="' + td + '"><b>' + x.name + '</b></td>' +
      '<td style="' + td + '">' + x.h + 'h' + (x.o ? ' <span style="color:#d97706">(+' + x.o + ' OT)</span>' : '') + '</td>' +
      '<td style="' + td + '">' + money(x.p) + '</td>' +
      '<td style="' + td + '">' + (x.cleans || '-') + '</td>' +
      '<td style="' + td + '">' + (x.rev ? money(x.rev) : '-') + '</td>' +
      '<td style="' + td + '">' + (x.per != null && x.rev ? '$' + x.per.toFixed(2) : '-') + '</td></tr>').join('')

    const bandColor = band === 'over target' ? '#dc2626' : band === 'watch' ? '#d97706' : '#059669'
    const html = '<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">' +
      '<div style="max-width:720px;margin:0 auto;padding:20px">' +
      '<div style="background:#111827;border-radius:12px;padding:18px 20px;margin-bottom:14px">' +
      '<p style="margin:0;color:#fff;font-size:16px;font-weight:700">Weekly labor recap</p>' +
      '<p style="margin:2px 0 0;color:#9ca3af;font-size:12.5px">' + start + ' to ' + end + ' - Homebase + Breezeway + Guesty</p></div>' +
      '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 18px;margin-bottom:14px">' +
      '<p style="margin:0 0 6px;font-size:14px"><b>' + r1(hours) + 'h</b> worked - payroll <b>' + money(payroll) + '</b> (scheduled ' + money(schedCost) + ')' + (ot ? ' - <span style="color:#d97706">' + r1(ot) + 'h overtime</span>' : '') + '</p>' +
      '<p style="margin:0 0 6px;font-size:14px">In-house cleaning revenue <b>' + money(inhouseFees) + '</b>' + (vendorFees ? ' - vendor-cleaned units brought ' + money(vendorFees) + ' more (not ours to clean)' : '') + '</p>' +
      '<p style="margin:0;font-size:14px">Labor at <b style="color:' + bandColor + '">' + (pct != null ? pct + '%' : '-') + '</b> of in-house revenue - <span style="color:' + bandColor + '">' + band + '</span> (goal &le; ' + settings.pct_good + '%)</p></div>' +
      '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 18px">' +
      '<p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;font-weight:700">Per person - revenue generated vs labor cost</p>' +
      '<table width="100%" cellspacing="0" cellpadding="0"><tr><th style="' + th + '">Person</th><th style="' + th + '">Hours</th><th style="' + th + '">Payroll</th><th style="' + th + '">Cleans</th><th style="' + th + '">Revenue</th><th style="' + th + '">Rev / $1</th></tr>' + rows + '</table>' +
      '<p style="margin:8px 0 0;font-size:11.5px;color:#6b7280">Revenue = guest cleaning fees on checkouts matched to that person&#39;s Breezeway cleans (in-house units only). People with hours but no cleans are maintenance/inspections or missing Breezeway assignees.</p></div>' +
      '<p style="margin:12px 0 0;font-size:11px;color:#9ca3af">Sent automatically by Lighthouse every Monday. Full detail: /labor.</p>' +
      '</div></body></html>'

    const subject = 'Weekly labor recap ' + start + ' to ' + end + ': ' + money(payroll) + ' payroll vs ' + money(inhouseFees) + ' in-house revenue' + (pct != null ? ' (' + pct + '%)' : '')

    if (preview) return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    if (test) {
      const r = await sendGmail({ fromEmail, to: [who as string], subject: '[TEST] ' + subject, html })
      return NextResponse.json({ ok: r.ok, test: true, to: who, error: r.error })
    }
    if (cfg.enabled !== true) return NextResponse.json({ ok: true, skipped: 'labor_weekly not enabled - set app_settings labor_weekly { enabled, to } ' })
    const to = (cfg.to || []).filter(Boolean)
    if (!to.length) return NextResponse.json({ ok: true, skipped: 'no recipients' })
    const r = await sendGmail({ fromEmail, to, subject, html })
    return NextResponse.json({ ok: r.ok, to: to.length, subject, error: r.error })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) })
  }
}
