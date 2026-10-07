// THE OWNER'S VIEW OF ONE JOB (Jon, 2026-10-07: "generate an owner-viewable link to the task with
// photos and a description"). Public by link — the token is the capability (lib/task-extras; listed in
// OPEN_PREFIXES as /job/). It shows what an owner should see and nothing else: the unit, the job, the
// date, the write-up, the photos, and the charge when there is one. No staff names, no internal notes,
// no other tasks.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { readExtras, readLocalTasks } from '@/lib/task-extras'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Work completed — Stay Hospitality', robots: { index: false, follow: false } }

const day = (d: string | null) => {
  if (!d) return null
  const t = new Date(d.length === 10 ? d + 'T12:00:00Z' : d)
  return isNaN(t.getTime()) ? null : t.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
}
const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function load(token: string) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(token)) return null
  const extras = await readExtras()
  const id = Object.keys(extras).find(k => extras[k]?.token === token)
  if (!id) return null
  const ex = extras[id]
  const db = supabaseAdmin()
  let unit = '', title = '', description = '', date: string | null = null, status = 'Scheduled', listingId = ''
  if (id.startsWith('lh-')) {
    const t = (await readLocalTasks()).find(x => x.id === id)
    if (!t) return null
    unit = t.unit || ''; title = t.name; description = t.description; date = t.date; listingId = t.listingId
  } else {
    const { data } = await db.from('breezeway_tasks_sync').select('name,status,scheduled_date,finished_at,reference_property_id,descr:raw->>description').eq('id', id).limit(1)
    const r: any = data && data[0]
    if (!r) return null
    title = String(r.name || ''); description = String(r.descr || ''); date = r.finished_at || r.scheduled_date || null
    status = /finish|complete|approved|closed/i.test(String(r.status || '')) || r.finished_at ? 'Completed' : /progress|started/i.test(String(r.status || '')) ? 'In progress' : 'Scheduled'
    listingId = String(r.reference_property_id || '')
  }
  if (listingId && !unit) {
    const { data: l } = await db.from('guesty_listings').select('nickname,title').eq('id', listingId).limit(1)
    unit = l && l[0] ? String((l[0] as any).nickname || (l[0] as any).title || '') : ''
  }
  // The charge: what the billing desk says this job bills the owner (left off the statement = none).
  let amount: number | null = null
  try {
    const { data: adj } = await db.from('billing_adjustments').select('override_amount,excluded').eq('task_id', id).limit(1)
    const a: any = adj && adj[0]
    if (a && !a.excluded && a.override_amount != null) amount = Number(a.override_amount)
    else if (!a?.excluded && date) {
      const { billingRange } = await import('@/lib/billing')
      const dd = String(date).slice(0, 10)
      const r = await billingRange(dd, dd)
      const t = r.tasks.find(x => x.id === id)
      if (t && !t.excluded) amount = t.billedAmount
    }
  } catch { /* the page still shows the work */ }
  return { unit, title, description: (ex.ownerNote || description || '').trim(), date, status, photos: ex.photos || [], amount }
}

export default async function OwnerJobPage({ params }: { params: { token: string } }) {
  const j = await load(params.token)
  return (
    <main className="min-h-screen bg-[#f7f6f3] text-[#1b1b1b]">
      <div className="max-w-[760px] mx-auto px-5 py-8 sm:py-12">
        <header className="flex items-center gap-3 mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/stay-logo.png" alt="Stay Hospitality" className="h-8 w-auto" />
        </header>
        {!j ? (
          <div className="rounded-2xl bg-white border border-black/10 px-6 py-10 text-center">
            <h1 className="text-[22px] font-semibold">This link isn&apos;t available</h1>
            <p className="text-[14px] text-black/60 mt-2">It may have been mistyped. Please ask your Stay Hospitality contact for a new one.</p>
          </div>
        ) : (
          <article className="rounded-2xl bg-white border border-black/10 overflow-hidden">
            <div className="px-6 sm:px-8 pt-7 pb-6">
              <div className="text-[13px] text-black/55">{j.unit}{j.unit && day(j.date) ? ' · ' : ''}{day(j.date)}</div>
              <h1 className="text-[28px] sm:text-[32px] leading-tight mt-1.5" style={{ fontFamily: '"Instrument Serif", Georgia, serif' }}>{j.title}</h1>
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <span className={'text-[12.5px] font-semibold rounded-full px-2.5 py-1 ' + (j.status === 'Completed' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700')}>{j.status}</span>
                {j.amount != null && j.amount > 0 ? <span className="text-[14px] text-black/70">Charge <b className="text-black tabular-nums">{money(j.amount)}</b></span> : null}
              </div>
              {j.description ? <p className="text-[15.5px] leading-relaxed text-black/80 mt-5 whitespace-pre-line">{j.description}</p> : null}
            </div>
            {j.photos.length ? (
              <div className="px-6 sm:px-8 pb-8">
                <h2 className="text-[13px] font-semibold text-black/55 mb-3">Photos</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {j.photos.map(u => (
                    <a key={u} href={u} target="_blank" rel="noreferrer" className="block rounded-xl overflow-hidden bg-black/5 aspect-[4/3]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" loading="lazy" className="w-full h-full object-cover hover:scale-[1.02] transition-transform" />
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </article>
        )}
        <p className="text-[12px] text-black/45 mt-6 text-center">Stay Hospitality · questions about this work? Reply to your property manager.</p>
      </div>
    </main>
  )
}
