'use client'
// The owner portal's front door (/portal): email + password, or a one-time link by email. One look in both themes,
// matching the owner page it opens (components/OwnerJoin.tsx).
import { useState } from 'react'

const CSS = `
.op{--ink:#121316;--body:#3A3B40;--mut:#6E6F74;--rule:#E5E1D8;--acc:#8C6D3A;--bad:#A1332B;--ok:#2F7D4F;min-height:100vh;background:#F6F4EE;color:var(--body);font:400 16px/1.55 Inter,system-ui,sans-serif;color-scheme:light}
.op-in{max-width:460px;margin:0 auto;padding:44px max(18px,env(safe-area-inset-right)) 60px max(18px,env(safe-area-inset-left))}
.op img{height:34px;width:auto;margin-bottom:34px}
.op-k{font:600 11.5px Inter,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--acc);margin:0 0 8px}
.op h1{font:400 clamp(34px,8vw,46px)/1.05 "Instrument Serif",Georgia,serif;color:var(--ink);margin:0 0 10px;text-wrap:balance}.op h1 em{font-style:italic}
.op p{margin:0 0 14px}
.op-card{background:#fff;border:1px solid var(--rule);border-radius:18px;padding:18px;display:grid;gap:12px;margin-top:16px}
.op label{display:grid;gap:5px}.op label span{font:600 11.5px Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--mut)}
.op input{font:400 16px Inter,sans-serif;color:var(--ink);background:#fff;border:1px solid var(--rule);border-radius:12px;padding:12px 13px;width:100%;min-width:0}
.op input:focus{outline:2px solid var(--ink);outline-offset:1px}
.op-cta{justify-self:start;background:var(--ink);color:#fff;border:0;border-radius:999px;padding:12px 22px;font:600 15px Inter,sans-serif;cursor:pointer}.op-cta:disabled{opacity:.5}
.op-link{background:none;border:0;padding:0;font:600 14px Inter,sans-serif;color:var(--ink);text-decoration:underline;cursor:pointer;justify-self:start}
.op-err{color:var(--bad);font-size:14px;margin:0}.op-ok{color:var(--ok);font-size:14px;margin:0}
.op-list{display:grid;gap:8px}.op-list a{display:block;border:1px solid var(--rule);border-radius:12px;padding:12px 14px;color:var(--ink);font-weight:600;text-decoration:none;background:#fff}
.op-small{font-size:13px;color:var(--mut)}
`
export function OwnerPortalSignIn() {
  const [email, setEmail] = useState(''); const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [sent, setSent] = useState(false)
  const [open, setOpen] = useState<{ code: string; label: string }[] | null>(null)
  const post = (body: Record<string, unknown>) => fetch('/api/portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).catch(() => null)
  async function signIn(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg('')
    const d = await post({ email, password: pw }); setBusy(false)
    if (!d?.ok) { setMsg(d?.error || 'Could not sign in. Check your connection and try again.'); return }
    if (d.open.length === 1) { window.location.href = '/join/' + d.open[0].code; return }
    setOpen(d.open)
  }
  async function link() {
    if (!email.trim()) { setMsg('Enter your email address first.'); return }
    setBusy(true); setMsg(''); const d = await post({ email, sendLink: 1 }); setBusy(false)
    if (d?.ok) setSent(true); else setMsg(d?.error || 'Could not send it. Try again.')
  }
  return (
    <main className="op"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" /><style>{CSS}</style>
      <div className="op-in">
        <img src="/stay-logo.png" alt="Stay Hospitality" />
        <p className="op-k">Owner portal</p>
        {open ? (<>
          <h1>Your <em>homes.</em></h1>
          <p>Choose the one you want to open.</p>
          <div className="op-list">{open.map(o => <a key={o.code} href={'/join/' + o.code}>{o.label}</a>)}</div>
        </>) : (<>
          <h1>Sign in to <em>your portal.</em></h1>
          <p>Use the email we have for you and the password you created from your welcome email.</p>
          <form className="op-card" onSubmit={signIn}>
            <label><span>Email</span><input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
            <label><span>Password</span><input type="password" autoComplete="current-password" required value={pw} onChange={e => setPw(e.target.value)} /></label>
            {msg ? <p className="op-err">{msg}</p> : null}
            <button type="submit" className="op-cta" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <div className="op-card">
            <p className="op-small" style={{ margin: 0 }}><b>Forgot your password, or have not created one yet?</b> We will email a one-time sign-in link to the address above.</p>
            {sent ? <p className="op-ok">If that address has an owner account, a sign-in link is on its way. It works for 30 minutes.</p> : <button type="button" className="op-link" disabled={busy} onClick={link}>Email me a sign-in link</button>}
          </div>
        </>)}
      </div>
    </main>
  )
}
