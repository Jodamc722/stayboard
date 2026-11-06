// THE LISTING COPY AUDIT — the data (Jon, 2026-11-06). Every active listing's title and six sections,
// as last synced from Guesty, run through lib/copy-audit-core; plus the last Regenerate push of each unit
// and whether Guesty kept it (recorded by lib/regenerate-client verifyPush). Read-only.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { pageRows } from './db-page'
import { getSettingFresh, setSetting } from './app-settings'
import { auditCopy, AUDIT_SECTIONS, type Finding } from './copy-audit-core'

export const SYNC_KEY = 'regen_sync_log'
export type SyncNote = { at: string; synced: boolean; missing: string[]; by?: string | null }

export type AuditRow = {
  id: string; name: string; building: string
  bedrooms: number | null; bathrooms: number | null; sleeps: number | null
  title: string; summaryLen: number; syncedAt: string | null
  findings: Finding[]; push: SyncNote | null
}

const str = (v: any) => (v == null ? '' : String(v))

export async function buildCopyAudit(): Promise<{ at: string; rows: AuditRow[] }> {
  const sb = supabaseAdmin()
  const { rows: ls } = await pageRows<any>((a, b) => sb.from('guesty_listings')
    .select('id, title, nickname, building, status, bedrooms, bathrooms, max_occupancy, synced_at, rawTitle:raw->>title, rawPub:raw->publicDescription, rawPubs:raw->publicDescriptions')
    .order('id').range(a, b))
  const pushes = await getSettingFresh<Record<string, SyncNote>>(SYNC_KEY, {}).catch(() => ({} as Record<string, SyncNote>))
  const rows: AuditRow[] = []
  for (const l of ls) {
    if (str(l.status).toLowerCase() !== 'active') continue
    const pub = l.rawPub || l.rawPubs || {}
    const sections = Object.fromEntries(AUDIT_SECTIONS.map(k => [k, str(pub?.[k]).trim()]))
    const title = str(l.rawTitle || l.title).trim()
    const facts = { bedrooms: l.bedrooms, bathrooms: l.bathrooms, sleeps: l.max_occupancy }
    const findings = auditCopy({ title, sections }, facts)
    const push = pushes[l.id] || null
    if (push && !push.synced) findings.unshift({ level: 'fix', kind: 'sync', field: 'Push', message: `The last Regenerate push did not stick in Guesty: ${push.missing.join(', ') || 'unknown'}. Open the unit and push again.` })
    rows.push({
      id: l.id, name: str(l.nickname || l.title || l.id), building: str(l.building) || 'Other',
      bedrooms: l.bedrooms ?? null, bathrooms: l.bathrooms ?? null, sleeps: l.max_occupancy ?? null,
      title, summaryLen: sections.summary.length, syncedAt: l.synced_at || null, findings, push,
    })
  }
  rows.sort((a, b) => fixes(b) - fixes(a) || a.building.localeCompare(b.building) || a.name.localeCompare(b.name))
  return { at: new Date().toISOString(), rows }
}
const fixes = (r: AuditRow) => r.findings.filter(f => f.level === 'fix').length

/** Called after every Regenerate push is read back from Guesty. */
export async function recordPush(listingId: string, synced: boolean, missing: string[], by?: string | null) {
  const log = await getSettingFresh<Record<string, SyncNote>>(SYNC_KEY, {}).catch(() => ({} as Record<string, SyncNote>))
  log[listingId] = { at: new Date().toISOString(), synced, missing: missing.slice(0, 12).map(m => String(m).slice(0, 160)), by: by || null }
  return setSetting(SYNC_KEY, log, by || 'regenerate')
}
