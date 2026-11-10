'use client'
// AUTOMATIONS — the Upkeep page's fourth tab (Jon, 2026-11-09: "automated task creations (should
// live in upkeep)"). Registry + state: lib/task-automations · API: /api/upkeep/automations.
//
// Every way a Breezeway task gets created, moved or closed by Lighthouse, one row each: what it
// makes, when it runs, its last receipt, whether it is on, its cap, who gets the work, what stops a
// duplicate, and how it treats the no-inspection buildings. The rows that run on their own come
// first; the buttons people press are listed under them so the list is complete.
//
// The switch on a row writes that creator's EXISTING setting (owner only — the same bar as the
// settings panels). A creator with no switch says "always on" instead of showing a dead toggle.
// Rows stack on a phone: name and switch on top, the facts underneath in one column.
import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Loader2, RefreshCw, Settings2, ShieldCheck, UserX, Building2, Hand, Bot, Archive } from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import { Tag, LeanEmpty, type Tone } from '@/components/lean'
import type { TaskAutomationsPayload, TaskCreatorState, CreatorGroup } from '@/lib/task-automations'

const API = '/api/upkeep/automations'
const GROUP_ORDER: CreatorGroup[] = ['Programs', 'Preventative', 'Inspections', 'Housekeeping moves', 'Guests', 'Eve', 'People', 'Retired']
const GROUP_SUB: Record<CreatorGroup, string> = {
  Programs: 'Scheduled walks and checks at a building or unit',
  Preventative: 'Work that comes due on a clock — filters, coils, deep cleans, batteries',
  Inspections: 'Inspections Lighthouse files on its own',
  'Housekeeping moves': 'These move or close tasks; they do not create work',
  Guests: 'Tasks that start with a guest',
  Eve: 'What Eve may create',
  People: 'Buttons — a person decides each time',
  Retired: 'Replaced by a property program',
}

function ago(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const m = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return m + ' min ago'
  const h = Math.round(m / 60)
  if (h < 36) return h + 'h ago'
  return Math.round(h / 24) + ' days ago'
}
const exact = (iso: string | null | undefined) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' }

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-bold uppercase tracking-wide text-muted/80">{label}</dt>
      <dd className="text-[12.5px] text-ink break-words">{children}</dd>
    </div>
  )
}

function Switch({ on, disabled, busy, onClick, label }: { on: boolean; disabled: boolean; busy: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={disabled ? 'Only the owner can change this' : on ? 'Switch off' : 'Switch on'}
      disabled={disabled || busy} onClick={onClick}
      className={'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ' + (on ? 'bg-emerald-500' : 'bg-slate-300') + (disabled ? ' opacity-60 cursor-not-allowed' : '')}>
      <span className={'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ' + (on ? 'translate-x-[22px]' : 'translate-x-[2px]')} />
      {busy ? <Loader2 size={12} className="absolute -right-4 animate-spin text-muted" /> : null}
    </button>
  )
}

export function UpkeepAutomations({ onOpenPrograms }: { onOpenPrograms?: () => void }) {
  const { data, loading, error, refresh } = useCachedFetch<TaskAutomationsPayload>(API, { ttl: 60_000 })
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [local, setLocal] = useState<Record<string, boolean>>({})

  const groups = useMemo(() => {
    const out: { group: CreatorGroup; rows: TaskCreatorState[] }[] = []
    for (const g of GROUP_ORDER) {
      const rows = (data?.creators || []).filter(c => c.group === g)
      if (rows.length) out.push({ group: g, rows })
    }
    return out
  }, [data])

  const reload = () => { invalidateCache(API); refresh() }

  const flip = async (c: TaskCreatorState, next: boolean) => {
    if (busy) return
    // Switching ON lets the app create real work for named staff — say so before it happens.
    if (next && !window.confirm('Switch on “' + c.label + '”?\n\nLighthouse will then act in Breezeway on its own: ' + c.makes)) return
    setBusy(c.key); setErr('')
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: c.key, on: next }) })
      const j = await res.json().catch(() => ({} as any))
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'could not save it')
      setLocal(l => ({ ...l, [c.key]: next }))
      reload()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }

  if (loading && !data) return <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-2" /> Reading every automation…</LeanEmpty>
  if (!data || !data.ok) return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{(data && data.error) || error || 'Nothing loaded.'}</div>

  const autos = data.creators.filter(c => c.kind === 'auto')
  const isOn = (c: TaskCreatorState) => (c.key in local ? local[c.key] : c.on === true)
  const onCount = autos.filter(c => isOn(c) && !c.heldByMaster).length

  const settingsLink = (c: TaskCreatorState) => {
    if (!c.settingsHref) return null
    const cls = 'inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:underline'
    if (c.settingsHref === '#property') return onOpenPrograms ? <button type="button" onClick={onOpenPrograms} className={cls}><Settings2 size={12} /> {c.settingsLabel || 'Property programs'}</button> : null
    return <Link href={c.settingsHref} className={cls}><Settings2 size={12} /> {c.settingsLabel || 'Settings'}</Link>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 flex-wrap">
        <p className="text-[12.5px] text-muted flex-1 min-w-[220px]">
          Everything that creates, moves or closes a Breezeway task. <b className="text-ink">{onCount} of {autos.length}</b> automatic ones are running.
          {data.madeToday ? <> <b className="text-ink">{data.madeToday.total} task{data.madeToday.total === 1 ? '' : 's'} created today</b> across every creator{data.madeToday.moved ? ', ' + data.madeToday.moved + ' moved instead of duplicated' : ''}{data.madeToday.removed ? ', ' + data.madeToday.removed + ' duplicate' + (data.madeToday.removed === 1 ? '' : 's') + ' removed' : ''}.</> : null}
          {data.isOwner ? ' Flip a switch to turn one on or off; the detailed knobs open from its settings link.' : ' Only the owner can flip a switch.'}
        </p>
        <button type="button" onClick={reload} className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </div>
      {err ? <p className="text-[12.5px] text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{err}</p> : null}

      {/* ── THE RULES EVERY CREATOR SHARES (read-only here) ── */}
      <section className="rounded-2xl border border-line bg-white p-3 grid gap-3 sm:grid-cols-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink"><UserX size={13} /> Never assigned</div>
          <p className="text-[12px] text-muted mt-0.5 break-words">{data.rules.neverAssign.length ? data.rules.neverAssign.join(', ') : 'Nobody on the list'}</p>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink"><Building2 size={13} /> No inspections at</div>
          <p className="text-[12px] text-muted mt-0.5 break-words">{data.rules.noInspections.length ? data.rules.noInspections.join(', ') : 'No building excluded'}</p>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink"><ShieldCheck size={13} /> One open task per job</div>
          <p className="text-[12px] text-muted mt-0.5">A create that finds the same job already open on the unit moves that task instead of making a second.</p>
        </div>
        <p className="sm:col-span-3 text-[11.5px] text-muted">
          These apply to every automatic creator below. Change the lists in <Link href="/users?tab=settings&panel=automation" className="font-semibold text-brand-700 hover:underline">Users &amp; admin → Task automation</Link>.
          {data.rules.noWelcomeCalls.length ? ' No welcome calls at: ' + data.rules.noWelcomeCalls.join(', ') + '.' : ''}
        </p>
      </section>

      {groups.map(({ group, rows }) => (
        <section key={group} className="rounded-2xl border border-line bg-white overflow-hidden">
          <header className="px-3 py-2 border-b border-line flex items-baseline gap-2 flex-wrap">
            <h3 className="text-[13px] font-bold text-ink inline-flex items-center gap-1.5">
              {group === 'People' ? <Hand size={13} /> : group === 'Retired' ? <Archive size={13} /> : <Bot size={13} />} {group}
            </h3>
            <span className="text-[11.5px] text-muted">{GROUP_SUB[group]}</span>
          </header>
          <ul className="divide-y divide-line">
            {rows.map(c => {
              const on = isOn(c)
              const run = c.lastRun
              const tone: Tone = c.kind === 'human' ? 'slate' : c.kind === 'retired' ? 'slate' : c.heldByMaster ? 'amber' : on ? 'emerald' : 'slate'
              const word = c.kind === 'human' ? 'By hand' : c.kind === 'retired' ? 'Retired' : c.heldByMaster ? 'Held' : c.on === null ? 'Always on' : on ? 'On' : 'Off'
              return (
                <li key={c.key} className={'px-3 py-3 ' + (c.kind === 'retired' ? 'opacity-70' : '')}>
                  {/* name + switch: one line on a desktop, the switch drops under the name on a phone */}
                  <div className="flex items-start gap-3 flex-wrap sm:flex-nowrap">
                    <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13.5px] font-semibold text-ink">{c.label}</span>
                        <Tag tone={tone} title={c.onWhy}>{word}</Tag>
                      </div>
                      <p className="text-[12.5px] text-muted mt-0.5">{c.makes}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.canToggle ? <Switch on={on} disabled={!data.isOwner} busy={busy === c.key} onClick={() => flip(c, !on)} label={c.label} /> : null}
                      <span className="text-[11.5px] text-muted max-w-[220px]">{c.key in local ? (on ? 'On' : 'Off') : c.onWhy}</span>
                    </div>
                  </div>
                  <dl className="mt-2 grid gap-x-4 gap-y-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                    <Fact label="Runs">{c.schedule}</Fact>
                    <Fact label="Last run">
                      {!c.hasReceipt ? <span className="text-muted">not recorded</span>
                        : !run ? <span className="text-muted">no run recorded yet</span>
                        : <span title={exact(run.at)}>
                            <span className={run.ok ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>{run.ok ? 'OK' : 'Failed'}</span>
                            {' · '}{ago(run.at)}
                            {c.madeToday == null && c.countIsMade && run.itemCount != null ? <> · <b>made {run.itemCount}</b></> : null}
                            {!run.ok && run.error ? <span className="block text-[11.5px] text-rose-700 break-words">{run.error}</span> : null}
                          </span>}
                    </Fact>
                    {c.madeToday != null ? <Fact label="Made today"><b>{c.madeToday}</b>{c.countIsMade && run && run.itemCount != null ? <span className="text-muted"> · last run {run.itemCount}</span> : null}</Fact> : null}
                    <Fact label="Cap">{c.cap || <span className="text-muted">none</span>}</Fact>
                    <Fact label="Who gets it">{c.who || <span className="text-muted">whoever is picked</span>}</Fact>
                    {c.facts ? <div className="sm:col-span-2 lg:col-span-4"><Fact label="Set to">{c.facts}</Fact></div> : null}
                    <div className="sm:col-span-2"><Fact label="Stops duplicates">{c.guard}</Fact></div>
                    <div className="sm:col-span-2"><Fact label="No-inspection buildings">{c.noService}</Fact></div>
                  </dl>
                  {c.note || c.settingsHref ? (
                    <div className="mt-2 flex items-start gap-3 flex-wrap">
                      {settingsLink(c)}
                      {c.note ? <span className="text-[11.5px] text-muted flex-1 min-w-[200px]">{c.note}</span> : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      <p className="text-[11.5px] text-muted">
        {data.madeToday
          ? '“Made today” counts tasks each creator created today (Eastern time), from the creation log. Creators that do not write to the log yet show what their last run made. The total at the top is read-only — no shared daily cap is enforced.'
          : '“Made” is what the last run created, from its receipt. A count per day across every creator appears here once the creation log table (task_creations) exists.'}
      </p>
    </div>
  )
}
