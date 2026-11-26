// TRAINING MODULES + THE STARTER COURSE (Jon, 2026-11-25): "build the training modules and the admin
// page for that. Also add the brand guide for walk-ins, how to enter a unit, and the Slack and
// Breezeway videos."
//
// A MODULE is an ordered group of library items (videos, docs, FAQs) for one or more role tracks.
// Onboarding a person assigns every lesson in every module on their track, in module order; their
// page shows the course module by module. With no modules saved, the older rule still applies
// (a track's audience + every required item), so nothing breaks before the course exists.
//
// Kept in app_settings (`training_modules`) — a dozen rows edited by one or two managers, no table.
//
// THE STARTER COURSE is written from Jon's own rules (topics/housekeeping, the PTE and red-button
// lines, the Slack tag conventions, "housekeepers never create tasks"). Nothing in it is invented:
// where a rule was not given (the door-lock steps), the module is created empty for Jon to fill.
// Seeding is idempotent — an item is matched by its English title, a module by its slug, and an
// existing quiz is never overwritten.
import 'server-only'
import { getSettingFresh, getSetting, setSetting } from './app-settings'
import { supabaseAdmin } from './supabase-admin'
import { listItems, createItem, type TrainingItem } from './training'

export type Track = 'housekeeping' | 'maintenance' | 'ops' | 'ccs_admin'
const TRACK_KEYS: Track[] = ['housekeeping', 'maintenance', 'ops', 'ccs_admin']
export type Module = {
  id: string
  title: { en: string; es: string | null }
  summary: { en: string | null; es: string | null }
  tracks: Track[]
  itemIds: string[]
  sortOrder: number
  status: 'active' | 'draft'
  updatedAt: string | null
  updatedBy: string | null
}
const KEY = 'training_modules'
const str = (v: any) => (v == null ? '' : String(v))
const clean = (v: any, max: number) => str(v).replace(/\s+/g, ' ').trim().slice(0, max)
const slug = (s: string) => str(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

function norm(m: any): Module | null {
  const en = clean(m?.title?.en ?? m?.titleEn, 120)
  if (!en) return null
  return {
    id: clean(m?.id, 80) || slug(en),
    title: { en, es: clean(m?.title?.es ?? m?.titleEs, 120) || null },
    summary: { en: clean(m?.summary?.en ?? m?.summaryEn, 300) || null, es: clean(m?.summary?.es ?? m?.summaryEs, 300) || null },
    tracks: (Array.isArray(m?.tracks) ? m.tracks : []).filter((t: any) => TRACK_KEYS.indexOf(t) >= 0),
    itemIds: Array.from(new Set((Array.isArray(m?.itemIds) ? m.itemIds : []).map(str).filter(Boolean))),
    sortOrder: Number.isFinite(Number(m?.sortOrder)) ? Number(m.sortOrder) : 100,
    status: m?.status === 'draft' ? 'draft' : 'active',
    updatedAt: m?.updatedAt ?? null, updatedBy: m?.updatedBy ?? null,
  }
}
const sortMods = (a: Module, b: Module) => a.sortOrder - b.sortOrder || a.title.en.localeCompare(b.title.en)

export async function listModules(fresh = false): Promise<Module[]> {
  const raw = await (fresh ? getSettingFresh : getSetting)<{ modules?: any[] }>(KEY, { modules: [] })
  return (Array.isArray(raw?.modules) ? raw.modules : []).map(norm).filter(Boolean).sort(sortMods as any) as Module[]
}
async function writeModules(mods: Module[], by: string) {
  return setSetting(KEY, { modules: mods.slice().sort(sortMods) }, by)
}

export async function saveModule(inp: any, by: string): Promise<{ ok: true; module: Module } | { ok: false; error: string }> {
  const m = norm(inp)
  if (!m) return { ok: false, error: 'Give the module a title (English).' }
  const mods = await listModules(true)
  const i = mods.findIndex(x => x.id === m.id)
  if (i < 0 && !inp?.id) { let id = m.id, n = 2; while (mods.some(x => x.id === id)) id = `${m.id}-${n++}`; m.id = id }
  if (i < 0 && inp?.sortOrder == null) m.sortOrder = (mods.length ? mods[mods.length - 1].sortOrder : 0) + 10
  m.updatedAt = new Date().toISOString(); m.updatedBy = by
  const next = i >= 0 ? mods.map((x, j) => (j === i ? m : x)) : mods.concat([m])
  const r = await writeModules(next, by)
  return r.ok ? { ok: true, module: m } : { ok: false, error: r.error || 'could not save' }
}
export async function deleteModule(id: string, by: string): Promise<{ ok: boolean; error?: string }> {
  const mods = await listModules(true)
  return writeModules(mods.filter(m => m.id !== id), by)
}
/** Move a module up or down one place. */
export async function moveModule(id: string, dir: -1 | 1, by: string): Promise<{ ok: boolean; error?: string }> {
  const mods = await listModules(true)
  const i = mods.findIndex(m => m.id === id), j = i + dir
  if (i < 0 || j < 0 || j >= mods.length) return { ok: true }
  const a = mods[i].sortOrder, b = mods[j].sortOrder
  mods[i].sortOrder = b; mods[j].sortOrder = a === b ? b + dir : a
  return writeModules(mods, by)
}

/** The lessons on a track, in course order — or null when no module covers the track (old rule applies). */
export function moduleItemIds(mods: Module[], track: Track | null): string[] | null {
  if (!track) return null
  const mine = mods.filter(m => m.status === 'active' && m.tracks.indexOf(track) >= 0)
  if (!mine.length) return null
  const out: string[] = []
  for (const m of mine.sort(sortMods)) for (const id of m.itemIds) if (out.indexOf(id) < 0) out.push(id)
  return out
}

// ---------------------------------------------------------------- the starter course
type Lesson = {
  kind: 'video' | 'doc'
  titleEn: string; titleEs: string; summaryEn: string; summaryEs: string; bodyEn?: string; bodyEs?: string
  tags: string[]; audience: string[]
  quiz?: { q: { en: string; es: string }; options: { en: string[]; es: string[] }; answer: number }[]
}
type StarterModule = { id: string; titleEn: string; titleEs: string; summaryEn: string; summaryEs: string; tracks: Track[]; lessons: Lesson[] }

const FIELD: Track[] = ['housekeeping', 'maintenance', 'ops']
const ALL: Track[] = ['housekeeping', 'maintenance', 'ops', 'ccs_admin']

export const STARTER: StarterModule[] = [
  {
    id: 'welcome', tracks: ALL,
    titleEn: 'Welcome to Stay', titleEs: 'Bienvenido a Stay',
    summaryEn: 'Who we are, the guest we work for, and the standard we hold.', summaryEs: 'Quiénes somos, el huésped para quien trabajamos y el estándar que mantenemos.',
    lessons: [{
      kind: 'doc', tags: ['housekeeping', 'safety'], audience: [],
      titleEn: 'The Stay standard', titleEs: 'El estándar de Stay',
      summaryEn: 'Why we do what we do — read this first.', summaryEs: 'Por qué hacemos lo que hacemos — lee esto primero.',
      bodyEn: `Stay Hospitality runs vacation rentals across Miami-Dade and Broward. Every unit is someone's home for a few nights, and every guest is trusting us with it.

THE FIRST MINUTE
A guest walks in at 4 pm. In that first minute they decide how their stay — and their review — will go. Everything we do is about that minute: a unit that feels like nobody was ever there, and that everything works.

WHY THE RULES EXIST
Our rules are not paperwork. Each one protects a guest, a teammate or you:
• We knock and wait, because a guest's privacy comes first.
• We take photos, because photos prove the unit was ready and protect you.
• We report problems right away, because the next guest should never find them.
• We tell the team early when we're running late, so customer care can tell the guest before they arrive.

HOW WE TALK
The team talks in Slack. Tag your manager, and tag @ccs (our customer care team) when you need information. Writing in Spanish is fine — tag @Eve at the end of your message and she translates it.

RED-BUTTON ISSUES
Some mistakes cannot be undone. We call them red-button issues. The first one you will learn is walking in on a guest. A red-button issue can lead to disciplinary action or termination. When you are not sure — stop and ask.`,
      bodyEs: `Stay Hospitality administra alquileres vacacionales en Miami-Dade y Broward. Cada unidad es el hogar de alguien por unas noches, y cada huésped nos la confía.

EL PRIMER MINUTO
Un huésped entra a las 4 pm. En ese primer minuto decide cómo será su estadía — y su reseña. Todo lo que hacemos es para ese minuto: una unidad que se siente como si nadie hubiera estado allí, y donde todo funciona.

POR QUÉ EXISTEN LAS REGLAS
Nuestras reglas no son trámites. Cada una protege a un huésped, a un compañero o a ti:
• Tocamos y esperamos, porque la privacidad del huésped es primero.
• Tomamos fotos, porque las fotos prueban que la unidad estaba lista y te protegen.
• Reportamos los problemas enseguida, porque el próximo huésped nunca debe encontrarlos.
• Avisamos temprano si vamos tarde, para que atención al cliente le avise al huésped antes de que llegue.

CÓMO NOS COMUNICAMOS
El equipo habla por Slack. Etiqueta a tu gerente, y etiqueta a @ccs (nuestro equipo de atención al cliente) cuando necesites información. Puedes escribir en español — etiqueta a @Eve al final de tu mensaje y ella lo traduce.

PROBLEMAS DE BOTÓN ROJO
Algunos errores no se pueden deshacer. Los llamamos problemas de botón rojo. El primero que aprenderás es entrar cuando hay un huésped adentro. Un problema de botón rojo puede llevar a una acción disciplinaria o al despido. Si no estás seguro — detente y pregunta.`,
      quiz: [
        { q: { en: 'What time do guests arrive?', es: '¿A qué hora llegan los huéspedes?' }, options: { en: ['11 am', '4 pm', '6 pm'], es: ['11 am', '4 pm', '6 pm'] }, answer: 1 },
        { q: { en: 'Who do you tag in Slack when you need information?', es: '¿A quién etiquetas en Slack cuando necesitas información?' }, options: { en: ['Your manager and @ccs', 'The guest', 'Nobody — call the office'], es: ['A tu gerente y a @ccs', 'Al huésped', 'A nadie — llama a la oficina'] }, answer: 0 },
        { q: { en: 'What is a red-button issue?', es: '¿Qué es un problema de botón rojo?' }, options: { en: ['A small mistake you fix later', 'A mistake that cannot be undone and can lead to termination', 'A broken appliance'], es: ['Un error pequeño que arreglas después', 'Un error que no se puede deshacer y puede llevar al despido', 'Un electrodoméstico roto'] }, answer: 1 },
      ],
    }],
  },
  {
    id: 'apps', tracks: ALL,
    titleEn: 'Get on your apps', titleEs: 'Configura tus apps',
    summaryEn: 'Homebase, Breezeway, Slack and Lighthouse — set up all four.', summaryEs: 'Homebase, Breezeway, Slack y Lighthouse — configura las cuatro.',
    lessons: [{
      kind: 'doc', tags: ['breezeway', 'lighthouse'], audience: [],
      titleEn: 'Your four apps', titleEs: 'Tus cuatro apps',
      summaryEn: 'What each app is for, and how to get in.', summaryEs: 'Para qué sirve cada app y cómo entrar.',
      bodyEn: `You will get an invite email from each app. Open each one and tap the link to create your login. Can't find one? Check spam, then tell your manager.

HOMEBASE — your schedule and your hours
Clock in when you start and clock out when you finish, every day. Your hours in Homebase are what you are paid for.

BREEZEWAY — your work
Every clean, inspection and job lives here, with the unit and the time. Download it from the App Store or Google Play and log in with your invite.

SLACK — how the team talks
Download it and join from your invite. Then finish your profile: a photo, your role, your email and your phone number, so everyone knows who they're talking to.

LIGHTHOUSE — your page
This page. Your training, your schedule for the week, your hours, your tasks and your inspections. Save it to your home screen.

When each app is set up, tick it on the Training tab.`,
      bodyEs: `Recibirás un correo de invitación de cada app. Abre cada uno y toca el enlace para crear tu usuario. ¿No encuentras uno? Revisa el correo no deseado y luego avísale a tu gerente.

HOMEBASE — tu horario y tus horas
Marca entrada cuando empiezas y salida cuando terminas, todos los días. Tus horas en Homebase son las que se te pagan.

BREEZEWAY — tu trabajo
Cada limpieza, inspección y trabajo está aquí, con la unidad y la hora. Descárgala del App Store o Google Play y entra con tu invitación.

SLACK — cómo se comunica el equipo
Descárgala y únete desde tu invitación. Luego completa tu perfil: una foto, tu puesto, tu correo y tu número de teléfono, para que todos sepan con quién hablan.

LIGHTHOUSE — tu página
Esta página. Tu capacitación, tu horario de la semana, tus horas, tus tareas y tus inspecciones. Guárdala en tu pantalla de inicio.

Cuando cada app esté lista, márcala en la pestaña Capacitación.`,
      quiz: [
        { q: { en: 'Where do you clock in and out?', es: '¿Dónde marcas entrada y salida?' }, options: { en: ['Slack', 'Homebase', 'Breezeway'], es: ['Slack', 'Homebase', 'Breezeway'] }, answer: 1 },
        { q: { en: 'Where are your cleans and jobs?', es: '¿Dónde están tus limpiezas y trabajos?' }, options: { en: ['Breezeway', 'Homebase', 'Email'], es: ['Breezeway', 'Homebase', 'Correo'] }, answer: 0 },
        { q: { en: 'What goes on your Slack profile?', es: '¿Qué va en tu perfil de Slack?' }, options: { en: ['Nothing', 'Photo, role, email and phone', 'Only your name'], es: ['Nada', 'Foto, puesto, correo y teléfono', 'Solo tu nombre'] }, answer: 1 },
      ],
    }],
  },
  {
    id: 'slack', tracks: ALL,
    titleEn: 'How we use Slack', titleEs: 'Cómo usamos Slack',
    summaryEn: 'Who to tag, what to post, and when.', summaryEs: 'A quién etiquetar, qué publicar y cuándo.',
    lessons: [{
      kind: 'video', tags: ['housekeeping'], audience: ['housekeeping', 'maintenance', 'supervision', 'ccs', 'office'],
      titleEn: 'How we use Slack', titleEs: 'Cómo usamos Slack',
      summaryEn: 'Eve walks you through Slack: tagging, PTE, damage, running late.', summaryEs: 'Eve te enseña Slack: etiquetas, PTE, daños y cuando vas tarde.',
      quiz: [
        { q: { en: 'Who does @ccs reach?', es: '¿A quién llega @ccs?' }, options: { en: ['One person', 'Our whole customer care team', 'Everyone in the company'], es: ['A una persona', 'A todo nuestro equipo de atención al cliente', 'A toda la empresa'] }, answer: 1 },
        { q: { en: 'You are running behind on a clean. By what time do you post in Slack?', es: 'Vas atrasado en una limpieza. ¿Antes de qué hora publicas en Slack?' }, options: { en: ['3:15 pm', '4:00 pm', '6:00 pm'], es: ['3:15 pm', '4:00 pm', '6:00 pm'] }, answer: 0 },
        { q: { en: 'Where do housekeepers post damage they find?', es: '¿Dónde publican los daños las personas de limpieza?' }, options: { en: ['In their own housekeeping channel', 'In the damage reports channel', 'In a direct message to the guest'], es: ['En su propio canal de limpieza', 'En el canal de reportes de daños', 'En un mensaje directo al huésped'] }, answer: 0 },
        { q: { en: 'How do you get a Spanish message translated?', es: '¿Cómo traduces un mensaje en español?' }, options: { en: ['Tag @Eve at the end of the message', 'Tag @Eve at the start', 'Ask a coworker'], es: ['Etiqueta a @Eve al final del mensaje', 'Etiqueta a @Eve al inicio', 'Pregúntale a un compañero'] }, answer: 0 },
      ],
    }],
  },
  {
    id: 'breezeway', tracks: FIELD,
    titleEn: 'How we use Breezeway', titleEs: 'Cómo usamos Breezeway',
    summaryEn: 'Start a task, photos, the checklist, and finishing it.', summaryEs: 'Iniciar una tarea, fotos, la lista y terminarla.',
    lessons: [{
      kind: 'video', tags: ['breezeway', 'housekeeping'], audience: ['housekeeping', 'maintenance', 'supervision'],
      titleEn: 'How to complete a task in Breezeway', titleEs: 'Cómo completar una tarea en Breezeway',
      summaryEn: 'Eve walks you through a task from start to finish.', summaryEs: 'Eve te guía en una tarea de principio a fin.',
      quiz: [
        { q: { en: 'You find damage during a clean. Who creates the Breezeway task?', es: 'Encuentras un daño durante una limpieza. ¿Quién crea la tarea en Breezeway?' }, options: { en: ['You do, right away', 'The office — you report it in Slack', 'The guest'], es: ['Tú, enseguida', 'La oficina — tú lo reportas en Slack', 'El huésped'] }, answer: 1 },
        { q: { en: 'What is the checklist in Breezeway for?', es: '¿Para qué es la lista en Breezeway?' }, options: { en: ['It is the whole job, step by step', 'A reminder so you don\'t miss anything', 'Only for supervisors'], es: ['Es todo el trabajo, paso a paso', 'Un recordatorio para que no se te olvide nada', 'Solo para supervisores'] }, answer: 1 },
        { q: { en: 'Something in the unit doesn\'t work. When do you post it?', es: 'Algo en la unidad no funciona. ¿Cuándo lo publicas?' }, options: { en: ['Right away, in Slack', 'At the end of the day', 'Only if the guest complains'], es: ['Enseguida, en Slack', 'Al final del día', 'Solo si el huésped se queja'] }, answer: 0 },
      ],
    }],
  },
  {
    id: 'entering-a-unit', tracks: FIELD,
    titleEn: 'Entering a unit', titleEs: 'Cómo entrar a una unidad',
    summaryEn: 'Permission to enter (PTE), the 11 am rule, and the knock.', summaryEs: 'Permiso para entrar (PTE), la regla de las 11 am y cómo tocar.',
    lessons: [{
      kind: 'doc', tags: ['housekeeping', 'safety'], audience: ['housekeeping', 'maintenance', 'supervision'],
      titleEn: 'How to enter a unit', titleEs: 'Cómo entrar a una unidad',
      summaryEn: 'Every entry, every time — no exceptions.', summaryEs: 'Cada entrada, siempre — sin excepciones.',
      bodyEn: `Every entry, every time. Walking in on a guest is a red-button issue.

1. READ SLACK FIRST
Before you go to any unit, check Slack. Guests extend their stays, and the team posts extensions there. A departure clean can change.

2. KNOW WHICH KIND OF ENTRY IT IS
• Departure clean: all checkouts are confirmed at 11 am. You may go in at 11 am.
• Anything else (maintenance, inspection, a non-departure clean, a delivery): you need permission to enter — PTE — first.
• Never enter a unit before 11 am without written OK from the team or a manager.

3. GET PTE IN SLACK (anything that is not a departure clean)
Post in Slack, tag your supervisor and @ccs, and wait for the written answer. No written answer, no entry.

4. AT THE DOOR — EVERY TIME, EVEN AT 11 AM
• Knock several times.
• Wait 30 seconds.
• Announce yourself: "Housekeeping!" (or "Maintenance!").
• Confirm nobody answers or opens the door.
• Then enter the code slowly.

NOT SURE?
Stop. Don't go in. Ask your manager or @ccs in Slack.`,
      bodyEs: `Cada entrada, siempre. Entrar cuando hay un huésped adentro es un problema de botón rojo.

1. PRIMERO LEE SLACK
Antes de ir a cualquier unidad, revisa Slack. Los huéspedes extienden su estadía, y el equipo publica las extensiones allí. Una limpieza de salida puede cambiar.

2. SABE QUÉ TIPO DE ENTRADA ES
• Limpieza de salida: todas las salidas se confirman a las 11 am. Puedes entrar a las 11 am.
• Cualquier otra cosa (mantenimiento, inspección, una limpieza que no es de salida, una entrega): necesitas permiso para entrar — PTE — primero.
• Nunca entres a una unidad antes de las 11 am sin autorización por escrito del equipo o de un gerente.

3. PIDE EL PTE EN SLACK (todo lo que no sea limpieza de salida)
Publica en Slack, etiqueta a tu supervisor y a @ccs, y espera la respuesta por escrito. Sin respuesta por escrito, no entras.

4. EN LA PUERTA — SIEMPRE, INCLUSO A LAS 11 AM
• Toca varias veces.
• Espera 30 segundos.
• Anúnciate: "¡Housekeeping!" (o "¡Mantenimiento!").
• Confirma que nadie responde ni abre la puerta.
• Luego marca el código despacio.

¿NO ESTÁS SEGURO?
Detente. No entres. Pregúntale a tu gerente o a @ccs en Slack.`,
      quiz: [
        { q: { en: 'When may you enter for a departure clean?', es: '¿Cuándo puedes entrar para una limpieza de salida?' }, options: { en: ['Any time after 9 am', 'At 11 am, once checkouts are confirmed', 'As soon as you arrive'], es: ['Cualquier hora después de las 9 am', 'A las 11 am, cuando se confirman las salidas', 'En cuanto llegues'] }, answer: 1 },
        { q: { en: 'A maintenance job in a unit. What do you need first?', es: 'Un trabajo de mantenimiento en una unidad. ¿Qué necesitas primero?' }, options: { en: ['Nothing — knock and go in', 'PTE: post in Slack, tag your supervisor and @ccs, wait for the written answer', 'A call from the guest'], es: ['Nada — tocas y entras', 'PTE: publica en Slack, etiqueta a tu supervisor y a @ccs, espera la respuesta por escrito', 'Una llamada del huésped'] }, answer: 1 },
        { q: { en: 'At the door, how long do you wait after knocking?', es: 'En la puerta, ¿cuánto esperas después de tocar?' }, options: { en: ['5 seconds', '30 seconds', 'You don\'t wait'], es: ['5 segundos', '30 segundos', 'No esperas'] }, answer: 1 },
        { q: { en: 'What do you do before going to any unit?', es: '¿Qué haces antes de ir a cualquier unidad?' }, options: { en: ['Read Slack for extensions', 'Call the guest', 'Nothing'], es: ['Leer Slack por extensiones', 'Llamar al huésped', 'Nada'] }, answer: 0 },
      ],
    }],
  },
  {
    id: 'red-button', tracks: ALL,
    titleEn: 'Walk-ins: the red-button rule', titleEs: 'Entradas con huésped: la regla de botón rojo',
    summaryEn: 'What a walk-in is, why it is red-button, and how to never have one.', summaryEs: 'Qué es entrar con huésped adentro, por qué es botón rojo y cómo evitarlo siempre.',
    lessons: [{
      kind: 'doc', tags: ['safety', 'housekeeping'], audience: [],
      titleEn: 'Walk-ins are a red-button issue', titleEs: 'Entrar con un huésped adentro es botón rojo',
      summaryEn: 'The one mistake we never make.', summaryEs: 'El único error que nunca cometemos.',
      bodyEn: `WHAT A WALK-IN IS
A walk-in is entering a unit while a guest is inside — or before they have left. For the guest it is a violation of their privacy, and it cannot be undone.

WHY IT IS RED-BUTTON
A walk-in can lead to disciplinary action and/or termination. There is no "small" walk-in.

HOW YOU NEVER HAVE ONE
• Read Slack before you go to any unit — stays get extended.
• Departure cleans: not before 11 am.
• Everything else: PTE in Slack first, written answer, every time.
• At the door: knock several times, wait 30 seconds, announce yourself, confirm nobody answers, enter the code slowly.
• Not sure? Do not go in. Ask your manager or @ccs.`,
      bodyEs: `QUÉ ES
Es entrar a una unidad mientras un huésped está adentro — o antes de que se haya ido. Para el huésped es una violación de su privacidad, y no se puede deshacer.

POR QUÉ ES BOTÓN ROJO
Entrar con un huésped adentro puede llevar a una acción disciplinaria y/o al despido. No existe un caso "pequeño".

CÓMO EVITARLO SIEMPRE
• Lee Slack antes de ir a cualquier unidad — las estadías se extienden.
• Limpiezas de salida: no antes de las 11 am.
• Todo lo demás: PTE en Slack primero, con respuesta por escrito, siempre.
• En la puerta: toca varias veces, espera 30 segundos, anúnciate, confirma que nadie responde, marca el código despacio.
• ¿No estás seguro? No entres. Pregúntale a tu gerente o a @ccs.`,
      quiz: [
        { q: { en: 'What can a walk-in lead to?', es: '¿A qué puede llevar entrar con un huésped adentro?' }, options: { en: ['Nothing, if you apologise', 'Disciplinary action and/or termination', 'A warning only'], es: ['A nada, si pides disculpas', 'Acción disciplinaria y/o despido', 'Solo una advertencia'] }, answer: 1 },
        { q: { en: 'You are not sure if the guest has left. What do you do?', es: 'No estás seguro si el huésped ya salió. ¿Qué haces?' }, options: { en: ['Knock loudly and go in', 'Don\'t go in — ask your manager or @ccs', 'Wait in the unit'], es: ['Tocar fuerte y entrar', 'No entres — pregúntale a tu gerente o a @ccs', 'Esperar dentro de la unidad'] }, answer: 1 },
        { q: { en: 'Which entries need PTE in Slack first?', es: '¿Qué entradas necesitan PTE en Slack primero?' }, options: { en: ['Only departure cleans', 'Everything that is not a departure clean', 'None'], es: ['Solo las limpiezas de salida', 'Todo lo que no sea limpieza de salida', 'Ninguna'] }, answer: 1 },
      ],
    }],
  },
  {
    id: 'door-locks', tracks: FIELD,
    titleEn: 'Door locks', titleEs: 'Cerraduras',
    summaryEn: 'How to change a door lock code — steps coming from the office.', summaryEs: 'Cómo cambiar el código de una cerradura — los pasos vienen de la oficina.',
    lessons: [],
  },
]

/** Create whatever of the starter course is missing. Never overwrites an item, a quiz or a module that exists. */
export async function seedStarter(by: string): Promise<{ ok: true; itemsCreated: number; quizzesCreated: number; modulesCreated: number } | { ok: false; error: string }> {
  const db = supabaseAdmin()
  const existing = await listItems(true)
  const byTitle: Record<string, TrainingItem> = {}
  for (const it of existing) byTitle[it.title.en.toLowerCase()] = it
  let itemsCreated = 0, quizzesCreated = 0, modulesCreated = 0
  const mods = await listModules(true)
  let next = mods.slice()
  let order = mods.length ? mods[mods.length - 1].sortOrder : 0
  for (let mi = 0; mi < STARTER.length; mi++) {
    const sm = STARTER[mi]
    const ids: string[] = []
    for (let li = 0; li < sm.lessons.length; li++) {
      const l = sm.lessons[li]
      let it = byTitle[l.titleEn.toLowerCase()]
      if (!it) {
        const r = await createItem({ kind: l.kind, titleEn: l.titleEn, titleEs: l.titleEs, summaryEn: l.summaryEn, summaryEs: l.summaryEs, bodyEn: l.bodyEn, bodyEs: l.bodyEs, tags: l.tags, audience: l.audience, required: false, sortOrder: (mi + 1) * 10 + li }, by)
        if (!r.ok) return { ok: false, error: `${l.titleEn}: ${r.error}` }
        it = r.item; byTitle[l.titleEn.toLowerCase()] = it; itemsCreated++
      }
      ids.push(it.id)
      if (l.quiz?.length) {
        const { data } = await db.from('training_quizzes').select('item_id').eq('item_id', it.id).maybeSingle()
        if (!data) {
          const { error } = await db.from('training_quizzes').insert({ item_id: it.id, questions: l.quiz, updated_by: by })
          if (!error) quizzesCreated++
        }
      }
    }
    if (!next.some(m => m.id === sm.id)) {
      order += 10
      next = next.concat([{ id: sm.id, title: { en: sm.titleEn, es: sm.titleEs }, summary: { en: sm.summaryEn, es: sm.summaryEs }, tracks: sm.tracks, itemIds: ids, sortOrder: order, status: 'active', updatedAt: new Date().toISOString(), updatedBy: by }])
      modulesCreated++
    }
  }
  if (modulesCreated) { const r = await writeModules(next, by); if (!r.ok) return { ok: false, error: r.error || 'could not save the modules' } }
  return { ok: true, itemsCreated, quizzesCreated, modulesCreated }
}
