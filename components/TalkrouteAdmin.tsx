'use client'
// TALKROUTE — Users & admin panel. Connect the phone system (one key), register the webhooks, set
// the voicemail rule, watch the feeds. The key is pasted once and never shown again.
import { useCallback, useEffect, useState } from 'react'
import { PhoneCall, Check, AlertTriangle, Loader2, RefreshCw, Webhook, KeyRound, Trash2, MessageSquare, Voicemail, Radio, FileText, Sparkles, UserCheck } from 'lucide-react'

type Sub = { id: string; type: string; ours: boolean }
type Num = { id: string; number: string; label: string; messaging: boolean }
type Status = {
  ok: boolean; connected: boolean; viaEnv: boolean; keyHint: string | null; connectedBy: string | null; connectedAt: string | null
  voicemailMaxSec: number; lastCallSyncAt: string | null; lastTextSyncAt: string | null; lastVoicemailSyncAt: string | null
  lastError: string | null; webhookRegistered: boolean; numbers: Num[]; subscriptions: Sub[]; account: { name: string | null } | null; apiError: string | null
  counts: { calls7d: number; texts7d: number; voicemails7d: number; autoLogged7d: number } | null
  transcribe: Transcribe | null
  people: People | null
  sync?: any; made?: string[]; removed?: number; notes?: any
  callers?: { scanned: number; named: number; devices: string[]; error?: string }
  reconciled?: { looked: number; completed: number; errors: string[] }
}
type People = {
  directory: { id: string; label: string; detail: string; kind: string }[]
  map: Record<string, string>
  devices: { device: string; name: string; calls: number }[]
}
type Transcribe = {
  ready: boolean; keyHint: string | null; viaEnv: boolean; enabled: boolean
  connectedBy: string | null; connectedAt: string | null
  minSeconds: number; usdPerDay: number; usdPerMinute: number; lastError: string | null
  fromDate: string; today: string
  queue: { pending: number; transcribed: number; failed: number; notesPushed: number; usdToday: number } | null
}

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 2) return 'just now'
  if (m < 90) return m + ' min ago'
  if (m < 60 * 48) return Math.round(m / 60) + ' h ago'
  return Math.round(m / 1440) + ' d ago'
}

export function TalkrouteAdmin() {
  const [d, setD] = useState<Status | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [vm, setVm] = useState<number>(20)
  const [flash, setFlash] = useState<string | null>(null)
  const [dgKey, setDgKey] = useState('')
  const [minSec, setMinSec] = useState(25)
  const [cap, setCap] = useState(3)
  const [from, setFrom] = useState('')

  const load = useCallback(async () => {
    setBusy('load'); setErr(null)
    try {
      const r = await fetch('/api/talkroute/admin', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Could not load Talkroute status.')
      setD(j); setVm(Number(j.voicemailMaxSec) || 20)
      if (j.transcribe) { setMinSec(Number(j.transcribe.minSeconds) || 25); setCap(Number(j.transcribe.usdPerDay) || 0); setFrom(String(j.transcribe.fromDate || '')) }
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(null) }
  }, [])
  useEffect(() => { load() }, [load])

  async function post(op: string, extra: any = {}) {
    setBusy(op); setErr(null); setFlash(null)
    try {
      const r = await fetch('/api/talkroute/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, ...extra }) })
      const j = await r.json().catch(() => ({ error: r.status === 504 || r.status === 502 ? 'The server ran out of time. Press the button again — each run resumes where the last stopped.' : `Server error ${r.status}.` }))
      if (!r.ok) throw new Error(j?.error || 'That did not work.')
      setD(j); setVm(Number(j.voicemailMaxSec) || 20)
      if (op === 'save_key') { setKey(''); setFlash('Connected. Talkroute accepted the key.') }
      if (op === 'subscribe') setFlash(j.made?.length ? `Webhooks registered: ${j.made.join(', ')}.` : 'Webhooks were already registered.')
      if (op === 'unsubscribe') setFlash(`Removed ${j.removed || 0} webhook${j.removed === 1 ? '' : 's'}.`)
      if (op === 'sync') {
        const s = j.sync || {}
        setFlash(`${s.partial ? 'Partly synced (ran out of time — press Sync now again, or the 15-minute backfill finishes it)' : 'Synced'} — ${s.calls?.fetched ?? 0} calls (${s.calls?.matched ?? 0} matched to bookings, ${s.calls?.welcomeCompleted ?? 0} welcome calls completed), ${s.texts?.messages ?? 0} texts in ${s.texts?.conversations ?? 0} threads, ${s.voicemails?.fetched ?? 0} voicemails.${s.errors?.length ? ' First error: ' + s.errors[0] : ''}`)
      }
      if (op === 'settings' || op === 'transcribe_settings') setFlash('Saved.')
      if (op === 'recheck_calls') {
        const c = j.reconciled || {}
        setFlash(`Re-read ${c.looked || 0} welcome calls, completed ${c.completed || 0}.${(c.completed || 0) >= 25 ? ' More to go — press again.' : ''}${c.errors?.length ? ' First error: ' + c.errors[0] : ''}`)
      }
      if (op === 'find_callers' || op === 'people_map') {
        const c = j.callers || {}
        if (c.error) setErr(`${op === 'people_map' ? 'Names saved, but ' : ''}${c.error}`)
        else setFlash(`${op === 'people_map' ? 'Names saved. ' : ''}Read ${c.scanned || 0} calls, named ${c.named || 0}.${c.devices?.length ? ' Devices seen: ' + c.devices.slice(0, 6).join(', ') + '.' : ' Talkroute named no device on any of them.'}`)
      }
      if (op === 'save_transcribe_key') { setDgKey(''); setFlash('Transcription is on. Recorded calls will start turning into notes within a few minutes.') }
      if (op === 'run_notes') {
        const n = j.notes || {}
        setFlash(`${n.transcribed || 0} calls transcribed, ${n.summarised || 0} notes written, ${n.notesPushed || 0} pushed to Guesty${n.usd ? ` · $${n.usd.toFixed(3)}` : ''}${n.partial ? ' — more to go, press again or let the 15-minute job finish it' : ''}.${n.errors?.length ? ' First error: ' + n.errors[0] : ''}`)
      }
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(null) }
  }

  if (err && !d) return <div className="rounded-2xl border border-rose-200 bg-rose-50/50 px-4 py-3 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {err}</div>
  if (!d) return <div className="rounded-2xl border border-line bg-white px-4 py-3 text-[13px] text-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Checking Talkroute…</div>

  return (
    <div className="space-y-5">
      {/* ── Connection ── */}
      <div className="rounded-2xl border border-line bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2">
          <PhoneCall size={15} className="text-brand-600" />
          <span className="text-sm font-bold text-ink">Talkroute</span>
          {d.connected
            ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full"><Check size={11} /> Connected{d.account?.name ? ` · ${d.account.name}` : ''}</span>
            : <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full"><AlertTriangle size={11} /> Not connected</span>}
          <button onClick={load} disabled={!!busy} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-muted hover:border-brand-300 disabled:opacity-40">{busy === 'load' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh</button>
        </div>
        <div className="p-4 space-y-4 text-[13px]">
          <p className="text-muted">
            Talkroute is the phone. Its API cannot place a call — the team still dials from the Talkroute app — but it reports every finished call
            (who, how long, <b className="text-ink">answered / missed / hangup</b>), every text and every voicemail. Lighthouse uses that to mark welcome
            calls by itself, count attempts, and show texts and voicemails in Messages next to the Guesty threads.
          </p>
          {err && <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-2 text-rose-700 flex items-center gap-2"><AlertTriangle size={13} /> {err}</div>}
          {flash && <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-emerald-800 flex items-center gap-2"><Check size={13} /> {flash}</div>}

          {d.connected ? (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-ink font-semibold"><KeyRound size={13} className="text-muted" /> API key {d.viaEnv ? 'from Vercel (TALKROUTE_API_KEY)' : `…${d.keyHint || '????'}`}</span>
              {d.connectedBy && <span className="text-muted">pasted by {d.connectedBy} {ago(d.connectedAt)}</span>}
              {!d.viaEnv && <button onClick={() => { if (confirm('Disconnect Talkroute? Call tracking and the SMS inbox stop until a key is pasted again.')) post('clear_key') }} disabled={!!busy} className="inline-flex items-center gap-1 text-[12px] text-rose-600 hover:underline"><Trash2 size={12} /> Disconnect</button>}
            </div>
          ) : (
            <div className="rounded-xl border border-line bg-app/40 p-3 space-y-2">
              <div className="font-semibold text-ink">Paste the API key</div>
              <p className="text-muted">From Talkroute → Settings → API (request access at talkroute.com/api if the page is empty). It starts with <code>tr_live_</code>. It is sealed with the vault key and never shown again.</p>
              <div className="flex gap-2 flex-wrap">
                <input value={key} onChange={e => setKey(e.target.value)} placeholder="tr_live_…" autoComplete="off" spellCheck={false}
                  className="flex-1 min-w-[240px] rounded-lg border border-line px-3 py-2 font-mono text-[12px]" />
                <button onClick={() => post('save_key', { key })} disabled={!!busy || !key.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3.5 py-2 font-semibold hover:bg-brand-700 disabled:opacity-50">{busy === 'save_key' ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />} Connect</button>
              </div>
            </div>
          )}

          {d.apiError && <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-amber-800 flex items-center gap-2"><AlertTriangle size={13} /> Talkroute API: {d.apiError}</div>}

          {d.connected && d.numbers.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted font-semibold mb-1.5">Numbers on the account</div>
              <div className="flex flex-wrap gap-2">
                {d.numbers.map(n => (
                  <span key={n.id} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1 text-[12px]">
                    <span className="font-semibold text-ink">{n.number}</span>{n.label && <span className="text-muted">{n.label}</span>}
                    {n.messaging ? <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 rounded">SMS</span> : <span className="text-[10px] text-muted bg-app px-1.5 rounded" title="Texting is not enabled on this number in Talkroute">voice only</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {d.connected && (
        <>
          {/* ── Webhooks + sync ── */}
          <div className="rounded-2xl border border-line bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-line flex items-center gap-2">
              <Webhook size={15} className="text-brand-600" />
              <span className="text-sm font-bold text-ink">Live events</span>
              {d.webhookRegistered
                ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full"><Radio size={11} /> Listening</span>
                : <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full"><AlertTriangle size={11} /> Webhooks not registered</span>}
            </div>
            <div className="p-4 space-y-3 text-[13px]">
              <p className="text-muted">With webhooks on, a finished call reaches the Calls desk within seconds. The 15-minute backfill runs either way, so nothing is lost if Talkroute misses one.</p>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => post('subscribe')} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3.5 py-2 font-semibold hover:bg-brand-700 disabled:opacity-50">{busy === 'subscribe' ? <Loader2 size={13} className="animate-spin" /> : <Webhook size={13} />} {d.webhookRegistered ? 'Re-register webhooks' : 'Register webhooks'}</button>
                <button onClick={() => post('sync')} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 font-semibold text-ink hover:bg-app disabled:opacity-50">{busy === 'sync' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sync now</button>
                <button onClick={() => post('recheck_calls')} disabled={!!busy} title="Re-read recent welcome calls and complete the ones that actually connected" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 font-semibold text-ink hover:bg-app disabled:opacity-50">{busy === 'recheck_calls' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Re-check welcome calls</button>
                <button onClick={() => { if (confirm('Pull every text thread again (not just the changed ones)? Fine to do; it just takes longer.')) post('sync', { full: true }) }} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-[12px] font-semibold text-muted hover:text-ink disabled:opacity-50">Full text re-sync</button>
                {d.webhookRegistered && <button onClick={() => post('unsubscribe')} disabled={!!busy} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-rose-600 ml-auto">Remove webhooks</button>}
              </div>
              {d.subscriptions.length > 0 && (
                <div className="text-[12px] text-muted">Registered: {d.subscriptions.map(s => <span key={s.id} className={`inline-block mr-1.5 px-1.5 py-0.5 rounded ${s.ours ? 'bg-emerald-50 text-emerald-700' : 'bg-app'}`}>{s.type}{s.ours ? '' : ' (other app)'}</span>)}</div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-1">
                <Tile Icon={PhoneCall} label="Calls · 7d" value={d.counts?.calls7d ?? '—'} sub={`synced ${ago(d.lastCallSyncAt)}`} />
                <Tile Icon={Check} label="Auto-logged calls · 7d" value={d.counts?.autoLogged7d ?? '—'} sub="welcome + post-checkout" />
                <Tile Icon={MessageSquare} label="Texts · 7d" value={d.counts?.texts7d ?? '—'} sub={`synced ${ago(d.lastTextSyncAt)}`} />
                <Tile Icon={Voicemail} label="Voicemails · 7d" value={d.counts?.voicemails7d ?? '—'} sub={`synced ${ago(d.lastVoicemailSyncAt)}`} />
              </div>
              {d.lastError && <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-amber-800 text-[12px]"><AlertTriangle size={12} className="inline mr-1" /> Last sync error: {d.lastError}</div>}
            </div>
          </div>

          {/* ── Who made the call ── */}
          <PeopleCard d={d} busy={busy} post={post} />

          {/* ── Call notes from recordings ── */}
          <TranscribeCard d={d} busy={busy} post={post} dgKey={dgKey} setDgKey={setDgKey} minSec={minSec} setMinSec={setMinSec} cap={cap} setCap={setCap} from={from} setFrom={setFrom} />

          {/* ── The rule ── */}
          <div className="rounded-2xl border border-line bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-line flex items-center gap-2">
              <Voicemail size={15} className="text-brand-600" />
              <span className="text-sm font-bold text-ink">What counts as a welcome call</span>
            </div>
            <div className="p-4 space-y-3 text-[13px]">
              <p className="text-muted">
                An outbound call to the guest&apos;s number between 72 hours before arrival and the arrival day is the welcome call. <b className="text-ink">Answered</b> → Reached.
                Answered but shorter than the seconds below → <b className="text-ink">Voicemail</b> (that is the guest&apos;s greeting picking up; both count as completed).
                <b className="text-ink"> Missed or hung up</b> → one more attempt, the card stays on the desk. Every match also writes the Welcome Call field and a dated note on the reservation in Guesty, exactly as the button did.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-muted">Answered calls shorter than</label>
                <input type="number" min={5} max={120} value={vm} onChange={e => setVm(Number(e.target.value))} className="w-20 rounded-lg border border-line px-2 py-1.5 text-center" />
                <span className="text-muted">seconds are voicemail</span>
                <button onClick={() => post('settings', { voicemailMaxSec: vm })} disabled={!!busy || vm === d.voicemailMaxSec} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 font-semibold text-ink hover:bg-app disabled:opacity-50">{busy === 'settings' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save</button>
              </div>
              <p className="text-[12px] text-muted">Calls made from a personal cell never reach Talkroute, so the manual buttons stay on the desk under &quot;Log by hand&quot;.</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * WHO MADE THE CALL (2026-09-21, Jon: "put who called too in lighthouse"). Talkroute names the
 * DEVICE that took a call, not a person, so this maps each device string it has actually seen to a
 * teammate. Names set here appear on the Calls desk, on the booking and in the Guesty note.
 */
function PeopleCard({ d, busy, post }: { d: Status; busy: string | null; post: (op: string, extra?: any) => void }) {
  const p = d.people
  const [draft, setDraft] = useState<Record<string, string>>({})
  if (!p) return null
  const unnamed = p.devices.filter(x => !x.name).length
  const value = (dev: string) => draft[dev] !== undefined ? draft[dev] : (p.devices.find(x => x.device === dev)?.name || '')
  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2">
        <UserCheck size={15} className="text-brand-600" />
        <span className="text-sm font-bold text-ink">Who made the call</span>
        {unnamed > 0 && <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">{unnamed} unnamed</span>}
      </div>
      <div className="p-4 space-y-3 text-[13px]">
        <p className="text-muted">
          Talkroute tells us which <b className="text-ink">device or extension</b> handled a call, not which person. Name each one here once and the
          caller shows on the Calls desk, on the booking and in the Guesty note. Devices are listed by how many calls they have taken in the last 30 days.
        </p>
        {p.devices.length === 0
          ? (
            <div className="space-y-2">
              <p className="text-muted">No caller devices read yet. Calls matched before this shipped never had one recorded — press below to read it from the call records already on file.</p>
              <button onClick={() => post('find_callers')} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 font-semibold hover:bg-brand-700 disabled:opacity-50">{busy === 'find_callers' ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />} Find who called</button>
              {p.directory.length > 0 && (
                <p className="text-[12px] text-muted">Talkroute knows {p.directory.length} devices and people on this account, including {p.directory.slice(0, 4).map(x => x.label).join(', ')}.</p>
              )}
            </div>
          )
          : (
            <div className="space-y-1.5">
              {p.devices.map(x => (
                <div key={x.device} className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[12px] text-ink min-w-[180px] truncate" title={x.device}>{x.device}</span>
                  <span className="text-[11px] text-muted w-16">{x.calls} call{x.calls === 1 ? '' : 's'}</span>
                  <input value={value(x.device)} onChange={e => setDraft(dd => ({ ...dd, [x.device]: e.target.value }))}
                    placeholder="Who is this?" list="tr-people"
                    className="flex-1 min-w-[160px] rounded-lg border border-line px-2.5 py-1.5 text-[12px]" />
                </div>
              ))}
              <datalist id="tr-people">{p.directory.map(dd => <option key={dd.id + dd.label} value={dd.label} />)}</datalist>
              <div className="flex items-center gap-2 pt-1">
                <button onClick={() => {
                  const map: Record<string, string> = { ...p.map }
                  for (const x of p.devices) { const v = value(x.device).trim(); if (v) map[x.device] = v }
                  post('people_map', { map })
                }} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 font-semibold hover:bg-brand-700 disabled:opacity-50">{busy === 'people_map' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save names</button>
                <span className="text-[11px] text-muted">Applies to calls from the next sync on; earlier calls keep the name they were given.</span>
              </div>
            </div>
          )}
      </div>
    </div>
  )
}

/**
 * CALL NOTES FROM RECORDINGS. Stay records every call and plays the notice, so the recording is
 * readable: it is transcribed, Claude writes the two-line note, and that note lands on the booking
 * and in Guesty's reservation notes. Off until a Deepgram key is pasted — everything else on this
 * page works without it.
 */
function TranscribeCard({ d, busy, post, dgKey, setDgKey, minSec, setMinSec, cap, setCap, from, setFrom }: {
  d: Status; busy: string | null; post: (op: string, extra?: any) => void
  dgKey: string; setDgKey: (v: string) => void; minSec: number; setMinSec: (v: number) => void; cap: number; setCap: (v: number) => void
  from: string; setFrom: (v: string) => void
}) {
  const t = d.transcribe
  if (!t) return null
  const q = t.queue
  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2">
        <FileText size={15} className="text-brand-600" />
        <span className="text-sm font-bold text-ink">Call notes from recordings</span>
        {t.ready
          ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full"><Sparkles size={11} /> On</span>
          : <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted bg-app border border-line px-2 py-0.5 rounded-full">Off</span>}
      </div>
      <div className="p-4 space-y-3 text-[13px]">
        <p className="text-muted">
          Every recorded call is transcribed and read into a two-line note — what the guest asked, what we promised, anything wrong —
          which lands on the booking under <b className="text-ink">Calls &amp; texts</b> and as one dated line in the reservation&apos;s notes in Guesty.
          The transcript is kept in Lighthouse behind the note. Only calls that connected, are matched to a booking, ran longer than the
          minimum below, and happened <b className="text-ink">on or after {t.fromDate === t.today ? 'today' : t.fromDate}</b> are transcribed —
          older recordings are left alone.
        </p>
        <p className="text-[12px] text-muted">
          This reads recordings of real guest calls, so it assumes what is already true here: calls are recorded and the recorded-call notice plays.
          If that ever changes, turn this off — Florida requires everyone on the call to be told.
        </p>

        {t.ready ? (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-ink font-semibold"><KeyRound size={13} className="text-muted" /> Deepgram key {t.viaEnv ? 'from Vercel' : `…${t.keyHint || '????'}`}</span>
            {t.connectedBy && <span className="text-muted">added by {t.connectedBy}</span>}
            {!t.viaEnv && <button onClick={() => { if (confirm('Turn off call transcription? Calls are still logged; they just stop getting notes.')) post('clear_transcribe_key') }} disabled={!!busy} className="inline-flex items-center gap-1 text-[12px] text-rose-600 hover:underline"><Trash2 size={12} /> Turn off</button>}
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-app/40 p-3 space-y-2">
            <div className="font-semibold text-ink">Paste a Deepgram API key to switch this on</div>
            <p className="text-muted">deepgram.com → sign up → API Keys. It reads the recording straight from Talkroute&apos;s link, so nothing large is ever downloaded. About ${t.usdPerMinute.toFixed(4)} per minute of audio.</p>
            <div className="flex gap-2 flex-wrap">
              <input value={dgKey} onChange={e => setDgKey(e.target.value)} placeholder="Deepgram API key" autoComplete="off" spellCheck={false}
                className="flex-1 min-w-[240px] rounded-lg border border-line px-3 py-2 font-mono text-[12px]" />
              <button onClick={() => post('save_transcribe_key', { key: dgKey })} disabled={!!busy || !dgKey.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3.5 py-2 font-semibold hover:bg-brand-700 disabled:opacity-50">{busy === 'save_transcribe_key' ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />} Turn on</button>
            </div>
          </div>
        )}

        {t.ready && q && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Tile Icon={Loader2} label="Waiting" value={q.pending} sub="to transcribe" />
            <Tile Icon={FileText} label="Transcribed" value={q.transcribed} />
            <Tile Icon={Check} label="Notes in Guesty" value={q.notesPushed} />
            <Tile Icon={AlertTriangle} label="Could not read" value={q.failed} />
            <Tile Icon={Sparkles} label="Spent today" value={`$${(q.usdToday || 0).toFixed(2)}`} sub={`cap $${t.usdPerDay}`} />
          </div>
        )}

        {t.ready && (
          <div className="flex items-end gap-3 flex-wrap pt-1">
            <label className="text-[12px] text-muted">Skip calls under
              <input type="number" min={5} max={300} value={minSec} onChange={e => setMinSec(Number(e.target.value))} className="w-16 mx-1.5 rounded-lg border border-line px-2 py-1 text-center text-ink" />seconds</label>
            <label className="text-[12px] text-muted">Stop after
              <input type="number" min={0} max={500} value={cap} onChange={e => setCap(Number(e.target.value))} className="w-16 mx-1.5 rounded-lg border border-line px-2 py-1 text-center text-ink" />$ a day</label>
            <label className="text-[12px] text-muted">Only calls from
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="mx-1.5 rounded-lg border border-line px-2 py-1 text-ink" />onward</label>
            <button onClick={() => post('transcribe_settings', { minSeconds: minSec, usdPerDay: cap, fromDate: from, enabled: true })} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 font-semibold text-ink hover:bg-app disabled:opacity-50">{busy === 'transcribe_settings' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save</button>
            <button onClick={() => post('run_notes')} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 font-semibold hover:bg-brand-700 disabled:opacity-50 ml-auto">{busy === 'run_notes' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Write notes now</button>
          </div>
        )}
        {t.lastError && <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-amber-800 text-[12px]"><AlertTriangle size={12} className="inline mr-1" /> {t.lastError}</div>}
      </div>
    </div>
  )
}

function Tile({ Icon, label, value, sub }: { Icon: any; label: string; value: any; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-app/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted font-semibold flex items-center gap-1"><Icon size={11} /> {label}</div>
      <div className="text-xl font-bold text-ink leading-tight mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  )
}
