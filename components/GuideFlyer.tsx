'use client'
// THE ONE-PAGER (Jon, 2026-11-06: "a 1 page flyer option with Book now, Wi-Fi details, contact, QR code to
// rebook … 3 versions: guest digital view, magazine and 1-pager" → "needs to be beautiful" → "make this much,
// much nicer").
//
// Designed like a hotel's in-room welcome card, not a manual: few words, lots of air, one typeface pair.
//   · the stay's photo, clean, edge to edge — no text over it
//   · WELCOME TO / the name in serif / unit · address in small caps, centred, with a short accent rule
//   · Wi-Fi as the hero line (network | password)
//   · check-in · check-out · the urgent line
//   · a short welcome message, signed (editable: labels flyer.welcome / flyer.signoff)
//   · exactly two QR codes, side by side: Your digital guide · Book direct & save (the goal of the page)
// Everything long (the beach steps, the check-out list, how-tos) lives in the digital guide — the QR says so.
// Paper only: nothing is a link. Colours follow the book's theme, or black & white from Print options.
// /g/<id>?flyer=1 shows it on screen; ?flyer=1&print=1 opens the print dialog.
import { useEffect } from 'react'
import { guideData, qrSrc, LOGO_URL } from '@/components/GuideMobile'
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
  const meta = [d.unit, d.address].filter(Boolean)
  useEffect(() => { if (autoPrint) { const x = setTimeout(() => window.print(), 1100); return () => clearTimeout(x) } }, [autoPrint])

  // THE WELCOME (Jon, 2026-11-06: "have a welcome message and get rid of the parking, the beach etc.").
  // Editable per book in the editor's labels (flyer.welcome / flyer.signoff). Surfside speaks as Vanessa &
  // Taylor, never Stay Hospitality.
  const lab = (k: string) => { const v = (d.s._labels || {})[k]; return typeof v === 'string' && v.trim() ? v.trim() : '' }
  const surfside = /surfside|boynton/i.test([gb?._unit, gb?._building, gb?._nickname, gb?.listing_name, gb?.title, d.address].join(' '))
  const welcome = lab('flyer.welcome') || "We're so glad you're here. Everything for your stay — the parking map, the walk to the beach, how things work and the places we love nearby — is in your digital guide below. If anything at all comes up, message us any time and we'll take care of it. Enjoy every minute."
  const signoff = lab('flyer.signoff') || (surfside ? 'Vanessa & Taylor' : 'Your hosts at Stay Hospitality')

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
        <div style={{ position: 'relative', height: '3.25in', flex: 'none', background: color ? t.cover : '#222' }}>
          {d.cover ? <img src={d.cover} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,.28) 0%, rgba(0,0,0,0) 22%)' }} />
          <img src={LOGO_URL} alt="" style={{ position: 'absolute', top: '.4in', left: '50%', transform: 'translateX(-50%)', height: '15pt', filter: 'brightness(0) invert(1)' }} />
        </div>

        {/* TITLE */}
        <div style={{ textAlign: 'center', padding: '.3in .8in 0', flex: 'none' }}>
          <p className="gf-cap" style={{ color: acc, letterSpacing: '.38em' }}>Welcome to</p>
          <p className="gf-val" style={{ fontSize: '31pt', marginTop: '7pt', letterSpacing: '-.01em' }}>{d.name}</p>
          {meta.length ? <p className="gf-cap" style={{ marginTop: '9pt', letterSpacing: '.18em' }}>{meta.join('   ·   ')}</p> : null}
          <div style={{ width: '34pt', height: '1pt', background: acc, margin: '14pt auto 0' }} />
          <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: '11.5pt', lineHeight: 1.6, color: '#3a3936', maxWidth: '5.6in', margin: '14pt auto 0' }}>{welcome}</p>
          <p className="gf-cap" style={{ marginTop: '9pt', letterSpacing: '.22em', color: acc }}>— {signoff}</p>
        </div>

        {/* WI-FI */}
        <div style={{ margin: '.24in .8in 0', borderTop: '.6pt solid ' + hair, borderBottom: '.6pt solid ' + hair, padding: '11pt 0', display: 'grid', gridTemplateColumns: d.wifiPw ? '1fr .6pt 1fr' : '1fr', alignItems: 'center', columnGap: '20pt', flex: 'none' }}>
          <div style={{ textAlign: 'center' }}><p className="gf-cap">Wi-Fi network</p><p className="gf-val" style={{ fontSize: '17pt', marginTop: '5pt', wordBreak: 'break-word' }}>{d.wifiNet || 'Ask us'}</p></div>
          {d.wifiPw ? <div style={{ height: '34pt', background: hair }} /> : null}
          {d.wifiPw ? <div style={{ textAlign: 'center' }}><p className="gf-cap">Password</p><p className="gf-val" style={{ fontSize: '17pt', marginTop: '5pt', wordBreak: 'break-all' }}>{d.wifiPw}</p></div> : null}
        </div>

        {/* TIMES */}
        <div style={{ margin: '14pt .8in 0', display: 'grid', gridTemplateColumns: d.phone ? '1fr 1fr 1fr' : '1fr 1fr', textAlign: 'center', flex: 'none' }}>
          <div><p className="gf-cap">Check-in</p><p className="gf-val" style={{ fontSize: '15pt', marginTop: '4pt' }}>{d.checkIn || '—'}</p></div>
          <div style={{ borderLeft: '.6pt solid ' + hair }}><p className="gf-cap">Check-out</p><p className="gf-val" style={{ fontSize: '15pt', marginTop: '4pt' }}>{d.checkOut || '—'}</p></div>
          {d.phone ? <div style={{ borderLeft: '.6pt solid ' + hair }}><p className="gf-cap">Urgent · 24/7</p><p className="gf-val" style={{ fontSize: '15pt', marginTop: '4pt' }}>{d.phone}</p></div> : null}
        </div>
        <p className="gf-note" style={{ textAlign: 'center', margin: '10pt .8in 0', color: mute, flex: 'none' }}>Anything else? Message us in your booking app — we reply fast. In an emergency, dial 911.</p>

        {/* TWO THINGS TO SCAN (Jon, 2026-11-06: "too many QR codes — have book now and guidebook … the goal is
            to get them to the digital guidebook and to our direct site"). The only two codes on the page. */}
        <div style={{ margin: '.24in .8in 0', display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '16pt', flex: 'none' }}>
          {[
            { k: 'Your digital guide', h: 'Everything for your stay', b: 'Parking map, the walk to the beach, how things work and our local picks.', url: guideUrl, foot: '' },
            { k: 'Come back soon', h: 'Book direct & save', b: 'Your next stay, straight from us — better rates, no booking fees.', url: d.bookUrl, foot: site },
          ].map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '13pt', padding: '13pt 14pt', borderRadius: '10pt', background: i ? band : '#fff', border: '.7pt solid ' + (i ? 'transparent' : hair) }}>
              <div style={{ background: '#fff', padding: '4pt', borderRadius: '6pt', flex: 'none' }}><img src={qrSrc(c.url)} alt="" style={{ width: '70pt', height: '70pt', display: 'block' }} /></div>
              <div style={{ minWidth: 0 }}>
                <p className="gf-cap" style={{ color: acc, letterSpacing: '.24em' }}>{c.k}</p>
                <p className="gf-val" style={{ fontSize: '14.5pt', marginTop: '4pt' }}>{c.h}</p>
                <p className="gf-note" style={{ marginTop: '3pt', fontSize: '8pt', lineHeight: 1.45 }}>{c.b}</p>
                {c.foot ? <p className="gf-note" style={{ marginTop: '3pt', fontSize: '7.6pt', color: ink, fontWeight: 600, letterSpacing: '.04em' }}>{c.foot}</p> : <p className="gf-cap" style={{ marginTop: '4pt', fontSize: '6pt' }}>Scan with your camera</p>}
              </div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1, minHeight: '.15in' }} />
        <div style={{ flex: 'none', borderTop: '.6pt solid ' + hair, margin: '0 .8in', padding: '10pt 0 .32in', textAlign: 'center' }}>
          <p className="gf-cap" style={{ letterSpacing: '.22em' }}>Thank you for staying with us</p>
        </div>
      </div>
    </div>
  )
}
