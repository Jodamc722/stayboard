'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import {
  Star, MessageSquare, ClipboardCheck, AlertTriangle, LogIn, PhoneCall,
  Send, Sparkles, Check, X, ArrowUpRight, CheckCircle2, Frown, ChevronRight,
} from 'lucide-react'

const SIGN_HINT = ''

type Review = { id: string; rating: number | null; content: string; channel: string; guest: string; listing_name: string; created_at?: string }
type Approval = { id: string; title: string; type: string; building: string; unit: string; vendor: string; amount_usd: number | null; priority: string }
type Message = { id: string; reservationId: string | null; guest: string; channel: string; unit: string; listing_name: string; preview: string; at?: string; unread: number }
type Welcome = { id: string; guest: string; listing_name: string; unit: string; check_in: string; today: boolean }
type CheckIn = { id: string; guest: string; listing_name: string; unit: string; nights: number }
type Overdue = { id: string; title: string; type: string; building: string; unit: string; due_at?: string; priority: string }
type Sentiment = { id: string; guest: string; channel: string; unit: string; band: string; dissatisfied: boolean; awaiting: boolean; topIssue: string; excerpt: string; at?: string }

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))
const fmtDate = (s?: string) => { if (!s) return ''; const d = new Date(s); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
const fmtRating = (n: number | null) => n == null ? '—' : (n <= 5 ? `${n}/5` : `${n}/10`)
const isLow = (n: number | null) => n != null && (n <= 3 || (n > 5 && n <= 7))
const unitTag = (unit: string, name: string) => unit ? `Unit ${unit}` : (name || '')

const PRIORITY: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700', high: 'bg-orange-100 text-orange-700',
  medium: 'bg-amber-100 text-amber-700', low: 'bg-slate-100 text-slate-600',
}

function Section({ icon: Icon, title, count, accent, children }: { icon: any; title: string; count: number; accent: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line flex items-center gap-2">
        <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${accent}`}><Icon size={14} /></span>
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        <span className="text-[11px] font-semibold text-muted bg-app rounded-full px-2 py-0.5">{count}</span>
      </div>
      {children}
    </section>
  )
}

export function MissionFeed({ reviews, approvals, messages, welcome, checkIns, overdue, sentiment }: {
  reviews: Review[]; approvals: Approval[]; messages: Message[]; welcome: Welcome[]; checkIns: CheckIn[]; overdue: Overdue[]; sentiment: Sentiment[]
}) {
  const router = useRouter()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [aiBusy, setAiBusy] = useState<Record<string, boolean>>({})
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({})
  const [postedIds, setPostedIds] = useState<Record<string, boolean>>({})
  const [decided, setDecided] = useState<Record<string, string>>({})
  const [err, setErr] = useState<string | null>(null)

  const liveReviews = reviews.filter(r => !postedIds[r.id])
  const liveApprovals = approvals.filter(a => !decided[a.id])

  const totalOpen = liveReviews.length + liveApprovals.length + messages.length + welcome.length + checkIns.length + overdue.length + sentiment.length

  async function draftAI(r: Review) {
    setAiBusy(b => ({ ...b, [r.id]: true })); setErr(null)
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetch('/api/reviews/draft', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: r.content, rating: r.rating, listing_name: r.listing_name, guest: r.guest, channel: r.channel, currentDraft: drafts[r.id] || '' }),
        })
        const d = await res.json()
        if (res.ok && d.draft) { setDrafts(x => ({ ...x, [r.id]: d.draft })); return }
        const msg = d.error || `HTTP ${res.status}`
        if (/429|rate limit/i.test(msg) && attempt < 3) { await sleep(15000); continue }
        throw new Error(msg)
      }
    } catch (e: any) { setErr(e?.message || String(e)) }
    finally { setAiBusy(b => ({ ...b, [r.id]: false })) }
  }

  async function postReview(r: Review) {
    const text = (drafts[r.id] || '').trim()
    if (!text) return
    setRowBusy(b => ({ ...b, [r.id]: true })); setErr(null)
    try {
      const res = await fetch('/api/reviews/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId: r.id, reviewReply: text }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      setPostedIds(p => ({ ...p, [r.id]: true }))
    } catch (e: any) { setErr(e?.message || String(e)) }
    finally { setRowBusy(b => ({ ...b, [r.id]: false })) }
  }

  async function decide(a: Approval, approved: boolean) {
    setRowBusy(b => ({ ...b, [a.id]: true })); setErr(null)
    const supabase = createClient()
    const { error } = await supabase.from('field_requests').update({
      approval_status: approved ? 'approved' : 'rejected',
      status: approved ? 'open' : 'rejected',
      updated_at: new Date().toISOString(),
    }).eq('id', a.id)
    setRowBusy(b => ({ ...b, [a.id]: false }))
    if (!error) { setDecided(x => ({ ...x, [a.id]: approved ? 'Approved' : 'Rejected' })); router.refresh() }
    else setErr('Could not update: ' + error.message)
  }

  if (totalOpen === 0) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 px-5 py-10 text-center">
        <CheckCircle2 size={28} className="text-emerald-500 mx-auto" />
        <h3 className="mt-2 text-lg font-bold text-ink">All clear</h3>
        <p className="text-sm text-muted mt-1">Nothing needs you right now. Ask Eve to look ahead, or generate today&apos;s ops plan.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {err && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {err}</div>}

      {/* 1. Approvals — money / decisions first */}
      {liveApprovals.length > 0 && (
        <Section icon={ClipboardCheck} title="Awaiting your approval" count={liveApprovals.length} accent="bg-amber-100 text-amber-700">
          <ul className="divide-y divide-line/70">
            {liveApprovals.slice(0, 6).map(a => (
              <li key={a.id} className="px-4 py-3 flex items-center gap-3">
                <Link href={`/requests/${a.id}`} className="flex-1 min-w-0 group">
                  <div className="text-sm font-medium text-ink truncate group-hover:text-brand-700">{a.title}</div>
                  <div className="text-[11px] text-muted truncate mt-0.5">
                    {[a.type, [a.building, a.unit].filter(Boolean).join(' '), a.vendor].filter(Boolean).join(' · ')}
                    {a.amount_usd != null ? <span className="font-semibold text-ink"> · ${a.amount_usd.toLocaleString()}</span> : null}
                  </div>
                </Link>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${PRIORITY[a.priority] || PRIORITY.low}`}>{a.priority.replace(/^\w/, c => c.toUpperCase())}</span>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => decide(a, true)} disabled={!!rowBusy[a.id]} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"><Check size={13} /> Approve</button>
                  <button onClick={() => decide(a, false)} disabled={!!rowBusy[a.id]} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-white text-rose-700 border border-rose-200 hover:bg-rose-50 disabled:opacity-50"><X size={13} /></button>
                </div>
              </li>
            ))}
          </ul>
          {liveApprovals.length > 6 && <FooterLink href="/requests" label={`View all ${liveApprovals.length} approvals`} />}
        </Section>
      )}

      {/* 2. Unhappy guests — sentiment warnings */}
      {sentiment.length > 0 && (
        <Section icon={Frown} title="Unhappy guests — needs attention" count={sentiment.length} accent="bg-rose-100 text-rose-700">
          <ul className="divide-y divide-line/70">
            {sentiment.slice(0, 5).map(s => (
              <li key={s.id} className="px-4 py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-ink">{s.guest}</span>
                  {s.unit && <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">Unit {s.unit}</span>}
                  {s.channel && <span className="text-[10px] uppercase tracking-wide text-muted bg-app px-1.5 py-0.5 rounded">{s.channel}</span>}
                  {s.dissatisfied && <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">Unhappy</span>}
                  {s.awaiting && <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">Awaiting reply</span>}
                  <Link href="/messages" className="ml-auto text-[11px] font-semibold text-brand-700 inline-flex items-center gap-0.5 hover:underline">Open <ChevronRight size={12} /></Link>
                </div>
                {(s.topIssue || s.excerpt) && <p className="text-xs text-muted mt-1 line-clamp-2">{s.topIssue ? <span className="font-semibold text-ink">{s.topIssue}: </span> : null}{s.excerpt}</p>}
              </li>
            ))}
          </ul>
          {sentiment.length > 5 && <FooterLink href="/messages" label={`View all ${sentiment.length} flagged threads`} />}
        </Section>
      )}

      {/* 3. Reviews to reply — inline AI draft + post */}
      {liveReviews.length > 0 && (
        <Section icon={Star} title="Reviews to reply" count={liveReviews.length} accent="bg-amber-100 text-amber-700">
          <ul className="divide-y divide-line/70">
            {liveReviews.slice(0, 5).map(r => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[11px] font-bold inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${isLow(r.rating) ? 'bg-red-100 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}><Star size={11} /> {fmtRating(r.rating)}</span>
                  <span className="text-sm font-medium text-ink truncate">{r.listing_name}</span>
                  {r.guest && <span className="text-[11px] text-muted whitespace-nowrap">· {r.guest}</span>}
                  {r.channel && <span className="text-[10px] uppercase tracking-wide text-muted bg-app px-1.5 py-0.5 rounded">{r.channel}</span>}
                  {r.created_at && <span className="text-[10px] text-muted whitespace-nowrap font-medium">{fmtDate(r.created_at)}</span>}
                </div>
                {r.content && <p className="text-xs text-muted mt-1.5 whitespace-pre-wrap leading-relaxed">{r.content}</p>}
                <div className="mt-2">
                  <textarea value={drafts[r.id] ?? ''} onChange={e => setDrafts(x => ({ ...x, [r.id]: e.target.value }))} rows={3}
                    placeholder={aiBusy[r.id] ? 'Writing the AI reply…' : 'Draft with AI, then approve & post.'}
                    className="w-full text-xs text-ink bg-app border border-line rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <button onClick={() => postReview(r)} disabled={!!rowBusy[r.id] || !(drafts[r.id] || '').trim()} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"><Send size={12} /> {rowBusy[r.id] ? 'Posting…' : 'Approve & post'}</button>
                    <button onClick={() => draftAI(r)} disabled={!!aiBusy[r.id] || !!rowBusy[r.id]} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg text-brand-700 border border-brand-200 bg-brand-50 hover:bg-brand-100 disabled:opacity-50"><Sparkles size={12} /> {aiBusy[r.id] ? 'Writing…' : (drafts[r.id] ? 'Rewrite with AI' : 'Draft with AI')}</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {liveReviews.length > 5 && <FooterLink href="/reviews" label={`View all ${liveReviews.length} reviews`} />}
        </Section>
      )}

      {/* 4. Unread guest messages */}
      {messages.length > 0 && (
        <Section icon={MessageSquare} title="Unread guest messages" count={messages.length} accent="bg-brand-100 text-brand-700">
          <ul className="divide-y divide-line/70">
            {messages.slice(0, 6).map(m => (
              <li key={m.id} className="px-4 py-3">
                <Link href={`/messages/${m.id}`} className="block group">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-ink group-hover:text-brand-700">{m.guest}</span>
                    {m.unit && <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">Unit {m.unit}</span>}
                    {m.channel && <span className="text-[10px] uppercase tracking-wide text-muted bg-app px-1.5 py-0.5 rounded">{m.channel}</span>}
                    {m.unread > 0 && <span className="text-[10px] font-bold text-white bg-brand-600 px-1.5 py-0.5 rounded-full">{m.unread}</span>}
                    {m.at && <span className="ml-auto text-[10px] text-muted">{fmtDate(m.at)}</span>}
                  </div>
                  {m.preview && <p className="text-xs text-muted mt-1 line-clamp-2">{m.preview}</p>}
                </Link>
              </li>
            ))}
          </ul>
          {messages.length > 6 && <FooterLink href="/messages" label={`View all ${messages.length} conversations`} />}
        </Section>
      )}

      {/* 5. Welcome calls due */}
      {welcome.length > 0 && (
        <Section icon={PhoneCall} title="Welcome calls due" count={welcome.length} accent="bg-emerald-100 text-emerald-700">
          <ul className="divide-y divide-line/70">
            {welcome.slice(0, 6).map(w => (
              <li key={w.id} className="px-4 py-3 flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-ink">{w.guest}</span>
                {w.unit ? <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">Unit {w.unit}</span> : (w.listing_name && <span className="text-[11px] text-muted truncate">{w.listing_name}</span>)}
                {w.today ? <span className="text-[10px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded">TODAY</span> : <span className="text-[10px] text-muted">in by {fmtDate(w.check_in)}</span>}
                <Link href="/welcome-calls" className="ml-auto text-[11px] font-semibold text-brand-700 inline-flex items-center gap-0.5 hover:underline">Call <ChevronRight size={12} /></Link>
              </li>
            ))}
          </ul>
          {welcome.length > 6 && <FooterLink href="/welcome-calls" label={`View all ${welcome.length} calls`} />}
        </Section>
      )}

      {/* 6. Check-ins today */}
      {checkIns.length > 0 && (
        <Section icon={LogIn} title="Check-ins today" count={checkIns.length} accent="bg-brand-100 text-brand-700">
          <ul className="divide-y divide-line/70">
            {checkIns.slice(0, 6).map(c => (
              <li key={c.id} className="px-4 py-3 flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-ink">{c.guest}</span>
                {c.unit ? <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">Unit {c.unit}</span> : (c.listing_name && <span className="text-[11px] text-muted truncate">{c.listing_name}</span>)}
                {c.nights > 0 && <span className="text-[10px] text-muted">{c.nights} night{c.nights === 1 ? '' : 's'}</span>}
                <Link href={`/reservations/${c.id}`} className="ml-auto text-[11px] font-semibold text-brand-700 inline-flex items-center gap-0.5 hover:underline">Open <ChevronRight size={12} /></Link>
              </li>
            ))}
          </ul>
          {checkIns.length > 6 && <FooterLink href="/reservations" label={`View all ${checkIns.length} arrivals`} />}
        </Section>
      )}

      {/* 7. Overdue work */}
      {overdue.length > 0 && (
        <Section icon={AlertTriangle} title="Overdue work" count={overdue.length} accent="bg-red-100 text-red-700">
          <ul className="divide-y divide-line/70">
            {overdue.slice(0, 6).map(o => (
              <li key={o.id} className="px-4 py-3 flex items-center gap-2 flex-wrap">
                <Link href={`/requests/${o.id}`} className="flex-1 min-w-0 group">
                  <div className="text-sm font-medium text-ink truncate group-hover:text-brand-700">{o.title}</div>
                  <div className="text-[11px] text-muted truncate mt-0.5">{[o.type, [o.building, o.unit].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</div>
                </Link>
                {o.due_at && <span className="text-[10px] font-semibold text-red-700 bg-red-50 px-1.5 py-0.5 rounded whitespace-nowrap">Due {fmtDate(o.due_at)}</span>}
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${PRIORITY[o.priority] || PRIORITY.low}`}>{o.priority.replace(/^\w/, c => c.toUpperCase())}</span>
              </li>
            ))}
          </ul>
          {overdue.length > 6 && <FooterLink href="/requests" label={`View all ${overdue.length} overdue`} />}
        </Section>
      )}
    </div>
  )
}

function FooterLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="flex items-center justify-center gap-1 px-4 py-2.5 text-[12px] font-semibold text-brand-700 border-t border-line hover:bg-app transition-colors">
      {label} <ArrowUpRight size={13} />
    </Link>
  )
}
