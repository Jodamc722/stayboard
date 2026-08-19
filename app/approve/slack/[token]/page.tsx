// Approve (or skip) a queued Slack message straight from the DM, on a phone, without logging in.
//
// Jon, 2026-08-19: "It can send me slack message DM, i can approve via there or command center."
//
// THE TOKEN IS THE AUTHORISATION. It is 24 random bytes, it only ever appears in a DM sent to an
// approver, and `decideByToken` clears it the moment it is used — so the link cannot be replayed,
// forwarded and reused, or brute-forced. This page sits under /approve/, which middleware already
// treats as public, so there is no session to get in the way when Jon taps it from his phone.
//
// Real Block Kit buttons would be one tap instead of two, but they need Interactivity switched on
// plus SLACK_SIGNING_SECRET in Vercel. This works today with no new secrets.
import Link from 'next/link'
import { decideByToken } from '@/lib/slack-queue'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Send this?', robots: { index: false, follow: false } }

export default async function SlackApprovePage({
  params, searchParams,
}: {
  params: { token: string }
  searchParams: { go?: string }
}) {
  const approve = String(searchParams.go || '') !== '0'
  const res = await decideByToken(params.token, approve)

  const good = res.ok && approve
  const skipped = res.ok && !approve

  const tone = good
    ? { ring: 'border-emerald-200 bg-emerald-50', text: 'text-emerald-800', icon: '✅' }
    : skipped
      ? { ring: 'border-slate-200 bg-slate-50', text: 'text-slate-700', icon: '🚫' }
      : { ring: 'border-amber-200 bg-amber-50', text: 'text-amber-800', icon: '⏳' }

  const heading = good ? 'Sent' : skipped ? 'Skipped' : 'Nothing to do'
  const blurb = good
    ? 'It has gone out to the team.'
    : skipped
      ? 'That one will not be sent. Nothing else happens.'
      : res.error || 'That one was already handled.'

  return (
    <div className="min-h-screen bg-neutral-50 flex items-start justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className={`rounded-2xl border ${tone.ring} px-5 py-6 text-center`}>
          <div className="text-3xl">{tone.icon}</div>
          <h1 className={`text-xl font-bold mt-2 ${tone.text}`}>{heading}</h1>
          <p className="text-sm text-neutral-600 mt-1.5">{blurb}</p>
        </div>

        {res.ok && res.row && res.row.body ? (
          <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3.5 mt-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 mb-1.5">
              {approve ? 'What went out' : 'What was skipped'}
            </div>
            <pre className="text-[12.5px] text-neutral-800 whitespace-pre-wrap font-sans leading-relaxed">{res.row.body}</pre>
          </div>
        ) : null}

        <Link href="/command" className="block text-center text-[13px] font-semibold text-brand-700 hover:underline mt-4">
          Open Command Center
        </Link>
      </div>
    </div>
  )
}
