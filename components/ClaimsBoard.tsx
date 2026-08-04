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
import {
  ShieldAlert, Search, RefreshCw, Plus, X, CalendarClock, Loader2, ExternalLink, CheckCircle2, AlertTriangle, Trash2,
} from 'lucide-react'
import { DeleteButton, UndoBar, TrashDrawer } from '@/components/DeleteControl'
import {
  STAGES, money, itemsTotal, num, daysUntil, urgencyOf, gatesFor, claimTitle,
  type Claim, type Stage,
} from '@/lib/claims'

type Board = { ok: boolean; today: string; claims: Claim[]; totals: { open: number; sought: number; recovered: number }; error?: string }
type Match = {
  reservationId: string; listingId: string; unitLabel: string; property: string; unitNo: string
  guestName: string; guestEmail: string | null; checkIn: string; checkOut: string; channel: string
  confirmationCode: string | null; deadline: string | null; daysLeft: number | null
  guestyUrl: string; existingClaimId: string | null
}

const URGENCY_CLASS: Record<string, string> = {
  expired: 'bg-rose-100 text-rose-900 border-rose-300',
  critical: 'bg-rose-50 text-rose-800 border-rose-200',
  soon: 'bg-amber-50 text-amber-800 border-amber-200',
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  none: 'bg-app text-muted border-line',
}

function DeadlineChip({ claim }: { claim: Claim }) {
  const u = urgencyOf(claim)
  const d = daysUntil(claim.deadline_on)
  if (u === 'none') {
    if (!claim.deadline_on) return null
    return <span className="text-[10px] text-muted">filed · window closed {claim.deadline_on}</span>
  }
  const text = d === null ? 'no date'
    : d < 0 ? 'EXPIRED ' + Math.abs(d) + 'd ago'
    : d === 0 ? 'LAST DAY'
    : d + 'd left'
  return (
    <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ' + URGENCY_CLASS[u]}>
      <CalendarClock size={10} />{text}
    </span>
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

  // Sort inside a lane by how close the claim is to dying, then by newest.
  const RANK: Record<string, number> = { expired: 0, critical: 1, soon: 2, ok: 3, none: 4 }
  const byStage = useMemo(() => {
    const m: Record<string, Claim[]> = {}
    for (let i = 0; i < STAGES.length; i++) m[STAGES[i].key] = []
    for (let i = 0; i < rows.length; i++) {
      const k = String(rows[i].stage || 'draft')
      if (!m[k]) m[k] = []
      m[k].push(rows[i])
    }
    const keys = Object.keys(m)
    for (let i = 0; i < keys.length; i++) {
      m[keys[i]].sort((a, b) => {
        const ra = RANK[urgencyOf(a)] - RANK[urgencyOf(b)]
        if (ra !== 0) return ra
        return String(b.created_at || '').localeCompare(String(a.created_at || ''))
      })
    }
    return m
  }, [rows])

  const atRisk = useMemo(() => rows.filter(c => {
    const u = urgencyOf(c)
    return u === 'expired' || u === 'critical'
  }), [rows])

  const totals = (data && data.totals) || { open: 0, sought: 0, recovered: 0 }
  const decided = all.filter(c => !!c.outcome)
  const won = decided.filter(c => c.outcome === 'won' || c.outcome === 'partial')
  const winRate = decided.length ? Math.round((won.length / decided.length) * 100) : null

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <button onClick={() => setNewOpen(true)} className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-ink text-white hover:opacity-90 inline-flex items-center gap-1.5">
          <Plus size={14} /> New claim
        </button>
        <span className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit, guest, code…" className="text-sm border border-line rounded-lg pl-7 pr-2 py-1.5 bg-white w-60 focus:outline-none focus:ring-2 focus:ring-brand-200" />
        </span>
        <select value={channel} onChange={e => setChannel(e.target.value)} className="text-sm border border-line rounded-lg px-2 py-1.5 bg-white">
          <option value="all">All channels</option>
          {channels.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={() => setShowTrash(!showTrash)} className="ml-auto text-sm font-medium px-3 py-1.5 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1.5">
          <Trash2 size={13} /> Recently deleted
        </button>
        <button onClick={() => { setLoading(true); load() }} className="text-sm font-medium px-3 py-1.5 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1.5">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">{err}</div>}
      {showTrash && <TrashDrawer kind="claim" onRestored={load} onClose={() => setShowTrash(false)} />}

      {/* THE ONE THING THAT LOSES MONEY: a claim that ages out unfiled. */}
      {atRisk.length > 0 && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 mb-4">
          <div className="flex items-center gap-2 text-rose-900 font-semibold">
            <AlertTriangle size={16} />
            {atRisk.length === 1 ? '1 claim is about to age out' : atRisk.length + ' claims are about to age out'}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {atRisk.slice(0, 8).map(c => (
              <Link key={c.id} href={'/claims/' + c.id} className="text-[12px] font-medium px-2 py-1 rounded-lg bg-white border border-rose-200 text-rose-900 hover:bg-rose-100">
                {claimTitle(c)} · {daysUntil(c.deadline_on) !== null && (daysUntil(c.deadline_on) as number) < 0 ? 'expired' : (daysUntil(c.deadline_on) as number) + 'd'}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <Tile label="Open claims" value={String(totals.open)} />
        <Tile label="Sought" value={money(totals.sought)} />
        <Tile label="Recovered" value={money(totals.recovered)} good />
        <Tile label="Win rate" value={winRate === null ? '—' : winRate + '%'} sub={decided.length ? decided.length + ' decided' : 'nothing decided yet'} />
      </div>

      {loading && !data && <div className="text-sm text-muted py-10 text-center">Loading claims…</div>}

      {data && all.length === 0 && (
        <div className="rounded-2xl border border-line bg-white p-10 text-center">
          <ShieldAlert size={28} className="mx-auto text-muted mb-2" />
          <div className="font-semibold text-ink">No claims yet.</div>
          <p className="text-sm text-muted mt-1 max-w-md mx-auto">Start one from the reservation it happened on — the guest, channel, dates, confirmation code and the filing deadline all come across automatically.</p>
          <button onClick={() => setNewOpen(true)} className="mt-3 text-sm font-semibold px-3 py-1.5 rounded-lg bg-ink text-white inline-flex items-center gap-1.5"><Plus size={14} /> New claim</button>
        </div>
      )}

      {data && all.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {STAGES.map(s => {
            const lane = byStage[s.key] || []
            const laneMoney = lane.reduce((t, c) => t + (num(c.amount_sought) || itemsTotal(c.items)), 0)
            return (
              <div key={s.key} className="w-[290px] shrink-0">
                <div className="flex items-baseline gap-2 px-1 mb-1.5">
                  <span className="text-sm font-semibold text-ink">{s.label}</span>
                  <span className="text-[11px] font-semibold text-muted tabular-nums">{lane.length}</span>
                  {laneMoney > 0 && <span className="ml-auto text-[11px] text-muted tabular-nums">{money(laneMoney)}</span>}
                </div>
                <div className="text-[10px] text-muted px-1 mb-2 leading-tight">{s.blurb}</div>
                <div className="space-y-2">
                  {lane.map(c => <Card key={c.id} claim={c} onDelete={() => removeClaim(c.id)} />)}
                  {lane.length === 0 && <div className="rounded-xl border border-dashed border-line px-3 py-4 text-[11px] text-muted text-center">Empty</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {newOpen && <NewClaimModal onClose={() => setNewOpen(false)} onCreated={(id: string) => router.push('/claims/' + id)} />}
      {undo && <UndoBar item={undo} onUndone={() => { setUndo(null); load() }} onDismiss={() => setUndo(null)} />}
    </>
  )
}

function Tile({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={'text-2xl font-bold ' + (good ? 'text-emerald-700' : 'text-ink')}>{value}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  )
}

function Card({ claim, onDelete }: { claim: Claim; onDelete: () => Promise<string | null> }) {
  const items = claim.items || []
  const gates = gatesFor(claim, items)
  const done = gates.filter(g => g.ok).length
  const amount = num(claim.amount_sought) || itemsTotal(items)
  const u = urgencyOf(claim)
  const border = u === 'expired' ? 'border-rose-300' : u === 'critical' ? 'border-rose-200' : 'border-line'
  return (
    <Link href={'/claims/' + claim.id} className={'group relative block rounded-xl border bg-white p-3 hover:shadow-sm transition ' + border}>
      {/* The delete sits on the card but out of the way — it appears on hover and swallows the
          click so it can never open the claim by accident. */}
      <span className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition">
        <DeleteButton variant="icon" title="Delete this claim" onDelete={onDelete} />
      </span>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-ink leading-snug break-words pr-5">{claimTitle(claim)}</div>
        </div>
        <span className="text-[13px] font-bold text-ink tabular-nums shrink-0">{amount > 0 ? money(amount) : ''}</span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <DeadlineChip claim={claim} />
        {claim.channel && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-line text-muted">{claim.channel}</span>}
        {claim.waiting_on && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-sky-200 bg-sky-50 text-sky-800">{claim.waiting_on === 'escalated' ? 'Escalated' : claim.waiting_on === 'guest' ? 'Awaiting guest' : 'Awaiting channel'}</span>}
        {claim.outcome && (
          <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded border ' + (claim.outcome === 'denied' ? 'border-rose-200 bg-rose-50 text-rose-800' : claim.outcome === 'won' || claim.outcome === 'partial' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-line bg-app text-muted')}>
            {claim.outcome === 'won' ? 'Paid in full' : claim.outcome === 'partial' ? 'Partial' : claim.outcome.charAt(0).toUpperCase() + claim.outcome.slice(1)}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded bg-app overflow-hidden">
          <div className={'h-full ' + (done === gates.length ? 'bg-emerald-500' : 'bg-brand-500')} style={{ width: Math.round((done / gates.length) * 100) + '%' }} />
        </div>
        <span className="text-[10px] text-muted tabular-nums shrink-0">{done}/{gates.length} evidence</span>
        <span className="text-[10px] text-muted shrink-0">{items.length} item{items.length === 1 ? '' : 's'}</span>
      </div>
      {claim.payment_verified === true && claim.owner_adjusted !== true && claim.stage === 'settle' && (
        <div className="mt-1.5 text-[10px] text-amber-800">Paid — owner statement still to adjust</div>
      )}
    </Link>
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
      <div className="bg-white rounded-2xl border border-line shadow-xl w-full max-w-2xl mt-16" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-line">
          <ShieldAlert size={16} className="text-ink" />
          <span className="font-semibold text-ink">Start a claim</span>
          <button onClick={onClose} className="ml-auto text-muted hover:text-ink"><X size={16} /></button>
        </div>
        <div className="p-5">
          <p className="text-sm text-muted mb-3">Find the stay the damage happened on. Guest name or confirmation code — everything else comes off the booking.</p>
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
                          : d < 0 ? 'Filing window closed ' + Math.abs(d) + ' day(s) ago (' + m.deadline + ')'
                          : 'File by ' + m.deadline + ' — ' + d + ' day(s) left'}
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
            <div className="mt-4 rounded-xl border border-line bg-app/50 p-3 text-[12px] text-muted flex items-start gap-2">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              <span>Airbnb closes the window 14 days after checkout. Whatever you pick, the claim is stamped with a file-by date and the board counts it down.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
