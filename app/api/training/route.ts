// TRAINING — the tab's API (Jon, 2026-10-26). Feature key `training`: view reads the library and
// finishes your own items, edit adds items / uploads videos / assigns, full archives.
//
//   GET  ?all=1                       the bundle: items (+archived with all=1), play URLs, people, assignments, candidates
//   POST { action, ... }              item.create · item.update · item.archive · item.restore
//                                     upload.sign · upload.done · assign · unassign · complete · reopen · person.update · view
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import {
  listItems, createItem, updateItem, itemById, removeFile, signUpload, playableUrls,
  listPeople, candidates, ensurePerson, updatePerson, listAssignments, assign, unassign, complete, reopen, recordView,
  type Lang,
} from '@/lib/training'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const who = (g: any) => String(g.access.profile?.name || g.access.profile?.full_name || g.access.email || 'someone')
const lvl = (g: any) => String(g.access.levels['training'] || (g.access.role === 'admin' ? 'full' : 'off'))
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status })
const langOf = (v: any): Lang => (String(v || '').toLowerCase() === 'es' ? 'es' : 'en')

export async function GET(req: NextRequest) {
  const gate = await requireLevel('training', 'view')
  if (!gate.ok) return gate.res
  const level = lvl(gate)
  const can = { edit: level === 'edit' || level === 'full' || gate.access.role === 'admin', full: level === 'full' || gate.access.role === 'admin' }
  const all = new URL(req.url).searchParams.get('all') === '1' && can.edit
  try {
    const items = await listItems(all)
    const [urls, people, assignments] = await Promise.all([playableUrls(items), listPeople(), listAssignments()])
    const me = String(gate.access.email || '').toLowerCase()
    const cands = can.edit ? await candidates() : []
    return NextResponse.json({ ok: true, items, urls, people, assignments, candidates: cands, can, me })
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const action = String(body?.action || '')
  const selfOnly = ['complete', 'view', 'person.update'].indexOf(action) >= 0
  const needsFull = ['item.archive', 'item.restore'].indexOf(action) >= 0
  const gate = await requireLevel('training', selfOnly ? 'view' : needsFull ? 'full' : 'edit')
  if (!gate.ok) return gate.res
  const by = who(gate)
  const me = String(gate.access.email || '').toLowerCase()
  const level = lvl(gate)
  const canEdit = level === 'edit' || level === 'full' || gate.access.role === 'admin'
  try {
    switch (action) {
      case 'item.create': {
        const r = await createItem(body.item || {}, by)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'item.update': {
        const r = await updateItem(String(body.itemId || ''), body.item || {}, by)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'item.archive':
      case 'item.restore': {
        const r = await updateItem(String(body.itemId || ''), { status: action === 'item.archive' ? 'archived' : 'active' }, by)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'upload.sign': {
        const item = await itemById(String(body.itemId || ''))
        if (!item) return bad('That item does not exist.', 404)
        const r = await signUpload(item.id, langOf(body.lang), String(body.filename || 'video.mp4'))
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'upload.done': {
        const item = await itemById(String(body.itemId || ''))
        if (!item) return bad('That item does not exist.', 404)
        const lang = langOf(body.lang)
        const path = String(body.path || '')
        if (!path.startsWith(`items/${item.id}/`)) return bad('That upload does not belong to this item.')
        const old = lang === 'es' ? item.videoPath.es : item.videoPath.en
        const patch: any = lang === 'es' ? { videoPathEs: path } : { videoPathEn: path }
        if (body.durationSec != null && Number.isFinite(Number(body.durationSec))) patch.durationSec = Number(body.durationSec)
        const r = await updateItem(item.id, patch, by)
        if (r.ok && old && old !== path) await removeFile(old)
        if (!r.ok) return NextResponse.json(r, { status: 400 })
        const urls = await playableUrls([r.item])
        return NextResponse.json({ ok: true, item: r.item, url: urls[r.item.id] })
      }
      case 'assign': {
        const r = await assign({ itemIds: body.itemIds || [], people: body.people || [], dueOn: body.dueOn || null, by, byEmail: me, notifyUsers: body.notifyUsers !== false })
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'unassign': {
        const r = await unassign(String(body.itemId || ''), String(body.personKey || ''))
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'complete': {
        // A person may finish their own item; a manager may mark anyone's.
        const key = String(body.personKey || me).toLowerCase()
        if (key !== me && !canEdit) return bad('Only a manager can mark someone else done.', 403)
        if (key === me) await ensurePerson({ key: me, name: by, email: me, dept: 'office' })
        const r = await complete(String(body.itemId || ''), key, langOf(body.lang), key === me ? 'app' : 'manager')
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'reopen': {
        if (!canEdit) return bad('Only a manager can reopen.', 403)
        const r = await reopen(String(body.itemId || ''), String(body.personKey || ''))
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'person.update': {
        const key = String(body.personKey || me).toLowerCase()
        if (key !== me && !canEdit) return bad('Only a manager can change someone else.', 403)
        const p = await updatePerson(key, { lang: body.lang ? langOf(body.lang) : undefined, name: body.name, email: body.email, newCode: body.newCode === true })
        return NextResponse.json({ ok: !!p, person: p })
      }
      case 'view': {
        await recordView(String(body.itemId || ''), me || null, langOf(body.lang))
        return NextResponse.json({ ok: true })
      }
      default:
        return bad('Unknown action.')
    }
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}
