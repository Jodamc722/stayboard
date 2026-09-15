// THE VENDOR'S VIEW OF THEIR OWN WORK.
//
// Jon, 2026-09-15: "can we please work on public board for just that."
//
// One permanent link per vendor company. It shows every job whose vendor_key is theirs, across
// every board, and — this is the part that matters — nothing else. A vendor holding this link
// cannot discover that other vendors exist, what anyone else charges, what else is wrong in the
// building, or that any other project exists at all.
//
// THE WHITELIST IS THE SECURITY. vendorJobView names the fields that go out. Anything added to
// project_steps in future is invisible here until somebody deliberately adds it, which is the
// right default for a surface with no login in front of it.
import 'server-only'
import { randomBytes } from 'crypto'
import { supabaseAdmin } from './supabase-admin'
import { type VendorRecord } from './projects-shared'
import { listVendors, getVendor } from './project-vendors'

/** 32 hex chars from the crypto RNG — long enough that a link cannot be guessed. */
export const newVendorToken = () => randomBytes(16).toString('hex')

export type VendorJob = {
  id: string
  title: string
  detail: string | null
  unit: string | null
  visit_on: string | null
  visit_window: string | null
  est_minutes: number | null
  due_on: string | null
  status: string
  done: boolean
  confirmed: boolean
  proposed_on: string | null
  photos: { id: string; url: string; caption: string | null; created_at: string }[]
  messages: { body: string; author: string | null; mine: boolean; created_at: string }[]
  invoices: { id: string; amount_cents: number; number: string | null; status: string; created_at: string }[]
}

/** The vendor behind a link, or null. Also stamps that the link was opened. */
export async function getVendorByToken(token: string): Promise<VendorRecord | null> {
  const t = String(token || '').trim()
  if (t.length < 24) return null                     // too short to be one of ours; do not even query
  try {
    const sb = supabaseAdmin()
    const { data } = await sb.from('vendors').select('key,share_expires').eq('share_token', t).maybeSingle()
    if (!data) return null
    if ((data as any).share_expires && new Date((data as any).share_expires).getTime() < Date.now()) return null
    // Best-effort: knowing whether a link has ever been opened is worth more than a failed write here.
    sb.from('vendors').update({ share_seen_at: new Date().toISOString() }).eq('key', (data as any).key).then(() => {}, () => {})
    return await getVendor(String((data as any).key))
  } catch { return null }
}

/**
 * Every job that belongs to this vendor.
 *
 * Personal boards and one-on-ones are excluded outright. A vendor_key should never appear on
 * either, but "should never" is not a security model: a job filed on somebody's private board by
 * mistake must not become readable by an outside company because of it.
 */
export async function vendorJobs(vendorKey: string, opts: { includeDone?: boolean } = {}): Promise<VendorJob[]> {
  const key = String(vendorKey || '').trim()
  if (!key) return []
  const sb = supabaseAdmin()
  try {
    let q = sb.from('project_steps')
      .select('id,project_id,title,description,status,due_on,visit_on,visit_window,est_minutes,vendor_confirmed_at,vendor_proposed_on')
      .eq('vendor_key', key)
      .order('visit_on', { ascending: true, nullsFirst: false })
      .limit(300)
    if (!opts.includeDone) q = q.neq('status', 'done')
    const { data: rows, error } = await q
    if (error || !rows || !rows.length) return []

    const pids = Array.from(new Set(rows.map(r => String((r as any).project_id))))
    const { data: projs } = await sb.from('projects').select('id,kind,archived').in('id', pids)
    const allowed = new Set(((projs || []) as any[])
      .filter(p => p.kind !== 'personal' && p.kind !== 'one_on_one' && !p.archived)
      .map(p => String(p.id)))
    const kept = (rows as any[]).filter(r => allowed.has(String(r.project_id)))
    if (!kept.length) return []
    const ids = kept.map(r => String(r.id))

    const [links, photos, notes, invoices] = await Promise.all([
      sb.from('project_links').select('task_id,kind,label').in('task_id', ids).in('kind', ['listing', 'building']),
      sb.from('project_photos').select('id,task_id,url,caption,created_at,via_share').in('task_id', ids).order('created_at'),
      // ONLY THE CONVERSATION THEY ARE PART OF. via_share marks what was written on a share link,
      // in either direction; internal comments about a vendor are exactly what must not leak to
      // the vendor being discussed.
      sb.from('project_notes').select('task_id,body,author,via_share,created_at,kind').in('task_id', ids).eq('via_share', true).eq('kind', 'comment').order('created_at'),
      sb.from('project_invoices').select('id,task_id,amount_cents,number,status,created_at').in('task_id', ids).order('created_at'),
    ])

    const by = <T extends { task_id?: any }>(list: T[] | null | undefined) => {
      const m: Record<string, T[]> = {}
      for (const x of (list || [])) (m[String((x as any).task_id)] = m[String((x as any).task_id)] || []).push(x)
      return m
    }
    const L = by(links.data as any), P = by(photos.data as any), N = by(notes.data as any), I = by(invoices.data as any)

    return kept.map(r => {
      const id = String(r.id)
      const unit = (L[id] || []).find((l: any) => l.kind === 'listing') || (L[id] || [])[0]
      return {
        id,
        title: String(r.title || ''),
        detail: r.description ? String(r.description) : null,
        unit: unit ? String((unit as any).label || '') : null,
        visit_on: r.visit_on ? String(r.visit_on).slice(0, 10) : null,
        visit_window: r.visit_window ? String(r.visit_window) : null,
        est_minutes: r.est_minutes == null ? null : Number(r.est_minutes),
        due_on: r.due_on ? String(r.due_on).slice(0, 10) : null,
        status: String(r.status || 'todo'),
        done: String(r.status) === 'done',
        confirmed: !!r.vendor_confirmed_at,
        proposed_on: r.vendor_proposed_on ? String(r.vendor_proposed_on).slice(0, 10) : null,
        photos: (P[id] || []).map((x: any) => ({ id: String(x.id), url: String(x.url), caption: x.caption ?? null, created_at: String(x.created_at) })),
        messages: (N[id] || []).map((x: any) => ({ body: String(x.body || ''), author: x.author ?? null, mine: false, created_at: String(x.created_at) })),
        invoices: (I[id] || []).map((x: any) => ({ id: String(x.id), amount_cents: Number(x.amount_cents) || 0, number: x.number ?? null, status: String(x.status), created_at: String(x.created_at) })),
      }
    })
  } catch { return [] }
}

/** The job behind a (token, jobId) pair — the check every write goes through. */
export async function vendorJobFor(vendorKey: string, jobId: string): Promise<{ id: string; project_id: string; title: string } | null> {
  try {
    const { data } = await supabaseAdmin().from('project_steps')
      .select('id,project_id,title,vendor_key').eq('id', String(jobId)).maybeSingle()
    if (!data || String((data as any).vendor_key || '') !== String(vendorKey)) return null
    const { data: p } = await supabaseAdmin().from('projects').select('kind,archived').eq('id', (data as any).project_id).maybeSingle()
    if (!p || (p as any).archived || (p as any).kind === 'personal' || (p as any).kind === 'one_on_one') return null
    return { id: String((data as any).id), project_id: String((data as any).project_id), title: String((data as any).title || '') }
  } catch { return null }
}

/** Make, or replace, a vendor's link. Replacing revokes the old one — that is the point of it. */
export async function mintVendorToken(key: string, by: string): Promise<string | null> {
  try {
    const token = newVendorToken()
    const { error } = await supabaseAdmin().from('vendors').update({
      share_token: token, share_made_at: new Date().toISOString(), share_made_by: by, share_seen_at: null, share_expires: null,
    }).eq('key', String(key))
    return error ? null : token
  } catch { return null }
}

export async function revokeVendorToken(key: string): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin().from('vendors')
      .update({ share_token: null, share_made_at: null, share_made_by: null }).eq('key', String(key))
    return !error
  } catch { return false }
}

/** The existing link for a vendor, if there is one. */
export async function vendorToken(key: string): Promise<{ token: string | null; seen_at: string | null }> {
  try {
    const { data } = await supabaseAdmin().from('vendors').select('share_token,share_seen_at').eq('key', String(key)).maybeSingle()
    return { token: (data as any)?.share_token ?? null, seen_at: (data as any)?.share_seen_at ?? null }
  } catch { return { token: null, seen_at: null } }
}

export { listVendors }
