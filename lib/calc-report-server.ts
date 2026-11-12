// Saving projection pages (lib/calc-report) in owner_reports. Server-only.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { makeCode } from './owner-report'
import { STAY_CONTACT } from './need-list-contact'
import { DEFAULT_SHOW, type CalcContent } from './calc-report'
import type { IncomeFull, IncomeInput } from './free-tools'

export async function createCalcReport(o: { input: IncomeInput; full: IncomeFull; source: 'public' | 'team'; by?: string | null; preparedFor?: string; title?: string }): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const p = STAY_CONTACT.person
  const today = new Date().toISOString().slice(0, 10)
  const name = o.input.building || o.full.area || 'Your home'
  const content: CalcContent = {
    meta: { kind: 'calc', v: 1, source: o.source },
    look: 'ivory',
    title: (o.title || '').trim() || (o.input.building ? o.input.building + ' rental projection' : 'Your rental projection'),
    preparedFor: (o.preparedFor || '').slice(0, 120),
    notes: '',
    show: { ...DEFAULT_SHOW, net: o.source === 'public' },
    input: o.input,
    full: { ...o.full, adjustments: [], adjTotal: 0, baseLo: 0, baseHi: 0 },
    contact: p ? { name: p.name, role: p.role, phone: p.phone, email: p.email, photo: p.photo } : {},
    team: { adjustments: o.full.adjustments || [], adjTotal: o.full.adjTotal || 0, baseLo: o.full.baseLo || 0, baseHi: o.full.baseHi || 0 },
  }
  const code = makeCode()
  const { error } = await supabaseAdmin().from('owner_reports').insert({
    code, title: content.title, scope_label: name.slice(0, 120), listing_ids: [], period_start: today, period_end: today, as_of: today,
    theme: 'calc', status: o.source === 'team' ? 'draft' : 'final', content, created_by: o.by || (o.source === 'public' ? 'free-tool' : null),
  })
  return error ? { ok: false, error: error.message } : { ok: true, code }
}

export async function readCalcReport(code: string): Promise<{ id: string; code: string; content: CalcContent; created_at: string; updated_at: string } | null> {
  if (!/^[0-9a-f]{12,32}$/i.test(code)) return null
  const { data } = await supabaseAdmin().from('owner_reports').select('id, code, content, created_at, updated_at').eq('code', code).limit(1)
  const r: any = (data || [])[0]
  return r && r.content?.meta?.kind === 'calc' ? r : null
}

export async function saveCalcReport(code: string, content: CalcContent): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin().from('owner_reports').update({ content, title: content.title, updated_at: new Date().toISOString() }).eq('code', code)
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** The team's recent projection pages, newest first. */
export async function listCalcReports(limit = 25): Promise<{ code: string; title: string; scope: string; preparedFor: string; source: string; by: string; at: string }[]> {
  const { data } = await supabaseAdmin().from('owner_reports').select('code, title, scope_label, created_by, updated_at, content').eq('theme', 'calc').order('updated_at', { ascending: false }).limit(limit)
  return ((data || []) as any[]).map(r => ({ code: r.code, title: r.title, scope: r.scope_label || '', preparedFor: String(r.content?.preparedFor || ''), source: String(r.content?.meta?.source || ''), by: r.created_by || '', at: r.updated_at }))
}
