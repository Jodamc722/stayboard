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
  if (!code && !id) return NextResponse.json({ error: 'code or id required' }, { status: 400 })
  const sb = supabaseAdmin()
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
    const f = encodeURIComponent(JSON.stringify({ operator: '@eq', value: str(r.id) }))
    const res = await fetch(base + '/accounting-api/journal-entries/all?limit=200&reservationId=' + f, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, cache: 'no-store' })
    const j: any = await res.json().catch(() => null)
    const list: any[] = Array.isArray(j?.results) ? j.results : Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : []
    if (!res.ok) pmcError = 'Guesty ' + res.status
    pmc = list.map((x: any) => ({ date: str(x.transactionDate || x.date || x.createdAt).slice(0, 10), ledger: str(x.ledger), sub: str(x.subLedger?.name || x.subledger?.name || x.subLedger || ''), code: str(x.chargeCode), name: str(x.name), amount: Number(x.amount?.value ?? x.amount) || 0, status: str(x.payoutStatus || x.status || ''), res: str(x.reservationConfirmationCode?.title || x.reservationId || ''), raw: sp.get('raw') === '1' ? x : undefined }))
  } catch (e: any) { pmcError = str(e?.message || e).slice(0, 160) }
  return NextResponse.json({ ok: true, reservation: { id: str(r.id), code: conf, guest: str(r.guest_name), checkIn: str(r.check_in).slice(0, 10), checkOut: str(r.check_out).slice(0, 10), source: str(r.source), status: str(r.status) }, invoice, owners, pmc, pmcError: pmcError || undefined, moneyKeys: r.money && typeof r.money === 'object' ? Object.keys(r.money) : [] })
}
