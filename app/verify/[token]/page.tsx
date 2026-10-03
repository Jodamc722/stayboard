'use client'
// THE GUEST'S VERIFICATION PAGE — /verify/<token>. Phone-first: three taps. A photo of the ID
// (rear camera), a selfie (front camera), the name as it reads on the ID, one consent line, Submit.
// Images are scaled in the browser before upload so a 12 MB phone photo is a 400 KB JPEG.
import { useEffect, useState } from 'react'

type Load = { ok: boolean; guestFirst?: string; guestName?: string; unit?: string; checkIn?: string; checkOut?: string; status?: string; verifiedAt?: string | null; error?: string; expired?: boolean; locked?: boolean }
const SERIF = "'Playfair Display', Georgia, serif"
const SANS = "'Inter', -apple-system, sans-serif"
const LOGO = 'https://ugbtsppfsgkkrdyyuxxg.supabase.co/storage/v1/object/public/guidebook-assets/1783090958148-l1zr8u.png'

function fmtDate(iso?: string) { if (!iso) return ''; const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }
function compressImage(file: File, maxPx: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
      if (!w || !h) { reject(new Error('bad image')); return }
      const scale = Math.min(1, maxPx / Math.max(w, h)); w = Math.round(w * scale); h = Math.round(h * scale)
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const ctx = c.getContext('2d'); if (!ctx) { reject(new Error('no canvas')); return }
      ctx.drawImage(img, 0, 0, w, h); resolve(c.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load failed')) }
    img.src = url
  })
}

export default function GuestVerifyPage({ params }: { params: { token: string } }) {
  const token = String(params.token || '')
  const [load, setLoad] = useState<Load | null>(null)
  const [name, setName] = useState('')
  const [idPhoto, setIdPhoto] = useState('')
  const [selfie, setSelfie] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/public/guest-verify?token=' + encodeURIComponent(token), { cache: 'no-store' }).then(r => r.json()).then((j: Load) => { setLoad(j); if (j.guestName) setName(j.guestName) }).catch(() => setLoad({ ok: false, error: 'Could not load this link.' }))
  }, [token])

  const pick = async (f: File | undefined, which: 'id' | 'selfie') => {
    if (!f) return
    setErr('')
    try { const d = await compressImage(f, which === 'id' ? 1800 : 1200, 0.82); if (which === 'id') setIdPhoto(d); else setSelfie(d) } catch { setErr('That photo could not be read — try again.') }
  }
  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/public/guest-verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, name: name.trim(), idPhoto, selfie, agree }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not submit — please try again.')
      setDone(j.verifiedAt || new Date().toISOString())
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  const c = { paper: '#fbf9f5', card: '#fff', ink: '#1f1d1a', mute: 'rgba(31,29,26,0.6)', accent: '#8a7350', tint: 'rgba(138,115,80,0.08)', line: 'rgba(138,115,80,0.2)' }
  const Shell = ({ children }: { children: any }) => (
    <div style={{ minHeight: '100vh', background: c.paper, color: c.ink, fontFamily: SANS }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500&family=Inter:wght@400;500;600&display=swap" />
      <div className="mx-auto max-w-md px-4 pb-10" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 20px)' }}>
        <img src={LOGO} alt="Stay Hospitality" className="h-7 w-auto" />
        {children}
      </div>
    </div>
  )
  const Tile = ({ label, hint, value, onPick, capture }: { label: string; hint: string; value: string; onPick: (f?: File) => void; capture: 'environment' | 'user' }) => (
    <label className="block rounded-2xl overflow-hidden active:opacity-90" style={{ background: c.card, border: '1px solid ' + c.line }}>
      <input type="file" accept="image/*" capture={capture} className="hidden" onChange={e => { onPick(e.target.files?.[0]); e.target.value = '' }} />
      {value ? <img src={value} alt="" className="h-48 w-full object-cover" /> : (
        <div className="flex h-36 flex-col items-center justify-center gap-1" style={{ background: c.tint }}>
          <span className="text-[28px]">{capture === 'user' ? '🤳' : '🪪'}</span>
          <span className="text-[14px] font-semibold">{label}</span>
          <span className="text-[12px]" style={{ color: c.mute }}>{hint}</span>
        </div>
      )}
      {value ? <div className="px-3 py-2 text-[12.5px] font-semibold" style={{ color: c.accent }}>✓ {label} — tap to retake</div> : null}
    </label>
  )

  if (!load) return <Shell><p className="mt-10 text-center text-[14px]" style={{ color: c.mute }}>Loading…</p></Shell>
  if (!load.ok) return <Shell><div className="mt-8 rounded-2xl p-5" style={{ background: c.card, border: '1px solid ' + c.line }}><p className="text-[18px] font-medium" style={{ fontFamily: SERIF }}>{load.expired ? 'This link has expired' : 'This link is not valid'}</p><p className="mt-2 text-[14px]" style={{ color: c.mute }}>{load.error || 'Please message us and we will send a fresh one.'}</p></div></Shell>
  if (done || load.status === 'verified') return (
    <Shell>
      <div className="mt-8 rounded-2xl p-6 text-center" style={{ background: c.card, border: '1px solid ' + c.line }}>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full text-[26px]" style={{ background: '#e7f3ec', color: '#1f7a4d' }}>✓</div>
        <p className="mt-4 text-[24px] font-medium leading-tight" style={{ fontFamily: SERIF }}>You're verified{load.guestFirst ? ', ' + load.guestFirst : ''}</p>
        <p className="mt-2 text-[14px]" style={{ color: c.mute }}>Thank you — nothing else to do. We'll see you {fmtDate(load.checkIn)} at {load.unit}.</p>
      </div>
    </Shell>
  )
  return (
    <Shell>
      <p className="mt-6 text-[10px] tracking-[0.4em] uppercase" style={{ color: c.accent }}>Before your stay</p>
      <h1 className="mt-1 text-[30px] leading-[1.05] font-medium" style={{ fontFamily: SERIF }}>Quick ID check{load.guestFirst ? ', ' + load.guestFirst : ''}</h1>
      <p className="mt-2 text-[14px] leading-[1.6]" style={{ color: c.mute }}>{load.unit} · {fmtDate(load.checkIn)} – {fmtDate(load.checkOut)}. Two photos and you're done — it takes under a minute and keeps every guest in the building safe.</p>
      <div className="mt-5 space-y-3">
        <Tile label="Photo of your ID" hint="Driver's license or passport, all four corners" value={idPhoto} onPick={f => pick(f, 'id')} capture="environment" />
        <Tile label="A selfie" hint="Just your face, good light" value={selfie} onPick={f => pick(f, 'selfie')} capture="user" />
        <div className="rounded-2xl p-4" style={{ background: c.card, border: '1px solid ' + c.line }}>
          <label className="text-[12px] font-semibold" style={{ color: c.accent }}>Name as it reads on the ID</label>
          <input value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full rounded-xl px-3 py-3 text-[16px] outline-none" style={{ background: c.tint, color: c.ink }} autoComplete="name" />
          <label className="mt-4 flex items-start gap-3 text-[13px] leading-[1.5]" style={{ color: c.mute }}>
            <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />
            <span>I confirm this is my own ID, and I agree that Stay Hospitality keeps these photos for this reservation only, under its privacy policy.</span>
          </label>
        </div>
        {err ? <p className="rounded-xl px-3 py-2 text-[13px] font-semibold" style={{ background: '#fdecec', color: '#b42318' }}>{err}</p> : null}
        <button type="button" disabled={busy || !idPhoto || !selfie || !name.trim() || !agree} onClick={submit}
          className="w-full rounded-2xl py-4 text-[16px] font-semibold text-white disabled:opacity-40" style={{ background: c.accent }}>
          {busy ? 'Sending…' : 'Submit'}
        </button>
        <p className="text-center text-[11.5px]" style={{ color: c.mute }}>Photos are stored privately and viewed only by our front desk.</p>
      </div>
    </Shell>
  )
}
