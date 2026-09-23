'use client'
// THE CLAIMS BOARD — every damage claim, in the lane it is actually in, with the clock visible.
//
// The board is organised around the one fact that decides whether a claim is worth anything: the
// filing window closes 14 days after checkout. So a claim that has not been filed shows a
// countdown, and a claim whose countdown has gone red sorts to the top of its lane. Everything
// else — money, channel, evidence completeness — is secondary to "is this going to expire".
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ClaimDesk } from '@/components/ClaimDesk'
import {
  ShieldAlert, Search, RefreshCw, Plus, X, CalendarClock, Loader2, ExternalLink, CheckCircle2, Trash2,
} from 'lucide-react'
import { DeleteButton, UndoBar, TrashDrawer } from '@/components/DeleteControl'
import { Tag, Pill, LeanHead, LeanTabs, IconBtn, Tip, LeanList, LeanEmpty, type Tone } from '@/components/lean'
import {
  STAGES, STAGE_LABEL, OUTCOMES, money, itemsTotal, num, daysUntil, urgencyOf, hardDeadlineBiting, gatesFor, claimTitle,
  type Claim, type Stage,
} from '@/lib/claims'
import { ClaimPolicyPanel } from '@/components/ClaimPolicy'

type Board = { ok: boolean; today: string; claims: Claim[]; totals: { open: number; sought: number; recovered: number }; error?: string }
type Match = {
  reservationId: string; listingId: string; unitLabel: string; property: string; unitNo: string
  guestName: string; guestEmail: string | null; checkIn: string; checkOut: string; channel: string
  confirmationCode: string | null; deadline: string | null; due: string | null
  daysLeft: number | null; hardDaysLeft: number | null; route: string | null
  guestyUrl: string; existingClaimId: string | null
}

const URGENCY_TONE: Record<string, Tone> = { expired: 'roseSolid', critical: 'rose', soon: 'amber', ok: 'emerald', none: 'slate' }

// The row counts down to OUR due date. The channel's hard cutoff only speaks up when it is
// actually close — otherwise it is noise on every row for two weeks.
function DeadlineChip({ claim }: { claim: Claim }) {
  const u = urgencyOf(claim)
  const target = claim.due_on || claim.deadline_on
  const d = daysUntil(target)
  if (u === 'none') {
    if (!target) return null
    return <Tag>Filed</Tag>
  }
  const text = d === null ? 'No date'
    : d < 0 ? 'Due ' + Math.abs(d) + 'd ago'
    : d === 0 ? 'Due today'
    : 'Due in ' + d + 'd'
  return <Tag tone={URGENCY_TONE[u]} title={'Our due date' + (target ? ' · ' + target : '') + (claim.due_source === 'manual' ? ' · set by hand' : '')}>{text}{claim.due_source === 'manual' ? ' ·set' : ''}</Tag>
}

// The evidence clock. Only shown while it is the thing that decides the day.
function TurnoverChip({ claim }: { claim: Claim }) {
  if (!claim.next_check_in) return null
  const a = daysUntil(claim.next_check_in)
  if (a === null || a > 2) return null
  return (
    <Tag tone={a < 0 ? 'slate' : 'violet'} title="Next guest check-in — get the evidence before the unit turns">
      {a < 0 ? 'Unit turned' : a === 0 ? 'Guest in today' : a === 1 ? 'Guest in tomorrow' : 'Guest in ' + a + 'd'}
    </Tag>
  )
}

function HardChip({ claim }: { claim: Claim }) {
  if (!hardDeadlineBiting(claim)) return null
  const h = daysUntil(claim.deadline_on)
  return (
    <Tag tone="roseSolid" title={'The channel’s hard filing cutoff' + (claim.deadline_on ? ' · ' + claim.deadline_on : '')}>
      {h !== null && h < 0 ? 'Window closed' : 'Window ' + h + 'd'}
    </Tag>
  )
}

export function ClaimsBoard() {
  const router = useRouter()
  const [data, setData] = useState<Board | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [channel, setChannel] = useState('all')
  const [newOpen, setNewOpen] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  // ONE PAGE, FOUR SECTIONS (Jon, 2026-09-23: "I would like it just to be: New / Pending /
  // Submitted / Closed … I want to see it all on one page, not a bunch of different tabs. The only
  // one that we can see in tabs is maybe the closed section").
  //
  // The seven DB stages stay exactly as they are — the desk's gates, the notes it writes and every
  // API check are built on them, and collapsing them in the database would be a migration to win an
  // argument about layout. What changes is that the board stops making you hunt: the four sections
  // stack down one page, each row still says which stage it is in, and the only thing behind a tab
  // is Closed, where the question is no longer "what do I do" but "how did it end".
  const [closedTab, setClosedTab] = useState<string>('all')
  const [showAllClosed, setShowAllClosed] = useState(false)
  // THE CLAIM OPENS IN A POP-UP, NOT A PAGE (Jon, 2026-09-16), the way the glitch board works. The
  // id also lives in the URL as ?claim=<id> so the drawer survives a refresh and can be pasted to
  // someone — the same trick the projects board uses for ?task=. /claims/<id> still renders the
  // desk as a page, so every link already sent out keeps working.
  const [openId, setOpenId] = useState<string | null>(null)
  const [showPolicy, setShowPolicy] = useState(false)
  const [undo, setUndo] = useState<{ trashId: string; label: string } | null>(null)

  const removeClaim = useCallback(async (id: string): Promise<string | null> => {
    try {
      const r = await fetch('/api/claims/' + id, { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok || j.ok === false) return j.error || 'Delete failed'
      setUndo({ trashId: String(j.trashId), label: String(j.label || 'claim') })
      setData(d => d ? { ...d, claims: d.claims.filter(c => c.id !== id) } : d)
      return null
    } catch (e: any) { return String(e?.message || e) }
  }, [])

  const load = useCallback(async () => {
    try {
      setErr('')
      const r = await fetch('/api/claims', { cache: 'no-store' })
      const j: Board = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Could not load claims.'); return }
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  // ?claim=<id> opens the pop-up on first paint, and every open/close writes it back, so a refresh
  // lands you where you were and the address bar is pasteable.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const id = new URLSearchParams(window.location.search).get('claim')
    if (id) setOpenId(id)
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    const u = new URL(window.location.href)
    if (openId) u.searchParams.set('claim', openId); else u.searchParams.delete('claim')
    window.history.replaceState(null, '', u.pathname + (u.search || '') + u.hash)
  }, [openId])

  const all = (data && data.claims) || []
  const channels = useMemo(() => {
    const seen: string[] = []
    for (let i = 0; i < all.length; i++) {
      const c = String(all[i].channel || '').trim()
      if (c && seen.indexOf(c) < 0) seen.push(c)
    }
    return seen.sort()
  }, [all])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all.filter(c => {
      if (channel !== 'all' && String(c.channel || '') !== channel) return false
      if (!needle) return true
      return claimTitle(c).toLowerCase().indexOf(needle) >= 0 || String(c.summary || '').toLowerCase().indexOf(needle) >= 0
    })
  }, [all, q, channel])

  // Inside a section: closest to dying first, then newest.
  const RANK: Record<string, number> = { expired: 0, critical: 1, soon: 2, ok: 3, none: 4 }
  const atRisk = useMemo(() => rows.filter(c => {
    const u = urgencyOf(c)
    return u === 'expired' || u === 'critical'
  }), [rows])

  const totals = (data && data.totals) || { open: 0, sought: 0, recovered: 0 }
  const decided = all.filter(c => !!c.outcome)
  const won = decided.filter(c => c.outcome === 'won' || c.outcome === 'partial')
  const winRate = decided.length ? Math.round((won.length / decided.length) * 100) : null

  const urgentFirst = useCallback((list: Claim[]) => list.slice().sort((a, b) => {
    const ra = RANK[urgencyOf(a)] - RANK[urgencyOf(b)]
    if (ra !== 0) return ra
    return String(b.created_at || '').localeCompare(String(a.created_at || ''))
  }), [])
  // Closed sorts by when it ended, not by a deadline that no longer exists.
  const newestFirst = useCallback((list: Claim[]) => list.slice().sort((a, b) =>
    String(b.paid_on || b.decided_on || b.created_at || '')
      .localeCompare(String(a.paid_on || a.decided_on || a.created_at || ''))), [])

  const sec = useMemo(() => {
    const pick = (...st: string[]) => urgentFirst(rows.filter(c => st.indexOf(String(c.stage || 'draft')) >= 0))
    return {
      // Nobody has worked it yet.
      new: pick('draft'),
      // Ours to move: finished and waiting on Jon, or approved and waiting to be filed. Both are a
      // claim sitting on OUR desk with a clock running, which is why they read as one section.
      pending: pick('review', 'ready'),
      // Out of our hands and into the channel's — filed, answered, or waiting on the money.
      submitted: pick('submitted', 'decided', 'settle'),
      closed: newestFirst(rows.filter(c => String(c.stage || 'draft') === 'closed')),
    }
  }, [rows, urgentFirst, newestFirst])

  // Closed is the one section that earns tabs, and the tabs are OUTCOMES: paid, partly paid,
  // denied, dropped. "Closed" on its own tells you nothing; how it ended is the whole point.
  const closedBy = useMemo(() => {
    const m: Record<string, Claim[]> = { all: sec.closed }
    for (const o of OUTCOMES) m[o.key] = sec.closed.filter(c => String(c.outcome || '') === o.key)
    m.none = sec.closed.filter(c => !c.outcome)
    return m
  }, [sec.closed])
  const closedRows = closedBy[closedTab] || sec.closed
  const closedRecovered = closedRows.reduce((t, c) => t + (num(c.amount_paid) || 0), 0)

  const ctl = 'text-[12px] border border-line rounded-lg bg-white py-1'

  return (
    <>
      <LeanHead title="Claims" icon={<ShieldAlert size={20} className="text-muted" />}>
        {atRisk.length > 0 && <Pill tone="roseSolid" title={'About to age out unfiled: ' + atRisk.map(c => claimTitle(c)).join(' · ')}>{atRisk.length} aging out</Pill>}
        <Pill title="Claims not yet closed">{totals.open} open</Pill>
        <Pill tone="amber" title="Total sought across claims">{money(totals.sought)} sought</Pill>
        <Pill tone="emerald" title="Total recovered">{money(totals.recovered)} recovered</Pill>
        <Pill tone="brand" title={decided.length ? decided.length + ' decided (won or partial counts as a win)' : 'Nothing decided yet'}>{winRate === null ? '—' : winRate + '%'} win</Pill>
        <button onClick={() => setNewOpen(true)} className="text-[12.5px] font-semibold px-2.5 py-1 rounded-lg bg-ink text-white hover:opacity-90 inline-flex items-center gap-1">
          <Plus size={13} /> New claim
        </button>
      </LeanHead>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <span className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit, guest, code…" className={ctl + ' pl-6 pr-2 w-44 focus:outline-none focus:ring-2 focus:ring-brand-200'} />
          </span>
          <select value={channel} onChange={e => setChannel(e.target.value)} className={ctl + ' px-2'}>
            <option value="all">All channels</option>
            {channels.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <IconBtn title="Filing policy — due dates per channel" onClick={() => setShowPolicy(!showPolicy)}><CalendarClock size={14} /></IconBtn>
          <IconBtn title="Recently deleted claims" onClick={() => setShowTrash(!showTrash)}><Trash2 size={14} /></IconBtn>
          <IconBtn title="Refresh" onClick={() => { setLoading(true); load() }}>{loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}</IconBtn>
        </div>
      </div>

      {err && <div className="text-[12.5px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">{err}</div>}
      {showPolicy && <ClaimPolicyPanel onClose={() => setShowPolicy(false)} onSaved={load} />}
      {showTrash && <TrashDrawer kind="claim" onRestored={load} onClose={() => setShowTrash(false)} />}

      {loading && !data && <LeanEmpty>Loading claims…</LeanEmpty>}

      {data && all.length === 0 && <LeanEmpty>No claims yet — start one from the reservation with <b>New claim</b>.</LeanEmpty>}

      {data && all.length > 0 && (
        <div className="space-y-5">
          <Section title="New" blurb="Started, nobody has worked it yet" rows={sec.new}
            empty="Nothing new." onDelete={removeClaim} onOpen={setOpenId} />
          <Section title="Pending" blurb="On our desk — waiting on approval, or approved and waiting to be filed" rows={sec.pending}
            empty="Nothing waiting on us." onDelete={removeClaim} onOpen={setOpenId} />
          <Section title="Submitted" blurb="With the channel — filed, answered, or waiting on the money" rows={sec.submitted}
            empty="Nothing with a channel right now." onDelete={removeClaim} onOpen={setOpenId} />

          {/* CLOSED — the one section behind tabs, and the tabs are how it ended. */}
          <section>
            <div className="flex items-baseline gap-2 flex-wrap px-1 mb-1.5">
              <h2 className="text-[13px] font-bold text-ink">Closed</h2>
              <span className="text-[12px] text-muted">{sec.closed.length} claim{sec.closed.length === 1 ? '' : 's'}</span>
              {closedRecovered > 0 && <Pill tone="emerald" title="Recovered in the tab you are looking at">{money(closedRecovered)} recovered</Pill>}
            </div>
            {sec.closed.length === 0 ? <LeanEmpty>Nothing closed yet.</LeanEmpty> : (
              <>
                <LeanTabs
                  tabs={([{ key: 'all', label: 'All', n: sec.closed.length }] as { key: string; label: string; n?: number | null }[])
                    .concat(OUTCOMES.map(o => ({ key: o.key as string, label: o.label, n: (closedBy[o.key] || []).length })))
                    .concat((closedBy.none || []).length ? [{ key: 'none', label: 'No outcome recorded', n: (closedBy.none || []).length }] : [])
                    .filter(t => t.key === 'all' || (t.n || 0) > 0)}
                  value={closedTab}
                  onChange={k => { setClosedTab(k); setShowAllClosed(false) }}
                />
                {closedRows.length === 0 ? <LeanEmpty>Nothing closed that way.</LeanEmpty> : (
                  <>
                    <LeanList>
                      {(showAllClosed ? closedRows : closedRows.slice(0, 12)).map(c =>
                        <ClaimRow key={c.id} claim={c} showStage={false} onDelete={() => removeClaim(c.id)} onOpen={() => setOpenId(c.id)} />)}
                    </LeanList>
                    {!showAllClosed && closedRows.length > 12 && (
                      <button onClick={() => setShowAllClosed(true)} className="mt-1.5 text-[12px] font-semibold text-muted hover:text-ink px-1">
                        Show all {closedRows.length}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {newOpen && <NewClaimModal onClose={() => setNewOpen(false)} onCreated={(id: string) => { setNewOpen(false); load(); setOpenId(id) }} />}
      {openId && <ClaimDrawer id={openId} onClose={() => { setOpenId(null); load() }} onChanged={load} />}
      {undo && <UndoBar item={undo} onUndone={() => { setUndo(null); load() }} onDismiss={() => setUndo(null)} />}
    </>
  )
}

/**
 * ONE SECTION OF THE BOARD — a heading, what the section means, and its rows.
 *
 * Every row keeps its stage tag even though the section already groups it: "Pending" holds two
 * stages and the difference between them (waiting on Jon vs. approved and waiting to be filed) is
 * the difference between whose move it is. An empty section still prints, because a board that
 * hides its empty lanes makes you wonder whether you filtered them away.
 */
function Section({ title, blurb, rows, empty, onDelete, onOpen }: {
  title: string; blurb: string; rows: Claim[]; empty: string
  onDelete: (id: string) => Promise<string | null>; onOpen: (id: string) => void
}) {
  const sought = rows.reduce((t, c) => t + (num(c.amount_sought) || itemsTotal(c.items)), 0)
  return (
    <section>
      <div className="flex items-baseline gap-2 flex-wrap px-1 mb-1.5">
        <h2 className="text-[13px] font-bold text-ink">{title}</h2>
        <span className="text-[12px] text-muted">{rows.length ? rows.length + ' claim' + (rows.length === 1 ? '' : 's') + ' · ' + blurb : blurb}</span>
        {sought > 0 && <Pill tone="amber" title="Total sought in this section">{money(sought)}</Pill>}
      </div>
      {rows.length === 0 ? <LeanEmpty>{empty}</LeanEmpty> : (
        <LeanList>
          {rows.map(c => <ClaimRow key={c.id} claim={c} showStage onDelete={() => onDelete(c.id)} onOpen={() => onOpen(c.id)} />)}
        </LeanList>
      )}
    </section>
  )
}

/**
 * THE CLAIM POP-UP — the same desk /claims/<id> renders, in a sheet over the board.
 *
 * It is a sheet rather than a small dialog because a claim is not a small thing: the stage rail,
 * the evidence gates, every item with its photos and the comment thread all have to fit, and a
 * modal that makes you scroll a 400px box through all of that is worse than the page it replaced.
 * Escape closes it, the backdrop closes it, and the board reloads on the way out so a card never
 * shows numbers from before you edited it.
 */
function ClaimDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    // The page behind must not scroll with the sheet — on a phone that is how you lose your place
    // on the board and come back to the top of it.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = prev }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 bg-ink/40 flex items-start justify-center overflow-y-auto p-0 sm:p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-app w-full sm:max-w-4xl sm:rounded-2xl sm:border sm:border-line shadow-xl min-h-full sm:min-h-0 sm:my-6">
        <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2.5 border-b border-line bg-white/95 backdrop-blur sm:rounded-t-2xl">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted">Claim</span>
          <a href={'/claims/' + id} className="text-[11px] text-muted hover:text-ink inline-flex items-center gap-1" title="Open as its own page">
            <ExternalLink size={11} /> full page
          </a>
          <button onClick={onClose} className="ml-auto text-muted hover:text-ink inline-flex items-center gap-1 text-[12px] font-semibold">
            Close <X size={15} />
          </button>
        </div>
        <div className="p-4">
          <ClaimDesk id={id} embedded onClose={onClose} onChanged={onChanged} />
        </div>
      </div>
    </div>
  )
}

function ClaimRow({ claim, showStage, onDelete, onOpen }: { claim: Claim; showStage: boolean; onDelete: () => Promise<string | null>; onOpen: () => void }) {
  const items = claim.items || []
  const gates = gatesFor(claim, items)
  const done = gates.filter(g => g.ok).length
  const amount = num(claim.amount_sought) || itemsTotal(items)
  const u = urgencyOf(claim)
  const stage = String(claim.stage || 'draft')
  return (
    <li className={'group ' + (u === 'expired' ? 'bg-rose-50/60' : u === 'critical' ? 'bg-rose-50/30' : '')}>
      <div className="flex items-center gap-2.5 px-3 sm:px-4 py-2">
        <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[13.5px] font-semibold text-ink truncate max-w-[18rem]">{claimTitle(claim)}</span>
            {showStage && <Tag tone="brand">{STAGE_LABEL[stage] || stage}</Tag>}
            <DeadlineChip claim={claim} />
            <HardChip claim={claim} />
            <TurnoverChip claim={claim} />
            {claim.channel && <Tag>{claim.channel}</Tag>}
            {claim.waiting_on && <Tag tone="sky">{claim.waiting_on === 'escalated' ? 'Escalated' : claim.waiting_on === 'guest' ? 'Awaiting guest' : 'Awaiting channel'}</Tag>}
            {claim.outcome && (
              <Tag tone={claim.outcome === 'denied' ? 'rose' : claim.outcome === 'won' || claim.outcome === 'partial' ? 'emerald' : 'slate'}>
                {claim.outcome === 'won' ? 'Paid in full' : claim.outcome === 'partial' ? 'Partial' : claim.outcome.charAt(0).toUpperCase() + claim.outcome.slice(1)}
              </Tag>
            )}
            <Tag tone={done === gates.length ? 'emerald' : 'slate'} title={gates.map(g => (g.ok ? '✓ ' : '· ') + g.label).join('\n') + '\n' + items.length + ' item' + (items.length === 1 ? '' : 's')}>{done}/{gates.length} evidence</Tag>
            {claim.payment_verified === true && claim.owner_adjusted !== true && stage === 'settle' && <Tag tone="amber" title="Paid — owner statement still to adjust">Adjust owner</Tag>}
          </div>
        </button>
        {amount > 0 && <span className="text-[13px] font-bold text-ink tabular-nums shrink-0">{money(amount)}</span>}
        {/* On a mouse the delete appears on hover; a touch screen has no hover, so on a phone it is
            always there. It sits outside the open button, so it can never open the claim. */}
        <span className="shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition">
          <Tip label="Delete this claim"><DeleteButton variant="icon" title="Delete this claim" onDelete={onDelete} /></Tip>
        </span>
      </div>
    </li>
  )
}

// ── starting a claim ───────────────────────────────────────────────────────
// You do not type a claim; you point at the stay it happened on. Everything identifying comes off
// the booking, which is the only way the confirmation code is guaranteed right.
function NewClaimModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState('')
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [err, setErr] = useState('')

  const run = async () => {
    const s = q.trim()
    if (s.length < 2) return
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/claims?search=' + encodeURIComponent(s), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Search failed.'); return }
      setMatches(Array.isArray(j.matches) ? j.matches : [])
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(false) }
  }

  const create = async (m: Match) => {
    setCreating(m.reservationId); setErr('')
    try {
      const r = await fetch('/api/claims', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservationId: m.reservationId }),
      })
      const j = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Could not create the claim.'); setCreating(''); return }
      onCreated(String(j.id))
    } catch (e: any) { setErr(String(e?.message || e)); setCreating('') }
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      {/* mt-16 threw a third of a phone screen away before the search box appeared. */}
      <div className="bg-white rounded-2xl border border-line shadow-xl w-full max-w-2xl mt-4 sm:mt-16 mb-[calc(env(safe-area-inset-bottom,0px)+4.25rem)] sm:mb-0" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-line">
          <ShieldAlert size={16} className="text-ink" />
          <span className="font-semibold text-ink">Start a claim</span>
          <span className="ml-auto"><IconBtn title="Close" onClick={onClose}><X size={15} /></IconBtn></span>
        </div>
        <div className="p-5">
          <div className="flex gap-2">
            <input
              autoFocus value={q} onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') run() }}
              placeholder="Guest name or confirmation code…"
              className="flex-1 text-sm border border-line rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
            <button onClick={run} disabled={busy || q.trim().length < 2} className="text-sm font-semibold px-4 py-2 rounded-lg bg-ink text-white disabled:opacity-40 inline-flex items-center gap-1.5">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Search
            </button>
          </div>
          {err && <div className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}

          {matches && matches.length === 0 && (
            <div className="mt-4 text-sm text-muted text-center py-6">No stay matches that. Cancellations and inquiries are never offered.</div>
          )}

          {matches && matches.length > 0 && (
            <div className="mt-4 space-y-2 max-h-[50vh] overflow-y-auto">
              {matches.map(m => {
                const d = m.daysLeft
                const tone = d === null ? 'text-muted' : d < 0 ? 'text-rose-700 font-semibold' : d <= 2 ? 'text-rose-700 font-semibold' : d <= 5 ? 'text-amber-800 font-semibold' : 'text-emerald-700'
                return (
                  <div key={m.reservationId} className="rounded-xl border border-line p-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink">{m.guestName || 'Guest'}</div>
                      <div className="text-[12px] text-muted">
                        {m.unitLabel}{m.unitNo ? ' · ' + m.unitNo : ''} · {m.channel}
                        {m.confirmationCode && <> · <span className="font-mono">{m.confirmationCode}</span></>}
                      </div>
                      <div className="text-[12px] text-muted">{m.checkIn} to {m.checkOut}</div>
                      <div className={'text-[12px] mt-0.5 ' + tone}>
                        {d === null ? 'No checkout date on this booking'
                          : d < 0 ? 'Due ' + Math.abs(d) + ' day(s) ago' + (m.deadline ? ' · window ' + m.deadline : '')
                          : 'Due ' + (m.due || m.deadline) + ' — ' + d + ' day(s)' + (m.route ? ' · ' + m.route : '')}
                      </div>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      {m.existingClaimId ? (
                        <Link href={'/claims/' + m.existingClaimId} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-900">
                          Claim exists — open
                        </Link>
                      ) : (
                        <button onClick={() => create(m)} disabled={!!creating} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40 inline-flex items-center gap-1.5">
                          {creating === m.reservationId ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Start claim
                        </button>
                      )}
                      <a href={m.guestyUrl} target="_blank" rel="noreferrer" className="text-[11px] text-muted hover:underline inline-flex items-center gap-1">
                        Guesty <ExternalLink size={9} />
                      </a>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {!matches && (
            <p className="mt-3 text-[12px] text-muted flex items-center gap-1.5" title="Airbnb and Vrbo close 14 days after checkout; direct bookings have no window because we hold the card. Every claim is stamped with a due date and a hard cutoff.">
              <CheckCircle2 size={13} className="shrink-0" /> Guest, dates, code and filing deadline come off the booking.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
