// SYSTEM-WIDE comments with @mentions -> in-app notifications. A comment attaches to any
// entity via (type, id): glitches, Breezeway tasks (type 'task'), anything else later. Mentioned teammates (picked in the
// UI or typed as @name in the text) get a notification; on glitches the creator does too.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { notify } from '@/lib/notify'
import { breezewayConfigured, retrieveBreezewayTask, updateBreezewayTask, listBreezewayComments, createBreezewayComment, matchBreezewayPerson, breezewayPeopleLite, breezewayPersonName, breezewayMention } from '@/lib/breezeway'
import { importTaskComments } from '@/lib/breezeway-comment-sync'
import { getSetting, setSetting } from '@/lib/app-settings'
import { getToken } from '@/lib/guesty'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

// Guesty "Reservation Notes" custom field - the same field the vendor board writes to, so notes
// entered anywhere in the app land in ONE place in Guesty.
const GUESTY_BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const RES_NOTES_FIELD = '695f16830cb54c001400b3ff'
const fieldIdOf = (c: any): string | null => (c?.fieldId?._id) || (typeof c?.fieldId === 'string' ? c.fieldId : null) || c?._id || null
function isNotesField(c: any): boolean { return String(fieldIdOf(c) || '') === RES_NOTES_FIELD || /reservation[_ ]?notes/i.test(String(c?.fieldName || '')) }

// Append a stamped line to the reservation's notes custom field in Guesty, and mirror it locally
// so the app shows it immediately. Returns true when Guesty accepted the write.
async function appendGuestyNote(db: any, reservationId: string, line: string): Promise<boolean> {
  const { data: row } = await db.from('guesty_reservations').select('custom_fields, raw').eq('id', reservationId).maybeSingle()
  if (!row) return false
  const raw: any = (row.raw && typeof row.raw === 'object') ? row.raw : {}
  const cf: any[] = Array.isArray((row as any).custom_fields) ? (row as any).custom_fields : (Array.isArray(raw.customFields) ? raw.customFields : [])
  const existing = cf.find(x => isNotesField(x))
  const prior = existing && typeof existing.value === 'string' ? existing.value : ''
  const next = prior ? prior + '\n' + line : line
  const notesId = existing ? (fieldIdOf(existing) || RES_NOTES_FIELD) : RES_NOTES_FIELD
  let token = ''
  try { token = await getToken() } catch { token = '' }
  if (!token) return false
  const r = await fetch(GUESTY_BASE + '/reservations/' + encodeURIComponent(reservationId), {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ customFields: [{ fieldId: notesId, value: next }] }),
  })
  if (!r.ok) return false
  try {
    const arr = Array.isArray((row as any).custom_fields) ? (row as any).custom_fields.slice() : []
    const idx = arr.findIndex((x: any) => isNotesField(x))
    if (idx >= 0) arr[idx] = Object.assign({}, arr[idx], { value: next })
    else arr.push({ fieldId: notesId, fieldName: 'Reservation Notes', value: next })
    await db.from('guesty_reservations').update({ custom_fields: arr, raw: Object.assign({}, raw, { customFields: arr }) }).eq('id', reservationId)
  } catch { /* mirror best-effort */ }
  return true
}

// WHO AM I IN BREEZEWAY? A Breezeway comment belongs to a PERSON — without a person id the API
// rejects the post, and the old code then quietly stamped the task description instead, which is
// why Jon's comments "never really worked". So the answer is resolved once and then REMEMBERED:
//   1. the saved map (set here the first time it resolves, or by an admin)
//   2. the user's profile name, then their email prefix, matched against the Breezeway roster
//   3. the pinned shared person for staff with no Breezeway account
// and whatever the answer is, the UI is told, so nobody posts into a void again.
const BZ_MAP_KEY = 'breezeway_person_by_email'

async function resolveCommentPerson(db: any, me: string): Promise<{ id: number | null; name: string | null }> {
  const saved = await getSetting<Record<string, any>>(BZ_MAP_KEY, {})
  const fromMap = Number((saved || {})[me])
  if (Number.isFinite(fromMap) && fromMap > 0) return { id: fromMap, name: await breezewayPersonName(fromMap) }
  let id: number | null = null
  try {
    const { data: me2 } = await db.from('app_users').select('profile').eq('email', me).maybeSingle()
    const prof: any = (me2 && (me2 as any).profile) || {}
    id = await matchBreezewayPerson(str(prof.name) || str(prof.full_name) || me)
    if (!id) id = await matchBreezewayPerson(me)   // profile name may be a formal name Breezeway does not use
  } catch { /* fall through to the pinned person */ }
  if (!id) {
    try {
      const { data: st } = await db.from('app_settings').select('value').eq('key', 'breezeway_comment_person_id').maybeSingle()
      const pinned = Number(str(st && (st as any).value).replace(/"/g, ''))
      if (Number.isFinite(pinned) && pinned > 0) id = pinned
    } catch { /* none pinned */ }
  }
  if (id) { try { await setSetting(BZ_MAP_KEY, Object.assign({}, saved || {}, { [me]: id }), me) } catch { /* remembering is a bonus */ } }
  return { id, name: id ? await breezewayPersonName(id) : null }
}

async function teamEmails(db: any): Promise<string[]> {
  const { data } = await db.from('app_users').select('email,status')
  return ((data || []) as any[])
    .filter(u => str(u.status).toLowerCase() !== 'disabled')
    .map(u => str(u.email).toLowerCase()).filter(Boolean)
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const type = str(req.nextUrl.searchParams.get('type'))
  const id = str(req.nextUrl.searchParams.get('id'))
  if (!type || !id) return NextResponse.json({ ok: false, error: 'type and id required.' }, { status: 400 })
  const db = supabaseAdmin()
  // FULL CLARITY on a Breezeway task: show what is actually written in Breezeway (task
  // description, what the field crew reads) AND in Guesty (the reservation_notes custom field),
  // next to the app thread - so all three surfaces are visible in one place.
  let breezeway: any = null
  let guesty: any = null
  let bzPeople: { id: number; name: string }[] = []
  let bzMe: { id: number | null; name: string | null } = { id: null, name: null }
  if (type === 'task') {
    try {
      if (breezewayConfigured()) {
        const cur = await retrieveBreezewayTask(id)
        const t: any = cur.ok && cur.data ? (cur.data.task || cur.data) : null
        if (t) breezeway = { taskId: id, name: str(t.name), description: str(t.description), url: 'https://app.breezeway.io/task/' + id, comments: [] as any[] }
        // The field crew's own thread on the task — what they write in the Breezeway app.
        try {
          const bc = await listBreezewayComments(id)
          if (breezeway && bc.ok) breezeway.comments = bc.comments
          // INSTANT INBOUND: store anything new as an app comment and notify the thread right now,
          // instead of leaving it to the 15-minute cron.
          if (bc.ok) { try { await importTaskComments(id, bc.comments) } catch { /* best effort */ } }
        } catch { /* best effort */ }
        // The full Breezeway roster, so a comment can tag anyone who works there — not just the
        // handful of people who happen to have a Lighthouse login.
        try { bzPeople = await breezewayPeopleLite() } catch { /* best effort */ }
        try { bzMe = await resolveCommentPerson(db, String(user.email || '').toLowerCase()) } catch { /* best effort */ }
      }
    } catch { /* best effort */ }
    try {
      const { data: mt } = await db.from('breezeway_tasks_sync').select('linked_reservation_id').eq('id', id).maybeSingle()
      const rid = str(mt && (mt as any).linked_reservation_id)
      if (rid) {
        const { data: res } = await db.from('guesty_reservations').select('id,guest_name,check_in,check_out,custom_fields').eq('id', rid).maybeSingle()
        if (res) {
          const cf: any[] = Array.isArray((res as any).custom_fields) ? (res as any).custom_fields : []
          const nf = cf.find(x => isNotesField(x))
          guesty = { reservationId: rid, guestName: str((res as any).guest_name), checkIn: str((res as any).check_in).slice(0, 10), checkOut: str((res as any).check_out).slice(0, 10), notes: str(nf && nf.value) }
        }
      }
    } catch { /* best effort */ }
  }
  // Read the app thread AFTER the import above, so a reply that just arrived is already in it.
  const { data, error } = await db.from('app_comments')
    .select('id,author_email,body,mentions,created_at')
    .eq('entity_type', type).eq('entity_id', id)
    .order('created_at', { ascending: true }).limit(100)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, comments: data || [], team: await teamEmails(db), breezeway, guesty, bzPeople, bzMe })
}

// "That is me in Breezeway." Saved once per user and reused for every comment afterwards, so a
// name mismatch between the two systems can never silently swallow comments again.
export async function PATCH(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const me = user.email.toLowerCase()
  const b = await req.json().catch(() => ({} as any))
  const personId = Number(b.personId)
  const saved = await getSetting<Record<string, any>>(BZ_MAP_KEY, {})
  const next = Object.assign({}, saved || {})
  if (Number.isFinite(personId) && personId > 0) next[me] = personId
  else delete next[me]
  const w = await setSetting(BZ_MAP_KEY, next, me)
  if (!w.ok) return NextResponse.json({ ok: false, error: w.error || 'Could not save' }, { status: 500 })
  return NextResponse.json({ ok: true, bzMe: { id: next[me] || null, name: next[me] ? await breezewayPersonName(next[me]) : null } })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const me = user.email.toLowerCase()
  const b = await req.json().catch(() => ({} as any))
  const type = str(b.type); const id = str(b.id); const body = str(b.body).trim()
  if (!type || !id || !body) return NextResponse.json({ ok: false, error: 'type, id and body are required.' }, { status: 400 })
  const db = supabaseAdmin()
  const team = await teamEmails(db)
  // mentions: explicit picks + @tokens in the text matched against team email prefixes
  const picked = (Array.isArray(b.mentions) ? b.mentions : []).map((x: any) => str(x).toLowerCase()).filter((x: string) => team.includes(x))
  const tokens = Array.from(body.matchAll(/@([a-z0-9._-]+)/gi)).map(m => (m as any)[1].toLowerCase())
  const fromText = team.filter(t => tokens.some(tok => t.split('@')[0] === tok || t === tok))
  const mentions: string[] = Array.from(new Set<string>(picked.concat(fromText)))
  const { data: row, error } = await db.from('app_comments')
    .insert({ entity_type: type, entity_id: id, author_email: me, body: body.slice(0, 2000), mentions })
    .select('id,author_email,body,mentions,created_at').single()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  // notifications: mentioned teammates always; on glitches the creator hears about every comment
  const actorName = me.split('@')[0]
  const label = str(b.label) || type
  const link = type === 'glitch' ? '/glitches' : (str(b.link) || (type === 'task' ? '/plan' : null))
  if (mentions.length) await notify(mentions, { kind: 'mention', title: actorName + ' tagged you: ' + label, body, link: link || undefined, actor: me })
  // THREAD FOLLOWERS: anyone who already commented here hears about the reply, so a comment
  // left on a task comes back as a notification without re-opening the board.
  try {
    const { data: prior } = await db.from('app_comments').select('author_email').eq('entity_type', type).eq('entity_id', id).limit(200)
    const followers = Array.from(new Set(((prior || []) as any[]).map(r => str(r.author_email).toLowerCase())))
      .filter(e => e && e !== me && !mentions.includes(e) && team.includes(e))
    if (followers.length) await notify(followers, { kind: 'comment', title: actorName + ' replied: ' + label, body, link: link || undefined, actor: me })
  } catch { /* best effort */ }
  if (type === 'glitch') {
    try {
      const { data: g } = await db.from('glitches').select('created_by').eq('id', id).maybeSingle()
      const creator = str(g && g.created_by).toLowerCase()
      if (creator && creator !== me && !mentions.includes(creator) && team.includes(creator)) {
        await notify([creator], { kind: 'comment', title: actorName + ' commented: ' + label, body, link: link || undefined, actor: me })
      }
    } catch { /* best effort */ }
  }
  // Optional: mirror the comment onto the BREEZEWAY task so the field crew sees it in their app.
  // Best effort - never fails the comment itself.
  let breezeway: boolean | undefined = undefined
  let breezewayNote: boolean | undefined = undefined   // the description fallback, reported separately
  let bzError: string | null = null
  let bzWho: { id: number | null; name: string | null } | null = null
  let bzTagged: string[] = []
  let bzDebug: any = null
  const bzTaskId = str(b.taskId)
  if (b.toBreezeway === true && bzTaskId && breezewayConfigured()) {
    breezeway = false
    try {
      // A real Breezeway COMMENT is what the crew sees and can reply to. Only if that endpoint
      // fails do we fall back to stamping the description (the old behaviour) — and that fallback
      // is reported as what it is, NOT as a successful comment.
      const who = await resolveCommentPerson(db, me)
      bzWho = who
      // TAG ANYONE IN BREEZEWAY: their own mention encoding is {{personId,Name}}, so the tagged
      // person is notified inside Breezeway exactly as if a teammate had typed it there.
      const roster = await breezewayPeopleLite().catch(() => [] as { id: number; name: string }[])
      const wanted = (Array.isArray(b.bzMentions) ? b.bzMentions : []).slice(0, 10)
      const tokens: string[] = []
      for (const m of wanted) {
        const wid = Number((m && (m.id ?? m)) as any)
        const hit = roster.find(p => p.id === wid)
        if (!hit) continue
        tokens.push(breezewayMention(hit.id, hit.name))
        bzTagged.push(hit.name)
      }
      const text = (tokens.length ? tokens.join(' ') + ' ' : '') + actorName + ': ' + body
      const cr = await createBreezewayComment(bzTaskId, text, who.id)
      // Breezeway has answered 200 with an empty body before while silently not creating the
      // comment, so success means "it is actually in the thread now", not "the call returned 200".
      bzDebug = { status: cr.status, path: cr.path, personId: who.id, text: str(cr.text).slice(0, 200) }
      if (cr.ok) {
        try {
          const back = await listBreezewayComments(bzTaskId)
          const needle = body.slice(0, 40)
          breezeway = back.ok && back.comments.some(x => x.body.includes(needle))
          bzDebug.readBack = back.comments.length
          if (!breezeway) bzError = 'Breezeway accepted the comment but it is not in the thread.'
        } catch { breezeway = cr.ok }
      } else {
        bzError = who.id
          ? 'Breezeway rejected the comment (' + cr.status + ').'
          : 'We could not tell who you are in Breezeway, so the comment was refused. Pick your Breezeway name once and it will be remembered.'
      }
      if (!breezeway) {
        // Last resort so the message still reaches the crew: stamp the task description.
        const cur = await retrieveBreezewayTask(bzTaskId)
        const t: any = cur.ok && cur.data ? (cur.data.task || cur.data) : null
        if (t) {
          const stamp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date())
          const existing = str(t.description)
          const description = ('NOTE (' + actorName + ', ' + stamp + '): ' + body + (existing ? '\n' + existing : '')).slice(0, 4000)
          const r = await updateBreezewayTask(bzTaskId, { name: str(t.name) || 'Task', description })
          breezewayNote = !!r.ok
        }
      }
    } catch (e: any) { breezeway = false; bzError = str(e?.message || e).slice(0, 160) }
  }
  // Optional: append to the GUESTY reservation notes (same custom field the vendor board uses),
  // so guest-facing context lives with the reservation. Reservation is resolved from the task
  // when the client does not pass one.
  let guesty: boolean | undefined = undefined
  if (b.toGuesty === true) {
    guesty = false
    try {
      let rid = str(b.reservationId)
      if (!rid && bzTaskId) {
        const { data: mt } = await db.from('breezeway_tasks_sync').select('linked_reservation_id').eq('id', bzTaskId).maybeSingle()
        rid = str(mt && (mt as any).linked_reservation_id)
      }
      if (!rid && type === 'task') {
        const { data: mt2 } = await db.from('breezeway_tasks_sync').select('linked_reservation_id').eq('id', id).maybeSingle()
        rid = str(mt2 && (mt2 as any).linked_reservation_id)
      }
      if (rid) {
        const stamp2 = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
        guesty = await appendGuestyNote(db, rid, '[' + stamp2 + '] ' + actorName + ': ' + body)
      }
    } catch { guesty = false }
  }
  return NextResponse.json({ ok: true, comment: row, notified: mentions, breezeway, breezewayNote, bzError, bzWho, bzTagged, guesty, bzDebug })
}
