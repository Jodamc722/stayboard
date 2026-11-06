'use client'
// THE ONE-PAGER (Jon, 2026-11-06: "a 1 page flyer option with Book now, Wi-Fi details, contact, QR code to
// rebook … 3 versions: guest digital view, magazine and 1-pager" → "needs to be beautiful" → "make this much,
// much nicer").
//
// Designed like a hotel's in-room welcome card, not a manual: few words, lots of air, one typeface pair.
//   · the stay's photo, clean, edge to edge — no text over it
//   · WELCOME TO / the name in serif / unit · address in small caps, centred, with a short accent rule
//   · Wi-Fi as the hero line (network | password | scan to join)
//   · check-in · check-out · the urgent line
//   · three quiet notes with line icons: parking, the beach, house rules (titles only)
//   · a tinted closing band: Book direct & save with the code, QR to book, QR to the full digital guide
// Everything long (the beach steps, the check-out list, how-tos) lives in the digital guide — the QR says so.
// Paper only: nothing is a link. Colours follow the book's theme, or black & white from Print options.
// /g/<id>?flyer=1 shows it on screen; ?flyer=1&print=1 opens the print dialog.
import { useEffect } from 'react'
import { Car, Waves, ScrollText } from 'lucide-react'
import { guideData, guideFaq, wifiQrSrc, qrSrc, LOGO_URL, sentence } from '@/components/GuideMobile'
import { themeForBook } from '@/lib/guide-themes'
import { printPrefs } from '@/lib/guide-print'

const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif"
const SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
const clean = (t: string) => String(t || '').replace(/\s+/g, ' ').trim()
const firstSentence = (t: string) => (clean(t).split(/(?<=[.!?])\s+/)[0] || '')
const short = (t: string, n: number) => { const x = clean(t); return x.length > n ? x.slice(0, n - 1).replace(/[\s,;:.—-]+\S*$/, '') + '…' : x }

export function GuideFlyer({ gb, screen = false, autoPrint = false }: { gb: any; screen?: boolean; autoPrint?: boolean }) {
  const d = guideData(gb)
  const t = themeForBook(gb)
  const color = printPrefs(d.s).color
  const acc = color ? t.accent : '#222222'
  const ink = '#1d1d1b'
  const mute = '#6b6a66'
  const hair = '#e4e1da'
  const band = color ? t.tint : 'rgba(0,0,0,0.045)'
  const guideUrl = 'https://lighthouse-stay.vercel.app/g/' + String(gb?.id || '')
  const site = d.bookUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const gf = guideFaq(gb)
  const parkQ = gf.qa.find(x => /park/i.test(x.q))
  const beachQ = gf.qa.find(x => /beach/i.test(x.q))
  const parking = parkQ ? short(firstSentence(parkQ.a), 120) : ''
  const beach = beachQ ? short(beachQ.steps.steps.length ? (beachQ.steps.intro || 'A short walk from your door.') : firstSentence(beachQ.a), 90) : ''
  const rules = d.rules.slice(0, 6).map((r: any) => sentence(String(r.title || '')).replace(/\.$/, '')).filter(Boolean)
  const meta = [d.unit, d.address].filter(Boolean)
  useEffect(() => { if (autoPrint) { const x = setTimeout(() => window.print(), 1100); return () => clearTimeout(x) } }, [autoPrint])

  const notes = [
    parking ? { Icon: Car, title: 'Parking', body: parking, qr: '' } : null,
    beach ? { Icon: Waves, title: 'The beach', body: beach + ' The route and map are in your digital guide.', qr: '' } : null,
    rules.length ? { Icon: ScrollText, title: 'House rules', body: rules.join(' · '), qr: '' } : null,
  ].filter(Boolean) as { Icon: any; title: string; body: string; qr: string }[]

  return (
    <div className={'gf-wrap' + (screen ? ' gf-screen' : '')}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500;600&display=swap" />
      <style>{`
        @page { size: letter; margin: 0; }
        .gf { font-family: ${SANS}; color: ${ink}; width: 8.5in; height: 11in; overflow: hidden; position: relative; background: #fff; display: flex; flex-direction: column; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .gf * { box-sizing: border-box; }
        .gf p { margin: 0; }
        .gf-screen { background: #ebe9e4; min-height: 100vh; padding: 36px 12px; }
        .gf-screen .gf { margin: 0 auto; box-shadow: 0 10px 40px rgba(0,0,0,.14); }
        @media print { html, body { margin: 0 !important; background: #fff !important; } .gf-screen { background: #fff; padding: 0; min-height: 0; } .gf-screen .gf { box-shadow: none; margin: 0; } }
        .gf-cap { font-size: 6.9pt; letter-spacing: .26em; text-transform: uppercase; font-weight: 500; color: ${mute}; }
        .gf-val { font-family: ${SERIF}; font-weight: 400; color: ${ink}; line-height: 1.1; }
        .gf-note { font-size: 8.6pt; line-height: 1.55; color: #45443f; font-weight: 400; }
      `}</style>

      <div className="gf">
        {/* PHOTO */}
        <div style={{ position: 'relative', height: '3.6in', flex: 'none', background: color ? t.cover : '#222' }}>
          {d.cover ? <img src={d.cover} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,.28) 0%, rgba(0,0,0,0) 22%)' }} />
          <img src={LOGO_URL} alt="" style={{ position: 'absolute', top: '.4in', left: '50%', transform: 'translateX(-50%)', height: '15pt', filter: 'brightness(0) invert(1)' }} />
          {/* THE DIGITAL GUIDE, at the top (Jon, 2026-11-06: "the route should be the digital guidebook — do it at
              the top"): parking map, the walk to the beach, how-tos, places — all one scan away. */}
          <div style={{ position: 'absolute', right: '.45in', bottom: '.35in', background: '#fff', borderRadius: '8pt', padding: '7pt 7pt 6pt', boxShadow: '0 4pt 16pt rgba(0,0,0,.14)', textAlign: 'center', width: '1.18in' }}>
            <img src={qrSrc(guideUrl)} alt="" style={{ width: '68pt', height: '68pt', display: 'block', margin: '0 auto' }} />
            <p className="gf-cap" style={{ fontSize: '5.9pt', marginTop: '4pt', letterSpacing: '.16em', color: acc }}>Your digital guide</p>
            <p style={{ fontSize: '6.2pt', color: mute, lineHeight: 1.35, marginTop: '1pt' }}>Parking map, beach route &amp; more</p>
          </div>
        </div>

        {/* TITLE */}
        <div style={{ textAlign: 'center', padding: '.3in .8in 0', flex: 'none' }}>
          <p className="gf-cap" style={{ color: acc, letterSpacing: '.38em' }}>Welcome to</p>
          <p className="gf-val" style={{ fontSize: '31pt', marginTop: '7pt', letterSpacing: '-.01em' }}>{d.name}</p>
          {meta.length ? <p className="gf-cap" style={{ marginTop: '9pt', letterSpacing: '.18em' }}>{meta.join('   ·   ')}</p> : null}
          <div style={{ width: '34pt', height: '1pt', background: acc, margin: '14pt auto 0' }} />
        </div>

        {/* WI-FI */}
        <div style={{ margin: '.24in .8in 0', borderTop: '.6pt solid ' + hair, borderBottom: '.6pt solid ' + hair, padding: '11pt 0', display: 'grid', gridTemplateColumns: d.wifiPw ? '1fr .6pt 1fr auto' : '1fr auto', alignItems: 'center', columnGap: '20pt', flex: 'none' }}>
          <div style={{ textAlign: 'center' }}><p className="gf-cap">Wi-Fi network</p><p className="gf-val" style={{ fontSize: '17pt', marginTop: '5pt', wordBreak: 'break-word' }}>{d.wifiNet || 'Ask us'}</p></div>
          {d.wifiPw ? <div style={{ height: '34pt', background: hair }} /> : null}
          {d.wifiPw ? <div style={{ textAlign: 'center' }}><p className="gf-cap">Password</p><p className="gf-val" style={{ fontSize: '17pt', marginTop: '5pt', wordBreak: 'break-all' }}>{d.wifiPw}</p></div> : null}
          {d.wifiNet ? <div style={{ textAlign: 'center' }}><img src={wifiQrSrc(d.wifiNet, d.wifiPw)} alt="" style={{ width: '50pt', height: '50pt', display: 'block' }} /><p className="gf-cap" style={{ fontSize: '5.6pt', marginTop: '3pt', letterSpacing: '.18em' }}>Scan to join</p></div> : null}
        </div>

        {/* TIMES */}
        <div style={{ margin: '14pt .8in 0', display: 'grid', gridTemplateColumns: d.phone ? '1fr 1fr 1fr' : '1fr 1fr', textAlign: 'center', flex: 'none' }}>
          <div><p className="gf-cap">Check-in</p><p className="gf-val" style={{ fontSize: '15pt', marginTop: '4pt' }}>{d.checkIn || '—'}</p></div>
          <div style={{ borderLeft: '.6pt solid ' + hair }}><p className="gf-cap">Check-out</p><p className="gf-val" style={{ fontSize: '15pt', marginTop: '4pt' }}>{d.checkOut || '—'}</p></div>
          {d.phone ? <div style={{ borderLeft: '.6pt solid ' + hair }}><p className="gf-cap">Urgent · 24/7</p><p className="gf-val" style={{ fontSize: '15pt', marginTop: '4pt' }}>{d.phone}</p></div> : null}
        </div>
        <p className="gf-note" style={{ textAlign: 'center', margin: '10pt .8in 0', color: mute, flex: 'none' }}>Anything else? Message us in your booking app — we reply fast. In an emergency, dial 911.</p>

        {/* NOTES */}
        <div style={{ margin: '.24in .8in 0', display: 'grid', gridTemplateColumns: 'repeat(' + Math.max(1, notes.length) + ', 1fr)', columnGap: '22pt', flex: 'none' }}>
          {notes.map((n, i) => (
            <div key={i} style={{ textAlign: 'center' }}>
              <div style={{ width: '26pt', height: '26pt', borderRadius: '50%', border: '.8pt solid ' + acc, color: acc, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}><n.Icon size={13} strokeWidth={1.6} /></div>
              <p className="gf-val" style={{ fontSize: '12.5pt', marginTop: '8pt' }}>{n.title}</p>
              <p className="gf-note" style={{ marginTop: '4pt' }}>{n.body}</p>
              {n.qr ? <div style={{ marginTop: '7pt' }}><img src={n.qr} alt="" style={{ width: '40pt', height: '40pt', display: 'block', margin: '0 auto 2pt' }} /><p className="gf-cap" style={{ fontSize: '5.6pt', letterSpacing: '.18em' }}>Scan for the route</p></div> : null}
            </div>
          ))}
        </div>

        <div style={{ flex: 1, minHeight: '.2in' }} />
        {/* CLOSING BAND */}
        <div style={{ flex: 'none', background: band, padding: '.26in .8in .3in', display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', columnGap: '22pt' }}>
          <div>
            <p className="gf-cap" style={{ color: acc, letterSpacing: '.32em' }}>Come back soon</p>
            <p className="gf-val" style={{ fontSize: '20pt', marginTop: '5pt' }}>Book direct <i>&amp; save</i></p>
            <p className="gf-note" style={{ marginTop: '5pt', color: mute }}>{site}  ·  code <span style={{ color: ink, fontWeight: 600, letterSpacing: '.12em' }}>{d.code}</span></p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ background: '#fff', padding: '5pt', borderRadius: '4pt' }}><img src={qrSrc(d.bookUrl)} alt="" style={{ width: '52pt', height: '52pt', display: 'block' }} /></div>
            <p className="gf-cap" style={{ fontSize: '5.8pt', marginTop: '4pt', letterSpacing: '.18em' }}>Book direct</p>
          </div>
        </div>
      </div>
    </div>
  )
}
