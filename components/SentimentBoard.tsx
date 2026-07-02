'use client'
// Guest-sentiment queue on the Messages page. Scans guest threads (AI), surfaces a warning
// banner for dissatisfaction, lets the team open a thread or close it out. Adds visibility —
// it never sends a message or changes a reservation.
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { AlertTriangle, Frown, Meh, Smile, Check, Clock, RefreshCw, ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react'

type Row = {
  id: string; guest: string; channel: string; listingName: string | null; building: string | null
  score: number | null; band: string; dissatisfied: boolean; triggers: string[]
  topIssue: string | null; reason: string | null; excerpt: string | null
  lastMessageAt: string | null; awaitingReply: boolean; status: string; preview: string; unread: number
}
type Summary = { total: number; open: number; dissatisfied: number; negative: number; awaitingNegative: number; unansweredNegative: number }

const CH: Record<string, string> = { airbnb: 'Airbnb', airbnb2: 'Airbnb', vrbo: 'VRBO', booking: 'Booking', 'booking.com': 'Booking', sms: 'SMS', email: 'Email', whatsapp: 'WhatsApp' }
const TRIG: Record<string, string> = { ai_dissatisfaction: 'AI: dissatisfied', keyword: 'Risk keyword', low_score: 'Low score', unanswered_negative: 'Unanswered + negative' }

function bandUi(band: string, score: number | null) {
  if (band === 'negative') return { ring: 'bg-rose-50 text-rose-700 border-rose-200', Icon: Frown, label: 'Negative' }
  if (band === 'positive') return { ring: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: Smile, label: 'Positive' }
  return { ring: 'bg-slate-50 text-slate-600 border-slate-200', Icon: Meh, label: 'Neutral' }
}
function ago(s: string | null) {
  if (!s) return ''
  const ms = Date.now() - new Date(s).getTime(); const h = ms / 3600000
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))}m ago`
  if (h < 24) return `${Math.round(h)}h ago`
  return `${Math.round(h / 24)}d ago`
}

// Map the guest's issue to a SPECIFIC QC task (what to check, which team, priority).
function classifyQc(r: Row) {
const text = ((r.topIssue || '') + ' ' + (r.excerpt || '') + ' ' + (r.reason || '')).toLowerCase()
if (/bed ?bug|bug bite|bites|welt|pest|roach|cockroach|rodent|mice|mouse/.test(text)) return { issueType: 'pest', department: 'inspection', priority: 'urgent', title: 'PEST ALERT - full inspection required', check: 'Full pest inspection: mattress seams, headboard, furniture, floors. Photos REQUIRED. Do not release the unit for the next guest until cleared.' }
if (/\bac\b|a\/c|air condition|heat|hot water|no water|leak|flood|electric|not working|broken|wifi|internet|sewer|lock|door code/.test(text)) return { issueType: 'maintenance', department: 'maintenance', priority: 'high', title: 'Guest-reported maintenance issue', check: 'Test and fix the reported item. Photo before/after + note exactly what was done.' }
if (/dirty|unclean|not clean|stain|hair|trash|linen|towel|smell/.test(text)) return { issueType: 'cleanliness', department: 'housekeeping', priority: 'high', title: 'Cleanliness complaint - inspection + re-clean', check: 'Full cleanliness inspection; re-clean anything below standard. Photos required.' }
return { issueType: 'upset-guest', department: 'inspection', priority: 'high', title: 'Upset guest - unit inspection', check: 'Guest is showing dissatisfaction. Walk the unit: maintenance + cleanliness + amenities. Photos + notes.' }
}

export function SentimentBoard() {
  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<'attention' | 'all'>('attention')
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
const [qc, setQc] = useState<Record<string, { taskId: string; reportUrl: string | null }>>({})
const [qcBusy, setQcBusy] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const r = await fetch('/api/sentiment/list?status=open')
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      setRows(d.rows || []); setSummary(d.summary || null)
try {
const ids = (d.rows || []).map((x: any) => x.id).filter(Boolean).join(',')
if (ids) {
const q = await fetch('/api/sentiment/create-qc?conversationIds=' + ids).then(x => x.json()).catch(() => null)
const m: Record<string, { taskId: string; reportUrl: string | null }> = {}
for (const t of ((q && q.tasks) || [])) if (t.conversation_id && t.breezeway_task_id) m[t.conversation_id] = { taskId: String(t.breezeway_task_id), reportUrl: t.report_url || null }
setQc(m)
}
} catch { /* qc state optional */ }
    } catch (e: any) { setErr(e?.message || String(e)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function close(id: string) {
    setRows(rs => rs.filter(r => r.id !== id))
    try { await fetch('/api/sentiment/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: id, status: 'closed' }) }) }
    finally { load() }
  }

  // EXPLICIT approval only - the click IS the approval; nothing is created automatically.
async function createQc(r: Row) {
const c = classifyQc(r)
const desc = 'GUEST ISSUE: ' + (r.topIssue || 'Guest dissatisfaction') + (r.excerpt ? ' - "' + r.excerpt.slice(0, 180) + '"' : '') + '\nCHECK FOR: ' + c.check + '\nGUEST CONTEXT: ' + r.guest + ' via ' + (CH[r.channel] || r.channel) + (r.listingName ? ' - ' + r.listingName : '') + '\nREQUIRED: photos + notes before closing. Created from StayBoard guest sentiment.'
if (!window.confirm('Create a ' + c.department.toUpperCase() + ' task in Breezeway' + (r.listingName ? ' for ' + r.listingName : '') + '?\n\n' + c.title)) return
setQcBusy(p => ({ ...p, [r.id]: true }))
try {
const res = await fetch('/api/sentiment/create-qc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: r.id, issueType: c.issueType, department: c.department, priority: c.priority, title: c.title, description: desc }) })
const j = await res.json().catch(() => null)
if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || 'Could not create the QC task.')
setQc(p => ({ ...p, [r.id]: { taskId: String(j.taskId), reportUrl: j.reportUrl || null } }))
} catch (e: any) { setErr(e?.message || String(e)) } finally { setQcBusy(p => { const n = { ...p }; delete n[r.id]; return n }) }
}

async function scan() {
    setScanning(true); setScanMsg('Scanning guest threads…')
    try {
      let total = 0
      for (let i = 0; i < 12; i++) {
        const r = await fetch('/api/sentiment/scan?days=30&limit=6', { method: 'POST' })
        const d = await r.json()
        if (d.error) { setScanMsg(d.error); break }
        total += d.scanned || 0
        setScanMsg(`Scanned ${total} threads… ${d.remaining || 0} remaining`)
        if (!d.remaining || d.remaining <= 0) break
        await new Promise(res => setTimeout(res, 600))
      }
      setScanMsg(`Done — ${total} conversations analyzed.`)
      await load()
    } catch (e: any) { setScanMsg(e?.message || String(e)) }
    finally { setScanning(false); setTimeout(() => setScanMsg(null), 6000) }
  }

  const shown = filter === 'attention' ? rows.filter(r => r.dissatisfied || r.band === 'negative' || r.triggers.length > 0) : rows
  const flagged = summary ? summary.dissatisfied + summary.negative : 0

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><ShieldAlert size={15} className="text-brand-600" /> Guest sentiment</h2>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-line overflow-hidden text-[12px]">
            <button onClick={() => setFilter('attention')} className={`px-2.5 py-1 font-semibold ${filter === 'attention' ? 'bg-brand-600 text-white' : 'bg-white text-muted'}`}>Needs attention</button>
            <button onClick={() => setFilter('all')} className={`px-2.5 py-1 font-semibold ${filter === 'all' ? 'bg-brand-600 text-white' : 'bg-white text-muted'}`}>All scored</button>
          </div>
          <button onClick={scan} disabled={scanning} className="inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-lg border border-brand-200 text-brand-700 bg-brand-50 px-2.5 py-1.5 hover:bg-brand-100 disabled:opacity-50">
            <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} /> {scanning ? 'Scanning…' : 'Scan now'}
          </button>
        </div>
      </div>

      {/* warning banner */}
      {summary && (summary.dissatisfied > 0 || summary.awaitingNegative > 0) && (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <AlertTriangle size={16} className="text-rose-600 shrink-0" />
          <span className="text-[13px] text-rose-800 font-semibold">{summary.dissatisfied} guest{summary.dissatisfied === 1 ? '' : 's'} showing dissatisfaction</span>
          {summary.awaitingNegative > 0 && <span className="text-[12px] text-rose-700">· {summary.awaitingNegative} negative + awaiting your reply</span>}
          {summary.unansweredNegative > 0 && <span className="text-[12px] text-rose-700">· {summary.unansweredNegative} unanswered &gt; 2h</span>}
        </div>
      )}

      {scanMsg && <div className="mb-3 text-[12px] text-muted inline-flex items-center gap-1.5"><Clock size={12} /> {scanMsg}</div>}
      {err && <div className="mb-3 text-[12px] text-rose-600 inline-flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5" /> {err}</div>}

      {loading ? (
        <div className="bg-white rounded-2xl border border-line p-8 text-center text-muted text-sm">Loading sentiment…</div>
      ) : shown.length === 0 ? (
        <div className="bg-white rounded-2xl border border-line p-8 text-center text-muted text-sm">
          {rows.length === 0 ? <>No conversations scored yet. Click <strong>Scan now</strong> to analyze the last 30 days.</> : 'No threads need attention right now. 🎉'}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-line shadow-soft divide-y divide-line/60 overflow-hidden">
          {shown.map(r => {
            const ui = bandUi(r.band, r.score); const Icon = ui.Icon; const isOpen = open[r.id]
            return (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-semibold shrink-0 ${ui.ring}`} title={`Score ${r.score ?? '—'}/5`}>
                    <Icon size={13} /> {r.score ?? '—'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-ink truncate">{r.guest}</span>
                      <span className="text-[10px] uppercase tracking-wide text-muted font-semibold">{CH[r.channel] || r.channel}</span>
                      {r.listingName && <span className="text-[11px] text-muted truncate">· {r.building || r.listingName}</span>}
                      {r.awaitingReply && <span className="text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full">Awaiting reply</span>}
                      <span className="ml-auto text-[11px] text-muted shrink-0">{ago(r.lastMessageAt)}</span>
                    </div>
                    {r.topIssue && <div className="text-[13px] text-ink mt-0.5"><span className="font-medium">{r.topIssue}</span></div>}
                    {r.excerpt && <div className="text-[12px] text-muted italic mt-0.5 truncate">“{r.excerpt}”</div>}
                    {r.triggers.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {r.triggers.map(t => <span key={t} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">{TRIG[t] || t}</span>)}
                      </div>
                    )}
                    {isOpen && r.reason && <div className="text-[12px] text-ink/70 mt-2 bg-app rounded-lg px-3 py-2">{r.reason}</div>}
                    <div className="flex items-center gap-3 mt-2">
                      <Link href={`/messages/${r.id}`} className="text-[12px] font-semibold text-brand-700 hover:underline">Open thread →</Link>
                      <button onClick={() => close(r.id)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700 hover:underline"><Check size={13} /> Close out</button>
{qc[r.id] ? (qc[r.id].reportUrl ? <a href={qc[r.id].reportUrl as string} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-violet-700 hover:underline">QC task created &rarr;</a> : <span className="text-[12px] font-semibold text-violet-700">QC task created</span>) : <button onClick={() => createQc(r)} disabled={!!qcBusy[r.id]} className="inline-flex items-center gap-1 text-[12px] font-semibold text-violet-700 hover:underline disabled:opacity-50" title="Create a targeted inspection/maintenance task in Breezeway with this guest's issue - only on your click">{qcBusy[r.id] ? 'Creating...' : 'Create QC task'}</button>}
                      {r.reason && <button onClick={() => setOpen(o => ({ ...o, [r.id]: !o[r.id] }))} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink ml-auto">{isOpen ? <>Less <ChevronUp size={13} /></> : <>Why <ChevronDown size={13} /></>}</button>}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
