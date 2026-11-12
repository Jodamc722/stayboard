'use client'
// THE PROJECTION PAGE (lib/calc-report). A full page for one projection, laid out to fit any screen: the
// yearly range, the month by month pattern, the comparables, what is nearby, the note and Nick. Anyone
// with the link reads it and downloads the PDF; the sales team (signed in) edits it right here: the look,
// the title, who it is for, every figure, which sections show, a note.
import { useMemo, useState } from 'react'
import { Download, Phone, Mail, Pencil, Check, Link2, ArrowLeft } from 'lucide-react'
import { money0, type IncomeFull } from '@/lib/free-tools'
import { CALC_LOOKS, describeHome, type CalcContent, type CalcLook } from '@/lib/calc-report'

type Any = any
const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const range = (a: number, b: number) => (a === b || !b ? money0(a) : money0(a) + '–' + money0(b).slice(1))

export function CalcReportPage({ code, initial, canEdit, createdAt }: { code: string; initial: CalcContent; canEdit: boolean; createdAt: string }) {
  const [c, setC] = useState<CalcContent>(initial)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState<'' | 'saving' | 'saved' | 'error'>('')
  const [copied, setCopied] = useState(false)
  const f = c.full as IncomeFull
  const home = describeHome(c.input)
  const where = [c.input.address, f.area && !(c.input.address || '').includes(f.area) ? f.area : ''].filter(Boolean).join(' · ')
  const date = new Date(createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const mx = Math.max(1, ...f.months.map(m => m.hi))
  const first = (c.contact.name || '').split(' ')[0]

  async function save(edits: Any) {
    const next = { ...c, ...edits, full: { ...c.full, ...(edits.full || {}) }, show: { ...c.show, ...(edits.show || {}) } }
    setC(next as CalcContent); setSaving('saving')
    try {
      const r = await fetch('/api/sales/calc-report', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, edits: { ...edits, show: next.show, full: edits.full } }) }).then(x => x.json())
      if (r?.ok) { setC(r.content); setSaving('saved') } else setSaving('error')
    } catch { setSaving('error') }
  }
  async function pdf() {
    const { toolPdf } = await import('@/lib/free-tool-pdf')
    await toolPdf({ tool: 'income', full: { ...f, comps: c.show.comps ? f.comps : [], places: c.show.nearby ? f.places : [] } as Any, title: c.title, kicker: c.preparedFor ? 'Prepared for ' + c.preparedFor : 'Rental projection', contact: c.contact, estimateNote: f.note + (c.notes ? ' ' + c.notes : ''), subtitle: [c.input.building, c.input.address].filter(Boolean).join(' · '), file: (c.input.building ? c.input.building.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-' : '') + 'rental-projection.pdf' })
  }
  function copy() {
    const url = window.location.origin + '/r/' + code
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1800) }
    navigator.clipboard?.writeText(url).then(done).catch(() => { const t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select(); try { document.execCommand('copy') } catch { /* */ } t.remove(); done() })
  }
  // a number, editable in place for the team
  const N = ({ k, pre = '$', suf = '' }: { k: keyof IncomeFull; pre?: string; suf?: string }) => editing
    ? <input className="cr-num" inputMode="numeric" defaultValue={String(f[k] as number)} onBlur={e => { const v = Number(e.target.value.replace(/[^\d]/g, '')); if (v !== f[k]) save({ full: { [k]: v } }) }} />
    : <>{pre === '$' ? money0(f[k] as number) : String(f[k]) + suf}</>
  const looks = useMemo(() => CALC_LOOKS, [])

  return (
    <main className={'cr cr-' + c.look}>
      <style>{CSS}</style>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" />
      {canEdit ? (
        <div className="cr-bar">
          <span className="cr-bar-l">Projection page</span>
          <div className="cr-seg">{looks.map(l => <button key={l.key} type="button" className={c.look === l.key ? 'on' : ''} onClick={() => save({ look: l.key as CalcLook })}>{l.label}</button>)}</div>
          <button type="button" className={'cr-btn' + (editing ? ' on' : '')} onClick={() => setEditing(!editing)}>{editing ? <><Check size={14} /> Done</> : <><Pencil size={14} /> Edit</>}</button>
          <span className="cr-save">{saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : saving === 'error' ? 'Not saved, try again' : ''}</span>
        </div>
      ) : null}

      <header className="cr-head">
        <div className="cr-wrap">
          <div className="cr-top"><img src={c.look === 'navy' ? '/stay-logo-white.png' : '/stay-logo.png'} alt="Stay Hospitality" /><span>{date}</span></div>
          <p className="cr-kick">{editing ? <input className="cr-in" defaultValue={c.preparedFor} placeholder="Prepared for (name)" onBlur={e => e.target.value !== c.preparedFor && save({ preparedFor: e.target.value })} /> : c.preparedFor ? 'Prepared for ' + c.preparedFor : 'Rental projection'}</p>
          <h1>{editing ? <input className="cr-in cr-in-h" defaultValue={c.title} onBlur={e => e.target.value !== c.title && save({ title: e.target.value })} /> : c.title}</h1>
          {where || home ? <p className="cr-sub">{[where, home].filter(Boolean).join('  ·  ')}</p> : null}
        </div>
      </header>

      <div className="cr-wrap cr-body">
        <section className="cr-hero">
          <p className="cr-lab">Could earn in a year{f.area ? ', ' + f.area : ''}</p>
          <p className="cr-big"><span><N k="lo" /></span> <i>to</i> <span><N k="hi" /></span></p>
          <p className="cr-note">Gross rental revenue once the listing is established. From {f.basisLabel}, adjusted for the home’s size, view, kitchen, balcony, amenities and distance to the beach.</p>
          {canEdit && initial.team && initial.team.adjustments.length ? (
            <details className="cr-team"><summary>For the team: how the calculator adjusted it (never shown to the owner)</summary>
              <p>Base {range(initial.team.baseLo, initial.team.baseHi)} · {initial.team.adjustments.map(a => a.label + ' ' + (a.pct > 0 ? '+' : '') + a.pct + '%').join(' · ')} · total {initial.team.adjTotal > 0 ? '+' : ''}{initial.team.adjTotal}%</p>
            </details>
          ) : null}
        </section>

        <dl className="cr-figs">
          <div><dt>Per month, average</dt><dd>{editing ? <><N k="monthLo" /> – <N k="monthHi" /></> : range(f.monthLo, f.monthHi)}</dd></div>
          <div><dt>Nightly rate</dt><dd>{editing ? <><N k="nightlyLo" /> – <N k="nightlyHi" /></> : range(f.nightlyLo, f.nightlyHi)}</dd></div>
          <div><dt>Occupancy</dt><dd>{editing ? <><N k="occLo" pre="" /> – <N k="occHi" pre="" suf="%" /></> : f.occLo + '–' + f.occHi + '%'}</dd></div>
          {c.show.net ? <div><dt>You keep, est.</dt><dd>{editing ? <><N k="netLo" /> – <N k="netHi" /></> : range(f.netLo, f.netHi)}</dd></div> : null}
        </dl>

        {c.show.months ? (
          <section className="cr-sec">
            <h2>Through the year</h2>
            <div className="cr-bars">{f.months.map((m, i) => (
              <div key={i} className="cr-bar1"><span className="cr-v">{'$' + Math.round(m.hi / 1000) + 'k'}</span><i style={{ height: (m.hi / mx * 100) + '%' }}><b style={{ height: (m.lo / Math.max(1, m.hi) * 100) + '%' }} /></i><em>{M[i]}</em></div>
            ))}</div>
            <p className="cr-fine">Darker is the low end of the range, lighter the high end. South Florida earns most from December to April.</p>
          </section>
        ) : null}

        {c.show.comps && f.comps.length ? (
          <section className="cr-sec">
            <h2>The comparables behind it</h2>
            <ul className="cr-list">{f.comps.map((x, i) => (
              <li key={i}><div><b>{x.name}</b><small>{[x.market, x.nightly, x.occ].filter(Boolean).join(' · ')}</small></div><span>{x.gross}</span></li>
            ))}</ul>
          </section>
        ) : null}

        {c.show.nearby && f.places.length ? (
          <section className="cr-sec">
            <h2>Nearby{f.beachMi != null ? <small> · about {f.beachMi < 0.95 ? f.beachMi.toFixed(1) : Math.round(f.beachMi)} mi to the beach</small> : null}</h2>
            <ul className="cr-list cr-near">{f.places.map((x, i) => <li key={i}><div><b>{x.name}</b><small>{x.kind}</small></div><span>{x.mi} mi</span></li>)}</ul>
          </section>
        ) : null}

        <section className="cr-notes">
          <p className="cr-lab">This is an estimate</p>
          <p>{f.note}</p>
          {editing ? <textarea className="cr-in" rows={3} defaultValue={c.notes} placeholder="A note for this owner (optional)" onBlur={e => e.target.value !== c.notes && save({ notes: e.target.value })} /> : c.notes ? <p className="cr-own">{c.notes}</p> : null}
          {c.show.net ? <p className="cr-fine">“You keep” takes off typical booking-site fees ({f.channelPct}%){f.mgmtPct ? <> and a {f.mgmtPct}% management fee</> : <>; self-managed, so no management fee, but cleaning, supplies and your time are yours</>}. Distances are straight-line.</p> : null}
        </section>

        {editing ? (
          <section className="cr-show">
            <p className="cr-lab">Show on the page</p>
            {([['months', 'Through the year'], ['comps', 'Comparables'], ['nearby', 'Nearby'], ['net', 'You keep']] as [keyof CalcContent['show'], string][]).map(([k, l]) => (
              <label key={k}><input type="checkbox" checked={c.show[k]} onChange={e => save({ show: { [k]: e.target.checked } })} /> {l}</label>
            ))}
          </section>
        ) : null}

        <div className="cr-actions">
          <button type="button" className="cr-primary" onClick={pdf}><Download size={16} /> Download the PDF</button>
          <button type="button" onClick={copy}><Link2 size={16} /> {copied ? 'Link copied' : 'Copy the link'}</button>
          {c.meta.source === 'public' ? <a href="/tools/income"><ArrowLeft size={16} /> Change the details</a> : null}
        </div>

        {c.contact.name ? (
          <section className="cr-who">
            {c.contact.photo ? <img src={c.contact.photo} alt={c.contact.name} /> : null}
            <div>
              <p className="cr-lab">Talk to {first}</p>
              <p className="cr-who-n">{c.contact.name}{c.contact.role ? <span>, {c.contact.role}</span> : null}</p>
              <p className="cr-who-c">
                {c.contact.phone ? <a href={'tel:' + c.contact.phone.replace(/[^\d+]/g, '')}><Phone size={14} /> {c.contact.phone}</a> : null}
                {c.contact.email ? <a href={'mailto:' + c.contact.email}><Mail size={14} /> {c.contact.email}</a> : null}
              </p>
            </div>
          </section>
        ) : null}
        <p className="cr-foot">Stay Hospitality · Short-term rental management across Miami-Dade and Broward · stay-hospitality.com</p>
      </div>
    </main>
  )
}

const CSS = `
.cr{--bg:#F7F5F0;--card:#fff;--ink:#121316;--body:#3A3B40;--mut:#6E6F74;--rule:#E5E1D8;--acc:#8C6D3A;--soft:#F1EDE4;--head:#EDE6D8;--headink:#121316;--headmut:#5C5D62;--kick:#8C6D3A;--bar:#14161B;--barhi:#D9CFBD;
  min-height:100vh;background:var(--bg);color:var(--body);font:400 15px/1.55 Inter,system-ui,sans-serif;overflow-x:clip}
.cr-navy{--headink:#fff;--headmut:rgba(255,255,255,.7);--kick:#D4B47C;--bg:#0F1726;--card:#162033;--ink:#F4F1EA;--body:#C9CCD3;--mut:#9097A3;--rule:rgba(255,255,255,.12);--acc:#D4B47C;--soft:#1B2740;--head:#0B1220;--bar:#D4B47C;--barhi:rgba(212,180,124,.35)}
.cr-minimal{--bg:#fff;--card:#fff;--ink:#0D0D0F;--body:#333;--mut:#777;--rule:#E8E8E8;--acc:#0D0D0F;--soft:#F5F5F5;--head:#fff;--headink:#0D0D0F;--headmut:#777;--bar:#0D0D0F;--barhi:#DADADA}
.cr *{box-sizing:border-box}
.cr-wrap{max-width:880px;margin:0 auto;padding-left:max(20px,env(safe-area-inset-left));padding-right:max(20px,env(safe-area-inset-right))}
.cr-bar{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px max(20px,env(safe-area-inset-left));background:#111;color:#fff;font-size:13px}
.cr-bar-l{font-weight:600;margin-right:auto}
.cr-seg{display:inline-flex;background:rgba(255,255,255,.1);border-radius:99px;padding:3px}
.cr-seg button{border:0;background:transparent;color:#ccc;font:600 12.5px Inter,sans-serif;padding:6px 12px;border-radius:99px;cursor:pointer}
.cr-seg button.on{background:#fff;color:#111}
.cr-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.3);background:transparent;color:#fff;font:600 12.5px Inter,sans-serif;padding:7px 14px;border-radius:99px;cursor:pointer}
.cr-btn.on{background:#D4B47C;border-color:#D4B47C;color:#111}
.cr-save{font-size:12px;color:#aaa;min-width:70px}
.cr-head{background:var(--head);color:var(--headink);padding:28px 0 40px}
.cr-minimal .cr-head{border-bottom:1px solid var(--rule)}
.cr-top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:40px}
.cr-top img{height:30px}
.cr-top span{font-size:12.5px;color:var(--headmut)}
.cr-kick{font:600 11px Inter,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:var(--kick,var(--acc));margin:0 0 10px}
.cr h1{font:400 clamp(36px,7vw,64px)/1.02 "Instrument Serif",Georgia,serif;margin:0;letter-spacing:-.01em;overflow-wrap:anywhere}
.cr-sub{margin:14px 0 0;color:var(--headmut);font-size:15px}
.cr-body{padding-top:36px;padding-bottom:60px}
.cr-lab{font:600 11px Inter,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--acc);margin:0 0 8px}
.cr-hero{background:var(--card);border:1px solid var(--rule);border-radius:18px;padding:28px clamp(18px,4vw,36px)}
.cr-big{margin:0;font:400 clamp(40px,9vw,76px)/1.05 "Instrument Serif",Georgia,serif;color:var(--ink);font-variant-numeric:lining-nums}
.cr-big span{display:inline-block;white-space:nowrap}
.cr-big i{font-style:italic;font-size:.55em;color:var(--mut);margin:0 .15em}
.cr-note{margin:12px 0 0;max-width:62ch}
.cr-team{margin-top:14px;font-size:13px;color:var(--mut)}
.cr-team summary{cursor:pointer;color:var(--acc);font-weight:600}
.cr-figs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0 0}
.cr-figs div{background:var(--card);border:1px solid var(--rule);border-radius:14px;padding:16px 16px 14px;min-width:0}
.cr-figs dt{font:600 10.5px Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--mut)}
.cr-figs dd{margin:6px 0 0;font:400 clamp(22px,3vw,28px)/1.15 "Instrument Serif",Georgia,serif;color:var(--ink);font-variant-numeric:lining-nums;overflow-wrap:anywhere}
.cr-sec{margin-top:40px}
.cr h2{font:400 clamp(26px,4vw,34px)/1.1 "Instrument Serif",Georgia,serif;color:var(--ink);margin:0 0 16px}
.cr h2 small{font:400 14px Inter,sans-serif;color:var(--mut)}
.cr-bars{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:clamp(4px,1vw,10px);height:220px;align-items:end;background:var(--card);border:1px solid var(--rule);border-radius:16px;padding:18px clamp(10px,2vw,20px) 12px}
.cr-bar1{display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;min-width:0}
.cr-bar1 i{display:flex;align-items:flex-end;width:100%;max-width:38px;background:var(--barhi);border-radius:6px 6px 2px 2px}
.cr-bar1 b{display:block;width:100%;background:var(--bar);border-radius:6px 6px 2px 2px}
.cr-bar1 em{font:600 10.5px Inter,sans-serif;font-style:normal;color:var(--mut);margin-top:6px}
.cr-v{font:500 10.5px Inter,sans-serif;color:var(--mut);margin-bottom:4px;white-space:nowrap}
.cr-fine{font-size:12.5px;color:var(--mut);margin:10px 0 0}
.cr-list{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--rule);border-radius:16px}
.cr-list li{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:14px 18px;border-top:1px solid var(--rule)}
.cr-list li:first-child{border-top:0}
.cr-list li>div{min-width:0}
.cr-list b{display:block;font-weight:600;color:var(--ink)}
.cr-list small{display:block;color:var(--mut);font-size:12.5px;margin-top:2px}
.cr-list li>span{font:400 20px "Instrument Serif",Georgia,serif;color:var(--ink);white-space:nowrap;font-variant-numeric:lining-nums}
.cr-near small{text-transform:capitalize}
.cr-notes{margin-top:40px;background:var(--soft);border-radius:16px;padding:20px 22px}
.cr-notes p{margin:0}
.cr-own{margin-top:10px!important;color:var(--ink)}
.cr-show{margin-top:16px;display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center}
.cr-show .cr-lab{margin:0;width:100%}
.cr-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}
.cr-actions button,.cr-actions a{display:inline-flex;align-items:center;gap:8px;height:46px;padding:0 20px;border-radius:99px;border:1px solid var(--rule);background:var(--card);color:var(--ink);font:600 14px Inter,sans-serif;text-decoration:none;cursor:pointer}
.cr-actions .cr-primary{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.cr-who{display:flex;gap:16px;align-items:center;margin-top:28px;padding:18px 20px;background:var(--card);border:1px solid var(--rule);border-radius:16px}
.cr-who img{width:72px;height:72px;border-radius:50%;object-fit:cover;flex:0 0 72px}
.cr-who>div{min-width:0}
.cr-who p{margin:0}
.cr-who-n{font:600 17px/1.3 Inter,sans-serif;color:var(--ink)}
.cr-who-n span{font-weight:400;color:var(--mut)}
.cr-who-c{display:flex;flex-wrap:wrap;gap:4px 18px;margin-top:6px!important}
.cr-who-c a{display:inline-flex;align-items:center;gap:6px;color:var(--ink);text-decoration:none;font-weight:500;min-width:0;overflow-wrap:anywhere}
.cr-foot{margin-top:40px;font-size:12px;color:var(--mut)}
.cr-in{font:inherit;color:inherit;background:rgba(255,255,255,.08);border:1px dashed #D4B47C;border-radius:8px;padding:4px 8px;width:100%}
.cr-notes .cr-in{margin-top:10px;background:var(--card);color:var(--ink)}
.cr-in-h{font:400 clamp(30px,6vw,52px)/1.1 "Instrument Serif",Georgia,serif}
.cr-num{font:inherit;color:var(--ink);background:var(--soft);border:1px dashed var(--acc);border-radius:8px;padding:0 6px;width:5.2em;max-width:100%}
.cr-big .cr-num{width:3.6em}.cr-figs .cr-num{width:42%;font-size:.8em}
@media (max-width:720px){.cr-figs{grid-template-columns:repeat(2,minmax(0,1fr))}.cr-bars{height:180px}.cr-v{display:none}.cr-top{margin-bottom:28px}}
@media (max-width:380px){.cr-figs{grid-template-columns:1fr}}
`
