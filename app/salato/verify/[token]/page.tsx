'use client'
import { useEffect, useRef, useState, useCallback } from 'react'

type Rule = { id: string; title: string; body: string }
type Load = {
  ok: boolean; guestName?: string; guestFirst?: string; unit?: string; checkIn?: string; checkOut?: string
  nights?: number; guests?: number | null; confirmationCode?: string
  rules?: Rule[]; rulesVersion?: number; status?: string; verifiedAt?: string; error?: string
}

function fmtDate(iso?: string) { if (!iso) return ''; const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }

// Scale an image File down to <= maxPx on its long edge and return a JPEG data URL.
function compressImage(file: File, maxPx: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
      if (!w || !h) { reject(new Error('bad image')); return }
      const scale = Math.min(1, maxPx / Math.max(w, h))
      w = Math.round(w * scale); h = Math.round(h * scale)
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const ctx = c.getContext('2d'); if (!ctx) { reject(new Error('no canvas')); return }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(c.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load failed')) }
    img.src = url
  })
}

// Guest initials from their name, e.g. "Jane Miller" -> "JM". Used to auto-fill the per-rule boxes so
// the guest never has to type "JM" a dozen times.
function deriveInitials(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return ''
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

// Shell + Detail MUST live at module scope. Defining them inside SalatoVerify (as before) gave them a
// brand-new function identity on every render, so each keystroke made React remount the entire tree —
// which blurred whatever input the guest was typing in ("it kicks me out of the box"). Hoisting fixes it.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900">
      <div className="max-w-xl mx-auto px-4 py-6">
        <div className="rounded-2xl bg-gradient-to-br from-neutral-900 via-neutral-900 to-neutral-800 shadow-lg overflow-hidden mb-4">
          <div className="p-5">
            <div className="text-[10px] uppercase tracking-[0.2em] text-amber-300 font-semibold">Stay Hospitality</div>
            <h1 className="text-2xl font-bold text-white mt-1 tracking-tight">Salato check-in</h1>
            <p className="text-xs text-neutral-400 mt-1.5">Guest verification</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 border-b border-neutral-100 last:border-0">
      <span className="text-neutral-500 text-sm">{label}</span><span className="text-sm font-medium text-right">{value}</span>
    </div>
  )
}

export default function SalatoVerify({ params }: { params: { token: string } }) {
  const rid = params.token
  const [data, setData] = useState<Load | null>(null)
  const [fullName, setFullName] = useState('')
  const [ruleInitials, setRuleInitials] = useState<Record<string, string>>({})
  const [sig, setSig] = useState('')
  const [idPhoto, setIdPhoto] = useState('')
  const [selfie, setSelfie] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    fetch('/api/public/salato-verify?rid=' + encodeURIComponent(rid), { cache: 'no-store' })
      .then(r => r.json()).then((j: Load) => { setData(j); if (j && j.guestName) setFullName(j.guestName) })
      .catch(() => setData({ ok: false, error: 'Could not load. Check your connection.' }))
  }, [rid])

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/public/salato-verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rid, fullName: fullName.trim(), ruleInitials, signature: sig, idPhoto, selfie }),
      })
      const j = await res.json()
      if (!res.ok || j.ok === false) { setErr(j.error || 'Something went wrong. Please try again.'); setBusy(false); return }
      setDone(true)
    } catch { setErr('Network error — please try again.'); setBusy(false) }
  }

  if (!data) return <Shell><div className="text-neutral-400 text-sm py-10 text-center">Loading…</div></Shell>
  if (!data.ok) return <Shell><div className="rounded-2xl border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-6 text-center">{data.error || 'This link is not valid.'}</div></Shell>

  if (done || data.status === 'verified') return (
    <Shell>
      <div className="rounded-2xl border border-emerald-200 bg-white shadow-sm px-5 py-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-2xl mb-3">✓</div>
        <div className="text-lg font-bold">You're all set{data.guestFirst ? ', ' + data.guestFirst : ''}.</div>
        <p className="text-sm text-neutral-500 mt-2">Verification complete. Please see the front desk if you need anything. Enjoy your stay!</p>
      </div>
    </Shell>
  )

  const rules = data.rules || []
  const defaultInitials = deriveInitials(fullName || data.guestName || '')
  const initialedCount = rules.filter(r => !!(ruleInitials[r.id] || '').trim()).length
  const allInitialed = rules.length > 0 && initialedCount === rules.length
  const canSubmit = !!fullName.trim() && allInitialed && !!sig && !!idPhoto && !!selfie && !busy
  const card = 'rounded-2xl border border-neutral-200 bg-white shadow-sm p-5 mb-4'
  const primaryBtn = 'w-full rounded-xl bg-neutral-900 text-white font-semibold py-3.5 hover:bg-neutral-800 transition-colors disabled:opacity-40'

  return (
    <Shell>
      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{err}</div>}

      {/* Auto-filled reservation details */}
      <div className={card}>
        <div className="text-base font-bold mb-2">Welcome{data.guestFirst ? ', ' + data.guestFirst : ''} 👋</div>
        <Detail label="Name" value={data.guestName || '—'} />
        <Detail label="Unit" value={data.unit || '—'} />
        <Detail label="Check-in" value={fmtDate(data.checkIn)} />
        <Detail label="Check-out" value={fmtDate(data.checkOut)} />
        {typeof data.nights === 'number' && <Detail label="Nights" value={String(data.nights)} />}
        {data.guests ? <Detail label="Guests" value={String(data.guests)} /> : null}
        {data.confirmationCode ? <Detail label="Confirmation" value={data.confirmationCode} /> : null}
      </div>

      {/* House rules (read-only) */}
      <div className={card}>
        <div className="text-base font-bold mb-1">House &amp; building rules</div>
        <p className="text-xs text-neutral-500 mb-3">Please read each rule and initial it individually. Tap the box next to a rule and your initials{defaultInitials ? ' (' + defaultInitials + ')' : ''} fill in for that rule — or type your own.</p>
        <div className="space-y-2.5">
          {rules.map((r, i) => {
            const val = ruleInitials[r.id] || ''
            const ok = !!val.trim()
            return (
              <div key={r.id} className={'rounded-xl border p-3 flex items-start gap-3 ' + (ok ? 'border-emerald-200 bg-emerald-50/50' : 'border-neutral-200 bg-neutral-50')}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">{i + 1}. {r.title}</div>
                  <div className="text-xs text-neutral-600 mt-0.5">{r.body}</div>
                </div>
                <div className="shrink-0 text-center">
                  <input value={val} aria-label={'Initials for rule ' + (i + 1)} placeholder="INIT"
                    autoCapitalize="characters" autoComplete="off" inputMode="text"
                    onFocus={() => { if (!(ruleInitials[r.id] || '').trim() && defaultInitials) setRuleInitials(prev => Object.assign({}, prev, { [r.id]: defaultInitials })) }}
                    onChange={e => { const v = e.target.value.toUpperCase().replace(/[^A-Z\s.]/g, '').slice(0, 6); setRuleInitials(prev => Object.assign({}, prev, { [r.id]: v })) }}
                    className={'w-16 rounded-lg border px-2 py-2 text-sm tracking-widest text-center uppercase ' + (ok ? 'border-emerald-300 text-emerald-800' : 'border-neutral-300')} />
                  <div className={'text-[9px] mt-0.5 ' + (ok ? 'text-emerald-600 font-semibold' : 'text-neutral-400')}>{ok ? '✓ Initialed' : 'Tap to initial'}</div>
                </div>
              </div>
            )
          })}
        </div>
        <div className={'text-xs font-medium mt-3 ' + (allInitialed ? 'text-emerald-700' : 'text-neutral-500')}>
          {allInitialed ? '✓ All rules initialed' : (initialedCount + ' of ' + rules.length + ' rules initialed')}
        </div>
      </div>

      {/* ID photo */}
      <div className={card}>
        <div className="text-base font-bold mb-1">Photo of your ID</div>
        <p className="text-xs text-neutral-500 mb-3">Take a clear photo of your government-issued ID — make sure all corners and text are readable.</p>
        <PhotoCapture facing="environment" maxPx={1600} placeholderClass="aspect-[16/10]"
          takeLabel="Take ID photo" retakeLabel="Retake ID photo" value={idPhoto} onChange={setIdPhoto}
          onError={setErr} primaryBtn={primaryBtn} />
      </div>

      {/* Selfie */}
      <div className={card}>
        <div className="text-base font-bold mb-1">Take a selfie</div>
        <p className="text-xs text-neutral-500 mb-3">A quick photo of your face so we can match it to your ID.</p>
        <PhotoCapture facing="user" maxPx={1200} placeholderClass="aspect-[3/4] max-h-72 mx-auto"
          takeLabel="Take selfie" retakeLabel="Retake selfie" value={selfie} onChange={setSelfie}
          onError={setErr} primaryBtn={primaryBtn} />
      </div>

      {/* Signature */}
      <div className={card}>
        <div className="text-base font-bold mb-1">Sign to agree</div>
        <p className="text-xs text-neutral-500 mb-3">Your signature confirms the details above and your agreement to the Salato house rules.</p>
        <label className="text-[11px] font-medium text-neutral-500">Name</label>
        <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Full name" className="w-full mt-1 mb-4 rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
        <label className="text-[11px] font-medium text-neutral-500">Signature</label>
        <SignaturePad value={sig} onChange={setSig} />
      </div>

      <button className={primaryBtn} disabled={!canSubmit} onClick={submit}>
        {busy ? 'Submitting…' : (canSubmit ? 'Submit verification' : 'Complete initials, ID, selfie & signature to submit')}
      </button>
      <div className="h-8" />
    </Shell>
  )
}

// ---- Live camera capture (opens the camera in-page; falls back to the native file/camera picker) ----
function PhotoCapture({ facing, maxPx, placeholderClass, takeLabel, retakeLabel, value, onChange, onError, primaryBtn }:
  { facing: 'environment' | 'user'; maxPx: number; placeholderClass: string; takeLabel: string; retakeLabel: string
    value: string; onChange: (s: string) => void; onError: (s: string) => void; primaryBtn: string }) {
  const [streaming, setStreaming] = useState(false)
  const [starting, setStarting] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const stop = useCallback(() => {
    const s = streamRef.current
    if (s) { s.getTracks().forEach(t => t.stop()); streamRef.current = null }
    setStreaming(false)
  }, [])

  // Always release the camera when this component unmounts.
  useEffect(() => () => stop(), [stop])

  // Attach the live stream to the <video> once it's mounted (after streaming flips true).
  useEffect(() => {
    if (streaming && videoRef.current && streamRef.current) {
      const v = videoRef.current
      v.srcObject = streamRef.current
      const p = v.play(); if (p && p.catch) p.catch(() => {})
    }
  }, [streaming])

  const openNativePicker = () => { if (fileRef.current) fileRef.current.click() }

  const openCamera = async () => {
    onError('')
    const md = (typeof navigator !== 'undefined' && navigator.mediaDevices) ? navigator.mediaDevices : null
    if (!md || !md.getUserMedia) { openNativePicker(); return }
    setStarting(true)
    try {
      const stream = await md.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false })
      streamRef.current = stream
      setStreaming(true)
    } catch {
      // Permission denied or no camera — fall back to the OS camera/file picker so they can still finish.
      openNativePicker()
    }
    setStarting(false)
  }

  const capture = () => {
    const v = videoRef.current; if (!v) return
    const vw = v.videoWidth, vh = v.videoHeight
    if (!vw || !vh) return
    const scale = Math.min(1, maxPx / Math.max(vw, vh))
    const w = Math.round(vw * scale), h = Math.round(vh * scale)
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const ctx = c.getContext('2d'); if (!ctx) { onError('Could not capture the photo — please try again.'); return }
    // Front camera preview is mirrored; capture it un-mirrored so the saved photo reads correctly.
    ctx.drawImage(v, 0, 0, w, h)
    onChange(c.toDataURL('image/jpeg', 0.72))
    stop()
  }

  const onFile = async (file: File | null) => {
    if (!file) return
    onError('')
    try { onChange(await compressImage(file, maxPx, 0.72)) } catch { onError('That photo could not be read — please try again.') }
  }

  if (streaming) return (
    <div>
      <div className="w-full rounded-xl overflow-hidden border border-neutral-800 bg-black mb-3">
        <video ref={videoRef} playsInline muted autoPlay
          className="w-full max-h-80 object-contain bg-black"
          style={facing === 'user' ? { transform: 'scaleX(-1)' } : undefined} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={capture} className={primaryBtn + ' !py-3'}>Capture photo</button>
        <button type="button" onClick={stop} className="w-full rounded-xl border border-neutral-300 text-neutral-700 font-semibold py-3 hover:bg-neutral-50 transition-colors">Cancel</button>
      </div>
    </div>
  )

  return (
    <div>
      {value
        ? <img src={value} alt="" className="w-full rounded-xl border border-neutral-200 mb-3" />
        : <div className={'w-full rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 flex items-center justify-center text-neutral-400 text-sm mb-3 ' + placeholderClass}>No photo yet</div>}
      <button type="button" onClick={openCamera} disabled={starting} className={primaryBtn}>
        {starting ? 'Opening camera…' : (value ? retakeLabel : takeLabel)}
      </button>
      {/* Fallback for devices where the live camera isn't available; also lets guests choose an existing photo. */}
      <input ref={fileRef} type="file" accept="image/*" capture={facing === 'user' ? 'user' : 'environment'} className="hidden"
        onChange={e => onFile(e.target.files && e.target.files[0])} />
    </div>
  )
}

// ---- Signature canvas ----
function SignaturePad({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const dirty = useRef(false)
  const valueRef = useRef(value)
  valueRef.current = value

  const setup = useCallback(() => {
    const c = canvasRef.current; if (!c) return
    const ratio = window.devicePixelRatio || 1
    const w = c.clientWidth || 300, h = c.clientHeight || 176
    c.width = Math.round(w * ratio); c.height = Math.round(h * ratio)
    const ctx = c.getContext('2d'); if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111827'
    // Resizing the canvas clears its pixels — repaint the saved signature so it doesn't disappear.
    const saved = valueRef.current
    if (saved) { const img = new Image(); img.onload = () => { ctx.drawImage(img, 0, 0, w, h) }; img.src = saved }
  }, [])
  useEffect(() => {
    setup()
    const onResize = () => setup()
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('orientationchange', onResize) }
  }, [setup])

  // Draw with BOTH touch and mouse events (no Pointer Events / setPointerCapture — that path
  // silently drops move events on some iPads, so the signature never registered).
  const point = (clientX: number, clientY: number) => { const c = canvasRef.current!; const r = c.getBoundingClientRect(); return { x: clientX - r.left, y: clientY - r.top } }
  const start = (clientX: number, clientY: number) => { drawing.current = true; last.current = point(clientX, clientY) }
  const draw = (clientX: number, clientY: number) => {
    if (!drawing.current) return
    const c = canvasRef.current!; const ctx = c.getContext('2d'); if (!ctx) return
    const p = point(clientX, clientY); const l = last.current || p
    ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(p.x, p.y); ctx.stroke()
    last.current = p; dirty.current = true
  }
  const end = () => { drawing.current = false; last.current = null; if (dirty.current && canvasRef.current) onChange(canvasRef.current.toDataURL('image/png')) }

  const onMouseDown = (e: React.MouseEvent) => { e.preventDefault(); start(e.clientX, e.clientY) }
  const onMouseMove = (e: React.MouseEvent) => { if (drawing.current) { e.preventDefault(); draw(e.clientX, e.clientY) } }
  const onTouchStart = (e: React.TouchEvent) => { const t = e.touches[0]; if (t) start(t.clientX, t.clientY) }
  const onTouchMove = (e: React.TouchEvent) => { const t = e.touches[0]; if (t && drawing.current) { if (e.cancelable) e.preventDefault(); draw(t.clientX, t.clientY) } }

  const clear = () => { const c = canvasRef.current; if (!c) return; const ctx = c.getContext('2d'); if (!ctx) return; ctx.clearRect(0, 0, c.width, c.height); dirty.current = false; onChange('') }

  return (
    <div>
      <div className={'mt-1 rounded-xl border bg-white ' + (value ? 'border-emerald-300' : 'border-neutral-300')}>
        <canvas ref={canvasRef}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={end} onMouseLeave={end}
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={end}
          className="w-full h-44 rounded-xl touch-none select-none" style={{ touchAction: 'none' }} />
      </div>
      <button type="button" onClick={clear} className="text-xs text-neutral-500 underline mt-1.5">Clear signature</button>
      {/* Confirmation preview so the guest can see the signature they just drew. */}
      {value ? (
        <div className="mt-3">
          <div className="text-[11px] font-medium text-emerald-700 mb-1">✓ Signature captured</div>
          <img src={value} alt="Your signature" className="w-full h-24 object-contain rounded-lg border border-emerald-200 bg-white" />
        </div>
      ) : null}
    </div>
  )
}
