// THE GUEST'S PARKING PASS — what the link on the reservation in Guesty actually opens.
//
// Jon, 2026-09-16: "Once the QR code is uploaded, we need to find a way to map that QR code to the
// reservation in Guesty." The mapping is this address, written into a reservation custom field.
//
// WHO IS STANDING HERE: a guest, on a phone, at a gate, possibly with one bar of signal. So there
// is no passcode (they have no credential to give), no app chrome, and nothing on the page but the
// code, the unit and the dates it is good for. The token in the URL is the whole capability, and
// it stops resolving the moment the permit is voided — which is what makes a replaced code
// genuinely replaced instead of a second live credential for the same gate.
import { permitByToken } from '@/lib/parking'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata = { title: 'Parking pass', robots: { index: false, follow: false } }

const fmt = (iso: string | null) => {
  if (!iso) return ''
  try { return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) } catch { return iso }
}

export default async function PermitPage({ params }: { params: { token: string } }) {
  const token = String(params.token || '')
  const r = await permitByToken(token)

  if (!r.ok) {
    // TWO DIFFERENT SENTENCES, because they send the reader somewhere different. A finished stay
    // is the pass working exactly as intended and needs no phone call; anything else might be a
    // code we replaced, and that person should look for our newer message.
    const expired = r.reason === 'expired'
    return (
      <div className='min-h-screen bg-neutral-100 text-neutral-900 px-safe-keep grid place-items-center'>
        <div className='w-full max-w-sm rounded-2xl bg-white shadow-lg p-6 text-center'>
          <div className='text-base font-bold mb-1'>
            {expired ? 'This pass has expired' : 'This pass is no longer available'}
          </div>
          <p className='text-sm text-neutral-600'>
            {expired
              ? 'Parking passes stop working the day after checkout. If you are still on the property and need access, please contact us.'
              : 'It may have been replaced with a newer one. Check your latest message from us, or ask the front desk and they will send the current pass.'}
          </p>
        </div>
      </div>
    )
  }
  const p = r

  const file = '/api/public/permit/' + encodeURIComponent(token) + '/file'
  const dates = [fmt(p.view.checkIn), fmt(p.view.checkOut)].filter(Boolean).join(' → ')

  return (
    <div className='min-h-screen bg-neutral-100 text-neutral-900 px-safe'>
      <div className='max-w-md mx-auto px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]'>
        <div className='rounded-2xl bg-gradient-to-br from-neutral-900 via-neutral-900 to-neutral-800 shadow-lg overflow-hidden mb-4'>
          <div className='p-5'>
            <span className='text-[10px] uppercase tracking-[0.2em] text-amber-300 font-semibold'>Stay Hospitality</span>
            <h1 className='text-2xl font-bold text-white mt-1.5 tracking-tight'>Parking pass</h1>
            <p className='text-xs text-neutral-400 mt-1.5'>
              {[p.view.unit, dates].filter(Boolean).join(' · ') || 'Scan at the gate'}
            </p>
          </div>
        </div>

        <div className='rounded-2xl border border-neutral-200 bg-white shadow-sm p-5 text-center'>
          {p.view.isPdf ? (
            // A PDF never renders in an <img>, and a guest at a gate is the worst possible place to
            // discover that. It is a link they tap themselves.
            <a href={file} target='_blank' rel='noreferrer'
               className='block w-full rounded-xl bg-neutral-900 text-white text-sm font-semibold py-3'>
              Open your parking pass
            </a>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={file} alt='Parking QR code' className='w-full max-w-[280px] mx-auto rounded-xl' />
          )}
          <p className='text-xs text-neutral-500 mt-4 leading-relaxed'>
            Hold this on your screen at the gate reader.
          </p>
        </div>

        {/* SAVE IT NOW, NOT AT THE GATE (Jon, 2026-09-16: "have a note on the QR page to take a
            screenshot").
            It was one clause of grey fine print under the code, which is exactly where advice that
            has to be acted on BEFORE it is needed goes unread. A parking garage is a concrete box:
            the moment this matters is the moment the page cannot reload, and by then the guest is
            at a barrier with a car behind them. So it gets its own block, above the fold on a
            phone, and it says what to do rather than describing a situation.
            It also survives the pass expiring the day after checkout, which the screenshot does
            not — but a guest still inside the garage on that last morning has what they need. */}
        <div className='mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3'>
          <div className='text-sm font-bold text-amber-900'>
            {p.view.isPdf ? 'Save this pass to your phone' : 'Screenshot this now'}
          </div>
          <p className='text-xs text-amber-800 mt-1 leading-relaxed'>
            {p.view.isPdf
              ? 'Download it before you arrive. Garages are usually dead zones, and the pass will not load without signal.'
              : 'Garages are usually dead zones. A screenshot opens at the gate whether or not you have signal \u2014 this page will not.'}
          </p>
        </div>

        <p className='text-[11px] text-neutral-400 text-center mt-4 leading-relaxed'>
          This pass is for the stay above only. If it stops working, message us and we will send a
          new one.
        </p>
      </div>
    </div>
  )
}
