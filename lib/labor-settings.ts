// lib/labor-settings.ts
// Loads labor settings from the labor_settings table (editable in the
// Lighthouse settings page). Market row overrides the 'default' row,
// which overrides hardcoded fallbacks — the system always works, even
// before the SQL has run.
import { supabaseAdmin } from '@/lib/supabase-admin'

export type LaborSettings = {
  market: string
  pct_good: number
  pct_bad: number
  grace_min: number
  over_sched_min: number
  ot_weekly_hours: number
  attribution_min: number
}

const FALLBACK: LaborSettings = {
  market: 'default',
  pct_good: 30, pct_bad: 40,
  grace_min: 7, over_sched_min: 30,
  ot_weekly_hours: 40, attribution_min: 0.85,
}

export async function getLaborSettings(market = 'default'): Promise<LaborSettings> {
  try {
    const sb = supabaseAdmin()
    const { data } = await sb.from('labor_settings').select('*')
      .in('market', ['default', market.toLowerCase()])
    const def = (data || []).find(r => r.market === 'default')
    const mkt = (data || []).find(r => r.market === market.toLowerCase())
    return { ...FALLBACK, ...(def || {}), ...(mkt || {}), market: market.toLowerCase() }
  } catch {
    return { ...FALLBACK, market: market.toLowerCase() }
  }
}

export async function getAllLaborSettings(): Promise<LaborSettings[]> {
  try {
    const sb = supabaseAdmin()
    const { data } = await sb.from('labor_settings').select('*').order('market')
    const rows = data || []
    return rows.length ? rows.map(r => ({ ...FALLBACK, ...r })) : [FALLBACK]
  } catch {
    return [FALLBACK]
  }
}
