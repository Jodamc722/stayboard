// ONE PERSON'S TASK LIST — every Breezeway job assigned to them, open and done.
//
// Jon, 2026-09-24: his boss asked Eve for the full task list assigned to a cleaner at Arya. Eve
// could not answer it and neither could the app: /cleaners scored people on completed departure
// cleans, /schedule showed a day at a time across everyone, and nothing anywhere answered "what is
// on HER list". This page is that question, and it is the page Eve links to when she is asked.
//
// WHY IT IS NOT JUST A FILTER ON /schedule. A manager asking this is usually about to send it to
// somebody — a supervisor, an owner, the person themselves. So it is a page with a name in the
// title and a URL you can paste, listing work across every department rather than only cleans, and
// it goes forward as well as back: the list a person is judged on has to include what they have not
// done yet.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { LeanHead, Pill, Tag, LeanList, LeanRow, LeanSection, LeanEmpty } from '@/components/lean'
import { nameMatches, personKey, bestSpelling } from '@/lib/person-name'
import { isDepartureCleanName } from '@/lib/breezeway'
import { buildingOf } from '@/lib/segments'

export const dynamic = 'force-dynamic'

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const shift = (iso: string, n: number) => ymd(new Date(new Date(iso + 'T12:00:00Z').getTime() + n * 86400000))

type Row = {
  id: string; unit: string; building: string; task: string; dept: string
  date: string; state: string; minutes: number | null; assignees: string[]
  departure: boolean
}

function stateOf(t: any): string {
  const s = String(t?.status || '').toLowerCase()
  if (/delet|cancel|remove/.test(s)) return 'gone'
  if (t?.finished_at) return 'done'
  if (t?.started_at) return 'running'
  return 'open'
}

export default async function CrewPage({ params, searchParams }: {
  params: { name: string }; searchParams?: { days?: string; building?: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const who = decodeURIComponent(params.name || '').trim()
  const today = ymd(new Date())
  const days = Math.min(120, Math.max(7, Number(searchParams?.days) || 21))
  const from = shift(today, -days)
  const to = shift(today, days)
  const bldFilter = String(searchParams?.building || '').trim()

  const db = supabaseAdmin()
  // Paged: a busy person over six weeks can exceed PostgREST's 1000-row cap, and a truncated task
  // list shown to a manager is worse than no page at all.
  let raw: any[] = []
  for (let i = 0; i < 6; i++) {
    const { data: page } = await db.from('breezeway_tasks_sync')
      .select('id,name,type_department,status,scheduled_date,assignees,total_minutes,started_at,finished_at,reference_property_id')
      .gte('scheduled_date', from).lte('scheduled_date', to)
      .order('scheduled_date').order('id').range(i * 1000, i * 1000 + 999)
    raw = raw.concat(page || [])
    if (!page || page.length < 1000) break
  }
  const { data: props } = await db.from('breezeway_properties').select('reference_property_id,name')
  const nameOf: Record<string, string> = {}
  for (const p of (props || [])) if ((p as any).reference_property_id) nameOf[String((p as any).reference_property_id)] = String((p as any).name || '')

  const mine: Row[] = []
  const spellings: Record<string, string> = {}
  const everyone = new Set<string>()
  for (const t of raw) {
    if (stateOf(t) === 'gone') continue
    const names: string[] = Array.isArray(t.assignees)
      ? t.assignees.map((a: any) => String(a?.name || '').trim()).filter(Boolean) : []
    for (const n of names) everyone.add(n)
    if (!names.some(n => nameMatches(n, who))) continue
    for (const n of names) {
      if (!nameMatches(n, who)) continue
      const k = personKey(n)
      spellings[k] = spellings[k] ? bestSpelling(spellings[k], n) : n
    }
    const unit = nameOf[String(t.reference_property_id)] || 'Unknown unit'
    mine.push({
      id: String(t.id), unit, building: buildingOf(unit) || 'Other',
      task: String(t.name || ''), dept: String(t.type_department || ''),
      date: String(t.scheduled_date || '').slice(0, 10), state: stateOf(t),
      minutes: t.total_minutes != null ? Number(t.total_minutes) : null,
      assignees: names, departure: isDepartureCleanName(t.name),
    })
  }
  const matched = Object.values(spellings)
  const display = matched.length ? matched.sort((a, b) => b.length - a.length)[0] : who
  const rows = bldFilter ? mine.filter(r => r.building.toLowerCase() === bldFilter.toLowerCase()) : mine

  const upcoming = rows.filter(r => r.date >= today && r.state !== 'done')
  const past = rows.filter(r => !(r.date >= today && r.state !== 'done'))
  const buildings = Array.from(new Set(mine.map(r => r.building))).sort()
  const cleans = rows.filter(r => r.departure).length

  const Task = ({ r }: { r: Row }) => (
    <LeanRow key={r.id} name={r.unit}
      meta={r.task + ' · ' + r.date + (r.minutes ? ' · ' + r.minutes + 'm' : '')}
      tags={<>
        <Tag tone={r.state === 'done' ? 'emerald' : r.state === 'running' ? 'amber' : 'slate'}>{r.state}</Tag>
        {r.departure ? <Tag title="A real departure clean, not a deep or oven clean">turnover</Tag> : null}
        <Tag title="Breezeway department">{r.dept}</Tag>
        {r.assignees.length > 1 ? <Tag title={'Shared with ' + r.assignees.join(', ')}>+{r.assignees.length - 1}</Tag> : null}
      </>} />
  )

  return (
    <Shell>
      <LeanHead title={display}>
        <Pill title={'Tasks assigned between ' + from + ' and ' + to}>{rows.length} tasks</Pill>
        <Pill tone={upcoming.length ? 'amber' : 'slate'} title="Scheduled today or later and not finished">{upcoming.length} still to do</Pill>
        <Pill title="Real departure cleans in this window">{cleans} turnovers</Pill>
        <Pill title="Window either side of today">±{days} days</Pill>
      </LeanHead>

      {!matched.length ? (
        <LeanEmpty>
          Nobody matching <b>{who}</b> has Breezeway work assigned between {from} and {to}.
          {everyone.size ? <> Names with work in this window: {Array.from(everyone).sort().slice(0, 40).join(' · ')}</> : null}
        </LeanEmpty>
      ) : (
        <>
          {matched.length > 1 ? (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
              <b>More than one spelling matched</b> — {matched.join(', ')}. This page merges them. If they are different
              people, use the full name in the URL.
            </div>
          ) : null}
          {buildings.length > 1 ? (
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="text-muted">Building:</span>
              <a href={`/cleaners/${encodeURIComponent(who)}?days=${days}`}
                className={'rounded-lg border px-2 py-0.5 font-semibold ' + (!bldFilter ? 'border-ink bg-ink text-white' : 'border-line bg-white text-muted hover:text-ink')}>All</a>
              {buildings.map(b => (
                <a key={b} href={`/cleaners/${encodeURIComponent(who)}?days=${days}&building=${encodeURIComponent(b)}`}
                  className={'rounded-lg border px-2 py-0.5 font-semibold ' + (bldFilter.toLowerCase() === b.toLowerCase() ? 'border-ink bg-ink text-white' : 'border-line bg-white text-muted hover:text-ink')}>{b}</a>
              ))}
            </div>
          ) : null}

          <LeanSection title="Still to do" n={upcoming.length}>
            {!upcoming.length ? <LeanEmpty>Nothing outstanding.</LeanEmpty> : (
              <LeanList>{upcoming.map(r => <Task key={r.id} r={r} />)}</LeanList>
            )}
          </LeanSection>

          <LeanSection title="Done & past" n={past.length}>
            {!past.length ? <LeanEmpty>Nothing in the past half of this window.</LeanEmpty> : (
              <LeanList>{past.slice(0, 200).map(r => <Task key={r.id} r={r} />)}</LeanList>
            )}
          </LeanSection>
        </>
      )}
    </Shell>
  )
}
