// GUEST PROFILES (Jon, 2026-11-10: "guest profiles"). One profile per guest across every stay the
// hotel has synced from Cloudbeds — matched by email, else phone, else name — with stays, nights,
// spend, channels, the desk's notes read into tags, ID / card on file, the Operto code and self
// check-in, and the calls logged. Read-only; Cloudbeds stays the record.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { readNotes, type NoteTag } from './notes-read'
import { resDetails } from './res-detail'
import { opertoStore } from './operto'

const s = (v: any) => (v == null ? '' : String(v))
const keyOf = (r: any) => {
  const e = s(r.guest_email).trim().toLowerCase(); if (e && !/guest\.booking\.com|expedia|agoda|hotels\.com|no-?email|noemail/i.test(e)) return 'e:' + e
  const p = s(r.guest_phone).replace(/\D/g, '').slice(-10); if (p.length >= 7) return 'p:' + p
  return 'n:' + s(r.guest_name).trim().toLowerCase().replace(/\s+/g, ' ')
}
export type Stay = { id: string; status: string; checkIn: string; checkOut: string; nights: number | null; rooms: string[]; source: string | null; total: number; balance: number }
export type GuestRow = { key: string; name: string; email: string | null; phone: string | null; stays: number; nights: number; spend: number; balance: number; channels: string[]; first: string; last: string; current: Stay | null; next: Stay | null; tags: NoteTag[]; vip: boolean }

async function allReservations() {
  const db = supabaseAdmin(); const out: any[] = []
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await db.from('garden_reservations').select('id,status,guest_name,guest_email,guest_phone,check_in,check_out,nights,room_names,source,total,balance').order('check_in', { ascending: false }).range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || [])); if (!data || data.length < 1000) break
  }
  return out
}
async function notesFor(ids: string[]) {
  const db = supabaseAdmin(); const by: Record<string, string[]> = {}
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('garden_messages').select('thread_id,body,sent_at').in('thread_id', ids.slice(i, i + 200).map(x => 'note:' + x)).order('sent_at')
    for (const m of ((data || []) as any[])) { const k = s(m.thread_id).slice(5); (by[k] = by[k] || []).push(s(m.body)) }
  }
  return by
}
const stayOf = (r: any): Stay => ({ id: s(r.id), status: s(r.status), checkIn: r.check_in, checkOut: r.check_out, nights: r.nights ?? null, rooms: r.room_names || [], source: r.source || null, total: Number(r.total) || 0, balance: Number(r.balance) || 0 })

export async function guestList(): Promise<{ guests: GuestRow[]; reservations: number }> {
  const R = await allReservations()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const by = new Map<string, any[]>()
  for (const r of R) { const k = keyOf(r); by.set(k, [...(by.get(k) || []), r]) }
  // Tags only for guests with a stay around now (notes are synced for that window).
  const near = R.filter(r => r.check_out >= today && r.status !== 'canceled').map(r => s(r.id))
  const notes = await notesFor(near)
  const guests: GuestRow[] = []
  for (const [key, rs] of Array.from(by.entries())) {
    const live = rs.filter(r => !['canceled', 'no_show'].includes(s(r.status)))
    const use = live.length ? live : rs
    // In house / arriving only from stays that are still on (a cancelled booking is history).
    const wk = new Date(Date.now() + 7 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    const cur = live.find(r => r.check_in <= today && r.check_out > today) || null
    const next = [...live].filter(r => r.check_in > today && r.check_in <= wk).sort((a, b) => a.check_in.localeCompare(b.check_in))[0] || null
    const nts = use.flatMap(r => notes[s(r.id)] || [])
    const tags = readNotes(nts).tags
    const top = use[0]
    guests.push({
      key, name: s(top.guest_name) || 'Guest', email: top.guest_email || null, phone: top.guest_phone || null,
      stays: live.length, nights: live.reduce((a, r) => a + (Number(r.nights) || 0), 0), spend: Math.round(live.reduce((a, r) => a + (Number(r.total) || 0), 0) * 100) / 100,
      balance: Math.round(live.filter(r => r.check_out >= today).reduce((a, r) => a + (Number(r.balance) || 0), 0) * 100) / 100,
      channels: Array.from(new Set(use.map(r => s(r.source)).filter(Boolean))), first: use[use.length - 1].check_in, last: use[0].check_in,
      current: cur ? stayOf(cur) : null, next: next ? stayOf(next) : null, tags, vip: tags.some(t => t.key === 'vip'),
    })
  }
  guests.sort((a, b) => Number(!!b.current) - Number(!!a.current) || Number(!!b.next) - Number(!!a.next) || b.last.localeCompare(a.last))
  return { guests, reservations: R.length }
}

/** One guest in full: by profile key, or by any of their reservation ids. */
export async function guestProfile(opts: { key?: string; res?: string }) {
  const R = await allReservations()
  let key = opts.key || ''
  if (!key && opts.res) { const r = R.find(x => s(x.id) === opts.res); if (r) key = keyOf(r) }
  const rs = R.filter(r => keyOf(r) === key)
  if (!rs.length) return null
  const ids = rs.map(r => s(r.id))
  const db = supabaseAdmin()
  const [notes, det, ops, calls, vers] = await Promise.all([
    notesFor(ids), resDetails().catch(() => ({} as any)), opertoStore().catch(() => null),
    db.from('garden_calls').select('reservation_id,kind,outcome,called_at,called_by,note').in('reservation_id', ids).order('called_at', { ascending: false }).limit(50).then(r => (r.data || []) as any[], () => [] as any[]),
    db.from('garden_verifications').select('reservation_id,kind,status,note,updated_at').in('reservation_id', ids).then(r => (r.data || []) as any[], () => [] as any[]),
  ])
  const stays = rs.map(r => {
    const nts = notes[s(r.id)] || [], rd = readNotes(nts), d = (det as any)[s(r.id)] || null, op = ops?.byRes?.[s(r.id)] || null
    const v = Object.fromEntries(vers.filter((x: any) => x.reservation_id === r.id).map((x: any) => [x.kind, x.status]))
    return { ...stayOf(r), resId: s(r.id), notes: nts, tags: rd.tags, vehicle: rd.vehicle, writers: rd.initials,
      id: { decision: v.id || null, onFile: d ? d.idOnFile : null, type: d?.idType || null, guests: d ? `${d.idGuests}/${d.guests}` : null },
      card: { decision: v.card || null, onFile: d ? d.cardOnFile : null },
      operto: op, guestStatus: d?.guestStatus || null }
  })
  const live = rs.filter(r => !['canceled', 'no_show'].includes(s(r.status)))
  return {
    key, name: s(rs[0].guest_name), email: rs[0].guest_email || null, phone: rs[0].guest_phone || null,
    totals: { stays: live.length, nights: live.reduce((a, r) => a + (Number(r.nights) || 0), 0), spend: Math.round(live.reduce((a, r) => a + (Number(r.total) || 0), 0) * 100) / 100, cancelled: rs.length - live.length },
    channels: Array.from(new Set(rs.map(r => s(r.source)).filter(Boolean))),
    stays, calls,
  }
}
