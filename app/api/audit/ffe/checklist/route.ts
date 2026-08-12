// FF&E CHECKLIST EDITOR (Jon, 2026-08-11: "a tab where we can update it or add item").
//
// Writes rows into ffe_checklist_items, which is an OVERLAY on the built-in list in
// lib/ffe-checklist.ts rather than a replacement for it:
//   hide    a built-in stops appearing on the walk form
//   add     a new item shows up in that room
//   edit    a built-in's label or ask type is overridden
//
// Signed-in and edit-gated: this changes what every walker in the company is asked, so it is not a
// share-link capability like the rest of the feature.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { FFE_ROOMS } from '@/lib/ffe-checklist'

export const dynamic = 'force-dynamic'

const str = (v: any) => (v == null ? '' : String(v))
const ROOM_KEYS = new Set(FFE_ROOMS.map(r => r.key))
/** Slugify a typed label into a stable key. The key is what answers are stored against, so it must
 *  never contain anything that would make it ambiguous against the "room::item" join we use. */
const slug = (s: string) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 36)

export async function POST(req: NextRequest) {
  const gate = await requireLevel('ffe', 'edit')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const action = str(body.action)
  const room = str(body.room)
  if (!ROOM_KEYS.has(room)) return NextResponse.json({ error: 'unknown room' }, { status: 400 })

  try {
    // ---- remove an override entirely (restores a hidden built-in, deletes a custom item) ----
    if (action === 'reset') {
      const itemKey = str(body.itemKey)
      const r = await db.from('ffe_checklist_items').delete().eq('room', room).eq('item_key', itemKey)
      if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    const builtinKeys = new Set((FFE_ROOMS.find(r => r.key === room)?.items || []).map(i => i.key))

    if (action === 'hide' || action === 'show') {
      const itemKey = str(body.itemKey)
      if (!itemKey) return NextResponse.json({ error: 'itemKey required' }, { status: 400 })
      // Showing a built-in again just drops the override row rather than storing hidden:false.
      if (action === 'show' && builtinKeys.has(itemKey)) {
        const r = await db.from('ffe_checklist_items').delete().eq('room', room).eq('item_key', itemKey)
        if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
        return NextResponse.json({ ok: true })
      }
      const row = { room, item_key: itemKey, hidden: action === 'hide', ask: 'replace', updated_at: new Date().toISOString(), created_by: gate.access.email || null }
      const { data: ex } = await db.from('ffe_checklist_items').select('id').eq('room', room).eq('item_key', itemKey).limit(1)
      const r = ex && ex[0]
        ? await db.from('ffe_checklist_items').update({ hidden: action === 'hide', updated_at: row.updated_at }).eq('id', ex[0].id)
        : await db.from('ffe_checklist_items').insert(row)
      if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    // ---- add a new item, or edit any item's labels / ask type ----
    if (action === 'save') {
      const en = str(body.en).slice(0, 80)
      if (!en) return NextResponse.json({ error: 'an English label is required' }, { status: 400 })
      const itemKey = str(body.itemKey) || slug(en)
      if (!itemKey) return NextResponse.json({ error: 'could not derive a key from that label' }, { status: 400 })
      const ask = ['replace', 'add', 'check'].includes(str(body.ask)) ? str(body.ask) : 'replace'
      const sortN = Number(body.sort)
      const row = {
        room, item_key: itemKey,
        en, es: str(body.es).slice(0, 80) || en,
        ask, hidden: false,
        sort: Number.isFinite(sortN) ? Math.max(0, Math.min(999, Math.round(sortN))) : 100,
        created_by: gate.access.email || null,
        updated_at: new Date().toISOString(),
      }
      const { data: ex } = await db.from('ffe_checklist_items').select('id').eq('room', room).eq('item_key', itemKey).limit(1)
      const r = ex && ex[0]
        ? await db.from('ffe_checklist_items').update(row).eq('id', ex[0].id)
        : await db.from('ffe_checklist_items').insert(row)
      if (r.error) {
        return /schema cache|does not exist/i.test(r.error.message || '')
          ? NextResponse.json({ error: 'Checklist storage is not set up yet — migration 033 has not been run.' }, { status: 503 })
          : NextResponse.json({ error: r.error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, itemKey })
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
