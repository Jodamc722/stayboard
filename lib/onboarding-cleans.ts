// ONBOARDING CLEANS ROLL FORWARD (Jon, 2026-11-19: "You can keep moving them if not completed to the
// next day"). An "Onboarding Clean — <unit>" task that is still open on a day after its date is moved to
// today, the same task, never a second one. Runs with the property programs each morning. It only ever
// changes the date: the people on it, the checklist and the notes are left as they are.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { updateBreezewayTask, breezewayConfigured } from './breezeway'

const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const DONE = /finish|complet|closed|delet|cancel|void|approv/i
export const ONBOARDING_CLEAN_RE = /^\s*onboarding clean\b/i

export async function rollOnboardingCleans(opts: { dryRun?: boolean } = {}): Promise<{ ok: boolean; today: string; moved: { id: string; name: string; from: string }[]; failed: { id: string; name: string; error: string }[] }> {
  const today = todayET()
  const out = { ok: true, today, moved: [] as { id: string; name: string; from: string }[], failed: [] as { id: string; name: string; error: string }[] }
  if (!breezewayConfigured()) return out
  const db = supabaseAdmin()
  const since = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10)
  const { data, error } = await db.from('breezeway_tasks_sync').select('id,name,status,scheduled_date,finished_at')
    .ilike('name', 'Onboarding Clean%').lt('scheduled_date', today).gte('scheduled_date', since).is('finished_at', null).limit(200)
  if (error) return { ...out, ok: false }
  const late = ((data || []) as any[]).filter(t => ONBOARDING_CLEAN_RE.test(String(t.name || '')) && !DONE.test(String(t.status || ''))).slice(0, 60)
  for (const t of late) {
    const row = { id: String(t.id), name: String(t.name), from: String(t.scheduled_date) }
    if (opts.dryRun) { out.moved.push(row); continue }
    try {
      const r = await updateBreezewayTask(t.id, { scheduled_date: today })
      if (!r.ok) { out.failed.push({ id: row.id, name: row.name, error: `Breezeway ${r.status}` }); continue }
      await db.from('breezeway_tasks_sync').update({ scheduled_date: today }).eq('id', row.id)
      out.moved.push(row)
    } catch (e: any) { out.failed.push({ id: row.id, name: row.name, error: String(e?.message || e).slice(0, 120) }) }
  }
  return out
}
