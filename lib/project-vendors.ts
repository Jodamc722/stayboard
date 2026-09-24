// THE VENDOR CONTACT CARD.
//
// Jon, 2026-09-15: "pull from once you save a vendor, save that vendor, have their phone number".
//
// This reads and writes the SAME `vendors` table lib/staffing already uses. That is deliberate:
// staffing's view of a vendor answers "which company covers this building", and this one answers
// "who do I call and what do they charge". Two tables would mean saving the plumber twice and
// then wondering which copy is right. lib/staffing.getVendors keeps working untouched — it simply
// selects fewer columns.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { type VendorRecord, VENDOR_TRADES, RATE_UNITS, CADENCES } from './projects-shared'

const str = (v: any) => (typeof v === 'string' ? v.trim() : '')
const num = (v: any): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null }

export const slugVendor = (s: string) =>
  String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

/** Digits only, then formatted for a US number. A vendor's phone is for dialling, so it is stored
 *  the way a person reads it out, not the way a form happened to receive it. */
export const tidyPhone = (raw: any): string | null => {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (!d) return null
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return String(raw).trim().slice(0, 40)   // international or an extension — keep what they typed
}

const shape = (r: any): VendorRecord => ({
  key: String(r.key), label: String(r.label || r.key),
  contact_name: r.contact_name ?? null,
  // `contact` is the old free-text column from 062. When nothing structured has been saved yet it
  // is the only contact detail there is, so it stands in rather than showing a blank card.
  phone: r.phone ?? null, email: r.email ?? null,
  trade: r.trade ?? null,
  buildings: Array.isArray(r.buildings) ? r.buildings.map(String) : [],
  rate_cents: r.rate_cents == null ? null : Number(r.rate_cents),
  rate_unit: r.rate_unit ?? null,
  billing: r.billing ?? null,
  address: r.address ?? null,
  notes: [r.notes, !r.phone && !r.email && r.contact ? 'Contact: ' + r.contact : ''].filter(Boolean).join('\n') || null,
  w9_on_file: !!r.w9_on_file,
  coi_expires: r.coi_expires ?? null,
  active: r.active !== false, sort: Number(r.sort) || 100,
  regular: !!r.regular,
  cadence: (CADENCES as readonly string[]).includes(String(r.cadence || '')) ? r.cadence : null,
})

/** FAIL-OPEN: no vendors table, or no 087 yet, means an empty picker — never a broken page. */
export async function listVendors(includeInactive = false): Promise<VendorRecord[]> {
  try {
    const { data, error } = await supabaseAdmin().from('vendors').select('*').order('sort').order('label').limit(1000)
    if (error) return []
    const rows = ((data || []) as any[]).map(shape)
    return includeInactive ? rows : rows.filter(v => v.active)
  } catch { return [] }
}

export async function getVendor(key: string): Promise<VendorRecord | null> {
  const k = slugVendor(key); if (!k) return null
  try {
    const { data, error } = await supabaseAdmin().from('vendors').select('*').eq('key', k).maybeSingle()
    if (error || !data) return null
    return shape(data)
  } catch { return null }
}

/**
 * Save a vendor from the project form. Returns the saved record so the caller can select it
 * straight away — "save that vendor" and "use that vendor" are one action to the person doing it.
 *
 * Only fields that were SENT are written. A form that shows four boxes must not wipe the address
 * and the buildings list that somebody filled in on the staffing page.
 */
export async function saveVendor(v: Record<string, any>, by?: string): Promise<{ ok: true; vendor: VendorRecord } | { ok: false; error: string }> {
  const label = str(v.label)
  const key = slugVendor(str(v.key) || label)
  if (!key) return { ok: false, error: 'The vendor needs a name.' }
  const row: any = { key, updated_at: new Date().toISOString() }
  if (label || v.label !== undefined) row.label = label || key
  if (v.contact_name !== undefined) row.contact_name = str(v.contact_name) || null
  if (v.phone !== undefined) row.phone = tidyPhone(v.phone)
  if (v.email !== undefined) row.email = str(v.email).toLowerCase() || null
  if (v.trade !== undefined) row.trade = (VENDOR_TRADES as readonly string[]).includes(str(v.trade)) ? str(v.trade) : (str(v.trade) || null)
  if (v.address !== undefined) row.address = str(v.address) || null
  if (v.notes !== undefined) row.notes = str(v.notes) || null
  if (v.billing !== undefined) row.billing = str(v.billing) || null
  if (v.rate_cents !== undefined) row.rate_cents = num(v.rate_cents)
  if (v.rate_unit !== undefined) row.rate_unit = (RATE_UNITS as readonly string[]).includes(str(v.rate_unit)) ? str(v.rate_unit) : null
  if (v.w9_on_file !== undefined) row.w9_on_file = !!v.w9_on_file
  if (v.coi_expires !== undefined) row.coi_expires = /^\d{4}-\d{2}-\d{2}$/.test(str(v.coi_expires)) ? str(v.coi_expires) : null
  if (Array.isArray(v.buildings)) row.buildings = v.buildings.map((b: any) => str(b)).filter(Boolean)
  if (v.active !== undefined) row.active = !!v.active
  if (v.regular !== undefined) row.regular = !!v.regular
  if (v.cadence !== undefined) row.cadence = (CADENCES as readonly string[]).includes(str(v.cadence)) ? str(v.cadence) : null

  try {
    const sb = supabaseAdmin()
    const existing = await getVendor(key)
    if (!existing && by) row.created_by = by
    // `contact` is 062's free-text column and several ops screens still read it. Keep it readable
    // so a vendor saved here shows a human on the staffing page too, instead of an empty cell.
    const human = [row.contact_name, row.phone].filter(Boolean).join(' · ')
    if (human) row.contact = human
    let { error } = await sb.from('vendors').upsert(row, { onConflict: 'key' })
    if (error && /regular|cadence/i.test(error.message)) {
      // 109 not run yet: keep everything else rather than losing the save over two columns.
      const { regular: _r, cadence: _c, ...rest } = row
      ;({ error } = await sb.from('vendors').upsert(rest, { onConflict: 'key' }))
    }
    if (error) {
      // Before 087 the contact columns do not exist. Save what the old shape can hold rather than
      // refusing the whole vendor — a name and a phone number in `contact` still beats nothing.
      if (!/column|schema/i.test(error.message)) return { ok: false, error: error.message }
      const legacy: any = { key, label: row.label || key, updated_at: row.updated_at }
      if (human) legacy.contact = human
      if (row.notes !== undefined) legacy.notes = row.notes
      if (row.billing !== undefined) legacy.billing = row.billing
      if (row.buildings !== undefined) legacy.buildings = row.buildings
      const retry = await sb.from('vendors').upsert(legacy, { onConflict: 'key' })
      if (retry.error) return { ok: false, error: retry.error.message }
    }
    const saved = await getVendor(key)
    return saved ? { ok: true, vendor: saved } : { ok: false, error: 'Saved, but could not read it back.' }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}

/** Insurance that has lapsed, or lapses inside 30 days. Shown next to the vendor in the picker,
 *  because the moment to find out is before you send them to a unit, not after. */
export function coiState(v: VendorRecord, todayISO: string): { tone: 'bad' | 'warn' | 'ok'; label: string } | null {
  if (!v.coi_expires) return null
  const days = Math.round((new Date(v.coi_expires + 'T00:00:00Z').getTime() - new Date(todayISO + 'T00:00:00Z').getTime()) / 86400000)
  if (days < 0) return { tone: 'bad', label: 'Insurance expired' }
  if (days <= 30) return { tone: 'warn', label: `Insurance expires in ${days}d` }
  return { tone: 'ok', label: 'Insured' }
}

// ── THE VENDOR CARD ──────────────────────────────────────────────────────────────────────────────
// Jon, 2026-09-24: "if you select vendor maybe then opens up vendor info". One read, every board:
// who they are and how to reach them, whether they are insured, when they were last here, what is
// open with them right now across projects, glitches and requests, and — for a regular — whether
// they are overdue by their own cadence. Each source is best-effort; a board whose column has not
// been migrated yet contributes nothing rather than breaking the card.
export type VendorJob = { kind: 'project' | 'glitch' | 'request'; id: string; title: string; where: string | null; when: string | null; href: string; done: boolean }
export type VendorSummary = {
  vendor: VendorRecord
  coi: { tone: 'bad' | 'warn' | 'ok'; label: string } | null
  lastVisit: string | null          // ISO date of the most recent finished project visit
  overdueBy: number | null          // days past cadence since last visit (regular vendors only)
  open: VendorJob[]                 // open work with them, newest first, capped
  recent: VendorJob[]               // last few finished jobs
  invoices: { count: number; cents: number }   // approved + paid, last 12 months
}

export async function vendorSummary(key: string, todayISO: string): Promise<VendorSummary | null> {
  const v = await getVendor(key); if (!v) return null
  const db = supabaseAdmin()
  const open: VendorJob[] = [], recent: VendorJob[] = []
  let lastVisit: string | null = null
  let invoices = { count: 0, cents: 0 }
  const titleOf: Record<string, string> = {}
  try {
    const { data: steps } = await db.from('project_steps').select('id,project_id,title,status,done,visit_on,done_at,updated_at')
      .eq('vendor_key', v.key).order('updated_at', { ascending: false }).limit(60)
    const rows = (steps as any[]) || []
    const pids = Array.from(new Set(rows.map(r => String(r.project_id))))
    if (pids.length) {
      const { data: ps } = await db.from('projects').select('id,title,building').in('id', pids)
      for (const p of (ps as any[]) || []) titleOf[String(p.id)] = [p.building, p.title].filter(Boolean).join(' · ')
    }
    for (const r of rows) {
      const done = !!r.done || String(r.status) === 'done'
      const job: VendorJob = { kind: 'project', id: String(r.id), title: String(r.title || ''), where: titleOf[String(r.project_id)] || null, when: r.visit_on || (done ? String(r.done_at || '').slice(0, 10) : null) || null, href: `/projects/${r.project_id}?task=${r.id}`, done }
      if (done) { recent.push(job); const d = String(r.visit_on || r.done_at || '').slice(0, 10); if (d && d <= todayISO && (!lastVisit || d > lastVisit)) lastVisit = d }
      else open.push(job)
    }
  } catch { /* 088 not run */ }
  try {
    const { data: gs } = await db.from('glitches').select('id,unit,category,overview,status,created_at,closed_at').eq('vendor_key', v.key).order('created_at', { ascending: false }).limit(30)
    for (const g of (gs as any[]) || []) {
      const done = /^(closed|done|resolved)$/i.test(String(g.status || ''))
      const job: VendorJob = { kind: 'glitch', id: String(g.id), title: String(g.category || 'Guest issue') + (g.overview ? ' — ' + String(g.overview).replace(/\s+/g, ' ').slice(0, 60) : ''), where: g.unit || null, when: String(done ? g.closed_at || g.created_at : g.created_at).slice(0, 10), href: `/glitches?id=${g.id}`, done }
      ;(done ? recent : open).push(job)
    }
  } catch { /* 109 not run */ }
  try {
    const { data: rs } = await db.from('field_requests').select('id,title,unit,status,created_at,updated_at').eq('vendor_key', v.key).order('created_at', { ascending: false }).limit(30)
    for (const r of (rs as any[]) || []) {
      const done = /^(done|cancelled)$/i.test(String(r.status || ''))
      const job: VendorJob = { kind: 'request', id: String(r.id), title: String(r.title || ''), where: r.unit || null, when: String(done ? r.updated_at || r.created_at : r.created_at).slice(0, 10), href: `/requests/${r.id}`, done }
      ;(done ? recent : open).push(job)
    }
  } catch { /* 109 not run */ }
  try {
    const since = new Date(Date.parse(todayISO + 'T00:00:00Z') - 365 * 86400_000).toISOString().slice(0, 10)
    const { data: inv } = await db.from('project_invoices').select('amount_cents,status,issued_on,created_at').eq('vendor_key', v.key).in('status', ['approved', 'paid']).limit(500)
    for (const i of (inv as any[]) || []) {
      const d = String(i.issued_on || i.created_at || '').slice(0, 10)
      if (d && d < since) continue
      invoices = { count: invoices.count + 1, cents: invoices.cents + (Number(i.amount_cents) || 0) }
    }
  } catch { /* no invoices table yet */ }
  const byWhen = (a: VendorJob, b: VendorJob) => String(b.when || '').localeCompare(String(a.when || ''))
  open.sort(byWhen); recent.sort(byWhen)
  let overdueBy: number | null = null
  if (v.regular && v.cadence && lastVisit) {
    const { CADENCE_DAYS } = await import('./projects-shared')
    const days = Math.round((Date.parse(todayISO + 'T00:00:00Z') - Date.parse(lastVisit + 'T00:00:00Z')) / 86400_000)
    overdueBy = Math.max(0, days - CADENCE_DAYS[v.cadence])
  }
  return { vendor: v, coi: coiState(v, todayISO), lastVisit, overdueBy, open: open.slice(0, 8), recent: recent.slice(0, 5), invoices }
}
