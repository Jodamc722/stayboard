// ONE CALL, IN FULL (2026-09-21). Jon: "Have a lighthouse link there for full transcript."
//
// A permanent page per call, so a transcript can be linked to — from the booking, from Guesty's
// reservation notes, from Slack, from an email to an owner. The note is at the top because that is
// what most people came for; the transcript is underneath, in full, speaker by speaker.
//
// It lives UNDER /welcome-calls on purpose: a recording of a guest conversation is exactly as
// sensitive as the Calls desk itself, so it inherits that tab's per-role permission rather than
// being login-only (lib/features.ts featureForPath matches the longest path).
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { formatPhone } from '@/lib/talkroute'
import { ArrowLeft, PhoneOutgoing, PhoneIncoming, PhoneMissed, Play, User, Home, CalendarDays, HandHeart, AlertTriangle } from 'lucide-react'

export const dynamic = 'force-dynamic'

const KIND: Record<string, string> = { welcome: 'Welcome call', post_checkout: 'Post-checkout call', stay: 'Call during the stay' }
const TONE: Record<string, string> = { happy: 'bg-emerald-100 text-emerald-700', fine: 'bg-slate-100 text-slate-600', unhappy: 'bg-rose-100 text-rose-700' }
const dur = (s: number) => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
const when = (s: any) => { const d = new Date(String(s || '')); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }

export default async function CallPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const sb = supabaseAdmin()
  const { data: c } = await sb.from('talkroute_calls')
    .select('id,direction,call_at,duration,result,recorded,match_kind,transcript,transcript_status,summary,intel,reservation_id,external_number,external_name,caller_name,caller_device,note_pushed_at,note_line,audio_seconds')
    .eq('id', params.id).maybeSingle()
  if (!c) notFound()

  let res: any = null
  if (c.reservation_id) {
    const { data } = await sb.from('guesty_reservations')
      .select('id,guest_name,listing_name,check_in,check_out,nights,source')
      .eq('id', c.reservation_id).maybeSingle()
    res = data || null
  }
  const intel: any = (c.intel && typeof c.intel === 'object') ? c.intel : null
  const answered = String(c.result) === 'answered'
  const Icon = c.direction === 'outbound' ? PhoneOutgoing : answered ? PhoneIncoming : PhoneMissed
  const lines = String(c.transcript || '').split('\n').filter(Boolean)

  return (
    <Shell>
      {res
        ? <Link href={`/reservations/${res.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-3"><ArrowLeft size={15} /> {res.guest_name || 'the booking'}</Link>
        : <Link href="/welcome-calls" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-3"><ArrowLeft size={15} /> Calls desk</Link>}

      <header className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Icon size={13} /> {KIND[String(c.match_kind || '')] || 'Guest call'}
        </p>
        <h1 className="text-2xl font-bold text-ink mt-1">
          {c.direction === 'outbound' ? 'We called' : 'Guest called'} {res?.guest_name || c.external_name || formatPhone(String(c.external_number || ''))}
        </h1>
        <p className="text-sm text-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{when(c.call_at)}</span>
          <span>· {answered ? `answered · ${dur(Number(c.duration) || 0)}` : String(c.result || 'no answer')}</span>
          {c.caller_name && <span>· by <b className="text-ink/80">{c.caller_name}</b></span>}
          {c.external_number && <a href={`tel:+${c.external_number}`} className="text-brand-600 hover:underline">· {formatPhone(String(c.external_number))}</a>}
          {intel?.sentiment && TONE[intel.sentiment] && <span className={`rounded px-1.5 text-[11px] font-semibold ${TONE[intel.sentiment]}`}>{intel.sentiment}</span>}
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {c.summary && (
            <section className="bg-white rounded-2xl border border-line shadow-soft p-5">
              <h2 className="text-sm font-semibold text-ink mb-2">The note</h2>
              <p className="text-[15px] text-ink leading-relaxed">{c.summary}</p>
              {intel && (intel.asked?.length || intel.promised?.length || intel.issues?.length) ? (
                <div className="grid sm:grid-cols-3 gap-3 mt-4 text-[13px]">
                  <Col label="They asked about" items={intel.asked} />
                  <Col label="We promised" items={intel.promised} Icon={HandHeart} cls="text-brand-700" />
                  <Col label="Problems raised" items={intel.issues} Icon={AlertTriangle} cls="text-rose-700" />
                </div>
              ) : null}
              {c.note_pushed_at && <p className="text-[11px] text-muted mt-3">This note is on the booking in Guesty.</p>}
            </section>
          )}

          <section className="bg-white rounded-2xl border border-line shadow-soft p-5">
            <h2 className="text-sm font-semibold text-ink mb-3">Transcript</h2>
            {lines.length === 0 ? (
              <p className="text-sm text-muted">
                {c.transcript_status === 'pending' ? 'Being transcribed — check back in a few minutes.'
                  : c.transcript_status === 'skipped' ? 'Too short to be worth transcribing.'
                  : c.transcript_status === 'none' ? 'This call was not recorded.'
                  : c.transcript_status === 'expired' ? 'The recording link expired before it could be read.'
                  : c.transcript_status === 'failed' ? 'The recording could not be transcribed.'
                  : 'No transcript.'}
              </p>
            ) : (
              <div className="space-y-2">
                {lines.map((l, i) => {
                  const m = l.match(/^Speaker (\d+):\s*(.*)$/)
                  const who = m ? Number(m[1]) : -1
                  const text = m ? m[2] : l
                  return (
                    <div key={i} className="flex gap-3">
                      <span className={`shrink-0 text-[11px] font-semibold mt-0.5 w-16 ${who === 0 ? 'text-brand-600' : 'text-slate-500'}`}>{who >= 0 ? `Speaker ${who}` : ''}</span>
                      <p className="text-[14px] text-ink leading-relaxed">{text}</p>
                    </div>
                  )
                })}
                <p className="text-[11px] text-muted pt-2 border-t border-line">
                  Speakers are numbered, not named — Talkroute does not label them. {c.audio_seconds ? `${dur(Number(c.audio_seconds))} of audio.` : ''}
                </p>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          {res && (
            <section className="bg-white rounded-2xl border border-line shadow-soft p-5">
              <h2 className="text-sm font-semibold text-ink mb-3">The booking</h2>
              <dl className="space-y-2 text-[13px]">
                <Row Icon={User} k="Guest" v={res.guest_name || '—'} />
                <Row Icon={Home} k="Unit" v={res.listing_name || '—'} />
                <Row Icon={CalendarDays} k="Stay" v={`${String(res.check_in || '').slice(0, 10)} → ${String(res.check_out || '').slice(0, 10)}`} />
              </dl>
              <div className="mt-3 flex flex-col gap-1.5">
                <Link href={`/reservations/${res.id}`} className="text-[12px] font-semibold text-brand-600 hover:underline">Open the booking →</Link>
                <a href={`https://app.guesty.com/reservations/${res.id}/summary`} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-muted hover:text-ink">Open in Guesty ↗</a>
              </div>
            </section>
          )}
          <section className="bg-white rounded-2xl border border-line shadow-soft p-5 text-[13px] space-y-1.5">
            <h2 className="text-sm font-semibold text-ink mb-2">The call</h2>
            <p className="text-muted">Made by <b className="text-ink">{c.caller_name || 'someone on the Talkroute account'}</b>{c.caller_device && c.caller_device !== c.caller_name ? ` (${c.caller_device})` : ''}.</p>
            <p className="text-muted">{c.recorded ? 'Recorded.' : 'Not recorded.'} {answered ? `Talked for ${dur(Number(c.duration) || 0)}.` : 'Never connected.'}</p>
          </section>
        </aside>
      </div>
    </Shell>
  )
}

function Col({ label, items, Icon, cls }: { label: string; items?: string[]; Icon?: any; cls?: string }) {
  if (!items?.length) return null
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-[0.1em] font-semibold mb-1 flex items-center gap-1 ${cls || 'text-muted'}`}>{Icon ? <Icon size={11} /> : null}{label}</div>
      <ul className="space-y-0.5">{items.map((x, i) => <li key={i} className="text-slate-700">· {x}</li>)}</ul>
    </div>
  )
}
function Row({ Icon, k, v }: { Icon: any; k: string; v: string }) {
  return <div className="flex items-start gap-2"><Icon size={13} className="text-muted mt-0.5" /><dt className="text-muted w-12 shrink-0">{k}</dt><dd className="text-ink">{v}</dd></div>
}
