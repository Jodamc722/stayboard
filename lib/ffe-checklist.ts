// FF&E AUDIT CHECKLIST — built from Jon's own sheet, not from a guess (rebuilt 2026-08-12).
//
// THIS FILE NOW MIRRORS THE DOCUMENT. The source is "furniture_checklist_bilingual.pdf" —
// "Furniture & Decor Checklist / Lista de muebles y decoración" — which Jon shared on 2026-08-11:
// https://drive.google.com/file/d/19YbW-XAFSlEN5FSMyjZMi2IuxO7xXc7l/view
//
// The first version of this file was written from the items Jon listed in chat and never read the
// sheet. That was wrong in three ways worth naming, because they are the whole reason for the
// rewrite:
//   1. THE ANSWER IS ADD / REPLACE / FIX, WITH A NUMBER (Jon, 2026-08-12: "the goal of that whole
//      thing is to just confirm what needs to be fixed, replaced, or added... you can add the
//      number needed"). Three verbs, because they are three different outcomes: ADD and REPLACE buy
//      something, FIX does not — a FIX answer goes to the Fixes board and never onto a quote. The
//      sheet's NUMBER NEEDED column rides alongside, defaulted per item: nightstands are a pair.
//   2. TERRACES WERE MISSING ENTIRELY. The sheet has a whole second page of outdoor furniture.
//      Every terrace item was invisible in the app.
//   3. THE WORDING IS THE SHEET'S WORDING, both languages, including the ones that carry an
//      instruction: "Sofa sleeper — confirm", "Nightstand — choose from 2 styles", "TV stand — if
//      needed", "Desk — units with a den", "Additional loungers — use Unit 512 as reference".
//
// Items the sheet does not list but a walker plainly needs to record (a sofa, a mattress, curtains)
// are kept and marked `extra: true`, so the sheet's own list stays legible as the sheet's own list
// and additions are honest about being additions.
//
// ROOM AND ITEM KEYS ARE PERMANENT. Answers are stored against room::item_key, so a renamed key is
// a lost answer. Labels change freely; keys do not.

export type FfeAsk = 'replace' | 'add' | 'check'

// WHAT SIZE / WHICH ONE (Jon, 2026-08-12: "for carpets, how big etc, TV size etc, TV stand / mount
// etc"). "Area rug x1" is not an order — 9x12 and 8x10 are different rugs at different prices for
// different rooms. Where an item has a spec that changes what gets bought, the form asks for it, and
// the answer rides onto the order line. Choices are SUGGESTIONS with a free-text box beside them,
// never a closed list: the walker who needs to write "9x12 but measure again" must be able to.
export type FfeSpec = {
  en: string
  es: string
  choices?: string[]   // shown as one-tap chips; the same string in both languages (sizes, inches)
}

export type FfeItem = {
  key: string          // stable id — never rename one in place
  en: string
  es: string
  ask?: FfeAsk         // default 'replace'
  hint?: { en: string; es: string }
  spec?: FfeSpec       // asked only once something is being ordered
  qty?: number         // how many this item comes in — nightstands are a pair, so 2
  variant?: boolean    // each bedroom gets its OWN one of these — see "Order N" below
  extra?: boolean      // true = not on Jon's sheet, kept because a walker needs it
}

const SPEC = {
  rug: { en: 'Size — measure the room', es: 'Tamaño — mida la habitación', choices: ['5x8', '8x10', '9x12', '10x14', 'Runner'] },
  tv: { en: 'Screen size', es: 'Tamaño de pantalla', choices: ['43"', '50"', '55"', '65"', '75"'] },
  mount: { en: 'Stand or wall mount?', es: '¿Mueble o soporte de pared?', choices: ['Stand', 'Wall mount', 'Both'] },
  style2: { en: 'Which style?', es: '¿Cuál estilo?', choices: ['Style 1', 'Style 2'] },
  bed: { en: 'Bed size', es: 'Tamaño de cama', choices: ['King', 'Queen', 'Full', 'Twin'] },
  seats: { en: 'Seats how many?', es: '¿Para cuántas personas?', choices: ['2', '4', '6', '8'] },
  sleeper: { en: 'Size and condition', es: 'Tamaño y condición', choices: ['Queen', 'Full', 'Twin', 'Works', 'Replace'] },
  drop: { en: 'Width x drop', es: 'Ancho x caída' },
  umbrella: { en: 'Size / type', es: 'Tamaño / tipo', choices: ['9ft', '11ft', 'Cantilever'] },
  free: { en: 'Size or finish', es: 'Tamaño o acabado' },
} satisfies Record<string, FfeSpec>

export type FfeRoom = {
  key: string
  en: string
  es: string
  minBedrooms?: number   // needs at least this many bedrooms
  bedroomNo?: number     // 1 = primary, 2 = first guest, 3 = second guest — drives "Order N"
  optional?: boolean     // not every unit has one — the sheet's terraces
  note?: { en: string; es: string }
  items: FfeItem[]
}

const A = (key: string, en: string, es: string, ask?: FfeAsk, hint?: { en: string; es: string }, spec?: FfeSpec, qty?: number, variant?: boolean): FfeItem =>
  ({ key, en, es, ask, hint, spec, qty, variant })
const X = (key: string, en: string, es: string, ask?: FfeAsk, hint?: { en: string; es: string }, spec?: FfeSpec, qty?: number, variant?: boolean): FfeItem =>
  ({ key, en, es, ask, hint, spec, qty, variant, extra: true })

// ── ONE ITEM, ONE OF THREE OUTCOMES ─────────────────────────────────────────────────────────────
// ADD      the unit does not have it — buy one          -> order line
// REPLACE  it is there and has to be swapped            -> order line
// FIX      it is there and can be repaired              -> Fixes board, never a quote line
// NONE     nothing needed
// FIX is the one that used to fall on the floor: it is not a purchase, so it had no home on a
// purchasing form, and it either got lost or got raised as a maintenance ticket. Now it is a first
// class answer that routes itself.
export const FFE_OUTCOMES = ['add', 'replace', 'fix', 'keep'] as const
export type FfeOutcome = typeof FFE_OUTCOMES[number]
/** Which answers become something to buy. FIX is deliberately not one of them. */
export const BUYS: string[] = ['add', 'replace']

/**
 * "Nightstands — Order 2".
 *
 * Jon, 2026-08-12: "If it's three bedrooms, we should consider getting three different types of
 * nightstands, and we should label it: Nightstands order 1 / order 2 / order 3 ... so that we can
 * get customized links for each."
 *
 * Numbering only appears when the unit HAS more than one bedroom — a studio does not need to be
 * told its nightstands are order 1 of 1. The number is the bedroom's position, so Order 2 is always
 * the first guest room in every unit rather than whatever happened to be filled in first.
 */
export function variantLabel(en: string, bedroomNo: number | undefined, bedrooms: number | null): string {
  const bd = typeof bedrooms === 'number' && bedrooms > 0 ? bedrooms : 1
  if (!bedroomNo || bd < 2) return en
  return en + ' — Order ' + bedroomNo
}
export function variantLabelEs(es: string, bedroomNo: number | undefined, bedrooms: number | null): string {
  const bd = typeof bedrooms === 'number' && bedrooms > 0 ? bedrooms : 1
  if (!bedroomNo || bd < 2) return es
  return es + ' — Pedido ' + bedroomNo
}

export const FFE_ROOMS: FfeRoom[] = [
  // ── INTERIOR FURNISHINGS / MUEBLES DE INTERIOR ────────────────────────────────────────────────
  {
    key: 'living', en: 'Living room', es: 'Sala',
    items: [
      A('tv', 'Large smart TV', 'Televisor inteligente grande', undefined, undefined, SPEC.tv),
      A('tv_stand', 'TV stand', 'Mueble para televisor', undefined, undefined, SPEC.mount),
      A('sofa_sleeper', 'Sofa sleeper / pull-out bed — confirm', 'Sofá cama — confirmar', 'check',
        { en: 'Open it fully. Confirm it works, and check the mattress for stains or tears.',
          es: 'Ábralo por completo. Confirme que funciona y revise el colchón por manchas o roturas.' }, SPEC.sleeper),
      A('carpet', 'Area rug / carpet', 'Alfombra de área', undefined,
        { en: 'Measure the room before ordering — length x width — and put it in the note.',
          es: 'Mida la sala antes de pedir — largo x ancho — y anótelo en la nota.' }, SPEC.rug),
      A('floor_lamp', 'Floor lamp', 'Lámpara de piso'),
      A('wall_art', 'Wall art', 'Arte para pared'),
      X('sofa', 'Sofa', 'Sofá'),
      X('accent_chairs', 'Accent chairs', 'Sillas decorativas'),
      X('coffee_table', 'Coffee table', 'Mesa de centro'),
      X('side_tables', 'Side tables', 'Mesas laterales'),
      X('lamps', 'Table lamps', 'Lámparas de mesa'),
      X('curtains', 'Curtains / blinds', 'Cortinas / persianas', undefined, undefined, SPEC.drop),
    ],
  },
  {
    key: 'dining', en: 'Dining area', es: 'Comedor',
    items: [
      A('dining_table', 'Dining table', 'Mesa de comedor', undefined, undefined, SPEC.seats),
      A('dining_chairs', 'Dining chair', 'Silla de comedor'),
      X('bar_stools', 'Bar stools', 'Banquetas / taburetes'),
      X('light_fixture', 'Light fixture', 'Lámpara de techo'),
      X('dining_art', 'Wall art', 'Arte para pared'),
    ],
  },
  {
    key: 'office', en: 'Den / Office', es: 'Estudio / Oficina',
    optional: true,
    note: { en: 'Units with a den only.', es: 'Solo unidades con estudio.' },
    items: [
      A('desk', 'Desk — units with a den', 'Escritorio — unidades con estudio', 'add'),
      A('office_chair', 'Office chair', 'Silla de oficina', 'add'),
      X('desk_lamp', 'Desk lamp', 'Lámpara de escritorio', 'add'),
      X('office_art', 'Wall art', 'Arte para pared'),
    ],
  },
  {
    key: 'master', en: 'Primary bedroom', es: 'Dormitorio principal', bedroomNo: 1,
    items: [
      A('nightstands', 'Nightstands', 'Mesas de noche', undefined,
        { en: 'They come as a pair — 2 unless this room is different.', es: 'Vienen en par — 2 salvo que esta habitación sea distinta.' },
        SPEC.style2, 2, true),
      A('bedroom_lamps', 'Nightstand lamps', 'Lámparas de mesa de noche', undefined, undefined, undefined, 2, true),
      A('dresser', 'Dresser', 'Cómoda', undefined, undefined, undefined, undefined, true),
      A('bedroom_tv_stand', 'TV stand — if needed', 'Mueble para televisor — si es necesario', undefined, undefined, SPEC.mount),
      X('bedroom_tv', 'TV', 'Televisor', undefined,
        { en: 'The 65-inch smart TV already in the unit moves here — check before ordering one.',
          es: 'El televisor de 65 pulgadas que ya está en la unidad se mueve aquí — revise antes de pedir otro.' }, SPEC.tv),
      X('bed_frame', 'Bed frame / headboard', 'Base de cama / cabecera', undefined, undefined, SPEC.bed, undefined, true),
      X('mattress', 'Mattress', 'Colchón', undefined, undefined, SPEC.bed),
      X('mirror', 'Mirror', 'Espejo'),
      X('bedroom_art', 'Wall art', 'Arte para pared'),
      X('bedroom_curtains', 'Curtains / blinds', 'Cortinas / persianas', undefined, undefined, SPEC.drop),
      X('bedroom_rug', 'Rug', 'Alfombra', undefined, undefined, SPEC.rug),
    ],
  },
  {
    key: 'guest1', en: 'Guest bedroom', es: 'Habitación de huéspedes', minBedrooms: 2, bedroomNo: 2,
    items: [
      A('nightstands', 'Nightstands', 'Mesas de noche', undefined,
        { en: 'They come as a pair — 2 unless this room is different.', es: 'Vienen en par — 2 salvo que esta habitación sea distinta.' },
        SPEC.style2, 2, true),
      A('bedroom_lamps', 'Nightstand lamps', 'Lámparas de mesa de noche', undefined, undefined, undefined, 2, true),
      A('dresser', 'Dresser', 'Cómoda', undefined, undefined, undefined, undefined, true),
      A('bedroom_tv_stand', 'TV stand — if needed', 'Mueble para televisor — si es necesario', undefined, undefined, SPEC.mount),
      X('bedroom_tv', 'TV', 'Televisor', undefined, undefined, SPEC.tv),
      X('bed_frame', 'Bed frame / headboard', 'Base de cama / cabecera', undefined, undefined, SPEC.bed, undefined, true),
      X('mattress', 'Mattress', 'Colchón', undefined, undefined, SPEC.bed),
      X('mirror', 'Mirror', 'Espejo'),
      X('bedroom_art', 'Wall art', 'Arte para pared'),
      X('bedroom_curtains', 'Curtains / blinds', 'Cortinas / persianas', undefined, undefined, SPEC.drop),
      X('bedroom_rug', 'Rug', 'Alfombra', undefined, undefined, SPEC.rug),
    ],
  },
  {
    key: 'guest2', en: 'Second guest bedroom', es: 'Segunda habitación de huéspedes', minBedrooms: 3, bedroomNo: 3,
    items: [
      A('nightstands', 'Nightstands', 'Mesas de noche', undefined,
        { en: 'They come as a pair — 2 unless this room is different.', es: 'Vienen en par — 2 salvo que esta habitación sea distinta.' },
        SPEC.style2, 2, true),
      A('bedroom_lamps', 'Nightstand lamps', 'Lámparas de mesa de noche', undefined, undefined, undefined, 2, true),
      A('dresser', 'Dresser', 'Cómoda', undefined, undefined, undefined, undefined, true),
      A('bedroom_tv_stand', 'TV stand — if needed', 'Mueble para televisor — si es necesario', undefined, undefined, SPEC.mount),
      X('bedroom_tv', 'TV', 'Televisor', undefined, undefined, SPEC.tv),
      X('bed_frame', 'Bed frame / headboard', 'Base de cama / cabecera', undefined, undefined, SPEC.bed, undefined, true),
      X('mattress', 'Mattress', 'Colchón', undefined, undefined, SPEC.bed),
      X('bedroom_art', 'Wall art', 'Arte para pared'),
      X('bedroom_curtains', 'Curtains / blinds', 'Cortinas / persianas', undefined, undefined, SPEC.drop),
    ],
  },
  {
    key: 'entry', en: 'Entry & hallway', es: 'Entrada y pasillo',
    items: [
      X('console', 'Console table', 'Mesa de entrada', undefined, undefined, SPEC.free),
      X('entry_mirror', 'Mirror', 'Espejo'),
      X('entry_art', 'Wall art', 'Arte para pared'),
      X('entry_light', 'Light fixture', 'Lámpara'),
    ],
  },

  // ── TERRACES & OUTDOOR AREAS / TERRAZAS Y ÁREAS EXTERIORES (page 2 of the sheet) ──────────────
  {
    key: 'terrace', en: 'Terrace', es: 'Terraza',
    optional: true,
    note: {
      en: 'Check what is already out there and can be reused before ordering anything.',
      es: 'Revise lo que ya está afuera y se puede reutilizar antes de pedir algo.',
    },
    items: [
      A('patio_umbrella', 'Patio umbrella', 'Sombrilla de patio', undefined, undefined, SPEC.umbrella),
      A('lounger', 'Lounger', 'Tumbona'),
      A('outdoor_chair', 'Outdoor chair', 'Silla de exterior'),
      A('outdoor_table', 'Outdoor table', 'Mesa de exterior', undefined, undefined, SPEC.seats),
      A('outdoor_accessories', 'Outdoor accessories', 'Accesorios de exterior'),
    ],
  },
  {
    key: 'terrace_large', en: 'Large terrace', es: 'Terraza grande',
    optional: true,
    note: {
      en: 'Only units with an oversized terrace. Unit 512 is the reference for how it should look.',
      es: 'Solo unidades con terraza grande. La Unidad 512 es la referencia de cómo debe quedar.',
    },
    items: [
      A('extra_loungers', 'Additional loungers — use Unit 512 as reference',
        'Tumbonas adicionales — usar la Unidad 512 como referencia'),
      X('outdoor_rug', 'Outdoor rug', 'Alfombra de exterior', undefined, undefined, SPEC.rug),
      X('outdoor_lighting', 'Outdoor lighting', 'Iluminación de exterior'),
    ],
  },
]

// ── REQUIRED ACTIONS / TAREAS PENDIENTES (page 2 of the sheet) ──────────────────────────────────
// These are the sheet's own standing instructions. Two of them are things a walker does IN the unit,
// so they surface on the form; the rest are decisions the office owes the project. They are listed
// here rather than retyped into a screen so there is one copy of the sheet's intent.
export type FfeAction = { key: string; en: string; es: string; inUnit?: boolean }

export const FFE_ACTIONS: FfeAction[] = [
  { key: 'move_tv', inUnit: true,
    en: 'Move the existing 65-inch smart TV to the primary bedroom.',
    es: 'Mover el televisor inteligente existente de 65 pulgadas al dormitorio principal.' },
  { key: 'measure_living', inUnit: true,
    en: 'Measure each living room before ordering the area rug. Record length x width.',
    es: 'Medir cada sala antes de pedir la alfombra. Anotar largo x ancho.' },
  { key: 'inspect_outdoor', inUnit: true,
    en: 'Inspect existing outdoor furniture and identify what can be reused.',
    es: 'Revisar los muebles de exterior existentes e identificar cuáles se pueden reutilizar.' },
  { key: 'select_styles',
    en: 'Select the indoor and outdoor furniture styles.',
    es: 'Seleccionar los estilos de los muebles de interior y exterior.' },
  { key: 'confirm_terraces',
    en: 'Confirm outdoor furniture needs for each terrace: umbrellas, loungers, chairs, tables and accessories.',
    es: 'Confirmar las necesidades de cada terraza: sombrillas, tumbonas, sillas, mesas y accesorios.' },
  { key: 'confirm_quantities',
    en: "Confirm quantities according to each unit's layout and available space.",
    es: 'Confirmar las cantidades según la distribución y el espacio disponible de cada unidad.' },
]

// The three answers. KEEP is deliberately not "no" — the crew is judging the piece, not themselves.
export const FFE_ANSWERS = {
  add: { en: 'Add', es: 'Agregar' },
  replace: { en: 'Replace', es: 'Reemplazar' },
  fix: { en: 'Fix', es: 'Reparar' },
  keep: { en: 'Nothing needed', es: 'Nada hace falta' },
  na: { en: 'Not here', es: 'No hay' },
}
export const FFE_ANSWER_HELP = {
  add: { en: 'The unit does not have one', es: 'La unidad no tiene' },
  replace: { en: 'It is here but has to be swapped', es: 'Está pero hay que cambiarlo' },
  fix: { en: 'It can be repaired — goes to the team, not the owner', es: 'Se puede reparar — va al equipo, no al dueño' },
}

export const FFE_UI = {
  title: { en: 'Furniture & Decor Checklist', es: 'Lista de muebles y decoración' },
  intro: {
    en: 'Room by room: does it need to be added, replaced or fixed? Then how many. Anything you mark Fix goes to the team, not onto the owner\u2019s order.',
    es: 'Habitación por habitación: ¿hay que agregar, reemplazar o reparar? Luego cuántos. Lo que marque Reparar va al equipo, no al pedido del dueño.',
  },
  ask: {
    replace: { en: 'How many needed?', es: '¿Cuántos se necesitan?' },
    add: { en: 'How many to add?', es: '¿Cuántos agregar?' },
    check: { en: 'Confirm', es: 'Confirmar' },
  },
  qty: { en: 'Number needed', es: 'Cantidad' },
  none: { en: 'Nothing needed', es: 'Nada hace falta' },
  fixWhat: { en: 'What needs fixing?', es: '¿Qué hay que reparar?' },
  fixGoesTo: { en: 'This goes to the team as a fix, not onto the order.', es: 'Esto va al equipo como reparación, no al pedido.' },
  note: { en: 'Note (optional)', es: 'Nota (opcional)' },
  saved: { en: 'Saved', es: 'Guardado' },
  saving: { en: 'Saving…', es: 'Guardando…' },
  progress: { en: 'answered', es: 'respondidas' },
  done: { en: 'All done — thank you.', es: 'Todo listo — gracias.' },
  reference: { en: 'Furniture & Decor Checklist (the sheet this comes from)', es: 'Lista de muebles y decoración (la hoja original)' },
  offline: { en: 'Could not save — check your signal and tap again.', es: 'No se pudo guardar — revise su señal y toque de nuevo.' },
  addItem: { en: 'Add an item to this room', es: 'Agregar un artículo a esta habitación' },
  addItemPh: { en: 'What is it? e.g. Bar cart', es: '¿Qué es? ej. Carrito de bar' },
  notesTitle: { en: 'Notes & measurements', es: 'Notas y medidas' },
  notesHint: {
    en: 'Living room length x width for the rug, anything that does not fit above.',
    es: 'Largo x ancho de la sala para la alfombra, y cualquier cosa que no quepa arriba.',
  },
  actionsTitle: { en: 'Before you leave the unit', es: 'Antes de salir de la unidad' },
  optionalRoom: { en: 'Does this unit have one?', es: '¿Esta unidad tiene?' },
  extraTag: { en: 'extra', es: 'extra' },
}

/** The rooms this unit actually has. Bedrooms unknown = show the primary only, never guess upward. */
export function roomsFor(bedrooms: number | null): FfeRoom[] {
  const bd = typeof bedrooms === 'number' && bedrooms > 0 ? bedrooms : 1
  return FFE_ROOMS.filter(r => !r.minBedrooms || bd >= r.minBedrooms)
}

// ── THE EDITABLE OVERLAY (Jon, 2026-08-11: "a tab where we can update it or add item") ──────────
// The list above is the FLOOR, not the law. Rows in ffe_checklist_items switch a built-in off or add
// a new item to a room, so adding "coffee maker" is a person on the Checklist tab — or now on the
// walk form itself — rather than a code change and a deploy.
export type FfeOverride = {
  room: string; item_key: string
  en?: string | null; es?: string | null
  ask?: string | null; hidden?: boolean; sort?: number | null
}

export function mergeChecklist(bedrooms: number | null, overrides: FfeOverride[]): FfeRoom[] {
  const byRoom: Record<string, FfeOverride[]> = {}
  for (const o of overrides || []) (byRoom[String(o.room)] = byRoom[String(o.room)] || []).push(o)

  // A hand-typed override always wins the label — if somebody renamed it on the Checklist tab, that
  // is the name, numbering and all.
  const num = (i: FfeItem, room: FfeRoom, edited: boolean): FfeItem =>
    (!i.variant || edited) ? i : {
      ...i,
      en: variantLabel(i.en, room.bedroomNo, bedrooms),
      es: variantLabelEs(i.es, room.bedroomNo, bedrooms),
    }

  return roomsFor(bedrooms).map(room => {
    const ov = byRoom[room.key] || []
    const hidden = new Set(ov.filter(o => o.hidden).map(o => String(o.item_key)))
    const edits: Record<string, FfeOverride> = {}
    for (const o of ov) if (!o.hidden) edits[String(o.item_key)] = o

    const base: (FfeItem & { sort: number })[] = room.items
      .filter(i => !hidden.has(i.key))
      .map((i, idx) => {
        const e = edits[i.key]
        const withLabel = num(i, room, !!(e && e.en))
        return {
          ...withLabel,
          en: e && e.en ? e.en : withLabel.en,
          es: e && e.es ? e.es : withLabel.es,
          ask: (e && e.ask ? e.ask : i.ask) as FfeItem['ask'],
          sort: e && typeof e.sort === 'number' ? e.sort : idx,
        }
      })

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
