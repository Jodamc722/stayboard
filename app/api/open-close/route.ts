// OPEN & CLOSE API (Jon, 2026-10-19).
//
//   GET  ?mode=open|close&date=YYYY-MM-DD   → the gates with their rows, carried items, the day record
//   POST { action: 'sign' | 'unsign' | 'carry' | 'resolve' | 'open' | 'close' }
//
// Lives under the Checklist feature key: whoever could tick the checklist can sign a gate and carry
// a row; viewing is the same 'view' level. The engine (lib/open-close) is the single read; nothing
// in the page computes a count of its own.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel, isSuperadmin } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { buildOpenClose, signGate, carryRow, resolveCarry, markDay, type OcMode } from '@/lib/open-close'
import { opsNow } from '@/lib/checklist-shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const str = (v: any) => (typeof v === 'string' ? v.trim() : '')
const modeOf = (v: any): OcMode => (str(v) === 'close' ? 'close' : 'open')

export async function GET(req: NextRequest) {
  const g = await requireLevel('checklist', 'view')
  if (!g.ok) return g.res
  const email = String(g.access.email || '')
  const mode = modeOf(req.nextUrl.searchParams.get('mode'))
  const date = str(req.nextUrl.searchParams.get('date')) || null
  try {
    const day = await buildOpenClose({ mode, date, viewer: { email, superadmin: isSuperadmin(email) } })
    return NextResponse.json({
      ...day,
      canSign: atLeast(g.access.levels['checklist'], 'edit'),
      canManage: atLeast(g.access.levels['checklist'], 'full') || isSuperadmin(email),
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('checklist', 'edit')
  if (!g.ok) return g.res
  const who = String(g.access.email || '')
  const b = await req.json().catch(() => ({}))
  const action = str(b.action)
  const day = /^\d{4}-\d{2}-\d{2}$/.test(str(b.day)) ? str(b.day) : opsNow().day
  try {
    let r: any
    switch (action) {
      case 'sign': r = await signGate(day, str(b.gate), modeOf(b.mode), who, true); break
      case 'unsign': r = await signGate(day, str(b.gate), modeOf(b.mode), who, false); break
      case 'carry': {
        const title = str(b.title); if (!title) return NextResponse.json({ ok: false, error: 'Nothing to carry.' }, { status: 400 })
        r = await carryRow(day, who, { key: str(b.key) || 'free', kind: str(b.kind) || null, unit: str(b.unit) || null, title, note: str(b.note) || null }); break
      }
      case 'resolve': r = await resolveCarry(str(b.id), who, str(b.how) === 'dropped' ? 'dropped' : 'done'); break
      case 'open': r = await markDay(day, who, 'open'); break
      case 'close': r = await markDay(day, who, 'close', str(b.note) || null, b.snapshot ?? null); break
      default: return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 })
    }
    if (!r || r.ok === false) return NextResponse.json({ ok: false, error: (r && r.error) || 'That did not save.' }, { status: 400 })
    return NextResponse.json(r)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
