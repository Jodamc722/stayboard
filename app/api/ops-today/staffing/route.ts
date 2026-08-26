// STAFFING CHECK — who is clocked in / on shift (Homebase) vs what Breezeway actually has
// assigned to them today. Born from the 2026-08-08 audit: two cleaners were clocked in with
// ZERO tasks while everything on the board was assigned to others, and nobody could see it
// without cross-reading two systems. Names are typed by different humans in each system
// ("Shaany Christian" is "shaany espinoza" in Breezeway; "Rodiguez" vs "Rodriguez"), so the
// join uses the same fuzzy matcher as the labor KPIs — a spelling variant is NOT a gap.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getShifts, nameMatches, nameMatchesRoster } from '@/lib/homebase'
import { getTimecards } from '@/lib/homebase-labor'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TZ = 'America/New_York'
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const qd = String(req.nextUrl.searchParams.get('date') || '')
    const today = /^\d{4}-\d{2}-\d{2}$/.test(qd) ? qd : ymd(new Date())

    const db = supabaseAdmin()
    const [shifts, timecards, tRes] = await Promise.all([
      getShifts(today, TZ).catch(() => []),
      getTimecards(today, today).catch(() => []),
      db.from('breezeway_tasks_sync')
        .select('id,name,status,assignees,type_department')
        .eq('scheduled_date', today)
        .limit(2000),
    ])
    const tasks = (tRes.data || []).filter(t => !/delete|cancel/.test(String(t.status || '').toLowerCase()))

    // Breezeway assignee spellings -> how many tasks / cleans each carries today.
    const bzCount: Record<string, { tasks: number; cleans: number }> = {}
    for (const t of tasks) {
      const ppl = Array.isArray(t.assignees) ? t.assignees : []
      const isClean = /clean|housekeep|turn/.test(`${t.type_department || ''} ${t.name || ''}`.toLowerCase())
      for (const p of ppl) {
        const n = p && p.name ? String(p.name) : ''
        if (!n) continue
        bzCount[n] = bzCount[n] || { tasks: 0, cleans: 0 }
        bzCount[n].tasks++
        if (isClean) bzCount[n].cleans++
      }
    }
    const bzNames = Object.keys(bzCount)

    // The Homebase side of the join: everyone with a shift or a timecard today.
    const hbNames: string[] = []
    for (const t of timecards as any[]) if (t.name && hbNames.indexOf(t.name) < 0) hbNames.push(t.name)
    for (const s of shifts as any[]) if (s.name && !s.open && hbNames.indexOf(s.name) < 0) hbNames.push(s.name)

    const people = hbNames.map(name => {
      // ALL of this person's punches today, not the first one found.
      //
      // `.find()` returned whichever card happened to sort first — so somebody who clocked out for
      // lunch and clocked back in had two cards, and if the closed one came first the board showed
      // them as NOT on the clock while they were standing in a unit working. Every other surface in
      // the app filters `open && date === today`; this one, the one the ops board actually reads,
      // did not.
      const cards = (timecards as any[]).filter(t => nameMatches(t.name, name))
      const card = cards.find(c => c.open) || cards[0]
      const shift = (shifts as any[]).find(s => !s.open && nameMatches(s.name, name))
      // Every Breezeway spelling that resolves to THIS Homebase person (fuzzy full-name
      // match, or the unique-first-name fallback that bridges last-name drift).
      let nTasks = 0, nCleans = 0
      const aliases: string[] = []
      for (const bn of bzNames) {
        const hit = nameMatches(bn, name) || nameMatchesRoster(bn, hbNames) === name
        if (!hit) continue
        nTasks += bzCount[bn].tasks
        nCleans += bzCount[bn].cleans
        if (bn.trim().toLowerCase() !== name.trim().toLowerCase()) aliases.push(bn)
      }
      return {
        name,
        role: (shift && shift.role) || (card && card.role) || null,
        // On the clock if ANY card today is still open; worked if any card exists at all.
        clockedIn: cards.some(c => c.open && (!c.date || c.date === today)),
        worked: cards.length > 0,
        shift: shift ? shift.label : null,
        bzAlias: aliases[0] || null,
        tasks: nTasks,
        cleans: nCleans,
      }
    }).sort((a, b) => (a.tasks - b.tasks) || a.name.localeCompare(b.name))

    // Breezeway spellings that resolve to NOBODY on today's Homebase side — either someone
    // working without a shift/clock-in, a vendor crew, or a directory-name drift worth fixing.
    const claimed = new Set<string>()
    for (const p of people) {
      for (const bn of bzNames) if (nameMatches(bn, p.name) || nameMatchesRoster(bn, hbNames) === p.name) claimed.add(bn)
    }
    const assignedOffShift = bzNames.filter(bn => !claimed.has(bn))
      .map(bn => ({ name: bn, tasks: bzCount[bn].tasks, cleans: bzCount[bn].cleans }))
      .sort((a, b) => b.tasks - a.tasks)

    const idle = people.filter(p => (p.clockedIn || p.worked || p.shift) && p.tasks === 0)
    return NextResponse.json({
      ok: true,
      date: today,
      people,
      assignedOffShift,
      summary: {
        onToday: people.length,
        clockedIn: people.filter(p => p.clockedIn).length,
        nothingAssigned: idle.length,
        idleNames: idle.map(p => p.name),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) })
  }
}
