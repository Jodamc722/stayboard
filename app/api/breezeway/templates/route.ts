// OUR TASK TEMPLATES, straight from Breezeway (Jon, 2026-08-25: "It should use our templates,
// formats, preventative maintenance template, field report, our inspection templates, etc.,
// pulled from Breezeway for creating tasks").
//
// The Add-task sheet used to offer seven hand-written presets that lived in this repo. Those
// drifted from what the field app actually shows an inspector, because the real checklists are
// edited in Breezeway by the people who run the work. This route reads the live list so the
// sheet offers the same formats the team already uses, and the created task carries the
// checklist rather than just a matching title.
//
// Never fatal: an empty list makes the sheet fall back to its built-in presets.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { breezewayConfigured, listBreezewayTemplates } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ ok: true, templates: [], reason: 'not configured' })
  try {
    const force = new URL(req.url).searchParams.get('refresh') === '1'
    const templates = await listBreezewayTemplates(force)
    const dept = String(new URL(req.url).searchParams.get('department') || '').toLowerCase().trim()
    const list = dept ? templates.filter(t => !t.department || t.department === dept) : templates
    return NextResponse.json({ ok: true, count: list.length, templates: list })
  } catch (e: any) {
    return NextResponse.json({ ok: true, templates: [], error: String(e?.message || e).slice(0, 160) })
  }
}
