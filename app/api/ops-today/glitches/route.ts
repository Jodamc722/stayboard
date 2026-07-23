// GLITCHES — guest-reported problems logged in Breezeway ("Guest Reported / Glitch — ...").
// These are the guest-impacting issues that need eyes fast, so they get their own tab.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const GLITCH = /glitch|guest\s*reported/i
const DONE = /complete|finish|cancel|closed/i
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(iso: string, n: number) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function daysBetween(a: string, b: string) { const x = new Date(a + 'T12:00:00'), y = new Date(b + 'T12:00:00'); return Math.round((+y - +x) / 86400000) }

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const db = supabaseAdmin()
    const today = ymd(new Date())
    const from = addDays(today, -45)
    const to = addDays(today, 14)
    const [lRes, tRes] = await Promise.all([
      db.from('guesty_listings').select('id,nickname,title,building,address_city'),
      db.from('breezeway_tasks_sync').select('id,reference_property_id,name,status,scheduled_date,assignees,report_url,type_department,created_at').ilike('name', '%guest reported%').gte('scheduled_date', from).lte('scheduled_date', to).limit(1000),
    ])
    const lmap: Record<string, { name: string; market: string }> = {}
    for (const l of (lRes.data || []) as any[]) { const name = l.nickname || l.title || 'Unit'; lmap[String(l.id)] = { name, market: marketOf(l.building, l.address_city, name) } }
    const glitches = ((tRes.data || []) as any[])
      .filter(t => GLITCH.test(str(t.name)) && !DONE.test(str(t.status)))
      .map(t => {
        const li = lmap[String(t.reference_property_id)]
        const ppl = Array.isArray(t.assignees) ? t.assignees : []
        const status = str(t.status).toLowerCase()
        const sd = str(t.scheduled_date).slice(0, 10)
        // strip the "Guest Reported / Glitch -" prefix so the issue reads cleanly
        const issue = str(t.name).replace(/^\s*guest\s*reported\s*\/?\s*(glitch)?\s*[-:]?\s*/i, '').trim() || str(t.name)
        return {
          id: String(t.id), unit: li ? li.name : 'Unknown unit', market: li ? li.market : 'Other',
          issue, rawName: str(t.name), status, scheduledDate: sd,
          ageDays: sd ? daysBetween(sd, today) : null,
          running: /progress|started/.test(status), unassigned: ppl.length === 0,
          assignees: ppl.map((p: any) => p && p.name).filter(Boolean), reportUrl: t.report_url || null,
        }
      })
      .sort((a, b) => (a.unassigned ? 0 : 1) - (b.unassigned ? 0 : 1) || (b.ageDays || 0) - (a.ageDays || 0) || a.unit.localeCompare(b.unit))
    return NextResponse.json({ ok: true, today, count: glitches.length, unassigned: glitches.filter(g => g.unassigned).length, glitches })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
