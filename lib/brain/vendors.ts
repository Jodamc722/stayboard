// VENDORS — who a vendor is under every name the other systems use (migration 178, vendor_xref).
//
// The first build wrote no vendor rows, and vendor_month stayed empty: the only vendor link in the
// data was glitches.vendor_key, which the board rarely fills. Vendors actually show up in four more
// places, and this file joins them:
//
//   THE REGISTRY        `vendors` (migration 062 / 087) — key + label, the companies on /users.
//   THE CLEANING RULE   lib/ops-presets vendorBuildings (getOpsPresets): Park Towers → Probol, Capri /
//                       Lucerne / Amrit → Opal Works, Botanica → Garden. A cleaning company that is
//                       not on the registry yet still gets a key (slug of its name) and its rows are
//                       left UNCONFIRMED, so it shows up to be added rather than disappearing.
//   BREEZEWAY           a vendor's crew is assigned as a Breezeway person ("Opal Works Opal Works" —
//                       Breezeway sends a company as first + last name). An assignee whose name
//                       carries a vendor's name is a MATCH, written confirmed = false.
//   PAPER TRAIL         glitches / project_steps / project_invoices / field_requests carry vendor_key
//                       beside the name typed at the time: those spellings are certain (a person
//                       picked the key) and are written confirmed = true. Cleaning-vendor invoices
//                       (app_settings, lib/clean-invoices) carry only a typed vendor name: matched,
//                       unconfirmed.
//
// A row a person confirmed keeps confirmed = true: the builder only ever SENDS confirmed = true
// (registry labels and picked spellings) and never sends false.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOpsPresets } from '@/lib/app-settings'
import { str, slug, aliasKey, pageRead, upsertBatches, addDays, todayET, type BuildResult } from './shared'

export type VendorRef = { key: string; label: string; registered: boolean }
export type VendorMap = {
  vendors: VendorRef[]
  /** vendor_key → label */
  label: Record<string, string>
  /** The vendor a person / company name belongs to (exact spelling first, then a name inside it). */
  keyForName: (name: any) => string | null
  /** The vendor a Breezeway assignee id belongs to. */
  keyForBzId: (id: any) => string | null
  /** The cleaning vendor of a vendor-cleaned building, from its label + unit name; null = we clean it. */
  cleanerOf: (buildingAndUnit: string) => string | null
  /** vendor_key → true when the key is not on the registry (a cleaning company from the presets). */
  unregistered: Record<string, boolean>
}

/** "Opal Works Opal Works" → "Opal Works" (lib/clean-invoices does the same). */
export function companyName(n: any): string {
  const s = str(n).replace(/\s+/g, ' ').trim()
  if (!s) return ''
  const h = s.split(' ')
  const k = h.length / 2
  return h.length % 2 === 0 && h.slice(0, k).join(' ').toLowerCase() === h.slice(k).join(' ').toLowerCase() ? h.slice(0, k).join(' ') : s
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

type Universe = {
  vendors: VendorRef[]
  aliases: Record<string, string>            // aliasKey → vendor_key
  cleaners: { re: RegExp; key: string }[]    // vendor-cleaned building pattern → cleaning vendor
}

async function universe(): Promise<{ u: Universe; partial: boolean; notes: string[] }> {
  const db = supabaseAdmin()
  const notes: string[] = []
  let partial = false
  const vendors: VendorRef[] = []
  const aliases: Record<string, string> = {}
  const byKey: Record<string, VendorRef> = {}
  const addVendor = (key: string, label: string, registered: boolean): VendorRef => {
    if (byKey[key]) return byKey[key]
    const v = { key, label, registered }
    byKey[key] = v; vendors.push(v)
    for (const a of [label, key.replace(/-/g, ' ')]) { const k = aliasKey(a); if (k && !aliases[k]) aliases[k] = key }
    return v
  }

  const reg = await pageRead<any>((a, b) => db.from('vendors').select('key,label').order('key').range(a, b), 2)
  if (reg.truncated) partial = true
  if (reg.missing) notes.push('vendors table not present')
  for (const r of reg.rows) { const key = str(r.key); if (key) addVendor(key, str(r.label) || key, true) }
  if (!reg.rows.length && !reg.missing) notes.push('the vendor registry is empty — cleaning companies come from the presets only')

  // The cleaning rule. A preset row that came FROM the registry has id 'vendor:<key>'.
  const cleaners: { re: RegExp; key: string }[] = []
  try {
    const presets = await getOpsPresets()
    for (const v of presets.vendorBuildings) {
      if (!v || !v.enabled) continue
      const pats: string[] = (v.terms || []).filter(Boolean).map(t => esc(t.trim()).replace(/\\?\s+/g, '\\s*'))
      for (const w of (v.wordTerms || []).filter(Boolean)) pats.push('\\b' + esc(w.trim()) + '\\b')
      if (!pats.length) continue
      let key: string
      if (v.id.indexOf('vendor:') === 0) key = v.id.slice(7)
      else {
        const company = companyName(v.company || v.assignTo || v.label)
        key = aliases[aliasKey(company)] || slug(company)
        if (!key) continue
        addVendor(key, company, !!byKey[key] && byKey[key].registered)
      }
      cleaners.push({ re: new RegExp(pats.join('|'), 'i'), key })
    }
  } catch { partial = true }
  return { u: { vendors, aliases, cleaners }, partial, notes }
}

function matcher(u: Universe, extra: Record<string, string>): (name: any) => string | null {
  const all: Record<string, string> = { ...extra, ...u.aliases }
  // Longest alias first, so "Opal Works Plumbing" is not taken by "Opal".
  const list = Object.keys(all).filter(a => a.length >= 4).sort((a, b) => b.length - a.length)
    .map(a => ({ re: new RegExp('(^|[^a-z0-9])' + esc(a) + '($|[^a-z0-9])', 'i'), key: all[a] }))
  return (name: any) => {
    const n = aliasKey(companyName(name))
    if (!n) return null
    if (all[n]) return all[n]
    for (const m of list) if (m.re.test(n)) return m.key
    return null
  }
}

/** Everything the other builders need to put a vendor on a row. Never throws. */
export async function loadVendorMap(): Promise<VendorMap & { partial: boolean }> {
  const db = supabaseAdmin()
  const { u, partial } = await universe().catch(() => ({ u: { vendors: [], aliases: {}, cleaners: [] } as Universe, partial: true, notes: [] as string[] }))
  const extra: Record<string, string> = {}
  const byBz: Record<string, string> = {}
  const x = await pageRead<any>((a, b) => db.from('vendor_xref').select('vendor_key,alias,breezeway_assignee_id').order('vendor_key').order('alias').range(a, b), 5)
  for (const r of x.rows) {
    const key = str(r.vendor_key), alias = aliasKey(r.alias)
    if (!key) continue
    if (alias && !extra[alias]) extra[alias] = key
    if (r.breezeway_assignee_id) byBz[str(r.breezeway_assignee_id)] = key
  }
  const label: Record<string, string> = {}
  const unregistered: Record<string, boolean> = {}
  for (const v of u.vendors) { label[v.key] = v.label; if (!v.registered) unregistered[v.key] = true }
  const keyForName = matcher(u, extra)
  return {
    vendors: u.vendors, label, unregistered, keyForName,
    keyForBzId: (id: any) => byBz[str(id)] || null,
    cleanerOf: (s: string) => { for (const c of u.cleaners) if (c.re.test(s)) return c.key; return null },
    partial: partial || x.truncated,
  }
}

/** Rebuild vendor_xref. Runs before the events so tonight's events can carry a vendor. */
export async function buildVendorXref(deadline: number): Promise<BuildResult> {
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const { u, partial: uPartial, notes } = await universe()
  let partial = uPartial
  if (!u.vendors.length) return { rows: 0, partial, note: notes.concat('no vendors to match').join('; ') }
  const keyForName = matcher(u, {})

  // Three shapes, three upserts: a row must never send a null over a value a person set.
  const certain: Record<string, any>[] = []   // confirmed = true, no Breezeway id
  const withBz: Record<string, any>[] = []    // a Breezeway match: id sent, confirmed not sent
  const guess: Record<string, any>[] = []     // a name match with no id: neither sent
  const seen: Record<string, boolean> = {}
  const push = (list: Record<string, any>[], row: Record<string, any>) => {
    const k = list === certain ? 'c' : list === withBz ? 'b' : 'g'
    const id = k + '|' + row.vendor_key + '|' + row.alias
    if (seen[id] || !row.alias || !row.vendor_key) return
    seen[id] = true; list.push(row)
  }

  // 1. Every vendor under its own name. A preset-only cleaning company is not confirmed: it is not
  //    on the registry yet, and the page lists it so someone adds it.
  for (const v of u.vendors) {
    const alias = aliasKey(v.label)
    if (v.registered) push(certain, { vendor_key: v.key, alias, confirmed: true, built_at: now })
    else push(guess, { vendor_key: v.key, alias, built_at: now })
  }

  // 2. Spellings typed beside a picked vendor_key — certain.
  const since = addDays(todayET(), -400) + 'T00:00:00Z'
  const paper: { table: string; col: string }[] = [
    { table: 'glitches', col: 'vendor_name' },
    { table: 'project_steps', col: 'vendor_name' },
    { table: 'project_invoices', col: 'vendor_name' },
  ]
  for (const p of paper) {
    if (Date.now() > deadline) { partial = true; break }
    const r = await pageRead<any>((a, b) => db.from(p.table).select('id,vendor_key,' + p.col)
      .not('vendor_key', 'is', null).gte('created_at', since).order('created_at').order('id').range(a, b), 5)
    if (r.truncated) partial = true
    for (const row of r.rows) {
      const key = str(row.vendor_key), alias = aliasKey(row[p.col])
      if (key && alias && u.vendors.some(v => v.key === key)) push(certain, { vendor_key: key, alias, confirmed: true, built_at: now })
    }
  }

  // 3. Breezeway assignees on the last 120 days of tasks (every department: a cleaning vendor's
  //    crew takes the departure cleans, a trade vendor the maintenance).
  let bzMatched = 0
  if (Date.now() < deadline) {
    const t = await pageRead<any>((a, b) => db.from('breezeway_tasks_sync').select('id,assignee_id,assignee_name,finished_by_name')
      .gte('scheduled_date', addDays(todayET(), -120)).order('scheduled_date').order('id').range(a, b), 25)
    if (t.truncated) partial = true
    const idName: Record<string, string> = {}
    const names: Record<string, boolean> = {}
    for (const r of t.rows) {
      const id = str(r.assignee_id), nm = companyName(r.assignee_name)
      if (id && nm && !idName[id]) idName[id] = nm
      for (const n of [nm, companyName(r.finished_by_name)]) if (n) names[n] = true
    }
    for (const id of Object.keys(idName)) {
      const key = keyForName(idName[id])
      if (key) { push(withBz, { vendor_key: key, alias: aliasKey(idName[id]), breezeway_assignee_id: id, built_at: now }); bzMatched++; delete names[idName[id]] }
    }
    for (const n of Object.keys(names)) {
      const key = keyForName(n)
      if (key) { push(guess, { vendor_key: key, alias: aliasKey(n), built_at: now }); bzMatched++ }
    }
  }

  // 4. Cleaning-vendor invoices (app_settings) — the vendor is whatever the invoice was read as.
  try {
    const { listInvoices } = await import('@/lib/clean-invoices')
    for (const inv of await listInvoices()) {
      const key = keyForName(inv.vendor)
      if (key) push(guess, { vendor_key: key, alias: aliasKey(companyName(inv.vendor)), built_at: now })
    }
  } catch { partial = true }

  const w1 = await upsertBatches('vendor_xref', certain, 'vendor_key,alias', { deadline })
  const w2 = await upsertBatches('vendor_xref', withBz, 'vendor_key,alias', { deadline })
  const w3 = await upsertBatches('vendor_xref', guess, 'vendor_key,alias', { deadline })
  const error = w1.error || w2.error || w3.error
  const registered = u.vendors.filter(v => v.registered).length
  notes.push(registered + ' on the registry, ' + (u.vendors.length - registered) + ' cleaning compan(ies) from the presets only; '
    + bzMatched + ' Breezeway name(s) matched (unconfirmed)')
  return {
    rows: w1.written + w2.written + w3.written,
    partial: partial || w1.stoppedEarly || w2.stoppedEarly || w3.stoppedEarly,
    ...(error ? { error } : {}), note: notes.join('; '),
  }
}
