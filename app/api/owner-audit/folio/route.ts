// THE WHOLE FOLIO FOR ONE BOOKING (Jon, 2026-11-04: "we should see the whole folio as is in the
// statement review"). Read-only. GET ?code=<confirmation code> (or ?id=<reservation id>) →
//   invoice  the guest invoice items (raw.money.invoiceItems) — what the guest was charged, with
//            any adjustment (an Airbnb Resolution Center item adjusted to $0 and re-allocated)
//   owners   the Owners-ledger journal lines for the booking (our mirror)
//   pmc      the Accounts Payable (PMC / vendors / tax) journal lines, read live from Guesty's
//            accounting API — the split between the owner and us
// Admins and the statement reviewer (share link) only, same gate as the audit itself.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { linkGate } from '@/lib/passcode-gate'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

async function allowed(): Promise<boolean> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) { const a = await getAccess(); if (a.allowed && atLeast(a.levels['owner-audit'], 'view')) return true }
  const gate = await linkGate('owner-audit', { kinds: ['owner-audit'], cookieOnly: true })
  return gate.ok
}

export async function GET(req: NextRequest) {
  if (!(await allowed())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const code = str(sp.get('code')).trim(), id = str(sp.get('id')).trim()
  const sb = supabaseAdmin()
  // ?arc=YYYY-MM: every booking that month with a real Airbnb Resolution Center item — the shape of
  // each (amount, description, logs, realization dates) so the allocated / not-allocated rule can be
  // read off real data rather than guessed.
  const arcMonth = str(sp.get('arc'))
  if (/^\d{4}-\d{2}$/.test(arcMonth)) {
    const from = arcMonth + '-01', to = arcMonth + '-31'
    const { data } = await sb.from('guesty_reservations').select('id, confirmation_code, guest_name, listing_id, check_in, status, inv:raw->money->invoiceItems')
      .lte('check_in', to).gte('check_out', from).limit(3000)
    const out: any[] = []
    for (const r of (data || []) as any[]) {
      const items: any[] = Array.isArray(r.inv) ? r.inv : []
      const arc = items.filter(x => /resolution|aircover/i.test(str(x?.title) + ' ' + str(x?.normalType)))
      if (!arc.length) continue
      out.push({ code: str(r.confirmation_code), guest: str(r.guest_name), listing: str(r.listing_id), checkIn: str(r.check_in).slice(0, 10), status: str(r.status),
        arc: arc.map(x => ({ title: str(x.title), type: str(x.normalType || x.type), amount: Number(x.amount) || 0, description: str(x.description).slice(0, 120), logs: Array.isArray(x.logs) ? x.logs.slice(0, 4).map((l: any) => ({ at: str(l?.at || l?.date || l?.createdAt).slice(0, 10), what: str(l?.type || l?.action || l?.event), from: l?.from ?? l?.oldAmount ?? l?.before, to: l?.to ?? l?.newAmount ?? l?.after, keys: Object.keys(l || {}).slice(0, 12) })) : null, realization: x.realizationDates ?? null, meta: x.metadata ? Object.keys(x.metadata) : null })),
        others: items.filter(x => !/resolution|aircover/i.test(str(x?.title))).map(x => str(x.title) + ' ' + (Number(x.amount) || 0)) })
    }
    return NextResponse.json({ ok: true, month: arcMonth, n: out.length, withMoney: out.filter(o => o.arc.some((a: any) => Math.abs(a.amount) > 0.005)).length, list: out.slice(0, 60) })
  }
  if (!code && !id) return NextResponse.json({ error: 'code or id required' }, { status: 400 })
  const q = sb.from('guesty_reservations').select('id, confirmation_code, guest_name, check_in, check_out, listing_id, source, status, inv:raw->money->invoiceItems, money:raw->money')
  const { data: rows } = await (id ? q.eq('id', id) : q.eq('confirmation_code', code)).limit(1)
  const r: any = (rows || [])[0]
  if (!r) return NextResponse.json({ error: 'reservation not found' }, { status: 404 })
  const conf = str(r.confirmation_code)
  const invoice = (Array.isArray(r.inv) ? r.inv : []).map((x: any) => ({
    title: str(x?.title || x?.name), type: str(x?.normalType || x?.type), amount: Number(x?.amount) || 0,
    adjusted: x?.adjustment ?? x?.adjustments ?? x?.isAdjusted ?? null, raw: sp.get('raw') === '1' ? x : undefined,
  }))
  // Owners ledger (mirror) for this booking.
  const { data: ol } = await sb.from('guesty_owner_ledger').select('entry_date, charge_code, amount, ledger, name:raw->>name, res:raw->reservationConfirmationCode->>title, raw')
    .eq('listing_id', str(r.listing_id)).gte('entry_date', str(r.check_in).slice(0, 10) < '2026' ? '2026-01-01' : str(r.check_in).slice(0, 7) + '-01').limit(2000)
  const owners = ((ol || []) as any[]).filter(x => str(x.res) === conf).map(x => ({ date: str(x.entry_date), code: str(x.charge_code), name: str(x.name), amount: Number(x.amount) || 0, ledger: str(x.ledger), sub: str(x.raw?.subLedger?.name || x.raw?.subledger || ''), status: str(x.raw?.payoutStatus || x.raw?.status || '') }))
  // Accounts Payable (PMC) ledger, live: every ledger for this reservation.
  let pmc: any[] = [], pmcError = ''
  try {
    const { getToken } = await import('@/lib/guesty')
    const token = await getToken()
    const base = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
    // The accounting API's filter grammar is not documented for reservations; try the likely spellings.
    const tries = [
      'reservationId=' + encodeURIComponent(str(r.id)),
      'reservationId=' + encodeURIComponent(JSON.stringify({ operator: '@eq', value: str(r.id) })),
      'filters=' + encodeURIComponent(JSON.stringify([{ field: 'reservationId', operator: '@eq', value: str(r.id) }])),
      'reservationConfirmationCode=' + encodeURIComponent(conf),
    ]
    let list: any[] = []
    const errs: string[] = []
    for (const t of tries) {
      const res = await fetch(base + '/accounting-api/journal-entries/all?limit=200&' + t, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, cache: 'no-store' })
      const j: any = await res.json().catch(() => null)
      const got: any[] = Array.isArray(j?.results) ? j.results : Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : []
      if (res.ok && got.length && got.every((x: any) => str(x?.reservationId || x?.reservation?._id || x?.reservation) === str(r.id) || str(x?.reservationConfirmationCode?.title) === conf)) { list = got; errs.push(t.split('=')[0] + ': ok ' + got.length); break }
      errs.push(t.split('=')[0] + ': ' + res.status + ' ' + got.length + ' rows' + (got.length ? ' (unfiltered?)' : ''))
    }
    pmcError = errs.join(' | ')
    pmc = list.map((x: any) => ({ date: str(x.transactionDate || x.date || x.createdAt).slice(0, 10), ledger: str(x.ledger), sub: str(x.subLedger?.name || x.subledger?.name || x.subLedger || ''), code: str(x.chargeCode), name: str(x.name), amount: Number(x.amount?.value ?? x.amount) || 0, status: str(x.payoutStatus || x.status || ''), res: str(x.reservationConfirmationCode?.title || x.reservationId || ''), raw: sp.get('raw') === '1' ? x : undefined }))
  } catch (e: any) { pmcError = str(e?.message || e).slice(0, 160) }
  return NextResponse.json({ ok: true, reservation: { id: str(r.id), code: conf, guest: str(r.guest_name), checkIn: str(r.check_in).slice(0, 10), checkOut: str(r.check_out).slice(0, 10), source: str(r.source), status: str(r.status) }, invoice, owners, pmc, pmcError: pmcError || undefined, moneyKeys: r.money && typeof r.money === 'object' ? Object.keys(r.money) : [] })
}
