'use client'
// Guest-sentiment queue on the Messages page. Scans guest threads (AI), flags dissatisfaction,
// lets the team open a thread or close it out. Adds visibility — it never sends a message or
// changes a reservation.
//
// LEAN PASS (2026-09-22): one row per thread (Open · guest · issue · tags · icon actions); the
// quote, the AI's reason and the triggers are behind the row. The dissatisfaction banner became
// header pills on the Messages page, fed by `onLoad`.
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { AlertTriangle, Frown, Meh, Smile, Check, RefreshCw, Wrench, ClipboardCheck, Loader2 } from 'lucide-react'
import { Tag, IconBtn, LeanList, LeanRow, LeanEmpty, Clamp, type Tone } from '@/components/lean'

export type SentimentRow = {
  id: string; guest: string; channel: string; listingName: string | null; building: string | null
  score: number | null; band: string; dissatisfied: boolean; triggers: string[]
  topIssue: string | null; reason: string | null; excerpt: string | null
  lastMessageAt: string | null; awaitingReply: boolean; status: string; preview: string; unread: number
}
type Row = SentimentRow
export type SentimentSummary = { total: number; open: number; dissatisfied: number; negative: number; awaitingNegative: number; unansweredNegative: number }
type Summary = SentimentSummary

const CH: Record<string, string> = { airbnb: 'Airbnb', airbnb2: 'Airbnb', vrbo: 'VRBO', booking: 'Booking', 'booking.com': 'Booking', sms: 'SMS', email: 'Email', whatsapp: 'WhatsApp' }
const TRIG: Record<string, string> = { ai_dissatisfaction: 'AI: dissatisfied', keyword: 'Risk keyword', low_score: 'Low score', unanswered_negative: 'Unanswered + negative' }

function bandUi(band: string): { tone: Tone; Icon: any; label: string } {
  if (band === 'negative') return { tone: 'rose', Icon: Frown, label: 'Negative' }
  if (band === 'positive') return { tone: 'emerald', Icon: Smile, label: 'Positive' }
  return { tone: 'slate', Icon: Meh, label: 'Neutral' }
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

/** `onLoad` hands every load's rows and summary to the page (header pills, inbox sentiment tags). */
export function SentimentBoard({ onLoad }: { onLoad?: (rows: SentimentRow[], summary: SentimentSummary | null) => void } = {}) {
  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<'attention' | 'all'>('attention')
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState<string | null>(null)
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
  // Report up whenever the list changes (including the optimistic removal on Close out).
  useEffect(() => { if (onLoad) onLoad(rows, summary) }, [rows, summary]) // eslint-disable-line react-hooks/exhaustive-deps

  async function close(id: string) {
    setRows(rs => rs.filter(r => r.id !== id))
    try { await fetch('/api/sentiment/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: id, status: 'closed' }) }) }
    finally { load() }
  }

  // EXPLICIT approval only - the click IS the approval; nothing is created automatically.
async function createQc(r: Row) {
const c = classifyQc(r)
const desc = 'GUEST ISSUE: ' + (r.topIssue || 'Guest dissatisfaction') + (r.excerpt ? ' - "' + r.excerpt.slice(0, 180) + '"' : '') + '\nCHECK FOR: ' + c.check + '\nGUEST CONTEXT: ' + r.guest + ' via ' + (CH[r.channel] || r.channel) + (r.listingName ? ' - ' + r.listingName : '') + '\nREQUIRED: photos + notes before closing. Created from Lighthouse guest sentiment.'
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

  return (
    <section>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <div className="inline-flex rounded-lg border border-line overflow-hidden text-[12px]">
          <button onClick={() => setFilter('attention')} className={`px-2.5 py-1 font-semibold ${filter === 'attention' ? 'bg-brand-600 text-white' : 'bg-white text-muted'}`}>Needs attention</button>
          <button onClick={() => setFilter('all')} className={`px-2.5 py-1 font-semibold border-l border-line ${filter === 'all' ? 'bg-brand-600 text-white' : 'bg-white text-muted'}`}>All scored</button>
        </div>
        <button onClick={scan} disabled={scanning} title="Score the last 30 days of guest threads with AI"
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-lg border border-brand-200 text-brand-700 bg-brand-50 px-2.5 py-1 hover:bg-brand-100 disabled:opacity-50">
          <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} /> {scanning ? 'Scanning…' : 'Scan now'}
        </button>
        {scanMsg && <span className="text-[12px] text-muted">{scanMsg}</span>}
        {err && <span className="text-[12px] text-rose-600 inline-flex items-center gap-1"><AlertTriangle size={12} /> {err}</span>}
      </div>

      {loading && rows.length === 0 ? (
        <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1.5" />Loading sentiment…</LeanEmpty>
      ) : shown.length === 0 ? (
        <LeanEmpty>{rows.length === 0 ? <>No conversations scored yet — <strong>Scan now</strong> analyzes the last 30 days.</> : 'No threads need attention right now.'}</LeanEmpty>
      ) : (
        <LeanList>
          {shown.map(r => {
            const ui = bandUi(r.band); const Icon = ui.Icon
            const q = qc[r.id]
            return (
              <LeanRow key={r.id}
                lead={<Link href={`/messages/${r.id}`} className="shrink-0 inline-flex items-center rounded-full bg-brand-600 text-white px-3 h-8 text-[12px] font-semibold hover:bg-brand-700">Open</Link>}
                name={r.guest}
                meta={[r.topIssue || r.building || r.listingName, ago(r.lastMessageAt)].filter(Boolean).join(' · ')}
                tags={<>
                  <Tag tone={ui.tone} title={`AI sentiment score ${r.score ?? '—'}/5`}><Icon size={10} className="inline -mt-px mr-0.5" />{r.dissatisfied ? 'Unhappy' : ui.label} {r.score ?? ''}</Tag>
                  <Tag>{CH[r.channel] || r.channel}</Tag>
                  {r.awaitingReply && <Tag tone="rose" title="Latest message is from the guest">Needs reply</Tag>}
                  {q && <Tag tone="violet" title={`Breezeway task ${q.taskId}`}>QC task</Tag>}
                </>}
                actions={<>
                  {q
                    ? (q.reportUrl ? <IconBtn title="Open the QC task in Breezeway" tone="brand" href={q.reportUrl}><ClipboardCheck size={14} /></IconBtn> : null)
                    : <IconBtn title="Create a Breezeway QC task for this issue" disabled={!!qcBusy[r.id]} onClick={() => createQc(r)}>{qcBusy[r.id] ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}</IconBtn>}
                  <IconBtn title="Close out — handled, drop it from the list" tone="ok" onClick={() => close(r.id)}><Check size={15} /></IconBtn>
                </>}
              >
                <div className="text-[12px] text-muted">{[r.building, r.listingName].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ') || 'No unit on the thread'}</div>
                {r.topIssue && <div className="text-[13px] text-ink font-medium">{r.topIssue}</div>}
                {r.excerpt && <Clamp text={`“${r.excerpt}”`} />}
                {r.reason && <div className="text-[12px] text-ink/70 bg-app rounded-lg px-3 py-2">{r.reason}</div>}
                {r.triggers.length > 0 && (
                  <div className="flex flex-wrap gap-1">{r.triggers.map(t => <Tag key={t} tone="amber">{TRIG[t] || t}</Tag>)}</div>
                )}
              </LeanRow>
            )
          })}
        </LeanList>
      )}
    </section>
  )
}
