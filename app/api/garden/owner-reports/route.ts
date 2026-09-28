// GARDEN HOTEL OWNER REPORTS — templates, datasets, and generation into the shared owner_reports
// table (the same page, editor, themes and share links as the VR owner review).
//   GET  ?datasets=1&from&to      → { templates, reports, sections, cards, themes } (+ datasets preview)
//   POST { op: 'generate', from, to, templateKey, theme?, title? }   → { id, code }
//        { op: 'save_template', template } | { op: 'reset_template', key }
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { generateGardenReport, listGardenReports } from '@/lib/garden/owner-report'
import { listTemplates, saveTemplate, resetTemplate, SECTIONS, CARD_KEYS } from '@/lib/garden/report-templates'
import { datasetsFor } from '@/lib/garden/report-datasets'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const THEMES = ['garden', 'capri', 'minimal', 'lux', 'ocean', 'sage', 'porcelain']
const FONTS = ['garden', 'modern', 'stay', 'editorial', 'classic']
const ok = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))

export async function GET(req: NextRequest) {
  const gate = await requireLevel('garden', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  try {
    const [templates, reports] = await Promise.all([listTemplates(), listGardenReports()])
    let datasets: any = null
    if (sp.get('datasets') && ok(sp.get('from')) && ok(sp.get('to'))) {
      const d = await datasetsFor(String(sp.get('from')), String(sp.get('to')))
      datasets = Object.values(d).map(x => ({ key: x.key, label: x.label, what: x.what, rows: x.rows.slice(0, 12), count: x.rows.length, summary: x.summary || null }))
    }
    return NextResponse.json({ ok: true, templates, reports, sections: SECTIONS, cards: CARD_KEYS, themes: THEMES, fonts: FONTS, datasets })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('garden', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const by = gate.access.email || 'someone'
  const op = String(b?.op || 'generate')
  try {
    if (op === 'generate') {
      if (!ok(b?.from) || !ok(b?.to) || b.from > b.to) return NextResponse.json({ error: 'from and to (YYYY-MM-DD) required' }, { status: 400 })
      const r = await generateGardenReport({ from: b.from, to: b.to, templateKey: String(b?.templateKey || 'owner-monthly'), theme: THEMES.includes(b?.theme) ? b.theme : undefined, title: b?.title ? String(b.title).slice(0, 160) : undefined, by })
      return NextResponse.json({ ok: true, ...r })
    }
    if (op === 'save_template') { if (!b?.template?.key || !b?.template?.name) return NextResponse.json({ error: 'template key and name required' }, { status: 400 }); await saveTemplate(b.template, by); return NextResponse.json({ ok: true, templates: await listTemplates() }) }
    if (op === 'reset_template') { await resetTemplate(String(b?.key || ''), by); return NextResponse.json({ ok: true, templates: await listTemplates() }) }
  } catch (e: any) { return NextResponse.json({ error: String(e?.message || e) }, { status: 500 }) }
  return NextResponse.json({ error: 'unknown op' }, { status: 400 })
}
