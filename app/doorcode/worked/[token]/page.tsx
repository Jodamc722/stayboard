// "Which code opened the door?"
//
// The only real evidence that a door code is CORRECT is that somebody stood in front of the lock,
// typed it, and got in. Everything else — shape, agreement with the listing text, uniqueness — is
// inference. This page is the measurement.
//
// THREE ANSWERS, NOT TWO. "The old one worked" is not a failure: it is a fact about the LOCK —
// housekeeping has not changed it yet. Collapsing that into a plain no would condemn a perfectly
// good new code and send somebody to change something that is already right. It is the single most
// useful thing this page can learn, because it tells us where the turnover actually got to.
//
// DELIBERATELY UNAUTHENTICATED. The people who know the answer are field techs and cleaners, and
// most have no login here. Requiring one would mean the question is only ever answered by people
// who were not at the door. The token is the credential: single-purpose, unguessable, and it
// reveals nothing — no code, no unit, just which of two already-issued codes turned the lock.
import { confirmByToken } from '@/lib/eve/door-code'

export const dynamic = 'force-dynamic'

const wrap = 'min-h-screen bg-app flex items-center justify-center p-5'
const card = 'bg-white border border-line rounded-2xl shadow-lifted p-6 w-full max-w-md text-center'
const btn = 'block w-full rounded-xl font-semibold py-3'

export default async function CodeWorkedPage(props: { params: { token: string }; searchParams: Record<string, string> }) {
  const sp = props.searchParams || {}
  const raw = String(sp.ok || '')
  const which: 'new' | 'old' | 'neither' | null =
    raw === '1' || raw === 'new' ? 'new' : raw === 'old' ? 'old' : raw === '0' || raw === 'neither' ? 'neither' : null

  if (!which) {
    return <div className={wrap}><div className={card}>
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold">Door code</p>
      <h1 className="text-lg font-bold text-ink mt-1">Which code opened it?</h1>
      <p className="text-[13px] text-muted mt-2">One tap. It is how we find out whether the lock has actually been changed yet.</p>
      <div className="mt-5 space-y-2">
        <a href="?ok=new" className={`${btn} bg-brand-600 text-white hover:bg-brand-700`}>The new code</a>
        <a href="?ok=old" className={`${btn} bg-white border border-line text-ink hover:bg-app`}>The old one</a>
        <a href="?ok=neither" className={`${btn} bg-white border border-line text-ink hover:bg-app`}>Neither — I could not get in</a>
      </div>
    </div></div>
  }

  const res = await confirmByToken(props.params.token, which)

  if (!res.ok) {
    return <div className={wrap}><div className={card}>
      <p className="text-sm font-semibold text-[#A32020]">Could not record that</p>
      <p className="text-[13px] text-ink mt-1">{res.error}</p>
    </div></div>
  }

  const unit = res.unit || 'that unit'
  const copy = which === 'new'
    ? { icon: '✅', head: 'Thank you — logged.', body: `The new code for ${unit} is confirmed working, and Eve will say so the next time anyone asks for it.` }
    : which === 'old'
      ? { icon: '🧹', head: 'Good to know — logged.', body: `So the lock on ${unit} still has the old code: housekeeping has not changed it yet. Anyone sent there next will be told to try the old one first.` }
      : { icon: '🔧', head: 'Logged. Somebody will fix it.', body: `${unit} is flagged. Neither code worked, so it is on the audit list as reported-not-working and the next person who asks will be warned before it is released.` }

  return <div className={wrap}><div className={card}>
    <p className="text-3xl">{copy.icon}</p>
    <p className="text-lg font-bold text-ink mt-2">{copy.head}</p>
    <p className="text-[13px] text-muted mt-2">{copy.body}</p>
    {which === 'neither' && <p className="text-[12px] text-muted mt-3">If you got in another way, say how in Slack so the right code gets into Guesty.</p>}
  </div></div>
}
