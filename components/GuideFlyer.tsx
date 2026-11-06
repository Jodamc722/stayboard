'use client'
// THE ONE-PAGER (Jon, 2026-11-06: "a 1 page flyer option with Book now, Wi-Fi details, contact, QR code to
// rebook … 3 versions: guest digital view, magazine and 1-pager … magazine and 1-pager should not have
// clickable sections or tap things" → "enhance the 1 pager please. Needs to be beautiful").
//
// One Letter sheet, made to be framed or left on the counter. Editorial layout:
//   · a full-bleed photo with the stay's name in serif and the unit on a pill
//   · a Wi-Fi card that overlaps the photo — network and password large, join-by-camera QR
//   · a three-up strip: check-in · check-out · urgent line
//   · "Good to know" (parking, the walk to the beach — steps numbered) beside "House rules"
//   · "Before you leave" as a tick list
//   · a closing band: Book direct & save with the code, QR to book, QR to the full guide
// Paper only — nothing is a link. Colours follow the book's theme (or black & white from Print options).
// /g/<id>?flyer=1 shows it on screen; ?flyer=1&print=1 opens the print dialog.
import { useEffect } from 'react'
import { guideData, guideFaq, wifiQrSrc, qrSrc, LOGO_URL, sentence } from '@/components/GuideMobile'
import { themeForBook } from '@/lib/guide-themes'
import { printPrefs } from '@/lib/guide-print'

const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif"
const SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
const str = (v: any): string => (typeof v === 'string' ? v.trim() : (v && typeof v === 'object' && typeof v.body === 'string') ? v.body.trim() : '')
const short = (t: string, n: number) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1).replace(/[\s,;:.—-]+\S*$/, '') + '…' : x }
const firstSentence = (t: string) => (String(t || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)[0] || '')

export function GuideFlyer({ gb, screen = false, autoPrint = false }: { gb: any; screen?: boolean; autoPrint?: boolean }) {
  const d = guideData(gb)
  const t = themeForBook(gb)
  const color = printPrefs(d.s).color
  const acc = color ? t.accent : '#1a1a1a'
  const deep = color ? t.cover : '#151515'
  const tint = color ? t.tint : 'rgba(0,0,0,0.05)'
  const guideUrl = 'https://lighthouse-stay.vercel.app/g/' + String(gb?.id || '')
  const rules = d.rules.slice(0, 5)
  const outList = d.checkoutList.slice(0, 5)
  const gf = guideFaq(gb)
  const faq = gf.qa.filter(x => /park|beach/i.test(x.q)).slice(0, 2)
  const site = d.bookUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
  useEffect(() => { if (autoPrint) { const x = setTimeout(() => window.print(), 1100); return () => clearTimeout(x) } }, [autoPrint])

  const Label = ({ children }: { children: any }) => <p className="gf-k">{children}</p>

  return (
    <div className={'gf-wrap' + (screen ? ' gf-screen' : '')}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;1,500&family=Inter:wght@400;500;600;700&display=swap" />
      <style>{`
        @page { size: letter; margin: 0; }
        .gf { font-family: ${SANS}; color: #1c1c1c; width: 8.5in; height: 11in; overflow: hidden; position: relative; background: #fff; box-sizing: border-box; display: flex; flex-direction: column; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .gf * { box-sizing: border-box; }
        .gf p { margin: 0; }
        .gf-screen { background: #e9e7e3; min-height: 100vh; padding: 32px 12px; }
        .gf-screen .gf { margin: 0 auto; box-shadow: 0 6px 30px rgba(0,0,0,.16); }
        @media print { html, body { margin: 0 !important; background: #fff !important; } .gf-screen { background: #fff; padding: 0; min-height: 0; } .gf-screen .gf { box-shadow: none; margin: 0; } }
        .gf-k { font-size: 7.2pt; letter-spacing: .2em; text-transform: uppercase; font-weight: 600; color: ${acc}; }
        .gf-h { font-family: ${SERIF}; font-size: 14pt; font-weight: 500; letter-spacing: -.005em; color: #161616; margin: 0 0 7pt; display: flex; align-items: center; gap: 8pt; }
        .gf-h:after { content: ''; flex: 1; height: .8pt; background: ${acc}; opacity: .45; }
        .gf-t { font-size: 8.9pt; line-height: 1.45; color: #333; }
        .gf-t b { color: #161616; font-weight: 600; }
        .gf-ol { margin: 3pt 0 0; padding: 0; list-style: none; counter-reset: s; }
        .gf-ol li { counter-increment: s; position: relative; padding-left: 15pt; margin: 0 0 2.5pt; font-size: 8.6pt; line-height: 1.4; color: #333; }
        .gf-ol li:before { content: counter(s); position: absolute; left: 0; top: .5pt; width: 10.5pt; height: 10.5pt; border-radius: 50%; background: ${acc}; color: #fff; font-size: 6.6pt; font-weight: 700; display: flex; align-items: center; justify-content: center; }
        .gf-rule { padding: 0 0 3pt; margin: 0 0 3pt; border-bottom: .6pt solid #e6e3de; }
        .gf-rule:last-child { border-bottom: 0; margin-bottom: 0; padding-bottom: 0; }
        .gf-tick { display: flex; gap: 7pt; align-items: flex-start; margin: 0 0 3.5pt; font-size: 8.5pt; line-height: 1.4; color: #333; }
        .gf-tick i { flex: none; width: 9pt; height: 9pt; margin-top: 1.5pt; border: 1pt solid ${acc}; border-radius: 2.5pt; }
      `}</style>

      <div className="gf">
        {/* HERO */}
        <div style={{ position: 'relative', height: '3.25in', background: deep, flex: 'none' }}>
          {d.cover ? <img src={d.cover} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,.38) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 45%, rgba(0,0,0,.66) 100%)' }} />
          <img src={LOGO_URL} alt="" style={{ position: 'absolute', top: '.42in', left: '.55in', height: '16pt', filter: 'brightness(0) invert(1)', opacity: .95 }} />
          <div style={{ position: 'absolute', left: '.55in', right: '.55in', bottom: '.9in', color: '#fff' }}>
            <p style={{ fontSize: '8pt', letterSpacing: '.34em', fontWeight: 600, opacity: .9 }}>WELCOME TO</p>
            <p style={{ fontFamily: SERIF, fontSize: '34pt', fontWeight: 500, lineHeight: 1.02, marginTop: '4pt', letterSpacing: '-.01em', maxWidth: '6.2in' }}>{d.name}</p>
            {d.unit || d.address ? <div style={{ display: 'flex', alignItems: 'center', gap: '10pt', marginTop: '9pt', flexWrap: 'wrap' }}>
            {d.unit ? <p style={{ display: 'inline-block', border: '1pt solid rgba(255,255,255,.85)', borderRadius: '20pt', padding: '3pt 12pt', fontSize: '10.5pt', fontWeight: 600, letterSpacing: '.04em' }}>{d.unit}</p> : null}
            {d.address ? <p style={{ fontSize: '9pt', opacity: .9 }}>{d.address}</p> : null}
            </div> : null}
          </div>
        </div>

        {/* WI-FI CARD, overlapping the photo */}
        <div style={{ margin: '-.72in .55in 0', position: 'relative', background: '#fff', borderRadius: '12pt', boxShadow: '0 8pt 24pt rgba(0,0,0,.12)', border: '.6pt solid #ebe8e3', padding: '15pt 18pt', display: 'flex', alignItems: 'center', gap: '18pt', flex: 'none' }}>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: d.wifiPw ? '1fr 1fr' : '1fr', gap: '14pt' }}>
            <div><Label>Wi-Fi network</Label><p style={{ fontFamily: SERIF, fontSize: '19pt', fontWeight: 500, lineHeight: 1.15, marginTop: '3pt', wordBreak: 'break-word' }}>{d.wifiNet || 'Ask us'}</p></div>
            {d.wifiPw ? <div style={{ borderLeft: '.6pt solid #e6e3de', paddingLeft: '14pt' }}><Label>Password</Label><p style={{ fontFamily: SERIF, fontSize: '19pt', fontWeight: 500, lineHeight: 1.15, marginTop: '3pt', wordBreak: 'break-all' }}>{d.wifiPw}</p></div> : null}
          </div>
          {d.wifiNet ? <div style={{ textAlign: 'center', flex: 'none' }}><img src={wifiQrSrc(d.wifiNet, d.wifiPw)} alt="" style={{ width: '64pt', height: '64pt', display: 'block' }} /><p style={{ fontSize: '6.5pt', color: '#777', marginTop: '3pt', letterSpacing: '.08em' }}>SCAN TO JOIN</p></div> : null}
        </div>

        {/* TIMES + CONTACT */}
        <div style={{ margin: '14pt .55in 0', display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr', borderTop: '.6pt solid #e6e3de', borderBottom: '.6pt solid #e6e3de', flex: 'none' }}>
          <div style={{ padding: '9pt 0' }}><Label>Check-in</Label><p style={{ fontFamily: SERIF, fontSize: '17pt', marginTop: '2pt' }}>{d.checkIn || '—'}</p></div>
          <div style={{ padding: '9pt 0 9pt 14pt', borderLeft: '.6pt solid #e6e3de' }}><Label>Check-out</Label><p style={{ fontFamily: SERIF, fontSize: '17pt', marginTop: '2pt' }}>{d.checkOut || '—'}</p></div>
          <div style={{ padding: '9pt 0 9pt 14pt', borderLeft: '.6pt solid #e6e3de' }}>
            <Label>Questions</Label>
            <p className="gf-t" style={{ marginTop: '3pt' }}>Message us in your booking app — we reply fast.</p>
            <p className="gf-t">{d.phone ? <>Urgent, 24/7 <b>{d.phone}</b> · </> : null}Emergency <b>911</b></p>
          </div>
        </div>

        {/* BODY */}
        <div style={{ margin: '15pt .55in 0', display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '24pt', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <div style={{ minHeight: 0, overflow: 'hidden' }}>
            {faq.length ? (
              <div style={{ marginBottom: '12pt' }}>
                <p className="gf-h">Good to know</p>
                {faq.map((x, i) => (
                  <div key={i} style={{ marginBottom: '8pt' }}>
                    <p className="gf-t"><b>{x.q.replace(/\?$/, '')}</b></p>
                    {x.steps.steps.length
                      ? <>{x.steps.intro ? <p className="gf-t">{x.steps.intro}</p> : null}<ol className="gf-ol">{x.steps.steps.slice(0, 5).map((y, j) => <li key={j}>{short(y, 150)}</li>)}</ol></>
                      : <p className="gf-t">{short(x.a, 230)}</p>}
                  </div>
                ))}
              </div>
            ) : null}
            {gf.buildingQr ? (
              <div style={{ display: 'flex', gap: '16pt', marginTop: '4pt' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7pt' }}><img src={gf.buildingQr} alt="" style={{ width: '46pt', height: '46pt' }} /><p className="gf-k" style={{ lineHeight: 1.5 }}>Directions<br />to us</p></div>
                {gf.beachQr ? <div style={{ display: 'flex', alignItems: 'center', gap: '7pt' }}><img src={gf.beachQr} alt="" style={{ width: '46pt', height: '46pt' }} /><p className="gf-k" style={{ lineHeight: 1.5 }}>Map to<br />the beach</p></div> : null}
              </div>
            ) : null}
          </div>
          <div style={{ minHeight: 0, overflow: 'hidden' }}>
            {rules.length ? (
              <>
                <p className="gf-h">House rules</p>
                {rules.map((r: any, i: number) => <div key={i} className="gf-rule"><p className="gf-t"><b>{sentence(r.title)}</b>{str(r.body) ? ' — ' + short(firstSentence(str(r.body)) || str(r.body), 64) : ''}</p></div>)}
              </>
            ) : null}
            <p className="gf-h" style={{ marginTop: rules.length ? '12pt' : 0 }}>Before you leave</p>
            {outList.length ? outList.map((x: string, i: number) => <div key={i} className="gf-tick"><i /><span>{short(x, 74)}</span></div>) : <p className="gf-t">Please leave by {d.checkOut || 'the agreed time'} — thank you!</p>}
          </div>
        </div>

        {/* CLOSING BAND */}
        <div style={{ flex: 'none', marginTop: '12pt', background: tint, padding: '16pt .55in 18pt', display: 'flex', alignItems: 'center', gap: '18pt' }}>
          <div style={{ flex: 1 }}>
            <p className="gf-k">Come back soon</p>
            <p style={{ fontFamily: SERIF, fontSize: '21pt', fontWeight: 500, lineHeight: 1.08, marginTop: '4pt', color: '#161616' }}>Book direct next time <i style={{ fontWeight: 500 }}>&amp; save</i></p>
            <p className="gf-t" style={{ marginTop: '6pt' }}>{site} · use code <span style={{ display: 'inline-block', background: acc, color: '#fff', borderRadius: '4pt', padding: '1pt 7pt', fontWeight: 700, letterSpacing: '.1em', fontSize: '8.6pt' }}>{d.code}</span></p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ background: '#fff', padding: '5pt', borderRadius: '7pt' }}><img src={qrSrc(d.bookUrl)} alt="" style={{ width: '62pt', height: '62pt', display: 'block' }} /></div>
            <p style={{ fontSize: '6.5pt', letterSpacing: '.12em', color: '#555', marginTop: '3pt' }}>BOOK DIRECT</p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ background: '#fff', padding: '5pt', borderRadius: '7pt' }}><img src={qrSrc(guideUrl)} alt="" style={{ width: '62pt', height: '62pt', display: 'block' }} /></div>
            <p style={{ fontSize: '6.5pt', letterSpacing: '.12em', color: '#555', marginTop: '3pt' }}>YOUR FULL GUIDE</p>
          </div>
        </div>
      </div>
    </div>
  )
}
