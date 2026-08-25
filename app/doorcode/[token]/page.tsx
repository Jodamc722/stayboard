// The release page. This is the ONLY surface where a door code is ever shown, and it is shown once.
//
// It shows the WHOLE case before the button: which door, where it physically is, who is in it, what
// the guest actually said, who asked and why. An approver who has to trust a Slack summary is not
// approving, they are rubber-stamping — and rubber-stamping is how someone walks into an occupied
// bedroom. Turning it down is the same one tap as approving it, so "no" costs nothing.
//
// Deliberately a plain server page with POST forms and no JavaScript: it has to work on a phone, in
// a lift, on bad signal, held in one hand at a door.
import { redirect } from 'next/navigation'
import { getAccess, isSuperadmin } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { releaseByToken, rejectByToken, peekRequest } from '@/lib/eve/door-code'
import { postApprovalOutcome } from '@/lib/eve/approvals'
import { dmUser } from '@/lib/slack'

export const dynamic = 'force-dynamic'

async function allowed() {
  const access = await getAccess()
  const email = String(access.email || '')
  const byRole = !!access.accessRole && atLeast((access.levels as any)?.eve, 'view')
  return { ok: isSuperadmin(email) || access.role === 'admin' || byRole, email, user: access.user }
}

async function release(formData: FormData) {
  'use server'
  const token = String(formData.get('token') || '')
  const a = await allowed()
  if (!a.ok) redirect(`/doorcode/${token}?e=forbidden`)

  const res = await releaseByToken(token, a.email)
  if (!res.ok) redirect(`/doorcode/${token}?e=${encodeURIComponent(res.error || 'failed')}`)

  // Deliver privately to the person who asked, never into a channel — and ASK WHETHER IT WORKED.
  // That answer is the only real evidence a code is correct, and it is only ever available in the
  // ninety seconds after somebody stands at the lock. Ask then or never find out.
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
  const confirmUrl = res.confirmToken ? `${base}/doorcode/worked/${res.confirmToken}` : null
  if (res.slackUserId) {
    const tryFirst = res.expect === 'old' && res.previousCode ? res.previousCode : res.code
    const thenTry = res.expect === 'old' && res.previousCode ? res.code : res.previousCode
    const lines = [`🔑 *${res.unit}*`, `*Try this first:* \`${tryFirst}\``]
    if (thenTry) lines.push(`*If that fails:* \`${thenTry}\``)
    if (res.transitionNote) lines.push(`_${res.transitionNote}_`)
    lines.push(`Released by ${a.email}. Please do not paste this into a channel.`)
    const blocks: any[] = [{ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } }]
    if (res.arrivalWarning) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: res.arrivalWarning } })
    }
    if (confirmUrl) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Which one opened it?* One tap — it is how we find out whether the lock has actually been changed yet.' } })
      blocks.push({ type: 'actions', elements: [
        { type: 'button', style: 'primary', text: { type: 'plain_text', text: 'The new code' }, url: `${confirmUrl}?ok=new` },
        { type: 'button', text: { type: 'plain_text', text: 'The old one' }, url: `${confirmUrl}?ok=old` },
        { type: 'button', text: { type: 'plain_text', text: 'Neither' }, url: `${confirmUrl}?ok=neither` },
      ] })
    }
    await dmUser(res.slackUserId, `Door code for ${res.unit} released by ${a.email}.`, blocks)
  }
  await postApprovalOutcome(res.slackChannel, res.slackTs,
    `✅ Released by ${a.email}${res.slackUserId ? ' — code sent by DM to whoever asked.' : '.'} This request is now closed.`)
  const q = new URLSearchParams({
    done: '1', unit: res.unit || '', code: res.code || '',
    prev: res.previousCode || '', expect: res.expect || '', tn: res.transitionNote || '',
    aw: res.arrivalWarning || '', c: res.confirmToken || '',
  })
  redirect(`/doorcode/${token}?${q.toString()}`)
}

async function reject(formData: FormData) {
  'use server'
  const token = String(formData.get('token') || '')
  const a = await allowed()
  if (!a.ok) redirect(`/doorcode/${token}?e=forbidden`)

  const res = await rejectByToken(token, a.email)
  if (!res.ok) redirect(`/doorcode/${token}?e=${encodeURIComponent(res.error || 'failed')}`)
  if (res.slackUserId) {
    await dmUser(res.slackUserId, `🚫 Your door-code request for *${res.unit}* was turned down by ${a.email}. Ask them directly if you still need in.`)
  }
  await postApprovalOutcome(res.slackChannel, res.slackTs, `🚫 Turned down by ${a.email}. This request is now closed.`)
  redirect(`/doorcode/${token}?rejected=1&unit=${encodeURIComponent(res.unit || '')}`)
}

const wrap = 'min-h-screen bg-app flex items-center justify-center p-5'
const card = 'bg-white border border-line rounded-2xl shadow-lifted p-6 w-full max-w-md'

export default async function DoorCodePage(props: { params: { token: string }; searchParams: Record<string, string> }) {
  const a = await allowed()
  if (!a.user) redirect('/login')

  const token = props.params.token
  const sp = props.searchParams || {}

  if (!a.ok) {
    return <div className={wrap}><div className={card}>
      <p className="text-sm font-semibold text-ink">Not your call</p>
      <p className="text-[13px] text-muted mt-1">Releasing a door code is limited to admins.</p>
    </div></div>
  }

  if (sp.done === '1') {
    return <div className={wrap}><div className={card}>
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold">Released</p>
      <p className="text-lg font-bold text-ink mt-1">{sp.unit || 'Unit'}</p>
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted font-semibold mt-4">{sp.expect === 'old' ? 'Try this first — the lock has not been changed yet' : 'Current code'}</p>
      <p className="text-4xl font-mono font-bold text-ink tracking-[0.2em] mt-1 mb-3 text-center select-all">{sp.expect === 'old' ? (sp.prev || sp.code) : sp.code}</p>
      {(sp.expect === 'old' ? sp.code : sp.prev) && (
        <>
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted font-semibold">If that fails, the {sp.expect === 'old' ? 'new' : 'previous'} code</p>
          <p className="text-2xl font-mono font-bold text-muted tracking-[0.18em] mt-1 mb-3 text-center select-all">{sp.expect === 'old' ? sp.code : sp.prev}</p>
        </>
      )}
      {sp.tn && <p className="text-[12px] text-muted mb-3">{decodeURIComponent(String(sp.tn))}</p>}
      {sp.aw && <p className="text-[13px] text-[#7A1A1A] font-semibold mb-3">{decodeURIComponent(String(sp.aw))}</p>}
      <p className="text-[13px] text-muted">Sent privately to whoever asked. This link is now dead — it will not show the code again.</p>
      <p className="text-[12px] text-muted mt-3">Don&apos;t paste it into a channel; channel history outlives the code.</p>
      {sp.c && (
        <div className="mt-5 pt-4 border-t border-line">
          <p className="text-[13px] font-semibold text-ink">Which one opened it?</p>
          <p className="text-[12px] text-muted mt-0.5">The only way we ever learn whether the lock has been changed yet.</p>
          <div className="flex gap-2 mt-2">
            <a href={`/doorcode/worked/${sp.c}?ok=new`} className="flex-1 rounded-xl bg-white border border-line text-ink text-[13px] font-semibold py-2">New</a>
            <a href={`/doorcode/worked/${sp.c}?ok=old`} className="flex-1 rounded-xl bg-white border border-line text-ink text-[13px] font-semibold py-2">Old</a>
            <a href={`/doorcode/worked/${sp.c}?ok=neither`} className="flex-1 rounded-xl bg-white border border-line text-ink text-[13px] font-semibold py-2">Neither</a>
          </div>
        </div>
      )}
    </div></div>
  }

  if (sp.rejected === '1') {
    return <div className={wrap}><div className={card}>
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold">Turned down</p>
      <p className="text-lg font-bold text-ink mt-1">{sp.unit || 'Unit'}</p>
      <p className="text-[13px] text-muted mt-2">No code was revealed. Whoever asked has been told, and the request is closed.</p>
    </div></div>
  }

  if (sp.e) {
    return <div className={wrap}><div className={card}>
      <p className="text-sm font-semibold text-[#A32020]">Cannot release</p>
      <p className="text-[13px] text-ink mt-1">{decodeURIComponent(String(sp.e))}</p>
      <p className="text-[12px] text-muted mt-3">Ask Eve again and she will re-run the checks against how things stand right now.</p>
    </div></div>
  }

  const peek = await peekRequest(token)
  if (!peek.ok || !peek.request) {
    return <div className={wrap}><div className={card}>
      <p className="text-sm font-semibold text-[#A32020]">Link is dead</p>
      <p className="text-[13px] text-ink mt-1">{peek.error}</p>
    </div></div>
  }
  const r = peek.request
  const occupied = r.verdict === 'permission_found'

  return <div className={wrap}><div className={card}>
    <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold">Door code release</p>
    <h1 className="text-xl font-bold text-ink mt-1">{r.unit}</h1>
    {r.building && <p className="text-[13px] text-muted">{r.building}</p>}
    {r.address && <p className="text-[13px] text-ink mt-1">📍 {r.address}</p>}

    <div className={`mt-4 rounded-xl px-3 py-2.5 text-[13px] ${occupied ? 'bg-[#FDF3F3] text-[#7A1A1A] border border-[#F0C9C9]' : 'bg-app text-ink border border-line'}`}>
      <p className="font-semibold">{r.headline}</p>
      {r.occupancy && <p className="mt-0.5 opacity-80">{r.occupancy}</p>}
    </div>

    {r.quote && (
      <div className="mt-3 rounded-xl border border-line bg-app px-3 py-2.5">
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted font-semibold">What the guest actually said</p>
        <p className="text-[13px] text-ink mt-1 italic">&ldquo;{r.quote.text.slice(0, 400)}&rdquo;</p>
        <p className="text-[12px] text-muted mt-1">{String(r.quote.at).slice(0, 10)}</p>
        <p className="text-[12px] text-[#7A1A1A] mt-2">That is a pattern match, not a judgement. If it does not clearly mean <em>yes, come in</em> — turn it down.</p>
      </div>
    )}

    {r.arrivalWarning && (
      <div className="mt-3 rounded-xl px-3 py-2.5 border border-[#F0C9C9] bg-[#FDF3F3]">
        <p className="text-[13px] text-[#7A1A1A] font-semibold">{r.arrivalWarning}</p>
      </div>
    )}

    {r.confidence?.transition?.hasPrevious && (
      <div className="mt-3 rounded-xl px-3 py-2.5 border border-line bg-app">
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted font-semibold">The code changed recently</p>
        <p className="text-[13px] text-ink mt-1">{r.confidence.transition.reason}</p>
        <p className="text-[12px] text-muted mt-1">Both codes are shown after you release, {r.confidence.transition.expect === 'old' ? 'old one first' : 'new one first'}.</p>
      </div>
    )}

    {r.confidence && (r.confidence.level !== 'verified' || r.confidence.problems.length || r.confidence.conflicts.length || r.confidence.sharedWith) && (
      <div className={`mt-3 rounded-xl px-3 py-2.5 border ${r.confidence.suspect || r.confidence.conflicts.length ? 'border-[#F0C9C9] bg-[#FDF3F3]' : 'border-line bg-app'}`}>
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted font-semibold">Is this code right?</p>
        <p className={`text-[13px] mt-1 ${r.confidence.suspect ? 'text-[#7A1A1A] font-semibold' : 'text-ink'}`}>{r.confidence.label}</p>
        {r.confidence.conflicts.length > 0 && <p className="text-[13px] text-[#7A1A1A] mt-1">The field disagrees with {r.confidence.conflicts.join(' and ')} — one of them is wrong.</p>}
        {r.confidence.problems.map((x, i) => <p key={i} className="text-[12px] text-muted mt-1">• {x}</p>)}
        {r.confidence.sharedWith > 0 && <p className="text-[12px] text-muted mt-1">• Also on {r.confidence.sharedWith} other unit{r.confidence.sharedWith === 1 ? '' : 's'}.</p>}
      </div>
    )}
    {r.confidence && r.confidence.level === 'verified' && !r.confidence.problems.length && !r.confidence.conflicts.length && !r.confidence.sharedWith && (
      <p className="text-[12px] text-muted mt-3">✅ {r.confidence.label}</p>
    )}

    {r.calendar && (
      <p className={`text-[12px] mt-3 ${r.calendar.ok ? 'text-muted' : 'text-[#7A1A1A]'}`}>
        {r.calendar.ok
          ? `📅 Live Guesty calendar checked: today is "${r.calendar.status || 'available'}". An extension would have shown.`
          : `❔ The live Guesty calendar could not be read (${r.calendar.error || 'no answer'}). An extension entered in the last few minutes would not show here.`}
      </p>
    )}

    {r.vacancyScan && (
      <div className={`mt-3 rounded-xl px-3 py-2.5 border ${r.vacancyScan.result === 'clean' ? 'border-line bg-app' : 'border-[#F0C9C9] bg-[#FDF3F3]'}`}>
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted font-semibold">Message double-check</p>
        <p className="text-[13px] text-ink mt-1">{r.vacancyScan.summary}</p>
        {r.vacancyScan.findings?.map((f, i) => (
          <p key={i} className="text-[13px] text-[#7A1A1A] italic mt-1.5">&ldquo;{f.text.slice(0, 240)}&rdquo; — {f.from}, {String(f.at).slice(0, 10)}</p>
        ))}
      </div>
    )}

    <dl className="mt-3 text-[13px] space-y-1">
      <div className="flex justify-between gap-3"><dt className="text-muted">Asked for by</dt><dd className="text-ink text-right">{r.requestedBy}</dd></div>
      {r.reason && <div className="flex justify-between gap-3"><dt className="text-muted">Reason</dt><dd className="text-ink text-right">{r.reason}</dd></div>}
      {r.taskToday && <div className="flex justify-between gap-3"><dt className="text-muted">Work booked today</dt><dd className="text-ink text-right">{r.taskToday.name}{r.taskToday.assignees?.length ? ` (${r.taskToday.assignees.join(', ')})` : ''}</dd></div>}
      {r.minutesLeft != null && <div className="flex justify-between gap-3"><dt className="text-muted">Expires in</dt><dd className="text-ink text-right">{r.minutesLeft} min</dd></div>}
    </dl>

    <p className="text-[12px] text-muted mt-4">
      The checks passed when this link was made. If anything has changed since — a guest checked in early,
      plans moved — turn it down and ask Eve again rather than tapping through.
    </p>

    <form action={release} className="mt-4">
      <input type="hidden" name="token" value={token} />
      <button type="submit" className="w-full rounded-xl bg-brand-600 text-white font-semibold py-3 hover:bg-brand-700">
        Reveal the code and DM it
      </button>
    </form>
    <form action={reject} className="mt-2">
      <input type="hidden" name="token" value={token} />
      <button type="submit" className="w-full rounded-xl bg-white border border-line text-ink font-semibold py-2.5 hover:bg-app">
        Turn it down
      </button>
    </form>
    <p className="text-[12px] text-muted mt-3 text-center">Works once. Expires 4 hours after it was created.</p>
  </div></div>
}
