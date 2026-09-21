'use client'
// CONTACT HISTORY on a booking (2026-09-21) — every call, text and voicemail with this guest, and
// what was actually said on the phone.
//
// The shape of it: a header that answers "were they called, and how did it go" in one glance, the
// follow-up list (what we promised them — the thing that quietly loses stays), then the timeline.
// A call opens to its note; the full transcript is one more click, because the note is the point
// and the transcript is the evidence behind it.
import { useState } from 'react'
import Link from 'next/link'
import { PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, Voicemail, MessageSquare, ChevronDown, Check, AlertTriangle, Play, FileText, Clock, HandHeart, ExternalLink } from 'lucide-react'

type Intel = { summary: string; asked: string[]; promised: string[]; issues: string[]; sentiment: string; followUp: boolean; whoAnswered: string } | null
type Ev =
  | { kind: 'call'; id: string; at: string; direction: 'inbound' | 'outbound'; result: string; seconds: number; matchKind: string; recorded: boolean; transcriptStatus: string; transcript: string; summary: string; intel: Intel; notePushed: boolean; callerName: string }
  | { kind: 'text'; id: string; at: string; direction: 'incoming' | 'outgoing'; body: string; by: string }
  | { kind: 'voicemail'; id: string; at: string; seconds: number; transcript: string; audio: string }
type Log = { kind: string; outcome: string; attempts: number; calledBy: string; calledAt: string; note: string; source: string }
export type History = {
  events: Ev[]; phone: string; phoneDisplay: string; log: Log[]
  totals: { calls: number; answered: number; talkSeconds: number; texts: number; voicemails: number }
  promised: { at: string; item: string }[]; openIssues: string[]; lastContactAt: string
}

const when = (s: string) => { const d = new Date(s); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
const dur = (s: number) => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
const KIND: Record<string, string> = { welcome: 'Welcome call', post_checkout: 'Post-checkout call', stay: 'During the stay' }
const TONE: Record<string, { cls: string; label: string }> = {
  happy: { cls: 'bg-emerald-100 text-emerald-700', label: 'Happy' },
  fine: { cls: 'bg-slate-100 text-slate-600', label: 'Fine' },
  unhappy: { cls: 'bg-rose-100 text-rose-700', label: 'Unhappy' },
}

export function ContactHistory({ h }: { h: History }) {
  const [open, setOpen] = useState<string | null>(null)
  const [script, setScript] = useState<string | null>(null)
  const answeredCall = h.events.find(e => e.kind === 'call' && e.result === 'answered') as any
  const called = !!answeredCall

  if (!h.events.length && !h.log.length) {
    return (
      <div className="text-sm text-slate-500">
        No calls, texts or voicemails on this booking{h.phoneDisplay ? ` for ${h.phoneDisplay}` : ''}.
        {!h.phone && <> No phone number on file, so texts can&apos;t be matched.</>}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* The one-glance answer */}
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        {called
          ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-2.5 py-1 font-semibold"><Check size={12} /> Spoke to the guest {when(answeredCall.at)}</span>
          : <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 px-2.5 py-1 font-semibold"><PhoneMissed size={12} /> Never reached by phone</span>}
        <span className="text-slate-500">{h.totals.calls} call{h.totals.calls === 1 ? '' : 's'}{h.totals.answered ? ` · ${h.totals.answered} answered · ${dur(h.totals.talkSeconds)} talking` : ''}{h.totals.texts ? ` · ${h.totals.texts} texts` : ''}{h.totals.voicemails ? ` · ${h.totals.voicemails} voicemail${h.totals.voicemails === 1 ? '' : 's'}` : ''}</span>
        {h.phoneDisplay && <a href={`tel:+${h.phone.length === 10 ? '1' + h.phone : h.phone}`} className="font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"><PhoneCall size={11} /> {h.phoneDisplay}</a>}
      </div>

      {/* What we owe them. This is the half of a call that gets forgotten. */}
      {h.promised.length > 0 && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/60 px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-brand-700 flex items-center gap-1.5 mb-1"><HandHeart size={12} /> We promised the guest</div>
          <ul className="space-y-0.5">
            {h.promised.map((p, i) => (
              <li key={i} className="text-[13px] text-ink flex gap-2"><span className="text-brand-600">·</span><span>{p.item} <span className="text-slate-400 text-[11px]">— {when(p.at)}</span></span></li>
            ))}
          </ul>
        </div>
      )}
      {h.openIssues.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-rose-700 flex items-center gap-1.5 mb-1"><AlertTriangle size={12} /> Raised on a call</div>
          <div className="text-[13px] text-ink">{h.openIssues.join(' · ')}</div>
        </div>
      )}

      {/* The timeline */}
      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
        {h.events.slice().reverse().map(e => {
          if (e.kind === 'text') {
            return (
              <li key={e.id} className="px-3 py-2 flex items-start gap-2.5">
                <MessageSquare size={14} className={`mt-0.5 shrink-0 ${e.direction === 'incoming' ? 'text-slate-400' : 'text-brand-500'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-slate-500">{e.direction === 'incoming' ? 'Guest texted' : `We texted${e.by ? ` · ${e.by.split('@')[0]}` : ''}`} · {when(e.at)}</div>
                  <div className="text-[13px] text-ink break-words">{e.body}</div>
                </div>
              </li>
            )
          }
          if (e.kind === 'voicemail') {
            return (
              <li key={e.id} className="px-3 py-2 flex items-start gap-2.5 bg-amber-50/40">
                <Voicemail size={14} className="mt-0.5 shrink-0 text-amber-600" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-slate-500">Guest left a voicemail · {dur(e.seconds)} · {when(e.at)}</div>
                  <div className="text-[13px] text-ink break-words">{e.transcript || <span className="italic text-slate-400">No transcript</span>}</div>
                  {e.audio && <a href={e.audio} target="_blank" rel="noopener noreferrer" className="text-[11px] text-brand-600 hover:underline inline-flex items-center gap-1 mt-0.5"><Play size={10} /> Listen</a>}
                </div>
              </li>
            )
          }
          const answered = e.result === 'answered'
          const Icon = e.direction === 'outbound' ? PhoneOutgoing : answered ? PhoneIncoming : PhoneMissed
          const isOpen = open === e.id
          const tone = e.intel ? TONE[e.intel.sentiment] : null
          return (
            <li key={e.id} className={answered ? '' : 'bg-slate-50/60'}>
              <button onClick={() => setOpen(isOpen ? null : e.id)} className="w-full text-left px-3 py-2 flex items-start gap-2.5 hover:bg-slate-50">
                <Icon size={14} className={`mt-0.5 shrink-0 ${answered ? 'text-emerald-600' : 'text-rose-400'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-slate-700">{e.direction === 'outbound' ? 'We called' : 'Guest called'}</span>
                    <span>{answered ? `answered · ${dur(e.seconds)}` : e.result === 'missed' ? 'no answer' : e.result || 'no answer'}</span>
                    <span>· {when(e.at)}</span>
                    {e.callerName && <span>· by <b className="text-slate-700">{e.callerName}</b></span>}
                    {e.matchKind && KIND[e.matchKind] && <span className="rounded bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-600">{KIND[e.matchKind]}</span>}
                    {tone && <span className={`rounded px-1.5 text-[10px] font-semibold ${tone.cls}`}>{tone.label}</span>}
                    {e.intel?.followUp && <span className="rounded bg-brand-100 px-1.5 text-[10px] font-semibold text-brand-700">Follow-up</span>}
                  </div>
                  <div className="text-[13px] text-ink">
                    {e.summary || (answered
                      ? <span className="italic text-slate-400">{statusWord(e)}</span>
                      : <span className="text-slate-400">No answer — nothing said.</span>)}
                  </div>
                </div>
                {answered && <ChevronDown size={13} className={`mt-1 shrink-0 text-slate-400 ${isOpen ? 'rotate-180 transition' : 'transition'}`} />}
              </button>
              {isOpen && answered && (
                <div className="px-3 pb-3 pl-10 space-y-2">
                  {e.intel && (e.intel.asked.length > 0 || e.intel.promised.length > 0 || e.intel.issues.length > 0) && (
                    <div className="grid sm:grid-cols-3 gap-2 text-[12px]">
                      <Bit label="They asked about" items={e.intel.asked} />
                      <Bit label="We promised" items={e.intel.promised} tone="brand" />
                      <Bit label="Problems raised" items={e.intel.issues} tone="rose" />
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-[11px] flex-wrap">
                    {e.transcript
                      ? <button onClick={() => setScript(script === e.id ? null : e.id)} className="inline-flex items-center gap-1 text-brand-600 hover:underline font-semibold"><FileText size={11} /> {script === e.id ? 'Hide' : 'Read'} the transcript</button>
                      : <span className="text-slate-400 inline-flex items-center gap-1"><Clock size={11} /> {statusWord(e)}</span>}
                    <Link href={`/welcome-calls/call/${e.id}`} className="inline-flex items-center gap-1 text-brand-600 hover:underline font-semibold"><ExternalLink size={11} /> Open the call page</Link>
                    {e.notePushed && <span className="text-slate-400">Note pushed to Guesty</span>}
                  </div>
                  {script === e.id && e.transcript && (
                    <pre className="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-80 overflow-y-auto font-sans">{e.transcript}</pre>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {h.log.length > 0 && (
        <div className="text-[11px] text-slate-500">
          Desk log: {h.log.map(l => `${l.kind === 'welcome' ? 'Welcome' : 'Post-checkout'} — ${outcomeWord(l.outcome)}${l.attempts > 1 ? ` after ${l.attempts} tries` : ''}${l.source === 'talkroute' ? ' (from the phone system)' : l.calledBy ? ` by ${l.calledBy}` : ''}`).join(' · ')}
        </div>
      )}
    </div>
  )
}

function Bit({ label, items, tone }: { label: string; items: string[]; tone?: 'brand' | 'rose' }) {
  if (!items.length) return null
  const cls = tone === 'brand' ? 'text-brand-700' : tone === 'rose' ? 'text-rose-700' : 'text-slate-600'
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-[0.1em] font-semibold ${cls} mb-0.5`}>{label}</div>
      <ul className="space-y-0.5">{items.map((x, i) => <li key={i} className="text-slate-700">· {x}</li>)}</ul>
    </div>
  )
}

/** Why there is no note yet, in words a person can act on. */
function statusWord(e: any): string {
  switch (String(e.transcriptStatus)) {
    case 'pending': return 'Transcribing…'
    case 'skipped': return 'Too short to transcribe.'
    case 'none': return 'This call was not recorded.'
    case 'expired': return 'The recording link expired before it could be read.'
    case 'failed': return 'The recording could not be transcribed.'
    default: return 'No note yet.'
  }
}
function outcomeWord(o: string): string {
  return o === 'reached' ? 'reached' : o === 'voicemail' ? 'voicemail left' : o === 'no_answer' ? 'no answer' : o === 'incomplete' ? 'closed incomplete' : o === 'in_progress' ? 'claimed' : o === 'happy' ? 'all good' : o === 'issue' ? 'issue raised' : o || '—'
}
