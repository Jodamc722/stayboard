'use client'
// Guidebook viewer/editor. Renders the generated guidebook as A4-style pages in the Salato
// editorial spirit (light) or Dark Luxe theme, with inline EDIT mode, theme switch, Print/PDF
// (browser print - each page breaks correctly), and Delete. QR points to stay-hospitality.com.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Pencil, Printer, Save, Trash2, Loader2 } from 'lucide-react'

const QR = 'https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=' + encodeURIComponent('https://stay-hospitality.com')

function StayLogo({ className = '' }: { className?: string }) {
  return (
    <div className={'text-center ' + className} style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
      <div className="text-3xl tracking-[0.35em]">STAY</div>
      <div className="mt-1 flex items-center justify-center gap-3">
        <span className="h-px w-10 bg-current opacity-70" />
        <span className="text-[9px] tracking-[0.45em]">HOSPITALITY</span>
        <span className="h-px w-10 bg-current opacity-70" />
      </div>
    </div>
  )
}

export function GuidebookView({ initial }: { initial: any }) {
  const router = useRouter()
  const [gb, setGb] = useState<any>(initial)
  const [edit, setEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const s = gb.sections || {}
  const photos: string[] = Array.isArray(s._photos) ? s._photos : []
  const dark = gb.theme === 'dark'

  function set(path: string[], value: any) {
    setGb((g: any) => {
      const next = JSON.parse(JSON.stringify(g))
      let o = next.sections
      for (let i = 0; i < path.length - 1; i++) o = o[path[i]] = o[path[i]] ?? {}
      o[path[path.length - 1]] = value
      return next
    })
  }

  async function save() {
    setBusy(true)
    try {
      await fetch('/api/guidebook', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: gb.id, sections: gb.sections, title: gb.title, theme: gb.theme }) })
      setEdit(false)
    } finally { setBusy(false) }
  }

  async function del() {
    if (!confirm('Delete this guidebook?')) return
    await fetch('/api/guidebook?id=' + gb.id, { method: 'DELETE' })
    router.push('/guidebooks')
  }

  const T = ({ path, value, className, rows = 2 }: { path: string[]; value: string; className?: string; rows?: number }) =>
    edit
      ? <textarea rows={rows} value={value || ''} onChange={e => set(path, e.target.value)} className={'w-full bg-transparent border border-dashed border-current/40 rounded p-1 ' + (className || '')} />
      : <span className={className}>{value}</span>

  const pageBase = dark
    ? 'bg-neutral-950 text-neutral-100'
    : 'bg-[#faf8f4] text-neutral-900'
  const accent = dark ? 'text-amber-200/90' : 'text-neutral-500'
  const serif = { fontFamily: 'Georgia, "Times New Roman", serif' }
  const footer = (
    <div className={'mt-auto pt-6 flex items-center justify-between text-[10px] tracking-widest ' + accent}>
      <span>{s.contact?.customerService || '954-526-8998'}</span>
      <span>{s.contact?.email || 'support@stay-hospitality.com'}</span>
    </div>
  )

  const Page = ({ children, cover }: { children: any; cover?: string }) => (
    <div className={'gb-page relative mx-auto mb-6 flex w-full max-w-[820px] flex-col overflow-hidden rounded-lg shadow-md print:mb-0 print:rounded-none print:shadow-none ' + pageBase}
      style={{ aspectRatio: '210/297', padding: '48px 52px' }}>
      {cover && <img src={cover} alt="" className="absolute inset-0 h-1/2 w-full object-cover" />}
      <div className={'relative flex h-full flex-col ' + (cover ? 'pt-[46%]' : '')}>{children}</div>
    </div>
  )

  const H = ({ children }: { children: any }) => (
    <h2 className="text-4xl lowercase leading-tight" style={serif}>{children}</h2>
  )

  return (
    <div className={dark ? 'min-h-screen bg-neutral-900' : 'min-h-screen bg-neutral-100'}>
      <style>{`@media print { .gb-chrome{display:none!important} .gb-page{page-break-after:always; width:100%!important; max-width:none!important} body{background:white} }`}</style>

      {/* Toolbar */}
      <div className="gb-chrome sticky top-0 z-10 flex items-center justify-between border-b border-black/10 bg-white/90 px-4 py-3 backdrop-blur">
        <Link href="/guidebooks" className="inline-flex items-center gap-1.5 text-sm text-neutral-600 hover:text-black"><ArrowLeft size={15} /> Guidebooks</Link>
        <div className="text-sm font-semibold text-neutral-800 truncate max-w-[40%]">{gb.title}</div>
        <div className="flex items-center gap-2">
          <select value={gb.theme} onChange={e => setGb({ ...gb, theme: e.target.value })} className="rounded-lg border border-neutral-300 px-2 py-1.5 text-xs">
            <option value="editorial">Coastal editorial</option>
            <option value="dark">Dark luxe</option>
          </select>
          {edit
            ? <button onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white">{busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save</button>
            : <button onClick={() => setEdit(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold"><Pencil size={13} /> Edit</button>}
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold"><Printer size={13} /> Print / PDF</button>
          <button onClick={del} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600"><Trash2 size={13} /></button>
        </div>
      </div>

      <div className="px-4 py-8">
        {/* 1 — Cover */}
        <Page cover={photos[0]}>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className={'text-[10px] tracking-[0.5em] ' + accent}>WELCOME</p>
            <div className="mt-4 text-5xl leading-tight" style={serif}>
              <T path={['cover', 'line1']} value={s.cover?.line1} /><br />
              <T path={['cover', 'line2']} value={s.cover?.line2} />
            </div>
            <p className={'mt-5 text-[11px] tracking-[0.35em] ' + accent}><T path={['cover', 'subtitle']} value={s.cover?.subtitle} /></p>
          </div>
          <StayLogo className="opacity-80" />
        </Page>

        {/* 2 — About */}
        <Page cover={photos[1]}>
          <H><T path={['about', 'heading']} value={s.about?.heading} /></H>
          <p className="mt-5 max-w-xl text-sm leading-7"><T path={['about', 'body']} value={s.about?.body} rows={6} /></p>
          {footer}
        </Page>

        {/* 3 — Private retreat */}
        <Page>
          <div className="flex flex-1 flex-col justify-center">
            <H><T path={['retreat', 'heading']} value={s.retreat?.heading} /></H>
            <div className="mt-8 space-y-5 text-[11px] tracking-[0.18em] leading-6">
              {(s.retreat?.lines || []).map((ln: string, i: number) => (
                <p key={i}><T path={['retreat', 'lines', String(i)] as any} value={ln} rows={2} /></p>
              ))}
            </div>
          </div>
          {footer}
        </Page>

        {/* 4 — What makes this stay special + QR */}
        <Page>
          <H><T path={['special', 'heading']} value={s.special?.heading} /></H>
          <div className="mt-6 grid flex-1 grid-cols-2 gap-x-8 gap-y-6">
            {(s.special?.groups || []).map((g: any, i: number) => (
              <div key={i}>
                <p className="text-sm font-bold"><T path={['special', 'groups', String(i), 'title'] as any} value={g.title} /></p>
                <ul className="mt-2 space-y-1.5 text-[13px] leading-5">
                  {(g.items || []).map((it: string, j: number) => <li key={j}>• <T path={['special', 'groups', String(i), 'items', String(j)] as any} value={it} rows={1} /></li>)}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-4">
            <img src={QR} alt="QR — stay-hospitality.com" className="h-24 w-24 rounded bg-white p-1" />
            <p className="text-sm" style={serif}>Scan to explore more stays<br />and <b>book direct</b> at stay-hospitality.com</p>
          </div>
          {footer}
        </Page>

        {/* 5 — Meet your host */}
        <Page>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <H><T path={['host', 'heading']} value={s.host?.heading} /></H>
            <StayLogo className="my-8" />
            <p className="max-w-md text-sm leading-7"><T path={['host', 'body']} value={s.host?.body} rows={6} /></p>
          </div>
          {footer}
        </Page>

        {/* 6 — House guidelines */}
        <Page>
          <H><T path={['guidelines', 'heading']} value={s.guidelines?.heading} /></H>
          <p className={'mt-3 text-[11px] tracking-[0.14em] leading-5 ' + accent}><T path={['guidelines', 'intro']} value={s.guidelines?.intro} rows={2} /></p>
          <div className="mt-5 flex-1 space-y-4">
            {(s.guidelines?.items || []).map((it: any, i: number) => (
              <div key={i}>
                <p className="text-[11px] font-bold tracking-[0.22em] uppercase"><T path={['guidelines', 'items', String(i), 'title'] as any} value={it.title} rows={1} /></p>
                <p className="mt-1 text-[12px] leading-5 opacity-80"><T path={['guidelines', 'items', String(i), 'body'] as any} value={it.body} rows={2} /></p>
              </div>
            ))}
          </div>
          <p className={'text-[10px] tracking-[0.2em] ' + accent}><T path={['guidelines', 'address']} value={s.guidelines?.address} rows={1} /></p>
          {footer}
        </Page>

        {/* 7 — Arrival & check-in */}
        <Page cover={photos[2]}>
          <H><T path={['arrival', 'heading']} value={s.arrival?.heading} /></H>
          <div className="mt-4 flex gap-10 text-sm">
            <p><span className={'text-[10px] tracking-[0.3em] block ' + accent}>CHECK-IN</span><b><T path={['arrival', 'checkIn']} value={s.arrival?.checkIn} rows={1} /></b></p>
            <p><span className={'text-[10px] tracking-[0.3em] block ' + accent}>CHECK-OUT</span><b><T path={['arrival', 'checkOut']} value={s.arrival?.checkOut} rows={1} /></b></p>
          </div>
          <div className="mt-5 space-y-4 text-[13px] leading-6">
            <div><p className="font-bold underline underline-offset-4">Entry</p><p className="mt-1"><T path={['arrival', 'entry']} value={s.arrival?.entry} rows={4} /></p></div>
            <div><p className="font-bold underline underline-offset-4">Parking</p><p className="mt-1"><T path={['arrival', 'parking']} value={s.arrival?.parking} rows={3} /></p></div>
          </div>
          {footer}
        </Page>

        {/* 8 — Contact */}
        <Page>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <H>Contact info</H>
            <div className="mt-10 grid grid-cols-2 gap-10 text-sm">
              <div><p className={'text-[10px] tracking-[0.3em] ' + accent}>CUSTOMER SERVICE</p><p className="mt-1 font-semibold"><T path={['contact', 'customerService']} value={s.contact?.customerService} rows={1} /></p></div>
              <div><p className={'text-[10px] tracking-[0.3em] ' + accent}>GENERAL MANAGER</p><p className="mt-1 font-semibold"><T path={['contact', 'gmName']} value={s.contact?.gmName} rows={1} /></p><p><T path={['contact', 'gmPhone']} value={s.contact?.gmPhone} rows={1} /></p></div>
            </div>
          </div>
          {footer}
        </Page>

        {/* 9 — House guide */}
        {(s.houseGuide?.items || []).length > 0 && (
          <Page>
            <p className={'text-[10px] tracking-[0.4em] ' + accent}>// HOUSE</p>
            <H>guide</H>
            <div className="mt-6 flex-1 space-y-6">
              {(s.houseGuide.items).map((it: any, i: number) => (
                <div key={i} className="flex gap-5">
                  <span className="text-lg opacity-50" style={serif}>{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <p className="text-[11px] font-bold tracking-[0.25em] uppercase"><T path={['houseGuide', 'items', String(i), 'title'] as any} value={it.title} rows={1} /></p>
                    <p className="mt-1 text-[12px] leading-5 opacity-80"><T path={['houseGuide', 'items', String(i), 'body'] as any} value={it.body} rows={2} /></p>
                  </div>
                </div>
              ))}
            </div>
            {footer}
          </Page>
        )}

        {/* 10 — Wi-Fi (always dark) */}
        <Page>
          <div className={'absolute inset-0 ' + (dark ? 'bg-black' : 'bg-neutral-900')} />
          <div className="relative flex h-full flex-col text-neutral-100">
            <p className="text-[10px] tracking-[0.4em] text-amber-200/80">// NETWORK</p>
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <h2 className="text-5xl" style={serif}>wi-fi<br />password</h2>
              <div className="mt-10 space-y-6 text-sm">
                <div><p className="text-[10px] tracking-[0.35em] text-amber-200/80">NETWORK NAME</p><p className="mt-1 text-xl font-semibold"><T path={['wifi', 'network']} value={s.wifi?.network} rows={1} /></p></div>
                <div><p className="text-[10px] tracking-[0.35em] text-amber-200/80">NETWORK PASSWORD</p><p className="mt-1 text-xl font-semibold"><T path={['wifi', 'password']} value={s.wifi?.password} rows={1} /></p></div>
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] tracking-widest text-neutral-400">
              <span>{s.contact?.customerService}</span><span>{s.contact?.email}</span>
            </div>
          </div>
        </Page>

        {/* 11 — Local places / restaurants */}
        {[(s.localPlaces?.items || []).length && { title: 'local places', tag: '// TO VISIT', key: 'localPlaces' },
          (s.restaurants?.items || []).length && { title: 'restaurants', tag: '// TOP PICKS', key: 'restaurants' }]
          .filter(Boolean).map((sec: any) => (
          <Page key={sec.key}>
            <p className={'text-[10px] tracking-[0.4em] ' + accent}>{sec.tag}</p>
            <H>{sec.title}</H>
            <div className="mt-8 grid flex-1 grid-cols-2 content-start gap-6">
              {(s[sec.key].items || []).map((p: any, i: number) => (
                <div key={i} className="border-l border-current/30 pl-4">
                  <p className="text-sm font-semibold tracking-wide uppercase"><T path={[sec.key, 'items', String(i), 'name'] as any} value={p.name} rows={1} /></p>
                </div>
              ))}
            </div>
            {footer}
          </Page>
        ))}

        {/* Add-ons */}
        {(s.addons?.items || []).length > 0 && (
          <Page>
            <H>Exclusive Add-On Services</H>
            <p className={'mt-3 text-[11px] tracking-[0.14em] leading-5 ' + accent}><T path={['addons', 'intro']} value={s.addons?.intro} rows={2} /></p>
            <div className="mt-6 grid flex-1 grid-cols-2 content-start gap-x-8 gap-y-4">
              {(s.addons.items).map((p: any, i: number) => (
                <div key={i} className="flex items-baseline gap-3">
                  <span className="text-sm opacity-50" style={serif}>{String(i + 1).padStart(2, '0')}</span>
                  <p className="text-[13px] font-semibold uppercase tracking-wide"><T path={['addons', 'items', String(i), 'name'] as any} value={p.name} rows={1} /></p>
                </div>
              ))}
            </div>
            {footer}
          </Page>
        )}

        {/* Before you go + review + thank you */}
        <Page cover={photos[3]}>
          <H>before you go</H>
          <ul className="mt-6 flex-1 space-y-4 text-[13px] leading-6">
            {(s.beforeYouGo?.items || []).map((it: string, i: number) => (
              <li key={i} className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current" /> <T path={['beforeYouGo', 'items', String(i)] as any} value={it} rows={2} /></li>
            ))}
          </ul>
          {footer}
        </Page>

        <Page>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className={'text-[10px] tracking-[0.4em] ' + accent}>// BEFORE YOU GO</p>
            <p className="mt-6 max-w-md text-sm leading-7" style={serif}><T path={['review', 'body']} value={s.review?.body} rows={5} /></p>
            <h2 className="mt-12 text-5xl" style={serif}>thank you</h2>
            <p className={'mt-2 text-[10px] tracking-[0.4em] ' + accent}>// FOR STAYING</p>
            <p className="mt-6 text-xs tracking-[0.25em]"><T path={['thankyou', 'line']} value={s.thankyou?.line} rows={1} /></p>
            <StayLogo className="mt-10 opacity-80" />
          </div>
          {footer}
        </Page>
      </div>
    </div>
  )
}
