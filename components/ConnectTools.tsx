'use client'
// Command Center — CONNECT YOUR TOOLS.
//
// One click to connect Slack, one click to prove it works. This sits on the Command Center on
// purpose: the alerts it carries are the ones that matter same-day, and a connection nobody can
// see is a connection nobody maintains. (The review sync died for four days behind exactly that.)
import { useCallback, useEffect, useState } from 'react'
import { Slack, Check, AlertTriangle, Loader2, Send, Plug, X, ExternalLink } from 'lucide-react'

type Status = {
  ok: boolean
  appConfigured: boolean
  slack: { connected: boolean; teamName?: string; channel?: string; connectedBy?: string; connectedAt?: string; viaEnv?: boolean }
}

// Human-readable outcomes of the OAuth round trip (?slack=... on the way back).
const RESULT: Record<string, { tone: 'ok' | 'bad'; msg: string }> = {
  connected: { tone: 'ok', msg: 'Slack connected.' },
  declined: { tone: 'bad', msg: 'You cancelled the Slack authorisation.' },
  badstate: { tone: 'bad', msg: 'That sign-in link did not match your session. Try connecting again.' },
  nocode: { tone: 'bad', msg: 'Slack did not send an authorisation code. Try again.' },
  exchange_failed: { tone: 'bad', msg: 'Slack refused the handshake. Check the app credentials in Vercel.' },
  no_webhook: { tone: 'bad', msg: 'Slack did not return a channel webhook. Re-run Connect and pick a channel.' },
  save_failed: { tone: 'bad', msg: 'Connected to Slack but could not save it. Try again.' },
  forbidden: { tone: 'bad', msg: 'You do not have access to integrations.' },
  unconfigured: { tone: 'bad', msg: 'No Slack app is configured yet.' },
}

export function ConnectTools() {
  const [s, setS] = useState<Status | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; msg: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/integrations/slack', { cache: 'no-store' })
      if (!r.ok) { setS(null); return }
      setS(await r.json())
    } catch { setS(null) }
  }, [])

  useEffect(() => {
    // Surface the OAuth result, then scrub it from the URL so a refresh doesn't repeat the message.
    try {
      const p = new URLSearchParams(window.location.search)
      const k = p.get('slack')
      if (k && RESULT[k]) {
        setNote(RESULT[k])
        p.delete('slack')
        const q = p.toString()
        window.history.replaceState({}, '', window.location.pathname + (q ? '?' + q : ''))
      }
    } catch { /* no-op */ }
    load()
  }, [load])

  async function test() {
    setBusy('test'); setNote(null)
    try {
      const r = await fetch('/api/integrations/slack', { method: 'POST' })
      const j = await r.json()
      setNote(r.ok ? { tone: 'ok', msg: 'Test message sent — check the channel.' } : { tone: 'bad', msg: j?.error || 'Could not send.' })
    } catch (e: any) { setNote({ tone: 'bad', msg: String(e?.message || e) }) } finally { setBusy(null) }
  }

  async function disconnect() {
    setBusy('disconnect'); setNote(null)
    try {
      const r = await fetch('/api/integrations/slack', { method: 'DELETE' })
      const j = await r.json()
      setNote(r.ok ? { tone: 'ok', msg: j?.note || 'Slack disconnected.' } : { tone: 'bad', msg: j?.error || 'Could not disconnect.' })
      await load()
    } catch (e: any) { setNote({ tone: 'bad', msg: String(e?.message || e) }) } finally { setBusy(null) }
  }

  // Not allowed to see integrations (or still loading) — render nothing rather than a broken box.
  if (!s) return null

  const on = s.slack.connected

  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center">
          <Plug size={13} />
        </div>
        <span className="text-sm font-bold text-ink">Connect your tools</span>
      </div>

      <div className="p-3 space-y-2.5">
        {note && (
          <div className={`rounded-lg border px-3 py-2 text-[12px] flex items-start gap-1.5 ${
            note.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
            {note.tone === 'ok' ? <Check size={13} className="mt-0.5 flex-shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />}
            <span className="flex-1">{note.msg}</span>
            <button onClick={() => setNote(null)} className="opacity-60 hover:opacity-100"><X size={12} /></button>
          </div>
        )}

        <div className={`rounded-xl border p-3 ${on ? 'border-emerald-200 bg-emerald-50/40' : 'border-line bg-app/40'}`}>
          <div className="flex items-center gap-2">
            <Slack size={15} className={on ? 'text-emerald-700' : 'text-muted'} />
            <span className="text-[13px] font-bold text-ink">Slack</span>
            <span className={`ml-auto text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
              on ? 'bg-emerald-100 text-emerald-800' : 'bg-app text-muted'}`}>
              {on ? 'Connected' : 'Not connected'}
            </span>
          </div>

          {on ? (
            <>
              <p className="text-[12px] text-emerald-800 mt-1.5">
                {s.slack.viaEnv
                  ? 'Configured by environment variable in Vercel.'
                  : <>Posting to <b>{s.slack.channel}</b>{s.slack.teamName ? <> in {s.slack.teamName}</> : null}.</>}
              </p>
              {s.slack.connectedBy && (
                <p className="text-[11px] text-muted mt-0.5">Connected by {s.slack.connectedBy}</p>
              )}
              <div className="flex items-center gap-1.5 mt-2.5">
                <button onClick={test} disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-2.5 py-1.5 text-[12px] font-semibold hover:bg-brand-700 disabled:opacity-40">
                  {busy === 'test' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send test
                </button>
                {!s.slack.viaEnv && (
                  <button onClick={disconnect} disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-muted hover:border-rose-300 hover:text-rose-700 disabled:opacity-40">
                    {busy === 'disconnect' ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />} Disconnect
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-[12px] text-muted mt-1.5">
                Sync failures, cleans running behind, and shared reviews land in a channel you pick.
              </p>
              {s.appConfigured ? (
                <a href="/api/integrations/slack/start"
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12px] font-semibold hover:bg-brand-700">
                  <Slack size={13} /> Connect Slack
                </a>
              ) : (
                <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
                  <b>One-time setup needed.</b> A Slack app has to exist before anyone can click Connect.
                  Add <code className="font-mono">SLACK_CLIENT_ID</code> and <code className="font-mono">SLACK_CLIENT_SECRET</code> in Vercel.
                  <a href="/integrations" className="inline-flex items-center gap-1 font-semibold underline ml-1">
                    Steps <ExternalLink size={10} />
                  </a>
                </div>
              )}
            </>
          )}
        </div>

        <a href="/integrations" className="block text-[11px] text-muted hover:text-ink text-center pt-0.5">
          All integrations &amp; feed health →
        </a>
      </div>
    </div>
  )
}
