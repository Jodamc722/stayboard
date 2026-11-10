// THE STARTER KIT ORDER FORM (Jon, 2026-11-10: "a link like the linens, just an order form to share
// what they need… just a count needed and items and recommended / must have, like the linen
// calculator"). /kit/<code>/order is the plain list: room by room, each item, whether it is a
// must-have or recommended, and how many the home needs. No products and no prices — those are on the
// report. Read-only — anyone the link is sent to (the owner, a buyer, a vendor) sees the same list. It follows the client's latest choices on /kit/<code>.
// Same capability as the report: the 20-hex code, a 404 when it is unknown or turned off.
import { notFound } from 'next/navigation'
import { openKit } from '@/lib/starter-kit-server'
import { KIT_CATEGORIES, describeSize, kitTotals, ruleText } from '@/lib/starter-kit'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { code: string } }) {
  const kit = await openKit(String(params.code || ''), false)
  return { robots: { index: false, follow: false }, title: kit ? `Order form for ${kit.client} — Stay Hospitality` : 'Stay Hospitality' }
}

export default async function StarterKitOrderPage({ params }: { params: { code: string } }) {
  const code = String(params.code || '')
  const kit = await openKit(code, false)
  if (!kit) notFound()
  const t = kitTotals(kit.size, kit.selection)
  const needed = t.lines.filter(l => l.included)
  const TYPE = { must: 'Must-have', recommended: 'Recommended', optional: 'Optional' } as const
  const count = (k: 'must' | 'recommended' | 'optional') => needed.filter(l => l.item.tier === k).length
  const date = new Date(kit.submitted?.at || kit.savedAt || kit.createdAt || Date.now()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div className="sko">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="sko-wrap">
        <header className="sko-head">
          <img src="/stay-logo.png" alt="Stay Hospitality" className="sko-logo" />
          <div className="sko-dl">
            <a href={`/api/public/starter-kit/${code}/xlsx`}>Excel</a>
            <a href={`/api/public/starter-kit/${code}/pdf`}>PDF</a>
          </div>
        </header>
        <div className="sko-eyebrow">What this home needs</div>
        <h1>{kit.client}</h1>
        <p className="sko-meta">{[kit.property, describeSize(kit.size), date].filter(Boolean).join(' · ')}</p>

        <div className="sko-sum">
          <div><span>Must-haves</span><b>{count('must')}</b></div>
          <div><span>Recommended</span><b>{count('recommended')}</b></div>
          <div><span>Optional chosen</span><b>{count('optional')}</b></div>
        </div>

        <table className="sko-t">
          <thead><tr><th>Item</th><th>Type</th><th className="n">Needed</th></tr></thead>
          {KIT_CATEGORIES.map(cat => {
            const rows = needed.filter(l => l.item.category === cat)
            if (!rows.length) return null
            return (
              <tbody key={cat}>
                <tr className="cat"><td colSpan={3}>{cat}</td></tr>
                {rows.map(l => (
                  <tr key={l.item.key}>
                    <td><b>{l.item.name}</b><small>{ruleText(l.item, kit.size)}{l.item.each > 1 ? ` · count is sets of ${l.item.each}` : ""}</small></td>
                    <td><i className={'sko-tier ' + l.item.tier}>{TYPE[l.item.tier]}</i></td>
                    <td className="n"><b className="sko-q">{l.qty}</b>{l.have ? <small>have {l.have} · {l.toBuy} more</small> : null}</td>
                  </tr>
                ))}
              </tbody>
            )
          })}
        </table>
        <p className="sko-fine">Counts are sized to the home: place settings at 1.5 per guest, glasses per guest, bath items per bathroom, hangers and luggage racks per bedroom. Must-haves are what every home needs; the owner can use our pick, their own, or provide it. Coffee pods are supplied by Stay. Linen is quoted separately.</p>
      </main>
    </div>
  )
}

const CSS = `
.sko{--paper:#fff;--ground:#EEF1F0;--ink:#15212B;--muted:#6B7880;--line:#DCE2E0;--accent:#1F5F5B;--display:'Instrument Serif',Georgia,serif;--ui:'Geist','Inter',system-ui,sans-serif;
  background:var(--ground);color:var(--ink);font-family:var(--ui);font-size:14.5px;line-height:1.45;min-height:100vh;color-scheme:light;padding-block:28px 48px}
.sko *{box-sizing:border-box}
.sko-wrap{max-width:900px;margin:0 auto;background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:28px max(20px,env(safe-area-inset-right,0px)) 28px max(20px,env(safe-area-inset-left,0px))}
@media (min-width:700px){.sko-wrap{padding:36px 40px}}
.sko-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:28px}
.sko-logo{height:28px;width:auto}
.sko-dl{display:flex;gap:8px}.sko-dl a{border:1px solid var(--line);border-radius:999px;padding:7px 14px;font-weight:600;font-size:13px;color:var(--ink);text-decoration:none}.sko-dl a:hover{border-color:var(--ink)}
.sko-eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:600}
.sko h1{font-family:var(--display);font-weight:400;font-size:clamp(34px,6vw,48px);line-height:1.05;margin:6px 0 6px}
.sko-meta{color:var(--muted);margin:0}
.sko-sum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:22px 0 26px}
.sko-sum div{border:1px solid var(--line);border-radius:12px;padding:12px 14px}.sko-sum span{display:block;font-size:12px;color:var(--muted)}.sko-sum b{font-family:var(--display);font-weight:400;font-size:28px;font-variant-numeric:tabular-nums}
.sko-tablewrap{overflow-x:auto}
.sko-t{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.sko-t th{text-align:left;font-size:11.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:8px 10px;border-bottom:2px solid var(--ink)}
.sko-t td{padding:10px;border-bottom:1px solid var(--line);vertical-align:top}
.sko-t td small{display:block;color:var(--muted);font-size:12px}
.sko-t .n{text-align:right;white-space:nowrap}
.sko-t a{color:var(--accent);text-decoration:none}.sko-t a:hover{text-decoration:underline}
.sko-tier{font-style:normal;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap}
.sko-tier.must{background:#E1EAF5;color:#1C4A7E}.sko-tier.recommended{background:#E0EFE4;color:#25633A}.sko-tier.optional{background:#ECEFF1;color:#56626B}
.sko-q{font-family:var(--display);font-weight:400;font-size:24px}
.sko-t tr.cat td{font-family:var(--display);font-size:20px;padding-top:20px;border-bottom:1px solid var(--ink)}
.sko-t tfoot td{border-bottom:0;padding-top:12px;font-weight:600}
.sko-t tr.tot td{font-family:var(--display);font-weight:400;font-size:26px}
.sko-empty{color:var(--muted)}
.sko-owner{margin-top:24px}.sko-owner h2{font-size:15px;margin:0 0 4px}.sko-owner p{margin:0;color:var(--muted);font-size:13.5px}
.sko-fine{margin-top:24px;font-size:12.5px;color:var(--muted)}
@media (max-width:520px){.sko-sum{grid-template-columns:1fr 1fr}.sko-sum div:last-child{grid-column:1/-1}}
@media print{.sko{background:#fff;padding:0}.sko-wrap{border:0}.sko-dl{display:none}}
`
