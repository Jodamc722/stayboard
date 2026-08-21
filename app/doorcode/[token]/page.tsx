// The release page. This is the ONLY surface where a door code is ever shown, and it is shown once.
//
// Deliberately a plain server page with a POST form and no JavaScript: it has to work on a phone,
// in a lift, on bad signal, held in one hand at a door.
import { redirect } from 'next/navigation'
import { getAccess, isSuperadmin } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { releaseByToken } from '@/lib/eve/door-code'
import { dmUser } from '@/lib/slack'

export const dynamic = 'force-dynamic'

async function release(formData: FormData) {
  'use server'
  const token = String(formData.get('token') || '')
  const access = await getAccess()
  const email = String(access.email || '')
  const byRole = !!access.accessRole && atLeast((access.levels as any)?.eve, 'view')
  if (!(isSuperadmin(email) || access.role === 'admin' || byRole)) redirect(`/doorcode/${token}?e=forbidden`)

  const res = await releaseByToken(token, email)
  if (!res.ok) redirect(`/doorcode/${token}?e=${encodeURIComponent(res.error || 'failed')}`)

  // Deliver privately to the person who asked, never into a channel.
  if (res.slackUserId) {
    await dmUser(res.slackUserId, `🔑 Door code for *${res.unit}*: \`${res.code}\`\nReleased by ${email}. Please do not paste this into a channel.`)
  }
  redirect(`/doorcode/${token}?done=1&unit=${encodeURIComponent(res.unit || '')}&code=${encodeURIComponent(res.code || '')}`)
}

export default async function DoorCodePage(props: { params: { token: string }; searchParams: Record<string, string> }) {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  const byRole = !!access.accessRole && atLeast((access.levels as any)?.eve, 'view')
  const allowed = isSuperadmin(access.email) || access.role === 'admin' || byRole

  const token = props.params.token
  const sp = props.searchParams || {}
  const wrap = 'min-h-screen bg-app flex items-center justify-center p-5'
  const card = 'bg-white border border-line rounded-2xl shadow-lifted p-6 w-full max-w-md'

  if (!allowed) {
    return <div className={wrap}><div className={card}>
      <p className="text-sm font-semibold text-ink">Not your call</p>
      <p className="text-[13px] text-muted mt-1">Releasing a door code is limited to admins.</p>
    </div></div>
  }

  if (sp.done === '1') {
    return <div className={wrap}><div className={card}>
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold">Released</p>
      <p className="text-lg font-bold text-ink mt-1">{sp.unit || 'Unit'}</p>
      <p className="text-4xl font-mono font-bold text-ink tracking-[0.2em] my-5 text-center select-all">{sp.code}</p>
      <p className="text-[13px] text-muted">Sent privately to whoever asked. This link is now dead — it will not show the code again.</p>
      <p className="text-[12px] text-muted mt-3">Don&apos;t paste it into a channel; channel history outlives the code.</p>
    </div></div>
  }

  if (sp.e) {
    return <div className={wrap}><div className={card}>
      <p className="text-sm font-semibold text-[#A32020]">Cannot release</p>
      <p className="text-[13px] text-ink mt-1">{decodeURIComponent(String(sp.e))}</p>
      <p className="text-[12px] text-muted mt-3">Ask Eve again and she will re-run the checks against how things stand right now.</p>
    </div></div>
  }

  return <div className={wrap}><div className={card}>
    <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold">Door code release</p>
    <h1 className="text-lg font-bold text-ink mt-1">Reveal and send the code?</h1>
    <p className="text-[13px] text-muted mt-2">
      The occupancy and permission checks already passed when this link was made. If anything has changed
      since — a guest checked in early, plans moved — stop and ask Eve again rather than tapping.
    </p>
    <form action={release} className="mt-5">
      <input type="hidden" name="token" value={token} />
      <button type="submit" className="w-full rounded-xl bg-brand-600 text-white font-semibold py-3 hover:bg-brand-700">
        Reveal the code and DM it
      </button>
    </form>
    <p className="text-[12px] text-muted mt-3 text-center">Works once. Expires 4 hours after it was created.</p>
  </div></div>
}
