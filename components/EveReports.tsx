'use client'
// THE REPORTS DESK — Eve tab → Reports (Jon, 2026-10-12: "there are so many Slack posts, especially the
// big, long updates. We need a better place to organize that. Slack should be a place for more
// day-to-day operations"). Every long-form thing she writes lands here under its kind and day; the
// list reads newest first, a kind filter narrows it, and one report opens in place. Admins set, per
// kind, what Slack gets: nothing, one line with a link, or the full text.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileText, Loader2, ChevronLeft } from 'lucide-react'
import { LeanEmpty, Tag } from '@/components/lean'

type Report = { id: string; kind: string; title: string; text: string; room: string | null; at: string; meta?: any }
type Kind = { key: string; label: string; cadence: string; defaultRoute: string; what: string }
type Route = 'page' | 'pointer' | 'slack'

const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' })

/** Slack mrkdwn → safe HTML: bold, italics, links, bullets, line breaks. Nothing else is interpreted. */
export function mrkdwnToHtml(src: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = String(src || '').split('\n')
  return lines.map(raw => {
    let l = esc(raw)
    l = l.replace(/&lt;(https?:\/\/[^|&]+)\|([^&]+)&gt;/g, (_m, u, t) => `<a class="underline text-brand-700" href="${u}" target="_blank" rel="noreferrer">${t}</a>`)
    l = l.replace(/&lt;(https?:\/\/[^&\s]+)&gt;/g, (_m, u) => `<a class="underline text-brand-700" href="${u}" target="_blank" rel="noreferrer">${u.replace(/^https?:\/\//, '').slice(0, 60)}</a>`)
    l = l.replace(/&lt;[#@][^&]*\|([^&]+)&gt;/g, '$1').replace(/&lt;![a-z]+&gt;/g, '')
    l = l.replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:])/g, '$1<i>$2</i>').replace(/`([^`\n]+)`/g, '<code class="text-[11.5px] bg-app px-1 rounded">$1</code>')
    l = l.replace(/:([a-z0-9_+-]+):/g, (m, n) => ({ sunrise: '🌅', crescent_moon: '🌙', warning: '⚠️', rotating_light: '🚨', wrench: '🔧', speech_balloon: '💬', pencil2: '✏️', red_circle: '🔴', large_yellow_circle: '🟡', large_green_circle: '🟢', writing_hand: '✍️' } as Record<string, string>)[n] || m)
    if (/^\s*[•\-]\s/.test(raw)) return `<div class="pl-4 -indent-3">${l}</div>`
    if (/^\s*\d+\.\s/.test(raw)) return `<div class="pl-5 -indent-4">${l}</div>`
    return l ? `<div>${l}</div>` : '<div class="h-2"></div>'
  }).join('')
}

export function EveReports({ initialId }: { initialId?: string | null }) {
  const [reports, setReports] = useState<Report[]>([])
  const [kinds, setKinds] = useState<Kind[]>([])
  const [routing, setRouting] = useState<Record<string, Route>>({})
  const [canRoute, setCanRoute] = useState(false)
  const [kind, setKind] = useState<string>('')
  const [open, setOpen] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showRouting, setShowRouting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/eve/reports').then(x => x.json())
      if (!r?.ok) { setErr(r?.error || 'Could not load the reports.'); return }
      setReports(r.reports || []); setKinds(r.kinds || []); setRouting(r.routing || {}); setCanRoute(!!r.canRoute); setErr('')
      if (initialId) { const hit = (r.reports || []).find((x: Report) => x.id === initialId); if (hit) setOpen(hit); else { const one = await fetch('/api/eve/reports?id=' + encodeURIComponent(initialId)).then(x => x.json()).catch(() => null); if (one?.report) setOpen(one.report) } }
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [initialId])
  useEffect(() => { load() }, [load])

  const pick = (r: Report | null) => {
    setOpen(r)
    try { const u = new URL(window.location.href); if (r) u.searchParams.set('id', r.id); else u.searchParams.delete('id'); window.history.replaceState(null, '', u.toString()) } catch { /* fine */ }
  }
  async function setRoute(k: string, v: Route) {
    setRouting(x => ({ ...x, [k]: v }))
    try { const r = await fetch('/api/eve/reports', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routing: { [k]: v } }) }).then(x => x.json()); if (r?.routing) setRouting(r.routing) } catch { /* shown as set; reload shows the truth */ }
  }

  const label = (k: string) => kinds.find(x => x.key === k)?.label || k
  const shown = useMemo(() => reports.filter(r => !kind || r.kind === kind), [reports, kind])
  const byDay = useMemo(() => { const m: Record<string, Report[]> = {}; for (const r of shown) (m[dayOf(r.at)] = m[dayOf(r.at)] || []).push(r); return m }, [shown])
  const counts = useMemo(() => { const m: Record<string, number> = {}; for (const r of reports) m[r.kind] = (m[r.kind] || 0) + 1; return m }, [reports])

  if (open) {
    return (
      <div className="bg-white border border-line rounded-2xl shadow-soft p-4">
        <button onClick={() => pick(null)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted hover:text-ink mb-2"><ChevronLeft size={13} /> All reports</button>
        <div className="flex items-center gap-2 flex-wrap mb-1"><Tag>{label(open.kind)}</Tag><span className="text-[12px] text-muted">{fmtWhen(open.at)}{open.room ? ' · would have gone to Slack' : ''}</span></div>
        <h2 className="text-[15px] font-bold text-ink mb-3">{open.title}</h2>
        <div className="text-[13px] leading-relaxed text-ink" dangerouslySetInnerHTML={{ __html: mrkdwnToHtml(open.text) }} />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <button onClick={() => setKind('')} className={`rounded-full px-2.5 py-1 text-[12px] font-semibold border ${!kind ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`}>All · {reports.length}</button>
        {kinds.filter(k => counts[k.key]).map(k => (
          <button key={k.key} onClick={() => setKind(k.key === kind ? '' : k.key)} className={`rounded-full px-2.5 py-1 text-[12px] font-semibold border ${kind === k.key ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`}>{k.label} · {counts[k.key]}</button>
        ))}
        {canRoute && <button onClick={() => setShowRouting(v => !v)} className="ml-auto text-[12px] font-semibold text-brand-700 hover:underline">{showRouting ? 'Hide' : 'What Slack gets'}</button>}
      </div>
      {showRouting && canRoute && (
        <div className="bg-white border border-line rounded-2xl shadow-soft p-4 mb-3">
          <div className="text-[13px] font-bold text-ink mb-1">What Slack gets, per report</div>
          <div className="text-[11.5px] text-muted mb-2">Every report is filed here regardless. <b>Page</b> — nothing in Slack. <b>Pointer</b> — one line with the headline and a link. <b>Slack</b> — the full text, as before.</div>
          <div className="divide-y divide-line">
            {kinds.map(k => (
              <div key={k.key} className="py-1.5 flex items-center gap-2 flex-wrap text-[12.5px]">
                <div className="min-w-0 flex-1"><b className="text-ink">{k.label}</b> <span className="text-muted">· {k.cadence} · {k.what}</span></div>
                <div className="inline-flex rounded-lg border border-line overflow-hidden text-[11px] font-semibold shrink-0">
                  {(['page', 'pointer', 'slack'] as Route[]).map(v => (
                    <button key={v} onClick={() => setRoute(k.key, v)} className={`px-2 py-0.5 ${(routing[k.key] || k.defaultRoute) === v ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink'}`}>{v === 'page' ? 'Page' : v === 'pointer' ? 'Pointer' : 'Slack'}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {loading ? <div className="text-[12px] text-muted inline-flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> Loading…</div>
        : err ? <LeanEmpty>{err}</LeanEmpty>
        : !shown.length ? <LeanEmpty>Nothing filed yet. Reports arrive as the desks run — the morning Ops Command, the shared-boards digest, the Monday quality audit, the Sunday scorecard.</LeanEmpty>
        : Object.entries(byDay).map(([day, list]) => (
          <div key={day} className="mb-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5 px-1">{day}</div>
            <div className="bg-white border border-line rounded-2xl shadow-soft divide-y divide-line">
              {list.map(r => (
                <button key={r.id} onClick={() => pick(r)} className="w-full text-left px-4 py-2.5 flex items-start gap-3 hover:bg-app/60">
                  <FileText size={15} className="text-brand-600 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap"><span className="text-[13px] font-semibold text-ink">{r.title}</span><Tag>{label(r.kind)}</Tag></div>
                    <div className="text-[12px] text-muted truncate">{String(r.text || '').replace(/[*_`>]/g, '').replace(/<[^|>]+\|([^>]+)>/g, '$1').split('\n').filter(l => l.trim()).slice(1, 3).join(' · ').slice(0, 160)}</div>
                  </div>
                  <span className="text-[11px] text-muted shrink-0">{new Date(r.at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
    </div>
  )
}
