'use client'
// MAINTENANCE — the presentation half of app/maintenance/page.tsx (lean pass, 2026-09-22). The page
// still does every query and the ranking; this only lays it out: one-line header, three tabs
// (Decide / By building / Unbilled), one row per thing.
import { useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Receipt } from 'lucide-react'
import { LeanHead, LeanTabs, Pill, Tag, IconBtn, LeanList, LeanRow, LeanEmpty, type Tone } from '@/components/lean'

export type TriageRow = {
  kind: 'wo' | 'task' | 'glitch'
  href: string
  title: string
  where: string
  who: string | null
  age: number
  flags: string[]        // 'unassigned' | 'overdue' | 'stale' | 'urgent' | 'blocked'
  score: number
}
type GridRow = { b: string; wo: number; task: number; glitch: number; blocked: number; unbilled: number; total: number }
type Unbilled = { id: string; name: string; unit: string; who: string | null; hours: number | null; age: number }

// The aging voice of the page: quiet under 3 days, amber to a week, loud after that.
const ageTone = (d: number): Tone => (d >= 7 ? 'rose' : d >= 3 ? 'amber' : 'slate')
const heatTone = (n: number): Tone => (n >= 5 ? 'rose' : n >= 2 ? 'amber' : 'slate')
const KIND: Record<TriageRow['kind'], { label: string; title: string }> = {
  wo: { label: 'W.O.', title: 'Work order (internal request)' },
  task: { label: 'Task', title: 'Breezeway maintenance task' },
  glitch: { label: 'Glitch', title: 'Guest-reported glitch' },
}

export function MaintenanceView({ verdict, counts, triage, grid, unbilled }: {
  verdict: string
  counts: { wo: number; unassigned: number; overdue: number; stale: number; unbilled: number; offline: number }
  triage: TriageRow[]; grid: GridRow[]; unbilled: Unbilled[]
}) {
  const [tab, setTab] = useState<'decide' | 'building' | 'unbilled'>('decide')

  return (
    <div>
      {/* The numbers that ARE the grip. Each still goes somewhere. */}
      <LeanHead title="Maintenance">
        <Link href="/requests"><Pill title="Open work orders — open the Work Orders page">{counts.wo} W.O. open</Pill></Link>
        <Pill tone={counts.unassigned ? 'rose' : 'slate'} onClick={() => setTab('decide')} title="Open items with nobody on them">{counts.unassigned} unassigned</Pill>
        <Pill tone={counts.overdue ? 'rose' : 'slate'} onClick={() => setTab('decide')} title="Past their due or scheduled date">{counts.overdue} overdue</Pill>
        <Pill tone={counts.stale ? 'amber' : 'slate'} onClick={() => setTab('decide')} title={'Sitting 7 days or more. ' + verdict}>{counts.stale} stale 7d+</Pill>
        <Link href="/blocked"><Pill tone={counts.offline ? 'amber' : 'slate'} title="Units blocked on the calendar right now — open Blocked units">{counts.offline} offline</Pill></Link>
      </LeanHead>

      <LeanTabs value={tab} onChange={setTab} tabs={[
        { key: 'decide', label: 'Decide now', n: triage.length },
        { key: 'building', label: 'By building', n: grid.length },
        { key: 'unbilled', label: 'Unbilled 30d', n: counts.unbilled },
      ]} />

      {/* TRIAGE — one list across work orders, Breezeway and glitches, worst first. */}
      {tab === 'decide' && (triage.length === 0 ? <LeanEmpty>Clean board — nothing unassigned, overdue or stale.</LeanEmpty> : (
        <>
          <LeanList>
            {triage.slice(0, 30).map((t, i) => (
              <LeanRow key={i}
                name={<Link href={t.href} className="hover:underline">{t.title}</Link>}
                meta={[t.where, t.who].filter(Boolean).join(' · ')}
                tags={<>
                  <Tag tone={ageTone(t.age)} title={t.age + ' days old'}>{t.age}d</Tag>
                  <Tag title={KIND[t.kind].title}>{KIND[t.kind].label}</Tag>
                  {t.flags.includes('unassigned') && <Tag tone="rose" title="Nobody is assigned">Assign</Tag>}
                  {t.flags.includes('overdue') && <Tag tone="rose" title="Past its due date">Overdue</Tag>}
                  {t.flags.includes('urgent') && <Tag tone="amber" title="Urgent or high priority">Priority</Tag>}
                  {t.flags.includes('blocked') && <Tag title="Marked blocked">Blocked</Tag>}
                  {t.flags.includes('stale') && !t.flags.includes('overdue') && <Tag tone="amber" title="Open a week or more">Stale</Tag>}
                </>}
                actions={<IconBtn title={t.kind === 'task' ? (t.href.startsWith('http') ? 'Open in Breezeway' : 'Open the plan') : t.kind === 'wo' ? 'Open the work order' : 'Open Guest Issues'} href={t.href}><ArrowUpRight size={14} /></IconBtn>} />
            ))}
          </LeanList>
          {triage.length > 30 && <p className="px-1 pt-2 text-[11.5px] text-muted">{triage.length - 30} more — clear these first.</p>}
        </>
      ))}

      {/* WHERE — open items per property; high numbers say where the grip is slipping. */}
      {tab === 'building' && (grid.length === 0 ? <LeanEmpty>Nothing open anywhere.</LeanEmpty> : (
        <LeanList>
          {grid.map(r => (
            <LeanRow key={r.b} name={r.b}
              tags={<>
                <Tag tone={heatTone(r.total)} title="Everything open here">{r.total} total</Tag>
                {r.wo > 0 && <Tag tone={heatTone(r.wo)} title="Open work orders">{r.wo} W.O.</Tag>}
                {r.task > 0 && <Tag tone={heatTone(r.task)} title="Open Breezeway maintenance tasks">{r.task} tasks</Tag>}
                {r.glitch > 0 && <Tag tone={heatTone(r.glitch)} title="Open guest glitches">{r.glitch} glitches</Tag>}
                {r.blocked > 0 && <Tag tone={heatTone(r.blocked)} title="Units offline now">{r.blocked} offline</Tag>}
                {r.unbilled > 0 && <Tag tone="violet" title="Closed maintenance with no billing, last 30 days">{r.unbilled} unbilled</Tag>}
              </>} />
          ))}
        </LeanList>
      ))}

      {/* MONEY — finished maintenance with no cost in Breezeway; enter it and it reaches the owner statement. */}
      {tab === 'unbilled' && (unbilled.length === 0 ? <LeanEmpty>Every closed maintenance task this month carries billing.</LeanEmpty> : (
        <>
          <LeanList>
            {unbilled.slice(0, 12).map(t => (
              <LeanRow key={t.id}
                name={t.name}
                meta={[t.unit, t.who, t.hours ? t.hours + 'h logged' : ''].filter(Boolean).join(' · ')}
                tags={<Tag tone={ageTone(t.age)} title={'Finished ' + t.age + ' days ago'}>{t.age}d</Tag>}
                actions={<IconBtn title="Enter billing (Billable Hours)" tone="brand" href="/billing"><Receipt size={14} /></IconBtn>} />
            ))}
          </LeanList>
          {unbilled.length > 12 && <p className="px-1 pt-2 text-[11.5px] text-muted">{unbilled.length - 12} more on the <Link className="underline" href="/billing">Billable Hours</Link> board.</p>}
        </>
      ))}
    </div>
  )
}
