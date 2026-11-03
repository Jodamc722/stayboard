// ONE OPEN COPY OF A JOB (Jon, 2026-11-03: "no duplicates of Lighthouse tasks should be created, only
// moving the incomplete tasks … you should be able to cancel these").
//
// The create guard (lib/breezeway createBreezewayTask) stops new copies. This is the sweep for the
// ones that already exist — LIGHTHOUSE'S OWN JOBS ONLY: the preventative programs ("A/C filter change
// — 906/6") and the property programs ("Parking Check: Eden"). Breezeway's own recurring tasks (Daily
// Pool testing on every day of the month) are not ours and are never touched.
//
// For one job at one unit: of the open copies dated today or earlier, the latest is kept (that is
// where the job was moved to) and the older ones are CANCELLED — cancel, not complete, because nobody
// did them. A copy dated ahead is the next cycle and stays; only a second copy on the SAME future day
// is a duplicate.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { cancelBreezewayTask } from './breezeway'
import { isTaskDone, isTaskGone } from './task-categories'

const SKIP = /\b(departure|turnover|check-?out|mid-?stay|arrival)\s+clean|\binspection\b/i
const keyOf = (n: any) => String(n ?? '').replace(/^\s*\[Moved to [^\]]+\]\s*/i, '').toLowerCase().replace(/\s+/g, ' ').trim()
const ymd = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10)

export type DupGroup = { unit: string; name: string; keep: { id: string; date: string }; cancel: { id: string; date: string }[] }

/** Is this one of the jobs Lighthouse files on a schedule? */
async function ourJobs(): Promise<(name: string) => boolean> {
  const labels: string[] = [], prefixes: string[] = []
  try { const { getCadenceCfg } = await import('./suggestions'); for (const c of (await getCadenceCfg()).cadences) if (c.label) labels.push(c.label.toLowerCase().trim() + ' — ') } catch { /* none */ }
  try { const { loadPrograms } = await import('./site-programs'); for (const p of await loadPrograms()) if (p.name) prefixes.push(p.name.toLowerCase().trim() + ':') } catch { /* none */ }
  return (name: string) => { const n = keyOf(name); return labels.some(l => n.startsWith(l)) || prefixes.some(p => n.startsWith(p)) }
}

export async function findDuplicates(opts: { only?: RegExp } = {}): Promise<DupGroup[]> {
  const db = supabaseAdmin()
  const ours = await ourJobs()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const rows: any[] = []
  for (let i = 0; i < 20; i++) {
    const { data } = await db.from('breezeway_tasks_sync').select('id,name,status,finished_at,scheduled_date,home_id,reference_property_id')
      .gte('scheduled_date', ymd(-120)).lte('scheduled_date', ymd(120)).order('id').range(i * 1000, i * 1000 + 999)
    if (!data || !data.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  const names: Record<string, string> = {}
  try {
    const refs = Array.from(new Set(rows.map(r => String(r.reference_property_id || '')).filter(Boolean)))
    for (let i = 0; i < refs.length; i += 200) {
      const { data } = await db.from('guesty_listings').select('id,nickname,title').in('id', refs.slice(i, i + 200))
      for (const l of (data || []) as any[]) names[String(l.id)] = String(l.nickname || l.title || '')
    }
  } catch { /* ids only */ }
  const groups: Record<string, any[]> = {}
  for (const t of rows) {
    if (isTaskDone(t.status, t.finished_at) || isTaskGone(t.status)) continue
    const k = keyOf(t.name)
    if (!k || SKIP.test(k) || !ours(String(t.name)) || (opts.only && !opts.only.test(String(t.name)))) continue
    const place = t.reference_property_id ? 'L' + t.reference_property_id : t.home_id != null ? 'H' + t.home_id : ''
    if (!place) continue
    ;(groups[place + '|' + k] = groups[place + '|' + k] || []).push(t)
  }
  const out: DupGroup[] = []
  for (const list of Object.values(groups)) {
    if (list.length < 2) continue
    list.sort((a, b) => String(b.scheduled_date).localeCompare(String(a.scheduled_date)) || Number(b.id) - Number(a.id))
    const day = (t: any) => String(t.scheduled_date || '').slice(0, 10)
    const due = list.filter(t => day(t) <= today)
    const rest: any[] = due.slice(1)                    // late copies under the latest one
    const seenDay = new Set<string>()
    for (const t of list.filter(t => day(t) > today)) { if (seenDay.has(day(t))) rest.push(t); else seenDay.add(day(t)) }
    if (!rest.length) continue
    const keep = due[0] || list[0]
    out.push({
      unit: names[String(keep.reference_property_id || '')] || String(keep.reference_property_id || keep.home_id || ''),
      name: String(keep.name), keep: { id: String(keep.id), date: String(keep.scheduled_date || '').slice(0, 10) },
      cancel: rest.map(t => ({ id: String(t.id), date: String(t.scheduled_date || '').slice(0, 10) })),
    })
  }
  return out.sort((a, b) => b.cancel.length - a.cancel.length)
}

export async function cancelDuplicates(opts: { only?: RegExp; max?: number } = {}): Promise<{ groups: number; cancelled: number; failed: string[] }> {
  const groups = await findDuplicates({ only: opts.only })
  const db = supabaseAdmin()
  let cancelled = 0, budget = opts.max ?? 200
  const failed: string[] = []
  for (const g of groups) {
    for (const x of g.cancel) {
      if (budget-- <= 0) break
      const r = await cancelBreezewayTask(x.id).catch(() => ({ ok: false } as any))
      if (r.ok) { cancelled++; try { await db.from('breezeway_tasks_sync').update({ status: 'cancelled' }).eq('id', x.id) } catch { /* sync */ } }
      else failed.push(x.id)
    }
  }
  return { groups: groups.length, cancelled, failed }
}
