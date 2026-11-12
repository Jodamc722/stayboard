// THE PROJECTION PAGE (Jon, 2026-11-12: "once the projection is generated it should open to a new page,
// where they can download, that way the numbers and page fit properly" — and "from rental projections our
// team [should be able] to generate these projections and edit the looks").
//
// One saved page per projection, in owner_reports (content.meta.kind 'calc'), shown at /r/<code>:
//   · an owner who unlocks the free calculator lands on theirs (public, read-only, PDF download)
//   · the sales team makes one from Sales → Projections library, then edits it on the page itself:
//     the look, the title, who it is for, every figure, which sections show, and a note
// The calculator's percentages never reach the page; the team sees them only in the editor's panel.
// Isomorphic types and helpers; the database writes live in lib/calc-report-server.
import type { IncomeFull, IncomeInput } from './free-tools'

export type CalcLook = 'ivory' | 'navy' | 'minimal'
export const CALC_LOOKS: { key: CalcLook; label: string }[] = [
  { key: 'ivory', label: 'Ivory' }, { key: 'navy', label: 'Navy' }, { key: 'minimal', label: 'Minimal' },
]
export type CalcShow = { months: boolean; comps: boolean; nearby: boolean; net: boolean }
export type CalcContact = { name?: string; role?: string; phone?: string; email?: string; photo?: string }
export type CalcContent = {
  meta: { kind: 'calc'; v: 1; source: 'public' | 'team' }
  look: CalcLook
  title: string
  preparedFor: string
  notes: string
  show: CalcShow
  input: IncomeInput
  full: IncomeFull
  contact: CalcContact
  /** The calculator's adjustments, for the team's eyes only (stripped before a public render). */
  team?: { adjustments: { label: string; pct: number }[]; adjTotal: number; baseLo: number; baseHi: number }
}

export const DEFAULT_SHOW: CalcShow = { months: true, comps: true, nearby: true, net: true }

export function describeHome(i: IncomeInput): string {
  return [i.bedrooms === 0 ? 'Studio' : i.bedrooms + ' bedroom' + (i.bedrooms === 1 ? '' : 's'), i.bathrooms ? i.bathrooms + ' bath' : '', i.sqft ? i.sqft.toLocaleString('en-US') + ' SF' : '',
    i.view && i.view !== 'none' ? ({ city: 'City view', water: 'Water view', ocean: 'Ocean view', beachfront: 'Beachfront' } as any)[i.view] : '', i.balcony ? 'Balcony' : ''].filter(Boolean).join(' · ')
}

/** What the page may show the public: no percentages, no base. */
export function publicContent(c: CalcContent): CalcContent {
  const { team, ...rest } = c
  void team
  return { ...rest, full: { ...c.full, adjustments: [], adjTotal: 0, baseLo: 0, baseHi: 0 } }
}

const num = (v: any, d: number) => { const x = Number(v); return Number.isFinite(x) && x >= 0 && x < 1e8 ? Math.round(x) : d }
const txt = (v: any, n: number, d: string) => (typeof v === 'string' ? v.slice(0, n) : d)

/** The team's edits, merged onto a saved page. Only these fields can change. */
export function applyEdits(c: CalcContent, e: any): CalcContent {
  if (!e || typeof e !== 'object') return c
  const f = { ...c.full }
  for (const k of ['lo', 'hi', 'monthLo', 'monthHi', 'nightlyLo', 'nightlyHi', 'occLo', 'occHi', 'netLo', 'netHi'] as const) if (e.full && k in e.full) (f as any)[k] = num(e.full[k], (f as any)[k])
  if (e.full && typeof e.full.area === 'string') f.area = e.full.area.slice(0, 80)
  // the months keep their shape and scale with the yearly range when the range is edited by hand
  if (e.full && ('lo' in e.full || 'hi' in e.full) && c.full.lo > 0 && c.full.hi > 0) {
    const kl = f.lo / c.full.lo, kh = f.hi / c.full.hi
    f.months = c.full.months.map(m => ({ lo: Math.round(m.lo * kl / 100) * 100, hi: Math.round(m.hi * kh / 100) * 100 }))
  }
  return {
    ...c,
    look: CALC_LOOKS.some(l => l.key === e.look) ? e.look : c.look,
    title: txt(e.title, 120, c.title), preparedFor: txt(e.preparedFor, 120, c.preparedFor), notes: txt(e.notes, 1500, c.notes),
    show: e.show && typeof e.show === 'object' ? { months: e.show.months !== false, comps: e.show.comps !== false, nearby: e.show.nearby !== false, net: e.show.net !== false } : c.show,
    full: f,
  }
}
