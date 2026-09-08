// FILES ON A PROJECT OR A TASK — the upload half. (Removal is the fileDelete action on ../route.ts.)
//
//   POST /api/projects/<id>/upload   multipart: file (one or many), taskId?, caption?
//
// Two rules that matter more than the plumbing:
//   • PRIVATE BUCKET. A quote attached to a one-on-one is as private as the one-on-one. Objects go
//     to `project-files` (not public); the page gets six-hour signed URLs from lib/projects on read.
//     The old /api/projects/photo route (public bucket, vendor share link) is untouched — vendors
//     still post before/after photos through it.
//   • IMAGES ARE RE-ENCODED, DOCUMENTS ARE NOT. A phone photo is 4-8MB and the drawer shows it at
//     300px, so it is rotated, shrunk and saved as JPEG. A PDF or spreadsheet is stored byte-for-byte
//     because the whole point of attaching it is to open the real thing later.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel, isSuperadmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getProject, gateProject, logEvent, ensureFilesBucket, FILES_BUCKET, type Viewer } from '@/lib/projects'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_BYTES = 25 * 1024 * 1024
const MAX_FILES = 10
// What the team actually attaches. Anything executable or scriptable is refused — this is an ops
// board, not a file share, and a .html "invoice" is how phishing gets into a shared drive.
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
  'application/pdf': 'pdf',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/csv': 'csv', 'text/plain': 'txt', 'application/zip': 'zip',
}
const extOf = (name: string) => (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] || '').toLowerCase()
// Browsers sometimes send application/octet-stream for a perfectly good PDF; fall back to the extension.
const mimeFor = (file: File): string | null => {
  const m = String(file.type || '').toLowerCase()
  if (ALLOWED[m]) return m
  const ext = extOf(file.name)
  const hit = Object.entries(ALLOWED).find(([, e]) => e === ext)
  return hit ? hit[0] : null
}
const safeName = (s: string) => String(s || 'file').replace(/[^\w.\-() ]+/g, '_').slice(0, 120)

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireLevel('projects', 'edit')
  if (!g.ok) return g.res
  const id = params.id
  const me = g.access.email || 'someone'
  const viewer: Viewer = { email: g.access.email, superadmin: isSuperadmin(g.access.email) }
  try {
    const gate = await gateProject(id, viewer, 'edit')
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

    const form = await req.formData()
    const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0).slice(0, MAX_FILES)
    const taskId = String(form.get('taskId') || '').trim() || null
    const caption = String(form.get('caption') || '').trim().slice(0, 300) || null
    if (!files.length) return NextResponse.json({ error: 'No file.' }, { status: 400 })

    const sb = supabaseAdmin()
    let taskTitle: string | undefined
    if (taskId) {
      const { data: t } = await sb.from('project_steps').select('title').eq('id', taskId).eq('project_id', id).maybeSingle()
      if (!t) return NextResponse.json({ error: 'No such task.' }, { status: 404 })
      taskTitle = t.title
    }
    await ensureFilesBucket(sb)

    const saved: any[] = [], refused: string[] = []
    for (const file of files) {
      if (file.size > MAX_BYTES) { refused.push(`${file.name} is over 25MB`); continue }
      const mime = mimeFor(file)
      if (!mime) { refused.push(`${file.name || 'that file'} is a type the board does not take`); continue }

      let body: Buffer = Buffer.from(await file.arrayBuffer())
      let outMime = mime, ext = ALLOWED[mime]
      const isImage = /^image\//.test(mime) && mime !== 'image/gif'
      if (isImage) {
        try {
          body = await sharp(body).rotate().resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 84 }).toBuffer()
          outMime = 'image/jpeg'; ext = 'jpg'
        } catch { refused.push(`${file.name} could not be read as an image`); continue }
      }
      const key = `${id}/${taskId || 'project'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: upErr } = await sb.storage.from(FILES_BUCKET).upload(key, body, { contentType: outMime, upsert: false })
      if (upErr) { refused.push(`${file.name}: ${upErr.message}`); continue }

      const { data, error } = await sb.from('project_photos').insert({
        project_id: id, task_id: taskId, kind: isImage ? 'photo' : 'file',
        url: '', storage_path: key, name: safeName(file.name), mime: outMime, bytes: body.length,
        caption, phase: 'during', uploaded_by: me, via_share: false,
      }).select('id,name').single()
      if (error) { await sb.storage.from(FILES_BUCKET).remove([key]).catch(() => {}); refused.push(`${file.name}: ${error.message}`); continue }
      saved.push(data)
    }

    if (saved.length) {
      const what = saved.length === 1 ? saved[0].name : `${saved.length} files`
      await logEvent(id, me, 'file_added', `attached ${what}`, { name: what, task_id: taskId || undefined, task_title: taskTitle })
    }
    if (!saved.length) return NextResponse.json({ error: refused.join('; ') || 'Nothing was saved.' }, { status: 400 })
    return NextResponse.json({ ok: true, saved: saved.length, refused, project: await getProject(id) })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
