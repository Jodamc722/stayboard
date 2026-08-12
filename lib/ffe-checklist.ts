// FF&E AUDIT CHECKLIST — furniture, fixtures and equipment, room by room (Jon, 2026-08-10).
//
// "Create a simple link per listing for 17 West called FF&E Audit. Should be simple, go unit by
//  unit, Replace Nightstands Yes or no, Master, Guest bedroom, etc. Living room (Carpet), check
//  sofa sleeper, Stools, Dining table, TV stands, Add desk, office chair, accent chairs, Lamps,
//  Wall art, TV Stands, dresser, etc. Make this easy and English/Spanish."
//
// DESIGN RULES, because a walk-the-unit form lives or dies on how fast it is on a phone:
//   • One question per line, two big buttons. The only required answer is Replace / Keep. Quantity
//     and a note are there when they matter and invisible when they do not.
//   • Rooms the unit does not have never render. A studio is not asked about Guest Bedroom 2, so
//     nobody has to tap "no" forty times to reach the end.
//   • Both languages are written by hand, not machine-translated, and the toggle flips the whole
//     page at once — the crew should not read half a form in their second language.
//   • ADD vs REPLACE is a real distinction on this list. "Add desk" and "add office chair" are
//     things a unit may not have at all, so those ask "Add?" instead of "Replace?".

export type FfeAsk = 'replace' | 'add' | 'check'

export type FfeItem = {
  key: string          // stable id — becomes audit_items.item_type, so never rename one in place
  en: string
  es: string
  ask?: FfeAsk         // default 'replace'
  hint?: { en: string; es: string }
}

export type FfeRoom = {
  key: string
  en: string
  es: string
  // Which units get this room. 'always' = every unit; a number = needs at least that many bedrooms.
  minBedrooms?: number
  items: FfeItem[]
}

const A = (key: string, en: string, es: string, ask?: FfeAsk, hint?: { en: string; es: string }): FfeItem =>
  ({ key, en, es, ask, hint })

export const FFE_ROOMS: FfeRoom[] = [
  {
    key: 'living', en: 'Living room', es: 'Sala',
    items: [
      A('sofa', 'Sofa', 'Sofá'),
      A('sofa_sleeper', 'Sofa sleeper — open it and check', 'Sofá cama — ábralo y revíselo', 'check',
        { en: 'Pull it out fully. Check the mechanism, the mattress and any stains or tears.',
          es: 'Ábralo por completo. Revise el mecanismo, el colchón y cualquier mancha o rotura.' }),
      A('accent_chairs', 'Accent chairs', 'Sillas decorativas'),
      A('coffee_table', 'Coffee table', 'Mesa de centro'),
      A('side_tables', 'Side tables', 'Mesas laterales'),
      A('tv', 'TV', 'Televisor'),
      A('tv_stand', 'TV stand', 'Mueble de TV'),
      A('lamps', 'Lamps', 'Lámparas'),
      A('wall_art', 'Wall art', 'Cuadros / arte de pared'),
      A('carpet', 'Carpet / rug', 'Alfombra',
        undefined, { en: 'Look underneath the furniture too — stains hide there.',
          es: 'Mire también debajo de los muebles — ahí se esconden las manchas.' }),
      A('curtains', 'Curtains / blinds', 'Cortinas / persianas'),
    ],
  },
  {
    key: 'dining', en: 'Dining', es: 'Comedor',
    items: [
      A('dining_table', 'Dining table', 'Mesa de comedor'),
      A('dining_chairs', 'Dining chairs', 'Sillas de comedor'),
      A('bar_stools', 'Bar stools', 'Banquetas / taburetes'),
      A('light_fixture', 'Light fixture', 'Lámpara de techo'),
      A('dining_art', 'Wall art', 'Cuadros / arte de pared'),
    ],
  },
  {
    key: 'office', en: 'Workspace', es: 'Área de trabajo',
    items: [
      A('desk', 'Desk', 'Escritorio', 'add'),
      A('office_chair', 'Office chair', 'Silla de escritorio', 'add'),
      A('desk_lamp', 'Desk lamp', 'Lámpara de escritorio', 'add'),
      A('office_art', 'Wall art', 'Cuadros / arte de pared'),
    ],
  },
  {
    key: 'master', en: 'Master bedroom', es: 'Habitación principal',
    items: [
      A('nightstands', 'Nightstands', 'Mesas de noche'),
      A('bed_frame', 'Bed frame / headboard', 'Base de cama / cabecera'),
      A('mattress', 'Mattress', 'Colchón'),
      A('dresser', 'Dresser', 'Cómoda'),
      A('bedroom_lamps', 'Lamps', 'Lámparas'),
      A('mirror', 'Mirror', 'Espejo'),
      A('bedroom_tv', 'TV', 'Televisor'),
      A('bedroom_tv_stand', 'TV stand / mount', 'Mueble o soporte de TV'),
      A('bedroom_art', 'Wall art', 'Cuadros / arte de pared'),
      A('bedroom_curtains', 'Curtains / blinds', 'Cortinas / persianas'),
      A('bedroom_rug', 'Rug', 'Alfombra'),
    ],
  },
  {
    key: 'guest1', en: 'Guest bedroom', es: 'Habitación de huéspedes', minBedrooms: 2,
    items: [
      A('nightstands', 'Nightstands', 'Mesas de noche'),
      A('bed_frame', 'Bed frame / headboard', 'Base de cama / cabecera'),
      A('mattress', 'Mattress', 'Colchón'),
      A('dresser', 'Dresser', 'Cómoda'),
      A('bedroom_lamps', 'Lamps', 'Lámparas'),
      A('mirror', 'Mirror', 'Espejo'),
      A('bedroom_tv', 'TV', 'Televisor'),
      A('bedroom_art', 'Wall art', 'Cuadros / arte de pared'),
      A('bedroom_curtains', 'Curtains / blinds', 'Cortinas / persianas'),
      A('bedroom_rug', 'Rug', 'Alfombra'),
    ],
  },
  {
    key: 'guest2', en: 'Second guest bedroom', es: 'Segunda habitación de huéspedes', minBedrooms: 3,
    items: [
      A('nightstands', 'Nightstands', 'Mesas de noche'),
      A('bed_frame', 'Bed frame / headboard', 'Base de cama / cabecera'),
      A('mattress', 'Mattress', 'Colchón'),
      A('dresser', 'Dresser', 'Cómoda'),
      A('bedroom_lamps', 'Lamps', 'Lámparas'),
      A('bedroom_tv', 'TV', 'Televisor'),
      A('bedroom_art', 'Wall art', 'Cuadros / arte de pared'),
      A('bedroom_curtains', 'Curtains / blinds', 'Cortinas / persianas'),
    ],
  },
  {
    key: 'entry', en: 'Entry & hallway', es: 'Entrada y pasillo',
    items: [
      A('console', 'Console table', 'Mesa de entrada'),
      A('entry_mirror', 'Mirror', 'Espejo'),
      A('entry_art', 'Wall art', 'Cuadros / arte de pared'),
      A('entry_light', 'Light fixture', 'Lámpara'),
    ],
  },
]

// The three answers, in both languages. KEEP is deliberately not called "no" — the crew is making a
// judgement about the piece, not answering a yes/no about themselves.
export const FFE_ANSWERS = {
  replace: { en: 'Replace', es: 'Reemplazar' },
  keep: { en: 'Keep', es: 'Conservar' },
  add: { en: 'Add', es: 'Agregar' },
  na: { en: 'Not here', es: 'No hay' },
}

export const FFE_UI = {
  title: { en: 'FF&E Audit', es: 'Auditoría FF&E' },
  intro: {
    en: 'Walk the unit room by room. For each piece, tap Replace or Keep. Add a quantity or a note only when it helps.',
    es: 'Recorra la unidad habitación por habitación. Para cada pieza, toque Reemplazar o Conservar. Agregue cantidad o nota solo si ayuda.',
  },
  ask: {
    replace: { en: 'Replace?', es: '¿Reemplazar?' },
    add: { en: 'Add?', es: '¿Agregar?' },
    check: { en: 'Condition?', es: '¿Condición?' },
  },
  qty: { en: 'How many', es: 'Cuántos' },
  note: { en: 'Note (optional)', es: 'Nota (opcional)' },
  saved: { en: 'Saved', es: 'Guardado' },
  saving: { en: 'Saving…', es: 'Guardando…' },
  progress: { en: 'answered', es: 'respondidas' },
  done: { en: 'All done — thank you.', es: 'Todo listo — gracias.' },
  reference: { en: 'FF&E standard (reference)', es: 'Estándar FF&E (referencia)' },
  offline: { en: 'Could not save — check your signal and tap again.', es: 'No se pudo guardar — revise su señal y toque de nuevo.' },
}

/** The rooms this unit actually has. Bedrooms unknown = show the master only, never guess upward. */
export function roomsFor(bedrooms: number | null): FfeRoom[] {
  const bd = typeof bedrooms === 'number' && bedrooms > 0 ? bedrooms : 1
  return FFE_ROOMS.filter(r => !r.minBedrooms || bd >= r.minBedrooms)
}

// ── THE EDITABLE OVERLAY (Jon, 2026-08-11: "a tab where we can update it or add item") ──────────
// The list above is the FLOOR, not the law. Rows in ffe_checklist_items switch a built-in off or
// add a new item to a room, so adding "coffee maker" is a person on the Checklist tab rather than
// a code change and a deploy. An empty overlay leaves the checklist exactly as designed.
export type FfeOverride = {
  room: string; item_key: string
  en?: string | null; es?: string | null
  ask?: string | null; hidden?: boolean; sort?: number | null
}

export function mergeChecklist(bedrooms: number | null, overrides: FfeOverride[]): FfeRoom[] {
  const byRoom: Record<string, FfeOverride[]> = {}
  for (const o of overrides || []) (byRoom[String(o.room)] = byRoom[String(o.room)] || []).push(o)

  return roomsFor(bedrooms).map(room => {
    const ov = byRoom[room.key] || []
    const hidden = new Set(ov.filter(o => o.hidden).map(o => String(o.item_key)))
    const edits: Record<string, FfeOverride> = {}
    for (const o of ov) if (!o.hidden) edits[String(o.item_key)] = o

    // Built-ins first, minus anything switched off, with any label edit applied.
    const base: (FfeItem & { sort: number })[] = room.items
      .filter(i => !hidden.has(i.key))
      .map((i, idx) => {
        const e = edits[i.key]
        return {
          ...i,
          en: e && e.en ? e.en : i.en,
          es: e && e.es ? e.es : i.es,
          ask: (e && e.ask ? e.ask : i.ask) as FfeItem['ask'],
          sort: e && typeof e.sort === 'number' ? e.sort : idx,
        }
      })

    // Then anything added that is not a built-in at all.
    const builtinKeys = new Set(room.items.map(i => i.key))
    const added: (FfeItem & { sort: number })[] = ov
      .filter(o => !o.hidden && !builtinKeys.has(String(o.item_key)) && o.en)
      .map(o => ({
        key: String(o.item_key),
        en: String(o.en),
        es: String(o.es || o.en),
        ask: (o.ask || 'replace') as FfeItem['ask'],
        sort: typeof o.sort === 'number' ? o.sort : 100,
      }))

    const items = base.concat(added).sort((a, b) => a.sort - b.sort)
      .map(({ sort, ...rest }) => rest as FfeItem)
    return { ...room, items }
  })
}

export function totalItems(bedrooms: number | null, overrides?: FfeOverride[]): number {
  const rooms = overrides && overrides.length ? mergeChecklist(bedrooms, overrides) : roomsFor(bedrooms)
  return rooms.reduce((a, r) => a + r.items.length, 0)
}
