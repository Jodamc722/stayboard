// ONE RESERVATION IN FULL (Jon, 2026-11-11: "need more info pulled into app for reservation details —
// notes, vouchers"). The sync keeps a lean row per booking; this reads the whole thing on demand, live:
//
//   Cloudbeds   getReservation      confirmation / OTA number, booked when, arrival time, each room with
//                                   its type, rate plan, guests and nightly rates, every guest on the
//                                   booking, custom fields, the folio split (room, taxes, extras, paid,
//                                   balance), cards on file (type only)
//               getReservationNotes every note in full, who wrote it and when — read into tags
//                                   (vouchers, prepaid, VIP / F&B credit, upgrades, LCO …)
//   ours        payments mirrored from Cloudbeds Payments, verifications, calls, the Operto code
//   Guesty      a "gy:" id (a Botanica stay still in Guesty): confirmation code, channel, money, the
//               Reservation Notes field — so the bookings list opens the same way for both.
//
// Never a document number or card digits. Notes read here are saved to the inbox store too, so the
// tags show on Today and in Guests afterwards without waiting for the week-window sync.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { cbGet, cloudbedsConfigured } from './cloudbeds'
import { readNotes } from './notes-read'

const s = (v: any) => (v == null ? '' : String(v))
const n = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : null }
const real = (v: any) => { const t = s(v).trim(); return !!t && !/^(n\/?a|none|null|0+|-+)$/i.test(t) }
const NOTES_FIELD = '695f16830cb54c001400b3ff'
const fid = (c: any) => s(c?.fieldId?._id || (typeof c?.fieldId === 'string' ? c.fieldId : '') || c?._id || c?.id)
const isNotes = (c: any) => fid(c) === NOTES_FIELD || /reservation[_ ]?notes/i.test(s(c?.fieldName))

export type LiveNote = { text: string; by: string | null; at: string | null }
export type LiveRes = {
  id: string; origin: 'cloudbeds' | 'guesty'; status: string; guest: string; email: string | null; phone: string | null
  confirmation: string | null; otaNumber: string | null; source: string | null; bookedAt: string | null; modifiedAt: string | null
  checkIn: string; checkOut: string; nights: number | null; arrivalTime: string | null
  rooms: { type: string | null; name: string | null; ratePlan: string | null; adults: number | null; children: number | null; nightly: { date: string; rate: number }[] }[]
  guests: { name: string; main: boolean; status: string | null; idOnFile: boolean; idType: string | null; country: string | null }[]
  money: { total: number | null; roomRevenue: number | null; taxes: number | null; extras: number | null; paid: number | null; balance: number | null; deposit: number | null; currency: string }
  cards: { type: string }[]; customFields: { name: string; value: string }[]
  notes: LiveNote[]; tags: ReturnType<typeof readNotes>['tags']; vehicle: string | null
  vouchers: number | null
  payments: { at: string | null; kind: string; method: string | null; amount: number; status: string | null }[]
  verifications: { kind: string; status: string; note: string | null }[]
  calls: { at: string; kind: string; outcome: string; by: string | null; note: string | null }[]
  fetchedAt: string; warnings: string[]
}

const voucherCount = (tags: any[]) => { const t = tags.find(x => x.key === 'vouchers'); const m = t ? /^(\d+)/.exec(t.label) : null; return m ? Number(m[1]) : null }

async function ours(id: string) {
  const db = supabaseAdmin()
  const [p, v, c] = await Promise.all([
    db.from('garden_payments').select('kind,method,amount,status,paid_at').eq('reservation_id', id).order('paid_at').then(r => (r.data || []) as any[], () => [] as any[]),
    db.from('garden_verifications').select('kind,status,note').eq('reservation_id', id).then(r => (r.data || []) as any[], () => [] as any[]),
    db.from('garden_calls').select('kind,outcome,called_at,called_by,note').eq('reservation_id', id).order('called_at', { ascending: false }).limit(30).then(r => (r.data || []) as any[], () => [] as any[]),
  ])
  return {
    payments: p.map(x => ({ at: x.paid_at || null, kind: s(x.kind), method: x.method || null, amount: Number(x.amount) || 0, status: x.status || null })),
    verifications: v.map(x => ({ kind: s(x.kind), status: s(x.status), note: x.note || null })),
    calls: c.map(x => ({ at: s(x.called_at), kind: s(x.kind), outcome: s(x.outcome), by: x.called_by || null, note: x.note || null })),
  }
}

async function fromGuesty(id: string): Promise<LiveRes | null> {
  const db = supabaseAdmin()
  const { data: r } = await db.from('guesty_reservations').select('id,listing_id,status,check_in,check_out,nights,source,guest_name,created_at,raw').eq('id', id).maybeSingle()
  if (!r) return null
  const raw: any = (r as any).raw || {}, m = raw.money || {}
  const { data: l } = await db.from('guesty_listings').select('nickname,title').eq('id', (r as any).listing_id).maybeSingle()
  const cf = Array.isArray(raw.customFields) ? raw.customFields : []
  const noteTxt = s(cf.find(isNotes)?.value)
  const notes: LiveNote[] = [
    ...noteTxt.split(/\n+/).map(t => t.trim()).filter(Boolean).map(t => ({ text: t, by: 'Reservation Notes (Guesty)', at: null })),
    ...(raw.notes?.other ? [{ text: s(raw.notes.other), by: 'Guesty note', at: null }] : []),
    ...(raw.notes?.guest ? [{ text: s(raw.notes.guest), by: 'Guest note', at: null }] : []),
  ]
  const rd = readNotes(notes.map(x => x.text))
  const accom = n(m.fareAccommodationAdjusted), clean = n(m.fareCleaning)
  return {
    id: 'gy:' + s((r as any).id), origin: 'guesty', status: s((r as any).status), guest: s((r as any).guest_name) || 'Guest',
    email: raw.guest?.email || null, phone: raw.guest?.phone || null,
    confirmation: raw.confirmationCode || null, otaNumber: raw.integration?.confirmationCode || raw.channelReservationId || null,
    source: (r as any).source || null, bookedAt: (r as any).created_at || null, modifiedAt: raw.lastUpdatedAt || null,
    checkIn: s((r as any).check_in).slice(0, 10), checkOut: s((r as any).check_out).slice(0, 10), nights: n((r as any).nights), arrivalTime: null,
    rooms: [{ type: 'Botanica · in Guesty', name: (l as any)?.nickname || (l as any)?.title || null, ratePlan: raw.ratePlanName || null, adults: n(raw.guestsCount), children: null, nightly: [] }],
    guests: [{ name: s((r as any).guest_name) || 'Guest', main: true, status: null, idOnFile: false, idType: null, country: raw.guest?.address?.country || null }],
    money: { total: accom != null || clean != null ? Math.round(((accom || 0) + (clean || 0)) * 100) / 100 : null, roomRevenue: accom, taxes: n(m.totalTaxes), extras: clean, paid: n(m.totalPaid), balance: n(m.balanceDue), deposit: null, currency: s(m.currency) || 'USD' },
    cards: [], customFields: cf.filter((f: any) => !isNotes(f) && real(f.value)).map((f: any) => ({ name: s(f.fieldName || f.fieldId?.name || f.name || 'Field'), value: s(f.value) })),
    notes, tags: rd.tags, vehicle: rd.vehicle, vouchers: voucherCount(rd.tags),
    payments: [], verifications: [], calls: [], fetchedAt: new Date().toISOString(), warnings: ['Still in Guesty — read-only here until the unit moves to Cloudbeds.'],
  }
}

export async function liveReservation(idIn: string): Promise<LiveRes | null> {
  const id = s(idIn).trim()
  if (!id) return null
  if (id.startsWith('gy:')) return fromGuesty(id.slice(3))
  const db = supabaseAdmin()
  const { data: row } = await db.from('garden_reservations').select('*').eq('id', id).maybeSingle()
  const warnings: string[] = []
  let d: any = null, notesRaw: any[] = []
  if (cloudbedsConfigured()) {
    const [a, b] = await Promise.all([
      cbGet<any>('getReservation', { reservationID: id }).catch(e => { warnings.push('Cloudbeds reservation: ' + s(e?.message || e).slice(0, 120)); return { data: null } }),
      cbGet<any>('getReservationNotes', { reservationID: id }).catch(e => { warnings.push('Cloudbeds notes: ' + s(e?.message || e).slice(0, 120)); return { data: [] } }),
    ])
    d = a.data; notesRaw = Array.isArray(b.data) ? b.data : []
  } else warnings.push('Cloudbeds is not connected — showing what the last sync kept.')
  if (!d && !row) return null
  const R: any = row || {}
  const gl = Object.values(d?.guestList || {}) as any[]
  const assigned = ([] as any[]).concat(d?.assigned || [], d?.unassigned || [])
  const bd = d?.balanceDetailed || {}
  const notes: LiveNote[] = notesRaw.map(x => ({ text: s(x.reservationNote || x.note).trim(), by: x.userName || null, at: x.dateCreated ? new Date(s(x.dateCreated).replace(' ', 'T') + 'Z').toISOString() : null })).filter(x => x.text)
  if (!d && !notes.length) {
    const { data: kept } = await db.from('garden_messages').select('body,author,sent_at').eq('thread_id', 'note:' + id).order('sent_at')
    for (const m of ((kept || []) as any[])) notes.push({ text: s(m.body), by: m.author || null, at: m.sent_at || null })
  }
  // Keep the notes so Today and Guests show their tags from now on.
  if (notesRaw.length) {
    const { ingestMessage } = await import('./hub')
    for (const x of notesRaw) {
      const body = s(x.reservationNote || x.note).trim(); if (!body) continue
      await ingestMessage({ threadId: `note:${id}`, reservationId: id, guest: R.guest_name || d?.guestName || null, channel: R.source || null, source: 'note', id: `note:${x.reservationNoteID || x.id || body.slice(0, 40)}`, direction: 'out', author: x.userName || 'Front desk', body, sentAt: x.dateCreated ? new Date(s(x.dateCreated).replace(' ', 'T') + 'Z').toISOString() : null, quiet: true }).catch(() => {})
    }
  }
  const rd = readNotes(notes.map(x => x.text))
  const cardsRaw = Array.isArray(d?.cardsOnFile) ? d.cardsOnFile : d?.cardsOnFile && typeof d.cardsOnFile === 'object' ? Object.values(d.cardsOnFile) : []
  const cf = Array.isArray(d?.customFields) ? d.customFields : []
  const mine = await ours(id)
  const total = n(bd.grandTotal) ?? n(d?.total) ?? n(R.total)
  return {
    id, origin: 'cloudbeds', status: s(d?.status || R.status), guest: s(d?.guestName || R.guest_name) || 'Guest', email: d?.guestEmail || R.guest_email || null, phone: R.guest_phone || (gl.find(g => g?.isMainGuest) || gl[0])?.guestCellPhone || (gl.find(g => g?.isMainGuest) || gl[0])?.guestPhone || null,
    confirmation: id, otaNumber: real(d?.thirdPartyIdentifier) ? s(d.thirdPartyIdentifier) : null, source: d?.sourceName || R.source || null,
    bookedAt: d?.dateCreated || R.booked_at || null, modifiedAt: d?.dateModified || R.modified_at || null,
    checkIn: s(d?.startDate || R.check_in).slice(0, 10), checkOut: s(d?.endDate || R.check_out).slice(0, 10), nights: n(R.nights),
    arrivalTime: real(d?.estimatedArrivalTime) ? s(d.estimatedArrivalTime) : null,
    rooms: assigned.length ? assigned.map(a => ({
      type: a.roomTypeName || null, name: a.roomName || null, ratePlan: a.ratePlanName || a.rateName || (a.rateID ? 'Rate ' + a.rateID : null),
      adults: n(a.adults), children: n(a.children),
      nightly: (Array.isArray(a.dailyRates) ? a.dailyRates : []).map((x: any) => ({ date: s(x.date).slice(0, 10), rate: Number(x.rate) || 0 })),
    })) : (R.room_names || []).map((nm: string) => ({ type: null, name: nm, ratePlan: null, adults: n(R.adults), children: n(R.children), nightly: [] })),
    guests: gl.map(g => ({
      name: [g.guestFirstName, g.guestLastName].filter(Boolean).join(' ') || s(g.guestName) || 'Guest', main: !!g.isMainGuest, status: g.guestStatus || null,
      idOnFile: real(g.guestDocumentNumber), idType: real(g.guestDocumentType) ? s(g.guestDocumentType).replace(/_/g, ' ') : null, country: g.guestCountry || null,
    })),
    money: { total, roomRevenue: n(bd.subTotal), taxes: n(bd.taxesFees), extras: n(bd.additionalItems), paid: n(bd.paid), balance: n(d?.balance) ?? n(R.balance), deposit: n(bd.suggestedDeposit), currency: 'USD' },
    cards: (cardsRaw as any[]).map(c => ({ type: s(c.cardType || c.type || 'card') })),
    customFields: cf.map((f: any) => ({ name: s(f.customFieldName || f.name), value: s(f.customFieldValue || f.value) })).filter((f: any) => f.name && real(f.value)),
    notes, tags: rd.tags, vehicle: rd.vehicle, vouchers: voucherCount(rd.tags),
    ...mine, fetchedAt: new Date().toISOString(), warnings,
  }
}
