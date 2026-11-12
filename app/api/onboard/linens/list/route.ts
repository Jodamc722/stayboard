// THE LINEN LIST, AS A FILE WORTH SENDING (Jon, 2026-11-12: "the quote linen need it to download with
// name, have ability to adjust the counts by par individual level. also need it to have item, then bed
// size and make nice"). The "What's needed" card on the Quote and Calculator posts exactly what is on
// the page — every quantity and per-line par already applied, typed-over quantities and added lines
// included — and gets back a designed file named for the unit or property:
//
//   POST { format: 'pdf' | 'xlsx', name, subtitle?, meta?: [{label,value}], sections: [{ label, rows: [{ item, size, par, qty }] }] }
//     → "<name> - Linen list - <YYYY-MM-DD>.pdf|xlsx"
//
// Nothing is priced and nothing is stored: this is the count sheet. The page did the arithmetic (lib/linens.ts),
// so the file cannot disagree with what was on screen.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel, type Gate } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { linenListPdf, linenListXlsx } from '@/lib/linen-list-doc'
import { linenFileName } from '@/lib/linens'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MAX_BODY = 200_000
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status })
const str = (v: any, max: number) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max)

async function gate(): Promise<Gate> {
  const g = await requireLevel('linens', 'view')
  if (!g.ok) return g
  if (!isVrLogin(g.access)) return { ok: false, res: hotelOnlyRes(), access: g.access }
  return g
}

function today(): { ymd: string; label: string } {
  const now = new Date()
  return {
    ymd: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now),
    label: new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }).format(now),
  }
}

type Row = { item: string; size: string; par: string; qty: number }
type Sec = { label: string; rows: Row[] }

/** Body → clean sections; empty names and zero quantities dropped, everything capped. */
function readSections(raw: any): Sec[] {
  const out: Sec[] = []
  for (const s of (Array.isArray(raw) ? raw : []).slice(0, 30)) {
    const rows: Row[] = []
    for (const r of (Array.isArray(s?.rows) ? s.rows : []).slice(0, 200)) {
      const qty = Math.max(0, Math.min(99_999, Math.round(Number(r?.qty) || 0)))
      const item = str(r?.item, 80)
      if (!item || !qty) continue
      rows.push({ item, size: str(r?.size, 30), par: str(r?.par, 12), qty })
    }
    if (rows.length) out.push({ label: str(s?.label, 40) || 'Other', rows })
  }
  return out
}


export async function POST(req: NextRequest) {
  const g = await gate()
  if (!g.ok) return g.res
  try {
    const raw = await req.text().catch(() => '')
    if (raw.length > MAX_BODY) return fail('That list is too large.', 413)
    let body: any = null
    try { body = JSON.parse(raw) } catch { body = null }
    if (!body || typeof body !== 'object') return fail('Send { format, name, sections }.', 400)
    const format = body.format === 'xlsx' ? 'xlsx' : body.format === 'pdf' ? 'pdf' : null
    if (!format) return fail('format must be pdf or xlsx.', 400)
    const sections = readSections(body.sections)
    if (!sections.length) return fail('Nothing on the list to download.', 400)
    const name = str(body.name, 100) || 'Linen quote'
    const subtitle = str(body.subtitle, 160)
    const meta = (Array.isArray(body.meta) ? body.meta : []).slice(0, 8).map((m: any) => ({ label: str(m?.label, 30), value: str(m?.value, 120) })).filter((m: any) => m.label && m.value)
    const { ymd, label: dateLabel } = today()
    const fileName = linenFileName(name, 'Linen list', format, ymd)
    const disposition = `attachment; filename="${fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`

    const input = { name, subtitle, meta, dateLabel, sections }
    if (format === 'pdf') {
      return new NextResponse(linenListPdf(input) as any, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': disposition, 'Cache-Control': 'no-store' } })
    }
    return new NextResponse(await linenListXlsx(input) as any, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': disposition, 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return fail(String(e?.message || e).slice(0, 200), 500)
  }
}
