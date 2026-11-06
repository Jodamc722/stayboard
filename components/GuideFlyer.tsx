'use client'
// THE ONE-PAGER (Jon, 2026-11-06: "a 1 page flyer option with Book now, Wi-Fi details, contact, QR code to
// rebook etc. — a printable option for properties if we do not want to do the full magazine" → "3 versions:
// guest digital view, magazine and 1-pager … magazine and 1-pager should not have clickable sections or
// tap things on it").
//
// One Letter sheet to frame or leave on the counter: the stay's photo with its name and UNIT, Wi-Fi in big
// type with a join-by-camera QR, check-in / check-out, the address, how to reach us, a QR to the live
// guide, the house rules and the check-out list in short, and a Book direct band with the code and a QR.
// Nothing on it is a link — it is paper. Colours follow the book's theme (or black & white from Print
// options). /g/<id>?flyer=1 shows it on screen; ?flyer=1&print=1 opens the print dialog.
import { useEffect } from 'react'
import { guideData, guideFaq, wifiQrSrc, qrSrc, LOGO_URL, sentence } from '@/components/GuideMobile'
import { themeForBook } from '@/lib/guide-themes'
import { printPrefs } from '@/lib/guide-print'

const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif"
const SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
const str = (v: any): string => (typeof v === 'string' ? v.trim() : (v && typeof v === 'object' && typeof v.body === 'string') ? v.body.trim() : '')
const short = (t: string, n: number) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1).replace(/[\s,;:.—-]+\S*$/, '') + '…' : x }

export function GuideFlyer({ gb, screen = false, autoPrint = false }: { gb: any; screen?: boolean; autoPrint?: boolean }) {
  const d = guideData(gb)
  const t = themeForBook(gb)
  const color = printPrefs(d.s).color
  const acc = color ? t.accent : '#111111'
  const deep = color ? t.cover : '#111111'
  const guideUrl = 'https://lighthouse-stay.vercel.app/g/' + String(gb?.id || '')
  const rules = d.rules.slice(0, 6)
  const outList = d.checkoutList.slice(0, 5)
  // Parking and the beach in a line each — the full answers (and maps) live in the guide and the magazine.
  const faq = guideFaq(gb).qa.filter(x => /park|beach/i.test(x.q)).map(x => ({ q: x.q, a: x.steps.steps.length ? [x.steps.intro, ...x.steps.steps.map((y, j) => (j + 1) + '. ' + y)].filter(Boolean).join(' ') : x.a }))
  useEffect(() => { if (autoPrint) { const x = setTimeout(() => window.print(), 900); return () => clearTimeout(x) } }, [autoPrint])

  return (
    <div className={'gf-wrap' + (screen ? ' gf-screen' : '')}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600&family=Inter:wght@400;500;600;700;800&display=swap" />
      <style>{`
        @page { size: letter; margin: 0.35in; }
        .gf { font-family: ${SANS}; color: #1a1a1a; width: 7.8in; height: 10.25in; overflow: hidden; display: flex; flex-direction: column; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .gf p { margin: 0; }
        .gf-screen { background: #e7e7e7; min-height: 100vh; padding: 28px 12px; }
        .gf-screen .gf { margin: 0 auto; padding: 0.35in; width: 8.5in; height: 11in; box-shadow: 0 2px 18px rgba(0,0,0,.14); box-sizing: border-box; }
        @media print { .gf-screen { background: #fff; padding: 0; min-height: 0; } .gf-screen .gf { box-shadow: none; padding: 0; width: 7.8in; height: 10.25in; } }
        .gf-k { font-size: 7.6pt; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; color: ${acc}; }
        .gf-box { border: 1.4pt solid ${acc}; border-radius: 9pt; padding: 9pt 11pt; }
        .gf-h { font-family: ${SERIF}; font-size: 13pt; font-weight: 600; margin: 0 0 4pt; padding-bottom: 2pt; border-bottom: 1.2pt solid ${acc}; }
        .gf-li { font-size: 8.8pt; line-height: 1.32; margin: 0 0 3.5pt; }
        .gf-li b { font-weight: 700; }
        .gf-check { display: inline-block; width: 8pt; height: 8pt; border: 1pt solid ${acc}; border-radius: 2pt; margin-right: 5pt; vertical-align: -1pt; }
      `}</style>
      <div className="gf">
        {/* PHOTO + NAME + UNIT */}
        <div style={{ position: 'relative', height: '2.55in', borderRadius: '10pt', overflow: 'hidden', background: deep }}>
          {d.cover ? <img src={d.cover} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,.15), rgba(0,0,0,0) 35%, rgba(0,0,0,.72))' }} />
          <img src={LOGO_URL} alt="" style={{ position: 'absolute', top: '11pt', left: '13pt', height: '15pt', filter: 'brightness(0) invert(1)' }} />
          <div style={{ position: 'absolute', left: '14pt', right: '14pt', bottom: '12pt', color: '#fff' }}>
            <p style={{ fontSize: '8pt', letterSpacing: '.3em' }}>WELCOME</p>
            <p style={{ fontFamily: SERIF, fontSize: '23pt', fontWeight: 600, lineHeight: 1.08 }}>{d.name}</p>
            {d.unit ? <p style={{ display: 'inline-block', marginTop: '5pt', background: '#fff', color: '#111', borderRadius: '5pt', padding: '2pt 9pt', fontSize: '13pt', fontWeight: 800 }}>{d.unit}</p> : null}
          </div>
        </div>

        {/* WI-FI + TIMES */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: '10pt', marginTop: '10pt' }}>
          <div className="gf-box" style={{ display: 'flex', gap: '10pt', alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="gf-k">Wi-Fi</p>
              <p style={{ fontSize: '17pt', fontWeight: 800, lineHeight: 1.15, wordBreak: 'break-word' }}>{d.wifiNet || 'Ask us'}</p>
              {d.wifiPw ? <><p className="gf-k" style={{ marginTop: '5pt' }}>Password</p><p style={{ fontSize: '17pt', fontWeight: 800, lineHeight: 1.15, wordBreak: 'break-all' }}>{d.wifiPw}</p></> : null}
            </div>
            {d.wifiNet ? <div style={{ textAlign: 'center' }}><img src={wifiQrSrc(d.wifiNet, d.wifiPw)} alt="" style={{ width: '72pt', height: '72pt' }} /><p style={{ fontSize: '6.8pt', color: '#555' }}>Scan to join</p></div> : null}
          </div>
          <div className="gf-box">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6pt' }}>
              <div><p className="gf-k">Check-in</p><p style={{ fontSize: '15pt', fontWeight: 700 }}>{d.checkIn || '—'}</p></div>
              <div><p className="gf-k">Check-out</p><p style={{ fontSize: '15pt', fontWeight: 700 }}>{d.checkOut || '—'}</p></div>
            </div>
            {d.address ? <p style={{ fontSize: '8.6pt', marginTop: '7pt', color: '#444' }}>{d.address}</p> : null}
          </div>
        </div>

        {/* CONTACT + LIVE GUIDE */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10pt', marginTop: '10pt', alignItems: 'center' }}>
          <div>
            <p style={{ fontSize: '11pt', fontWeight: 700 }}>Questions? Message us in your booking app.</p>
            <p style={{ fontSize: '9pt', color: '#444', marginTop: '2pt' }}>Airbnb, Vrbo, Booking.com or wherever you booked — we reply fast.{d.phone ? <> Urgent, 24/7: <b style={{ color: '#111' }}>{d.phone}</b>.</> : null} Emergency: <b style={{ color: '#111' }}>911</b>.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7pt' }}>
            <div style={{ textAlign: 'right' }}><p className="gf-k">Your full guide</p><p style={{ fontSize: '8pt', color: '#444', maxWidth: '1.3in' }}>Parking, how-tos, places to eat and more</p></div>
            <img src={qrSrc(guideUrl)} alt="" style={{ width: '62pt', height: '62pt' }} />
          </div>
        </div>

        {faq.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: faq.length > 1 ? '1fr 1fr' : '1fr', gap: '14pt', marginTop: '11pt' }}>
            {faq.map((x, i) => <div key={i}><p className="gf-h">{x.q.replace(/\?$/, '')}</p><p className="gf-li">{short(x.a, 420)}</p></div>)}
          </div>
        ) : null}

        {/* RULES + CHECK-OUT */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14pt', marginTop: '11pt', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <div>
            {rules.length ? <><p className="gf-h">House rules</p>{rules.map((r: any, i: number) => <p key={i} className="gf-li"><b>{sentence(r.title)}</b>{str(r.body) ? ' — ' + short(str(r.body), 90) : ''}</p>)}</> : null}
          </div>
          <div>
            <p className="gf-h">Check-out{d.checkOut ? ' · by ' + d.checkOut : ''}</p>
            {outList.length ? outList.map((x: string, i: number) => <p key={i} className="gf-li"><span className="gf-check" />{short(x, 95)}</p>) : <p className="gf-li">Please leave by {d.checkOut || 'the agreed time'} — thank you!</p>}
          </div>
        </div>

        {/* BOOK DIRECT */}
        <div style={{ marginTop: '10pt', borderRadius: '10pt', background: deep, color: '#fff', padding: '11pt 14pt', display: 'flex', alignItems: 'center', gap: '12pt' }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: '8pt', letterSpacing: '.25em', opacity: .8 }}>COME BACK SOON</p>
            <p style={{ fontFamily: SERIF, fontSize: '18pt', fontWeight: 600, lineHeight: 1.1 }}>Book direct next time &amp; save</p>
            <p style={{ fontSize: '9.5pt', marginTop: '3pt', opacity: .92 }}>{d.bookUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')} · code <b style={{ letterSpacing: '.08em' }}>{d.code}</b></p>
          </div>
          <div style={{ background: '#fff', padding: '4pt', borderRadius: '6pt' }}><img src={qrSrc(d.bookUrl)} alt="" style={{ width: '66pt', height: '66pt', display: 'block' }} /></div>
        </div>
      </div>
    </div>
  )
}
