// KEEP CLAIMS FROM AGEING OUT.
//
// A due date nobody is shown is a wish. Everything else in the claims board — the channel windows,
// the turnover clock, the evidence gates — is worth nothing if the claim simply sits in Draft
// while the fortnight runs out, which is exactly what happened in Asana and is why claims were
// filed on day 12 in the first place.
//
// Once a morning: anything unfiled that is due today, overdue, or about to lose its evidence to
// the next guest gets a notification, and the claim remembers it was nudged so the same card does
// not shout every single day.
//
// BARE PATH ON PURPOSE — a Vercel cron pointed at a path WITH A QUERY STRING never fires.
// Auth matches the other crons: enforce the bearer token when CRON_SECRET is set, otherwise run
// open so the schedule works without extra configuration.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { notify } from '@/lib/notify'
import { claimTitle, daysUntil, money, num, itemsTotal, todayET, type Claim } from '@/lib/claims'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const OPEN_STAGES = ['draft', 'review', 'ready']

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    if (auth !== 'Bearer ' + secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const started = Date.now()
  const today = todayET()
  try {
    const db = supabaseAdmin()
    const { data, error } = await db.from('claims')
      .select('*').is('deleted_at', null).in('stage', OPEN_STAGES).limit(500)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    const claims = (data || []) as Claim[]
    const urgent: { claim: Claim; why: string; rank: number }[] = []
    for (const c of claims) {
      const due = daysUntil(c.due_on)
      const hard = daysUntil(c.deadline_on)
      const arrival = daysUntil(c.next_check_in)
      let why = ''
      let rank = 9
      // Ordered by how final the consequence is, not by how soon the date is.
      if (hard !== null && hard < 0) { why = 'the filing window has closed'; rank = 0 }
      else if (hard !== null && hard <= 2) { why = 'the filing window closes in ' + hard + ' day(s)'; rank = 1 }
      else if (arrival !== null && arrival >= 0 && arrival <= 1) { why = 'the next guest arrives ' + (arrival === 0 ? 'today' : 'tomorrow') + ' — photograph it now'; rank = 2 }
      else if (due !== null && due < 0) { why = 'due ' + Math.abs(due) + ' day(s) ago'; rank = 3 }
      else if (due !== null && due === 0) { why = 'due today'; rank = 4 }
      else if (due !== null && due <= 2) { why = 'due in ' + due + ' day(s)'; rank = 5 }
      if (!why) continue
      // Already shouted today. An alert that repeats every morning stops being an alert.
      if (str(c.nudged_on) === today) continue
      urgent.push({ claim: c, why, rank })
    }
    urgent.sort((a, b) => a.rank - b.rank)

    if (!urgent.length) {
      return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), elapsed_ms: Date.now() - started, checked: claims.length, nudged: 0 })
    }

    // Who hears about it: the claim's owner, plus every admin, because an ageing claim is money
    // leaving the building and that is not one person's private problem.
    let admins: string[] = []
    try {
      const { data: au } = await db.from('app_users').select('email').eq('role', 'admin').eq('status', 'active')
      admins = ((au || []) as any[]).map(a => str(a.email).toLowerCase()).filter(Boolean)
    } catch { /* the owner still gets it */ }

    let sent = 0
    for (const u of urgent.slice(0, 40)) {
      const c = u.claim
      const amount = num(c.amount_sought) || itemsTotal(c.items)
      const to = Array.from(new Set(admins.concat([str(c.assignee_email).toLowerCase()]).filter(Boolean)))
      if (!to.length) continue
      try {
        await notify(to, {
          kind: 'claim',
          title: 'Claim ' + u.why + ': ' + claimTitle(c),
          body: (amount > 0 ? money(amount) + ' · ' : '') + String(c.channel || '') + (c.due_on ? ' · due ' + c.due_on : ''),
          link: '/claims/' + c.id,
        })
        sent++
        await db.from('claims').update({ nudged_on: today }).eq('id', c.id)
      } catch { /* one bad claim must not stop the round */ }
    }

    return NextResponse.json({
      ok: true, ranAt: new Date().toISOString(), elapsed_ms: Date.now() - started,
      checked: claims.length, nudged: sent,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
