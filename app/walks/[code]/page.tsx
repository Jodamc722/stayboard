// A WALK REPORT, FOR THE OWNERS (lib/walk-reports; Jon, 2026-11-02, the Eden exterior walk). No
// login — the 16-hex code in the link is the key, like /r/<code> and /job/<token>. Every line of
// the checklist with its answer, every issue with its photo and note and the fix task it raised,
// and what is still open from earlier walks. Robots noindex. Listed in OPEN_PREFIXES ('/walks/').
import { notFound } from 'next/navigation'
import { getReport, type WalkItem } from '@/lib/walk-reports'

export const dynamic = 'force-dynamic'

const fmtDate = (ymd: string) => { const d = new Date(ymd + 'T12:00:00Z'); return isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) }
const fmtTime = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) }
const fmtShort = (ymd: string) => { const d = new Date(ymd + 'T12:00:00Z'); return isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) }

export async function generateMetadata({ params }: { params: { code: string } }) {
  const base = { robots: { index: false, follow: false } }
  const r = await getReport(String(params.code || ''))
  return r ? { ...base, title: r.programName + ' — ' + fmtShort(r.scheduledDate) } : { ...base, title: 'Walk report' }
}

function Count({ n, label, tone }: { n: number; label: string; tone: 'emerald' | 'rose' | 'amber' | 'slate' }) {
  const cls = tone === 'emerald' ? 'bg-emerald-50 text-emerald-800' : tone === 'rose' ? 'bg-rose-50 text-rose-800' : tone === 'amber' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700'
  return <div className={'rounded-xl px-3 py-2 ' + cls}><div className="text-[22px] font-bold leading-none tabular-nums">{n}</div><div className="text-[11.5px] mt-1 font-semibold">{label}</div></div>
}

function Photos({ urls }: { urls: string[] }) {
  if (!urls.length) return null
  return <div className="flex gap-2 flex-wrap mt-2">{urls.map((u, i) => <a key={u + i} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="h-24 w-32 object-cover rounded-lg border border-line" /></a>)}</div>
}

export default async function WalkReportPage({ params }: { params: { code: string } }) {
  const r = await getReport(String(params.code || ''))
  if (!r) notFound()
  const sections: { name: string; items: WalkItem[] }[] = []
  for (const it of r.items) {
    const name = it.section || 'Checklist'
    const s = sections.find(x => x.name === name) || (sections.push({ name, items: [] }), sections[sections.length - 1])
    s.items.push(it)
  }
  const issues = r.items.filter(x => x.state === 'issue')
  const fixes = new Map(r.fixTasks.map(f => [f.action, f]))
  const walked = (r.finishedBy ? 'Walked by ' + r.finishedBy : 'Walked') + (r.startedAt ? ', ' + fmtTime(r.startedAt) + (r.finishedAt ? ' to ' + fmtTime(r.finishedAt) : '') : r.finishedAt ? ' at ' + fmtTime(r.finishedAt) : '') + (r.minutes ? ' (' + r.minutes + ' min)' : '') + '.'
  const mark = (s: WalkItem['state']) => s === 'pass' ? <span className="inline-flex h-5 px-2 items-center rounded-full bg-emerald-50 text-emerald-800 text-[11px] font-bold">PASS</span> : s === 'issue' ? <span className="inline-flex h-5 px-2 items-center rounded-full bg-rose-50 text-rose-800 text-[11px] font-bold">ISSUE</span> : <span className="inline-flex h-5 px-2 items-center rounded-full bg-amber-50 text-amber-800 text-[11px] font-bold">NOT DONE</span>
  return (
    <main className="min-h-screen bg-app text-ink">
      <div className="max-w-[720px] mx-auto px-4 py-8 space-y-6">
        {r.programId.indexOf('sample:') === 0 ? <p className="rounded-xl bg-amber-50 text-amber-800 px-3 py-2 text-[13px]"><b>Sample.</b> This is what ownership receives after a finished walk; the answers are illustrative, the real ones come from the walk in the field app.</p> : null}
        <header className="space-y-1">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">{r.place || 'Property walk'}</p>
          <h1 className="text-[24px] font-bold leading-tight">{r.programName} — {fmtDate(r.scheduledDate)}</h1>
          <p className="text-[13.5px] text-muted">{walked}</p>
        </header>
        <div className="flex gap-2 flex-wrap">
          <Count n={r.passed} label="passed" tone="emerald" />
          <Count n={r.issues} label={r.issues === 1 ? 'issue' : 'issues'} tone={r.issues ? 'rose' : 'slate'} />
          <Count n={r.open} label="not done" tone={r.open ? 'amber' : 'slate'} />
        </div>

        <section className="rounded-2xl border border-line bg-white p-4 space-y-3">
          <h2 className="text-[15px] font-bold">{issues.length ? 'Issues on this walk' : 'Nothing failed on this walk'}</h2>
          {issues.map((it, i) => {
            const f = fixes.get(it.action)
            return (
              <div key={i} className="border-t border-line pt-3">
                <div className="text-[14px] font-semibold">{it.action} {it.section ? <span className="font-normal text-muted">· {it.section}</span> : null}</div>
                {it.note ? <p className="text-[13px] text-ink/80 mt-0.5">{it.note}</p> : null}
                {f ? <p className="text-[12.5px] text-emerald-800 mt-0.5">Fix task raised for maintenance on {fmtShort(f.raisedOn)}</p> : null}
                <Photos urls={it.photos} />
              </div>
            )
          })}
        </section>

        {r.carried.length ? (
          <section className="rounded-2xl border border-line bg-white p-4 space-y-3">
            <h2 className="text-[15px] font-bold">Still open from earlier walks</h2>
            {r.carried.map((c, i) => (
              <div key={c.taskId + i} className="border-t border-line pt-3">
                <div className="text-[14px] font-semibold">{c.action}</div>
                {c.note ? <p className="text-[13px] text-ink/80 mt-0.5">{c.note}</p> : null}
                <p className="text-[12.5px] text-amber-800 mt-0.5">Found on the walk of {fmtShort(c.date)} — the fix task is still open</p>
                <Photos urls={c.photos} />
              </div>
            ))}
          </section>
        ) : null}

        <section className="rounded-2xl border border-line bg-white p-4 space-y-4">
          <h2 className="text-[15px] font-bold">Every line</h2>
          {!r.items.length ? <p className="text-[13px] text-muted">This task carried no checklist — the walk was recorded with photos and notes only.</p> : null}
          {sections.map(s => (
            <div key={s.name}>
              <h3 className="text-[12px] font-bold uppercase tracking-wide text-muted mb-1">{s.name}</h3>
              <ul className="divide-y divide-line">
                {s.items.map((it, i) => (
                  <li key={i} className="py-2 flex items-start gap-3 text-[13.5px]">
                    <span className="flex-1">{it.action}{it.note && it.state !== 'issue' ? <span className="block text-[12.5px] text-muted">{it.note}</span> : null}</span>
                    {mark(it.state)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {r.comments.length || r.photos.length ? (
          <section className="rounded-2xl border border-line bg-white p-4 space-y-2">
            <h2 className="text-[15px] font-bold">Notes and photos on the task</h2>
            {r.comments.map((c, i) => <p key={i} className="text-[13.5px]">{c.body}</p>)}
            <Photos urls={r.photos} />
          </section>
        ) : null}

        <footer className="text-[12px] text-muted space-y-1">
          {r.reportUrl ? <p><a href={r.reportUrl} target="_blank" rel="noreferrer" className="underline">Breezeway task report</a></p> : null}
          <p>Prepared by Lighthouse, Stay Hospitality&rsquo;s operations system, when the walk was finished in Breezeway.</p>
        </footer>
      </div>
    </main>
  )
}
