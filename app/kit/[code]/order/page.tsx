// THE STARTER KIT ORDER FORM (Jon, 2026-11-10: "we should also be able to generate a link like the
// linens, just an order form to share what they need"). /kit/<code>/order is the plain version of the
// starter kit report: only what still has to be bought, room by room, with the quantity, the product,
// its link and the price, and the totals. Read-only — anyone the link is sent to (the owner, a buyer,
// a vendor) sees the same list. It follows the client's latest choices on /kit/<code>.
// Same capability as the report: the 20-hex code, a 404 when it is unknown or turned off.
import { notFound } from 'next/navigation'
import { openKit } from '@/lib/starter-kit-server'
import { KIT_CATEGORIES, describeSize, fmtMoney, kitTotals } from '@/lib/starter-kit'

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
  const buy = t.lines.filter(l => l.included && l.source !== 'self' && l.toBuy > 0)
  const owner = t.lines.filter(l => l.included && (l.source === 'self' || l.toBuy === 0))
  const grand = t.total + (kit.setupFee || 0)
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
        <div className="sko-eyebrow">Order form</div>
        <h1>{kit.client}</h1>
        <p className="sko-meta">{[kit.property, describeSize(kit.size), date].filter(Boolean).join(' · ')}</p>

        <div className="sko-sum">
          <div><span>Items to buy</span><b>{buy.length}</b></div>
          <div><span>Already covered</span><b>{owner.length}</b></div>
          <div><span>Total</span><b>{fmtMoney(grand)}</b></div>
        </div>

        <div className="sko-tablewrap">
          <table className="sko-t">
            <thead><tr><th>Item</th><th>Product</th><th className="n">Qty</th><th className="n">Each</th><th className="n">Total</th></tr></thead>
            {KIT_CATEGORIES.map(cat => {
              const rows = buy.filter(l => l.item.category === cat)
              if (!rows.length) return null
              return (
                <tbody key={cat}>
                  <tr className="cat"><td colSpan={5}>{cat}</td></tr>
                  {rows.map(l => (
                    <tr key={l.item.key}>
                      <td><b>{l.item.name}</b>{l.have ? <small>need {l.qty}, have {l.have}</small> : null}</td>
                      <td>{l.own ? <a href={l.own} target="_blank" rel="noopener noreferrer">Owner’s link</a> : l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer">{l.detail}</a> : l.detail}</td>
                      <td className="n">{l.toBuy}</td>
                      <td className="n">{l.own ? '—' : l.price != null ? (l.option?.approx ? '~' : '') + fmtMoney(l.price) : '—'}</td>
                      <td className="n">{l.own ? 'On review' : l.price === 0 ? 'Included' : fmtMoney(l.total || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              )
            })}
            <tfoot>
              {kit.setupFee ? <tr><td colSpan={4}>Setup, delivery and installation</td><td className="n">{fmtMoney(kit.setupFee)}</td></tr> : null}
              <tr className="tot"><td colSpan={4}>Total</td><td className="n">{fmtMoney(grand)}</td></tr>
            </tfoot>
          </table>
        </div>
        {!buy.length && <p className="sko-empty">Nothing left to buy: everything on the list is already covered.</p>}

        {owner.length > 0 && (
          <section className="sko-owner">
            <h2>Already covered by the owner</h2>
            <p>{owner.map(l => `${l.item.name}${l.source === 'self' ? ' (owner provides)' : ` (has ${l.have})`}`).join(' · ')}</p>
          </section>
        )}
        <p className="sko-fine">Prices are retail prices from when this list was prepared and are confirmed before ordering. Coffee pods are supplied by Stay. Linen is quoted separately.</p>
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
.sko-t{width:100%;border-collapse:collapse;min-width:560px;font-variant-numeric:tabular-nums}
.sko-t th{text-align:left;font-size:11.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:8px 10px;border-bottom:2px solid var(--ink)}
.sko-t td{padding:10px;border-bottom:1px solid var(--line);vertical-align:top}
.sko-t td small{display:block;color:var(--muted);font-size:12px}
.sko-t .n{text-align:right;white-space:nowrap}
.sko-t a{color:var(--accent);text-decoration:none}.sko-t a:hover{text-decoration:underline}
.sko-t tr.cat td{font-family:var(--display);font-size:20px;padding-top:20px;border-bottom:1px solid var(--ink)}
.sko-t tfoot td{border-bottom:0;padding-top:12px;font-weight:600}
.sko-t tr.tot td{font-family:var(--display);font-weight:400;font-size:26px}
.sko-empty{color:var(--muted)}
.sko-owner{margin-top:24px}.sko-owner h2{font-size:15px;margin:0 0 4px}.sko-owner p{margin:0;color:var(--muted);font-size:13.5px}
.sko-fine{margin-top:24px;font-size:12.5px;color:var(--muted)}
@media (max-width:520px){.sko-sum{grid-template-columns:1fr 1fr}.sko-sum div:last-child{grid-column:1/-1}}
@media print{.sko{background:#fff;padding:0}.sko-wrap{border:0}.sko-dl{display:none}}
`
