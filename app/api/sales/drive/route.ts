// The Drive folder the projections library keeps up with (lib/sales-drive-sync).
//   GET                              → the folder, whether it is on, the last run and the latest imports (sales view)
//   POST { action: 'run' }           → check the folder now
//   POST { action: 'retry' }         → check now, reading again the files that failed
//   POST { action: 'save', folder?, on? } → change the folder link, or switch it on or off
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readDriveSync, runDriveSync, saveDriveSyncSettings, type DriveSyncState } from '@/lib/sales-drive-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const view = (s: DriveSyncState) => ({ folderId: s.folderId, folderUrl: 'https://drive.google.com/drive/folders/' + s.folderId, on: s.on, lastRun: s.lastRun || null, log: s.log.slice(0, 12),
  failed: Object.values(s.seen).filter(x => x.result === 'failed').length, skipped: Object.values(s.seen).filter(x => x.result === 'skipped').map(x => ({ name: x.name, note: x.note || '' })).slice(0, 20) })

export async function GET() {
  const g = await requireLevel('sales', 'view'); if (!g.ok) return g.res
  return NextResponse.json({ ok: true, drive: view(await readDriveSync()) })
}
export async function POST(req: NextRequest) {
  const g = await requireLevel('sales', 'edit'); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  if (b.action === 'save') {
    const r = await saveDriveSyncSettings({ folder: typeof b.folder === 'string' ? b.folder : undefined, on: typeof b.on === 'boolean' ? b.on : undefined }, g.access.email || null)
    return r.ok ? NextResponse.json({ ok: true, drive: view(r.state!) }) : NextResponse.json({ ok: false, error: r.error }, { status: 400 })
  }
  if (b.action === 'run' || b.action === 'retry') {
    const r = await runDriveSync(g.access.email || null, { force: true, retry: b.action === 'retry' })
    return NextResponse.json({ ok: r.ok, error: r.error, added: r.added, updated: r.updated, failed: r.failed, left: r.left, drive: r.state ? view(r.state) : null }, { status: r.ok ? 200 : 400 })
  }
  return NextResponse.json({ ok: false, error: 'Nothing to do.' }, { status: 400 })
}
