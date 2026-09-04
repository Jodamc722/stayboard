// TEAM SCHEDULER LINKS — the desk side (signed in, feature 'schedule').
//   GET  → links + recent submissions
//   POST {action:'create', market, label?, passcode?} | {action:'passcode', id, passcode} | {action:'revoke', id} | {action:'feedback', id, feedback} | {action:'reviewed', id}
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
const MARKETS = ['Miami', 'Broward', 'North']
const str = (v: any) => (v == null ? '' : String(v)).trim()

export async function GET() {
  const g = await requireLevel('schedule', 'view'); if (!g.ok) return g.res
  const db = supabaseAdmin()
  const [{ data: links }, { data: subs }] = await Promise.all([
    db.from('schedule_links').select('*').order('created_at', { ascending: false }),
    db.from('schedule_submissions').select('*').order('created_at', { ascending: false }).limit(60),
  ])
  return NextResponse.json({ ok: true, links: links || [], submissions: subs || [] })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('schedule', 'edit'); if (!g.ok) return g.res
  const me = g.access.email || null
  const b = await req.json().catch(() => ({} as any))
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  try {
    if (b.action === 'create') {
      // 'All' = the ops review link: every market on one page, sortable, for whoever runs the day.
      const market = MARKETS.includes(b.market) || b.market === 'All' ? b.market : null
      if (!market) return NextResponse.json({ ok: false, error: 'market must be Miami, Broward, North or All' }, { status: 400 })
      const code = randomBytes(6).toString('hex')
      const { data, error } = await db.from('schedule_links').insert({ code, market, label: str(b.label).slice(0, 120) || (market === 'All' ? 'Ops schedule review · all markets' : market + ' team schedule'), passcode: str(b.passcode).slice(0, 40) || null, created_by: me }).select('*').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true, link: data, url: '/scheduler/' + code })
    }
    const id = str(b.id); if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    // Change or clear the passcode on a live link. Phones that saved the old one get the gate again.
    if (b.action === 'passcode') { const pc = str(b.passcode).slice(0, 40) || null; await db.from('schedule_links').update({ passcode: pc }).eq('id', id); return NextResponse.json({ ok: true, passcode: pc }) }
    if (b.action === 'revoke') { await db.from('schedule_links').update({ revoked_at: now }).eq('id', id); return NextResponse.json({ ok: true }) }
    if (b.action === 'feedback') {
      const feedback = str(b.feedback).slice(0, 4000)
      await db.from('schedule_submissions').update({ feedback: feedback || null, status: 'reviewed', reviewed_by: me, reviewed_at: now }).eq('id', id)
      return NextResponse.json({ ok: true })
    }
    if (b.action === 'reviewed') { await db.from('schedule_submissions').update({ status: 'reviewed', reviewed_by: me, reviewed_at: now }).eq('id', id); return NextResponse.json({ ok: true }) }
    return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
}
