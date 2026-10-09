'use client'
// THE SHARED BOARD — one project, no login, no commercials.
//
// A contractor or an owner holding this link sees the job: what it is, which units, the checklist,
// the dates and the photos. They can tick steps, add a note and upload photos from a phone, and —
// when the link was given edit access — add work of their own. They never see budget, spend, the
// owner, or anything the team said internally: that filtering happens on the server
// (app/api/public/project), not here, so a curious person reading this page's source finds nothing.
//
// 2026-10-09 (Jon: "sharable with the owners, and password protected. They should have edit access
// too"). Two things changed. A link can ask for a PASSCODE before it shows anything, and it can
// grant EDIT. The passcode is kept in this browser so the owner types it once, not every morning,
// and a name is asked for the same way so their comments and tasks are signed by a person rather
// than by "vendor".
import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Check, Loader2, AlertTriangle, Building2, Lock, Plus, X, Wrench, FileText, MessageSquare, ChevronRight, ChevronDown, Paperclip, Layers, Sparkles, ClipboardCheck } from 'lucide-react'

type Step = {
  id: string; title: string; done: boolean; status?: string | null; due_on: string | null
  section?: string | null; note?: string | null; addedByShare?: boolean
  done_at?: string | null; done_by?: string | null; doneShared?: boolean
  priority?: string | null
  assignees?: string[]
  subtasks?: { id: string; title: string; done: boolean; due_on?: string | null }[]
  breezeway?: { id: string; status: string; tone: string; assignee: string | null; date: string | null; reportUrl: string | null } | null
  requested?: boolean
  photos?: { id: string; url: string; caption: string | null; created_at: string }[]
  invoices?: { id: string; number: string | null; vendor: string | null; issued_on: string | null; file: { name: string; url: string; mime: string | null } | null }[]
  comments?: { body: string; author: string | null; created_at: string; mine?: boolean; mentions?: string[] }[]
}

type V = {
  id: string; ref: string | null; title: string; summary: string | null
  stage: string; category: string; starts_on: string | null; due_on: string | null
  building: string | null; vendor_name: string | null
  units: { ref_id: string; label: string | null; done: boolean }[]
  steps: Step[]
  team?: string[]
  inspections?: { id: string; unit: string; name: string; inspector: string | null; date: string | null; reportUrl: string | null }[]
  boards?: { id: string; label: string; stage: string | null; ref: string | null }[]
  staff?: { email: string; heroChoices?: string[]; inspections: { id: string; unit: string; name: string; inspector: string | null; date: string | null; reportUrl: string | null; shared: boolean }[] } | null
  hero?: string | null
  canEdit?: boolean
  photos: { id: string; url: string; caption: string | null; phase: string; created_at: string }[]
  notes: { body: string; author: string | null; created_at: string }[]
  progress: { done: number; total: number; pct: number | null; basis: string }
}

// ── TWO LANGUAGES (Jon, 2026-10-09: "a Spanish to English capability and vice versa") ──────────
//
// Two separate problems, solved two separate ways. The PAGE's own words are a fixed list, so they
// are translated here, once, by hand: instant, free, correct, and right even when the network is
// not. The CONTENT — job titles, notes, comments, written by whoever typed them — is translated
// on demand by the model, in one call for the whole board, and cached for the visit.
type Lang = 'en' | 'es'
const UI: Record<string, { en: string; es: string }> = {
  private: { en: 'This board is private', es: 'Este tablero es privado' },
  enterCode: { en: 'Enter the code you were given.', es: 'Introduce el código que te dieron.' },
  code: { en: 'Code', es: 'Código' },
  openBoard: { en: 'Open the board', es: 'Abrir el tablero' },
  badCode: { en: 'That code does not open this board.', es: 'Ese código no abre este tablero.' },
  whoAreYou: { en: 'Who are you?', es: '¿Quién eres?' },
  yourName: { en: 'Your name — so the team knows who ticked it', es: 'Tu nombre — para que el equipo sepa quién lo marcó' },
  needsDoing: { en: 'What needs doing', es: 'Qué hay que hacer' },
  nothingYet: { en: 'Nothing on the list yet.', es: 'Todavía no hay nada en la lista.' },
  addSomething: { en: 'Add something that needs doing…', es: 'Añadir algo que hay que hacer…' },
  whichUnit: { en: 'Which unit?', es: '¿Qué unidad?' },
  add: { en: 'Add', es: 'Añadir' },
  details: { en: 'Details (optional) — what exactly, where in the unit, anything to buy', es: 'Detalles (opcional) — qué exactamente, dónde en la unidad, algo que comprar' },
  units: { en: 'Units', es: 'Unidades' },
  photos: { en: 'Photos', es: 'Fotos' },
  takePhoto: { en: 'Take or upload a photo', es: 'Tomar o subir una foto' },
  messages: { en: 'Messages', es: 'Mensajes' },
  updateTeam: { en: 'Update the team…', es: 'Avisar al equipo…' },
  send: { en: 'Send', es: 'Enviar' },
  noMessages: { en: 'No messages yet.', es: 'Todavía no hay mensajes.' },
  inspections: { en: 'Inspections', es: 'Inspecciones' },
  report: { en: 'Report', es: 'Informe' },
  linkPrivate: { en: 'This link is for this job only. Please do not forward it.', es: 'Este enlace es solo para este trabajo. Por favor no lo reenvíes.' },
  everythingElse: { en: 'Everything else', es: 'Todo lo demás' },
  steps: { en: 'steps', es: 'pasos' },
  done: { en: 'Done', es: 'Hecho' },
  open: { en: 'Open', es: 'Abierto' },
  markDone: { en: 'Mark this done', es: 'Marcar como hecho' },
  isDone: { en: 'This is done', es: 'Esto está hecho' },
  actionSteps: { en: 'Action steps', es: 'Pasos a seguir' },
  noneYet: { en: 'None yet.', es: 'Todavía ninguno.' },
  addStep: { en: 'Add a step…', es: 'Añadir un paso…' },
  inTheField: { en: 'In the field', es: 'En el campo' },
  scheduled: { en: 'Scheduled with the team.', es: 'Programado con el equipo.' },
  showReport: { en: 'Show the report', es: 'Ver el informe' },
  hideReport: { en: 'Hide the report', es: 'Ocultar el informe' },
  openReport: { en: 'Open the report in a new tab ↗', es: 'Abrir el informe en otra pestaña ↗' },
  paperwork: { en: 'Paperwork', es: 'Documentos' },
  addPhotoJob: { en: 'Add a photo to this job', es: 'Añadir una foto a este trabajo' },
  comments: { en: 'Comments', es: 'Comentarios' },
  nothingSaid: { en: 'Nothing said yet.', es: 'Todavía no se ha dicho nada.' },
  addComment: { en: 'Add a comment…', es: 'Añadir un comentario…' },
  nameFirst: { en: 'Add a comment — put your name at the top first', es: 'Añadir un comentario — pon tu nombre arriba primero' },
  askTech: { en: 'Ask for a technician', es: 'Pedir un técnico' },
  techNote: { en: 'Anything the technician should know? (optional)', es: '¿Algo que el técnico deba saber? (opcional)' },
  requested: { en: 'A technician has been asked for. We will put it on the schedule.', es: 'Se ha pedido un técnico. Lo pondremos en el calendario.' },
  requestedShort: { en: 'Requested', es: 'Pedido' },
  yours: { en: 'yours', es: 'tuyo' },
  translating: { en: 'Translating…', es: 'Traduciendo…' },
  seeEnglish: { en: 'See in English', es: 'See in English' },
  seeSpanish: { en: 'Ver en español', es: 'Ver en español' },
  ofUnitsDone: { en: 'units done', es: 'unidades hechas' },
  addOne: { en: 'Add a task or project', es: 'Añadir una tarea o proyecto' },
  newItem: { en: 'Add', es: 'Añadir' },
  whatKind: { en: 'What is it?', es: '¿Qué es?' },
  aTask: { en: 'A task — one job', es: 'Una tarea — un trabajo' },
  aProject: { en: 'A project — its own board', es: 'Un proyecto — su propio tablero' },
  titleLabel: { en: 'Title', es: 'Título' },
  whatNeedsDoing: { en: 'What needs doing?', es: '¿Qué hay que hacer?' },
  unitLabel: { en: 'Unit', es: 'Unidad' },
  detailsLabel: { en: 'Details', es: 'Detalles' },
  dateLabel: { en: 'Date', es: 'Fecha' },
  cancel: { en: 'Cancel', es: 'Cancelar' },
  noUnit: { en: 'No unit', es: 'Sin unidad' },
  projects: { en: 'Projects', es: 'Proyectos' },
  pushBz: { en: 'Push to Breezeway', es: 'Enviar a Breezeway' },
  pushSent: { en: 'Sent to the team — they will schedule it in Breezeway.', es: 'Enviado al equipo — lo programarán en Breezeway.' },
  pushSentShort: { en: 'Sent', es: 'Enviado' },
  assignedTo: { en: 'Who has it', es: 'Quién lo tiene' },
  nobody: { en: 'Nobody yet', es: 'Nadie todavía' },
  due: { en: 'Due', es: 'Para' },
  overdue: { en: 'Overdue', es: 'Atrasado' },
  today: { en: 'Today', es: 'Hoy' },
  tomorrow: { en: 'Tomorrow', es: 'Mañana' },
  noDate: { en: 'No date', es: 'Sin fecha' },
  addTask: { en: 'Add a task', es: 'Añadir una tarea' },
  stepsLabel: { en: 'Steps', es: 'Pasos' },
  stepsHint: { en: 'One per line', es: 'Uno por línea' },
  photoLabel: { en: 'Photo', es: 'Foto' },
  choosePhoto: { en: 'Add a photo', es: 'Añadir una foto' },
  saving: { en: 'Saving…', es: 'Guardando…' },
  completed: { en: 'Completed', es: 'Completado' },
  nothingDone: { en: 'Nothing finished yet.', es: 'Todavía no se ha terminado nada.' },
  allClear: { en: 'Everything on the board is done.', es: 'Todo en el tablero está hecho.' },
  tabBoard: { en: 'Board', es: 'Tablero' },
  tabTeam: { en: 'Team', es: 'Equipo' },
  teamOnly: { en: 'Only you can see this tab — it is not on the owner\u2019s link.', es: 'Solo tú ves esta pestaña — no está en el enlace del propietario.' },
  releaseDone: { en: 'Show on the owner\u2019s completed list', es: 'Mostrar en la lista de completados del propietario' },
  releasedDone: { en: 'The owner can see this one.', es: 'El propietario puede ver esta.' },
  releaseIns: { en: 'Show on the owner\u2019s link', es: 'Mostrar en el enlace del propietario' },
  releasedIns: { en: 'The owner can see this one.', es: 'El propietario puede ver esta.' },
  finished: { en: 'Finished work', es: 'Trabajo terminado' },
  tidy: { en: 'Tidy up the names', es: 'Ordenar los nombres' },
  tidying: { en: 'Reading the board…', es: 'Leyendo el tablero…' },
  tidyNone: { en: 'The names already read well.', es: 'Los nombres ya se leen bien.' },
  keep: { en: 'Keep', es: 'Mantener' },
  use: { en: 'Use this', es: 'Usar este' },
  releaseAll: { en: 'Release all', es: 'Publicar todo' },
  search: { en: 'Search the board…', es: 'Buscar en el tablero…' },
  noMatch: { en: 'Nothing matches that.', es: 'Nada coincide con eso.' },
  expandAll: { en: 'Open all', es: 'Abrir todo' },
  collapseAll: { en: 'Close all', es: 'Cerrar todo' },
  polish: { en: 'Clean up the wording', es: 'Mejorar la redacción' },
  undo: { en: 'Undo', es: 'Deshacer' },
  pushNow: { en: 'Push to Breezeway now', es: 'Enviar a Breezeway ahora' },
  pushing: { en: 'Creating the field task…', es: 'Creando la tarea…' },
  needUnit: { en: 'Pick the unit first — a field task has to live somewhere.', es: 'Elige la unidad primero — la tarea necesita una unidad.' },
  activity: { en: 'Activity', es: 'Actividad' },
  coverPhoto: { en: 'Cover photo', es: 'Foto de portada' },
  coverHint: { en: 'Pick the picture at the top of the board.', es: 'Elige la foto que va arriba del tablero.' },
  urgent: { en: 'Urgent', es: 'Urgente' },
  high: { en: 'High', es: 'Alta' },
  medium: { en: 'Medium', es: 'Media' },
  low: { en: 'Low', es: 'Baja' },
  importance: { en: 'Importance', es: 'Importancia' },
  groupBy: { en: 'Group by', es: 'Agrupar por' },
  byUnit: { en: 'Unit', es: 'Unidad' },
  byPriority: { en: 'Importance', es: 'Importancia' },
  byDue: { en: 'Due date', es: 'Fecha' },
  byAssignee: { en: 'Who has it', es: 'Quién lo tiene' },
  anyone: { en: 'Anyone', es: 'Cualquiera' },
  unassigned: { en: 'Nobody', es: 'Nadie' },
  thisWeek: { en: 'This week', es: 'Esta semana' },
  later: { en: 'Later', es: 'Más adelante' },
  clear: { en: 'Clear', es: 'Limpiar' },
  showing: { en: 'showing', es: 'mostrando' },
}

/** Urgent, High, Medium, Low — Jon's four, stored as project_steps.priority. */
const PRIOS = ['urgent', 'high', 'normal', 'low'] as const
type Prio = typeof PRIOS[number]
const PRIO_KEY: Record<string, string> = { urgent: 'urgent', high: 'high', normal: 'medium', low: 'low' }
const PRIO_CLS: Record<string, string> = {
  urgent: 'border-rose-300 bg-rose-50 text-rose-800',
  high: 'border-amber-300 bg-amber-50 text-amber-800',
  normal: 'border-line bg-app text-muted',
  low: 'border-line bg-white text-muted/70',
}
const PRIO_DOT: Record<string, string> = { urgent: 'bg-rose-500', high: 'bg-amber-500', normal: 'bg-slate-300', low: 'bg-slate-200' }
const prioOf = (s: Step): Prio => (PRIOS as readonly string[]).includes(String(s.priority)) ? (s.priority as Prio) : 'normal'
const PRIO_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

/** Today in New York, which is where the work is. */
const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

/**
 * A DATE SOMEBODY CAN ACT ON. "Wed, Oct 14" tells you when; it does not tell you that it was due
 * yesterday, which is the only thing that changes what you do next. So a date near now is named
 * rather than printed, and late reads late.
 */
function dueChip(iso: string | null | undefined, lang: Lang, T: (k: string) => string) {
  if (!iso) return null
  const t = todayISO()
  const tomorrow = new Date(new Date(t + 'T12:00:00').getTime() + 864e5).toLocaleDateString('en-CA')
  const label = iso < t ? T('overdue') : iso === t ? T('today') : iso === tomorrow ? T('tomorrow') : day(iso, lang)
  const tone = iso < t ? 'border-rose-200 bg-rose-50 text-rose-700'
    : iso === t ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-line text-muted'
  return { label: String(label), tone, late: iso < t }
}

/** Two letters for a face that is not there. Steadier to scan down a column than a full name. */
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase()

const day = (iso: string | null, lang: Lang = 'en') =>
  !iso ? null : new Date(iso + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' })

// ORGANISED BY UNIT. A board that covers twenty-three units collects work from all of them, and a
// single running list hides which flat a job belongs to. Tasks keep the order they were given in;
// only the grouping is imposed. Anything with no unit on it falls to the end under its own
// heading rather than being hidden or guessed at.
function groupSteps(steps: Step[], elseLabel: string) {
  const order: string[] = []
  const by: Record<string, Step[]> = {}
  for (const s of steps) {
    const k = unitKey(s.section) || '\u0000'
    if (!by[k]) { by[k] = []; order.push(k) }
    by[k].push(s)
  }
  const loose = order.filter(k => k === '\u0000')
  const named = order.filter(k => k !== '\u0000')
  return [...named, ...loose].map(k => ({ key: k, name: k === '\u0000' ? (named.length ? elseLabel : '') : k, rows: by[k] }))
}

/**
 * ONE UNIT, ONE BLOCK — whatever it was called when the job was written down.
 *
 * The same flat arrives spelled three ways: "Arya 1404", "Arya 1404 - 1BR", "1404". Grouping on
 * the raw text split one unit into three cards, each with part of its work, which is worse than
 * not grouping at all. So the key is the unit ITSELF — its number and, where it exists, which
 * half — and the card is titled with that: "1404", "1418/2". Shorter to read down a column, and
 * impossible to spell two ways.
 */
function unitKey(section: string | null | undefined): string {
  const raw = String(section || '').trim()
  if (!raw) return ''
  const m = raw.match(/(\d{3,4})\s*(?:[-/]\s*([12])\b)?/)
  if (!m) return raw
  return m[2] ? `${m[1]}/${m[2]}` : m[1]
}

// The unit picker offers the sections already in use plus every unit on the board, so an owner
// adding a second job to 1404 files it under the same heading rather than a near-miss spelling.
function unitNames(p: V) {
  const out: string[] = []
  const listed = p.units.map(u => String(u.label || '').trim()).filter(Boolean)
  const skip = combinedListings(listed)
  for (const s of p.steps) { const n = (s.section || '').trim(); if (n && !out.includes(n)) out.push(n) }
  for (const n of listed) if (!skip.has(n) && !out.includes(n)) out.push(n)
  return out
}

/**
 * "FULL" IS THE SAME SPACE TWICE (Jon, 2026-10-09: "full means both units. For example, 1418
 * full is 1418, unit 1 and unit 2, so you don't need to create a task for those units. I prefer
 * it at the individual unit").
 *
 * A combined listing and its two halves are one apartment sold two ways. A job filed against
 * both is the same job counted twice — and worse, ticked in one place and still open in the
 * other. So the combined listing is not offered as somewhere to put work; the halves are.
 *
 * Found by shape, not by the word "Full": Arya 1705 is the combined of 1705/1 and 1705/2 and
 * says so nowhere in its name. A listing is combined when its number ALSO appears split.
 */
function combinedListings(labels: string[]): Set<string> {
  const num = (s: string) => (s.match(/(\d{3,4})/) || [])[1] || ''
  const isHalf = (s: string) => /\d{3,4}\s*[-/]\s*[12]\b/.test(s)
  const halves = new Set(labels.filter(isHalf).map(num).filter(Boolean))
  return new Set(labels.filter(l => !isHalf(l) && halves.has(num(l))))
}

export default function VendorProjectPage({ params }: { params: { token: string } }) {
  const token = params.token
  const [p, setP] = useState<V | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [task, setTask] = useState('')
  const [taskUnit, setTaskUnit] = useState('')
  const [taskDesc, setTaskDesc] = useState('')
  const [adding, setAdding] = useState(false)
  const [naming, setNaming] = useState(false)
  const [openSubs, setOpenSubs] = useState<Set<string>>(new Set())
  const [showDone, setShowDone] = useState(false)
  const [openReport, setOpenReport] = useState<string | null>(null)
  const [tab, setTab] = useState<'board' | 'team'>('board')
  const [q, setQ] = useState('')
  const [fPrio, setFPrio] = useState('')
  const [fDue, setFDue] = useState('')
  const [fWho, setFWho] = useState('')
  const [groupBy, setGroupBy] = useState<'unit' | 'prio' | 'due' | 'who'>('unit')
  // Units start folded once there are enough of them to scroll past; with three or four groups
  // folding is friction, with twenty it is the only way to see the shape of the board.
  const [folded, setFolded] = useState<Set<string> | null>(null)
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [lang, setLang] = useState<Lang>('en')
  // original → translation, for the language currently chosen. Cleared when the language flips,
  // so nothing from the last language can leak into this one.
  const [tr, setTr] = useState<Record<string, string>>({})
  const [translating, setTranslating] = useState(false)
  const T = useCallback((k: string) => (UI[k] ? UI[k][lang] : k), [lang])
  // Content goes through the same door: a line we have a translation for is shown translated,
  // and one we do not is shown as written rather than as a gap.
  const TX = useCallback((v: string | null | undefined) => (v && tr[v]) || v || '', [tr])
  const fileRef = useRef<HTMLInputElement>(null)
  // The passcode and the name live in this browser, not in the URL — a link pasted into a chat
  // should not carry the code that unlocks it.
  const KEY = 'share:' + token
  const [pass, setPass] = useState('')
  const [who, setWho] = useState('')
  const [locked, setLocked] = useState(false)
  const [tryPass, setTryPass] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try { const raw = localStorage.getItem(KEY); if (raw) { const v = JSON.parse(raw); setPass(v.pass || ''); setWho(v.who || ''); if (v.lang === 'es' || v.lang === 'en') setLang(v.lang) } } catch { /* fresh browser */ }
    setReady(true)
  }, [KEY])

  const load = useCallback(async (code?: string) => {
    try {
      const c = code !== undefined ? code : pass
      const r = await fetch('/api/public/project?token=' + encodeURIComponent(token) + (c ? '&pass=' + encodeURIComponent(c) : ''), { cache: 'no-store' })
      const j = await r.json()
      // The server decides. A signed-in team member is answered with the board and never sees
      // this screen; only a 401 means the code is actually needed.
      if (r.status === 401 && j.needsPass) { setLocked(true); setP(null); return }
      if (!r.ok || !j.ok) throw new Error(j.error || 'This link is not valid.')
      setLocked(false); setErr(null); setP(j.project)
    } catch (e: any) { setErr(String(e.message || e)) }
  }, [token, pass])
  useEffect(() => { if (ready) load() }, [ready, load])

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('unlock'); setErr(null)
    const code = tryPass.trim()
    const r = await fetch('/api/public/project?token=' + encodeURIComponent(token) + '&pass=' + encodeURIComponent(code), { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    setBusy(null)
    if (r.status === 401) { setErr(T('badCode')); return }
    if (!r.ok || !j.ok) { setErr(j.error || 'Could not open the board.'); return }
    setPass(code); setLocked(false); setP(j.project)
    try { localStorage.setItem(KEY, JSON.stringify({ pass: code, who, lang })) } catch { /* private window */ }
  }
  const saveWho = (name: string) => { setWho(name); try { localStorage.setItem(KEY, JSON.stringify({ pass, who: name, lang })) } catch { /* fine */ } }

  const post = async (body: any, key: string): Promise<any> => {
    setBusy(key); setErr(null)
    try {
      const r = await fetch('/api/public/project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, pass, who, ...body }) })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save.')
      if (j.project) setP(j.project)
      return j
    } catch (e: any) { setErr(String(e.message || e)); return null } finally { setBusy(null) }
  }

  const upload = async (f: File, taskId?: string) => {
    setBusy(taskId ? 'photo' + taskId : 'photo'); setErr(null)
    try {
      const fd = new FormData(); fd.append('file', f); fd.append('token', token); fd.append('phase', 'during'); fd.append('pass', pass); fd.append('who', who)
      if (taskId) fd.append('taskId', taskId)
      const r = await fetch('/api/projects/photo', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Upload failed.')
      await load()
    } catch (e: any) { setErr(String(e.message || e)) } finally { setBusy(null) }
  }

  /**
   * Flip the language. The page's own words change instantly from the table above; the CONTENT is
   * gathered into one list — every title, note, action step and comment on the board — and sent
   * in a single call. Going back to English just drops the cache: the originals were never
   * overwritten, so nothing can be lost in a round trip.
   */
  const switchTo = async (next: Lang) => {
    setLang(next)
    try { localStorage.setItem(KEY, JSON.stringify({ pass, who, lang: next })) } catch { /* fine */ }
    if (!p) return
    if (next === 'en') { setTr({}); return }
    const lines: string[] = []
    const take = (v?: string | null) => { const t = String(v || '').trim(); if (t && !lines.includes(t)) lines.push(t) }
    take(p.summary)
    for (const t of p.steps) {
      take(t.title); take(t.note); take(t.section)
      for (const x of (t.subtasks || [])) take(x.title)
      for (const c of (t.comments || [])) take(c.body)
    }
    if (!lines.length) return
    setTranslating(true)
    try {
      const r = await fetch('/api/public/project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, pass, who, action: 'translate', to: next, lines }) })
      const j = await r.json()
      if (j?.ok && Array.isArray(j.lines)) {
        const map: Record<string, string> = {}
        lines.forEach((src, i) => { const out = String(j.lines[i] || '').trim(); if (out && out !== src) map[src] = out })
        setTr(map)
      }
    } catch { /* the board stays in English, which is readable, rather than half-translated */ }
    finally { setTranslating(false) }
  }

  if (locked) {
    return (
      <main className="min-h-screen bg-app flex items-center justify-center p-6">
        <form onSubmit={unlock} className="w-full max-w-xs text-center">
          <Lock size={24} className="text-muted mx-auto mb-3" />
          <h1 className="text-lg font-bold text-ink">{T('private')}</h1>
          <p className="text-[13px] text-muted mt-1 mb-4">{T('enterCode')}</p>
          <input value={tryPass} onChange={e => setTryPass(e.target.value)} autoFocus placeholder={T('code')}
            className="w-full text-center text-[16px] tracking-widest rounded-xl border border-line px-3 py-3 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          {err && <p className="text-[12.5px] text-rose-700 mt-2">{err}</p>}
          <button disabled={!tryPass.trim() || busy === 'unlock'} className="mt-3 w-full rounded-xl bg-ink text-white text-[14px] font-semibold py-3 disabled:opacity-50">
            {busy === 'unlock' ? <Loader2 size={15} className="animate-spin inline" /> : T('openBoard')}
          </button>
          <button type="button" onClick={() => setLang(l => (l === 'en' ? 'es' : 'en'))}
            className="mt-4 text-[12px] text-muted hover:text-ink">{lang === 'en' ? 'Ver en español' : 'See in English'}</button>
        </form>
      </main>
    )
  }
  if (err && !p) {
    return (
      <main className="min-h-screen bg-app flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <AlertTriangle size={28} className="text-amber-500 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-ink">This link is not valid</h1>
          <p className="text-[13px] text-muted mt-1">It may have expired or been replaced. Ask your contact at Stay Hospitality for a new one.</p>
        </div>
      </main>
    )
  }
  if (!p) return <main className="min-h-screen bg-app flex items-center justify-center"><Loader2 size={20} className="animate-spin text-muted" /></main>

  // The board at a glance: how much of the WORK is done, which is what anyone opening this link
  // actually wants to know. The unit count stays below it as the second number.
  const jobs = p.steps.length
  const jobsDone = p.steps.filter(x => x.done).length

  // ── WHAT THE LIST SHOWS ──────────────────────────────────────────────────────────────────
  // Four filters that narrow, and one choice that organises. Deliberately separate: hiding work
  // and arranging work are different jobs, and a board that conflates them is the one Jon could
  // not read.
  const needle = q.trim().toLowerCase()
  const openAll = p.steps.filter(x => !x.done)
  const t0 = todayISO()
  const weekEnd = new Date(new Date(t0 + 'T12:00:00').getTime() + 6 * 864e5).toLocaleDateString('en-CA')
  const people = Array.from(new Set(openAll.flatMap(x => x.assignees || []))).concat(
    openAll.some(x => !(x.assignees || []).length) ? [T('unassigned')] : [])
  const rows = openAll.filter(x => {
    if (needle && ![x.title, x.note, x.section, ...(x.assignees || [])].some(v => String(v || '').toLowerCase().includes(needle))) return false
    if (fPrio && prioOf(x) !== fPrio) return false
    if (fWho) {
      const mine = x.assignees || []
      if (fWho === T('unassigned') ? mine.length > 0 : !mine.includes(fWho)) return false
    }
    if (fDue) {
      const d = x.due_on || ''
      if (fDue === 'none' && d) return false
      if (fDue === 'overdue' && !(d && d < t0)) return false
      if (fDue === 'today' && d !== t0) return false
      if (fDue === 'week' && !(d && d >= t0 && d <= weekEnd)) return false
    }
    return true
  })

  // THE ORGANISING. Whatever it is grouped by, the groups come out in an order that means
  // something — importance highest first, dates soonest first, units in the order the work
  // arrived — and every group is open. Nothing is hidden behind a chevron any more.
  const buckets = (() => {
    const by: Record<string, { key: string; name: string; sort: string; rows: Step[] }> = {}
    const put = (key: string, name: string, sort: string, s: Step) => {
      if (!by[key]) by[key] = { key, name, sort, rows: [] }
      by[key].rows.push(s)
    }
    for (const s of rows) {
      if (groupBy === 'prio') { const k = prioOf(s); put(k, T(PRIO_KEY[k]), String(PRIO_RANK[k]), s) }
      else if (groupBy === 'who') {
        const who0 = (s.assignees || [])[0] || T('unassigned')
        put(who0, who0, (s.assignees || []).length ? '1' + who0 : '2', s)
      } else if (groupBy === 'due') {
        const d = s.due_on || ''
        const k = !d ? 'none' : d < t0 ? 'overdue' : d === t0 ? 'today' : d <= weekEnd ? 'week' : 'later'
        const name = k === 'none' ? T('noDate') : k === 'overdue' ? T('overdue') : k === 'today' ? T('today') : k === 'week' ? T('thisWeek') : T('later')
        put(k, name, { overdue: '0', today: '1', week: '2', later: '3', none: '4' }[k] as string, s)
      } else {
        const k = unitKey(s.section) || '~'
        put(k, k === '~' ? T('everythingElse') : k, k === '~' ? 'zz' : k, s)
      }
    }
    const list = Object.values(by).sort((a, b) => a.sort.localeCompare(b.sort, undefined, { numeric: true }))
    // Within a group: most important first, then soonest, so the top of every block is the
    // thing to do next.
    for (const g of list) {
      g.rows.sort((x, y) => (PRIO_RANK[prioOf(x)] - PRIO_RANK[prioOf(y)])
        || String(x.due_on || '9999').localeCompare(String(y.due_on || '9999')))
    }
    return list
  })()

  return (
    <main className="min-h-screen bg-app">
      {/* THE HEADER (2026-10-09 look). One dark band carrying the name, the two numbers and the
          language switch — so the page opens on something composed rather than on a stack of
          white cards, and the switch is the first thing a Spanish reader meets. */}
      {/* THE PLACE ITSELF, BLOCKED IN (Jon, 2026-10-09: "the way the photo looks, where it fills
          up the whole screen, it looks silly on the desktop. It should just kind of block in").
          A full-bleed band is a phone pattern; on a wide screen it is a billboard above a list.
          So the picture is a fixed-height block inside the same column as everything else. */}
      {/* THE DARK BAND STOPS WHERE THE CONTENT STOPS (Jon: "the top part, the black part,
          shouldn't extend on"). Edge-to-edge ink behind a centred column leaves two black
          margins doing nothing but making the page feel like two unrelated halves. It is a
          card now, the same width as everything under it. */}
      <div className="max-w-3xl mx-auto px-4 pt-4">
        {/* LIGHT, NOT BLACK (Jon: "AND DON'T WANT IT BLACK EITHER"). A slab of ink at the top
            of a white page is a header shouting at a list. White card, dark type, and the photo
            carries the colour — which is what a photo is for. */}
        <header className="rounded-2xl border border-line bg-white overflow-hidden shadow-[0_1px_2px_rgba(16,17,20,0.04)]">
        {p.hero && <img src={p.hero} alt="" aria-hidden className="w-full h-24 sm:h-32 object-cover" />}
        <div className="px-4 sm:px-5 pt-4 pb-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {/* THE TWO MARKS (Jon, 2026-10-09). Stay Hospitality is whose board this is;
                  Lighthouse is what it runs on. Both small, both in the one place a reader
                  looks first, neither competing with the name of the job. */}
              <span className="flex items-center gap-2 mb-1.5">
                <img src="/stay-logo.png" alt="Stay Hospitality" className="h-5 w-auto" />
                <span className="w-px h-3.5 bg-line" />
                <img src="/lighthouse-mark.svg" alt="" aria-hidden className="h-4 w-auto opacity-60" />
                <span className="text-[10px] uppercase tracking-[0.16em] font-semibold text-muted">Lighthouse</span>
                {p.ref && <span className="text-[10px] uppercase tracking-[0.16em] font-semibold text-muted ml-auto">{p.ref}</span>}
              </span>
              <h1 className="text-[22px] font-bold tracking-tight mt-1 leading-tight text-ink">{p.title}</h1>
            </div>
            <button onClick={() => switchTo(lang === 'en' ? 'es' : 'en')} disabled={translating}
              className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[11.5px] font-semibold text-ink hover:bg-app disabled:opacity-50 inline-flex items-center gap-1.5">
              {translating ? <Loader2 size={12} className="animate-spin" /> : null}
              {translating ? T('translating') : lang === 'en' ? 'Español' : 'English'}
            </button>
          </div>
          {p.summary && <p className="text-[13px] text-muted mt-2 leading-relaxed">{TX(p.summary)}</p>}
          <div className="flex items-center gap-2.5 flex-wrap mt-3 text-[11.5px] text-muted">
            {p.building && <span className="inline-flex items-center gap-1"><Building2 size={11} />{p.building}</span>}
            {p.due_on && <span>{day(p.due_on, lang)}</span>}
            {p.vendor_name && <span>{p.vendor_name}</span>}
          </div>
          {jobs > 0 && (
            <div className="mt-4">
              <div className="flex items-baseline justify-between text-[11.5px] text-muted mb-1.5">
                <span className="tabular-nums font-semibold text-ink">{jobsDone}/{jobs}</span>
                <span className="tabular-nums">{p.progress.total > 0 ? `${p.progress.done}/${p.progress.total} ${T('ofUnitsDone')}` : ''}</span>
              </div>
              <span className="block h-1.5 rounded-full bg-app overflow-hidden">
                <span className="block h-full bg-emerald-500 transition-all" style={{ width: (jobs ? Math.round((jobsDone / jobs) * 100) : 0) + '%' }} />
              </span>
            </div>
          )}
        </div>
        </header>
      </div>

      {/* THE TEAM TAB (Jon, 2026-10-09). The same URL serves both: an owner gets the board, a
          signed-in Lighthouse user gets the board AND the controls for what leaves the building.
          It only renders when the server says so — the client never decides who is staff. */}
      {p.staff && (
        <div className="max-w-3xl mx-auto px-4 pt-4">
          <div className="inline-flex rounded-xl border border-line bg-white p-0.5 shadow-[0_1px_2px_rgba(16,17,20,0.04)]">
            {(['board', 'team'] as const).map(k => (
              <button key={k} onClick={() => setTab(k)}
                className={'px-3 py-1.5 text-[12.5px] font-semibold rounded-lg ' + (tab === k ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                {k === 'board' ? T('tabBoard') : T('tabTeam')}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={'max-w-3xl mx-auto px-4 py-5 space-y-3' + (tab === 'team' ? ' hidden' : '')}>
        {err && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{err}</p>}

        {/* WHO ARE YOU is a question asked once, not a permanent field. Answered, it shrinks to
            a line you can click to change — a full card at the top of every visit, repeating a
            question you already answered, is the kind of furniture that makes a page feel long. */}
        {p.canEdit && (who && !naming ? (
          <button onClick={() => setNaming(true)} className="flex items-center gap-2 px-1 pb-1 text-[12px] text-muted hover:text-ink">
            <span className="w-5 h-5 rounded-full bg-ink text-white grid place-items-center text-[9px] font-bold">{initials(who)}</span>
            {who}<span className="text-muted/60">· {lang === 'es' ? 'cambiar' : 'change'}</span>
          </button>
        ) : (
          <section className="rounded-xl border border-line bg-white p-3">
            <label className="block text-[12px] font-bold text-ink mb-1.5">{T('whoAreYou')}</label>
            <input value={who} autoFocus={naming} onChange={e => saveWho(e.target.value)} onBlur={() => setNaming(false)}
              onKeyDown={e => { if (e.key === 'Enter') setNaming(false) }} placeholder={T('yourName')}
              className="w-full text-[14px] rounded-xl border border-line px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          </section>
        ))}

        {/* ── EVERYTHING, ORGANISED, AND FILTERABLE ───────────────────────────────────────
            Jon: "I hate the new format. It doesn't make sense. I want to be able to see
            everything organized, and then I should be able to filter it by due date, assignee,
            or importance."
            So: one list, all of it open, nothing folded away. The organising is a CHOICE —
            group by unit, by importance, by date or by person — and the filters cut the list
            down rather than hiding it behind a chevron. Every row carries the same four facts
            in the same four places: how important, what it is, when, and who. */}
        <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-[0_1px_2px_rgba(16,17,20,0.04)]">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line">
            <h2 className="text-[12px] font-bold text-ink flex-1">{T('needsDoing')}</h2>
            <span className="text-[11px] text-muted tabular-nums">{rows.length === openAll.length ? openAll.length : `${rows.length} ${T('showing')} / ${openAll.length}`}</span>
            {p.canEdit && (
              <button onClick={() => setAdding(true)}
                className="text-[12.5px] font-semibold rounded-lg bg-ink text-white px-2.5 py-1.5 inline-flex items-center gap-1 hover:opacity-90">
                <Plus size={14} /> {T('addTask')}
              </button>
            )}
          </div>

          {/* THE FILTER BAR. Chips, not a form — on a phone a row of taps beats four dropdowns,
              and a filter you can see is a filter you remember to turn off. */}
          <div className="px-3 py-2 border-b border-line bg-app/40 space-y-2">
            <div className="flex items-center gap-2">
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={T('search')}
                className="flex-1 min-w-0 text-[13px] bg-transparent py-1 focus:outline-none placeholder:text-muted/70" />
              {(q || fPrio || fDue || fWho) && (
                <button onClick={() => { setQ(''); setFPrio(''); setFDue(''); setFWho('') }}
                  className="shrink-0 text-[11.5px] font-semibold text-muted hover:text-ink">{T('clear')}</button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {PRIOS.map(k => (
                <button key={k} onClick={() => setFPrio(fPrio === k ? '' : k)}
                  className={'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ' +
                    (fPrio === k ? 'border-ink bg-ink text-white' : PRIO_CLS[k] + ' hover:border-ink/40')}>
                  <span className={'w-1.5 h-1.5 rounded-full ' + (fPrio === k ? 'bg-white' : PRIO_DOT[k])} />
                  {T(PRIO_KEY[k])}
                </button>
              ))}
              <span className="w-px h-4 bg-line mx-0.5" />
              {([['overdue', T('overdue')], ['today', T('today')], ['week', T('thisWeek')], ['none', T('noDate')]] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setFDue(fDue === k ? '' : k)}
                  className={'rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ' +
                    (fDue === k ? 'border-ink bg-ink text-white' : 'border-line text-muted hover:text-ink')}>{lbl}</button>
              ))}
            </div>
            {!!people.length && (
              <div className="flex flex-wrap items-center gap-1">
                {people.map(n => (
                  <button key={n} onClick={() => setFWho(fWho === n ? '' : n)}
                    className={'inline-flex items-center gap-1 rounded-full border pl-0.5 pr-2 py-0.5 text-[11.5px] ' +
                      (fWho === n ? 'border-ink bg-ink text-white font-semibold' : 'border-line text-muted hover:text-ink')}>
                    <span className={'w-4 h-4 rounded-full grid place-items-center text-[8px] font-bold ' + (fWho === n ? 'bg-white/20' : 'bg-app text-muted')}>{n === T('unassigned') ? '·' : initials(n)}</span>
                    {n}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-[11.5px]">
              <span className="text-muted/80">{T('groupBy')}</span>
              {([['unit', T('byUnit')], ['prio', T('byPriority')], ['due', T('byDue')], ['who', T('byAssignee')]] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setGroupBy(k)}
                  className={'rounded-md px-1.5 py-0.5 font-semibold ' + (groupBy === k ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>{lbl}</button>
              ))}
            </div>
          </div>

          {!rows.length && (
            <p className="px-3 py-4 text-[13px] text-muted">{openAll.length ? T('noMatch') : p.steps.length ? T('allClear') : T('nothingYet')}</p>
          )}
          {/* ONE UNIT SHOULD LOOK LIKE ONE UNIT (Jon: "need more delineation between units").
              The groups were separated by a hairline, which is not a separation — thirty-five
              rows with faint captions in them still reads as one run. Each group now gets real
              space above it, a heading in ink rather than grey, a count that looks like a
              count, and a tinted rail down the side of its rows so the block holds together
              from the first job to the last. */}
          {buckets.map((b, i) => (
            <div key={b.key} className={i ? 'border-t-8 border-app' : ''}>
              <div className="flex items-center gap-2 px-3 pt-3 pb-1.5 bg-white">
                <span className="w-1 h-4 rounded-full bg-ink/80 shrink-0" />
                <h3 className="text-[13px] font-bold text-ink tracking-tight">{b.name}</h3>
                <span className="text-[11px] font-semibold text-muted tabular-nums rounded-full bg-app px-1.5 py-px ml-auto">{b.rows.length}</span>
              </div>
              <div className="divide-y divide-line/60 border-l-2 border-app ml-3">
                {b.rows.map(s => <JobRow key={s.id} s={s} p={p} busy={busy} T={T} TX={TX} lang={lang}
                  post={post} onOpen={setOpenTask}
                  showUnit={groupBy !== 'unit'}
                  open={openSubs.has(s.id)}
                  onToggleSubs={() => setOpenSubs(v => { const n = new Set(v); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n })} />)}
              </div>
            </div>
          ))}
        </div>


        {/* ── THE ACTIVITY LOG ─────────────────────────────────────────────────────────────
            Jon: "I just want to be able to see the activity. There should be a log that's like
            completed work ... projects on this board, or inspections or tasks that we show from
            Breezeway. It'll have the report built into it, so Paco can see the distinctions
            between the units."
            So one stream, newest first, two kinds of entry in it: work we finished here, and
            inspections the field completed in Breezeway. Each carries its unit, so reading down
            the column tells you which flats have been attended to and which have not — and an
            inspection opens its report in place rather than sending anyone to another login. */}
        {(() => {
          type Entry = { id: string; when: string; unit: string | null; title: string; who: string | null; kind: 'task' | 'inspection'; reportUrl?: string | null }
          const entries: Entry[] = []
          for (const x of p.steps) {
            if (!x.done) continue
            if (!p.staff && !x.doneShared) continue
            entries.push({ id: 'T' + x.id, when: String(x.done_at || '').slice(0, 10), unit: x.section || null, title: x.title, who: x.done_by || null, kind: 'task' })
          }
          for (const i of (p.inspections || [])) {
            entries.push({ id: 'I' + i.id, when: String(i.date || '').slice(0, 10), unit: i.unit, title: i.name, who: i.inspector, kind: 'inspection', reportUrl: i.reportUrl })
          }
          if (!entries.length) return null
          entries.sort((a, b) => b.when.localeCompare(a.when))
          const shown = showDone ? entries : entries.slice(0, 6)
          return (
            <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-[0_1px_2px_rgba(16,17,20,0.04)]">
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line">
                <h2 className="text-[12px] font-bold text-ink flex-1">{T('activity')}</h2>
                <span className="text-[11px] text-muted tabular-nums">{entries.length}</span>
              </div>
              <div className="p-3 space-y-2">
                {shown.map(e => (
                  <div key={e.id} className="rounded-xl border border-line overflow-hidden">
                    <div className="flex items-start gap-2.5 px-3 py-2.5">
                      <span className={'shrink-0 mt-0.5 w-6 h-6 rounded-full grid place-items-center ' +
                        (e.kind === 'inspection' ? 'bg-brand-50 text-brand-700' : 'bg-emerald-50 text-emerald-700')}>
                        {e.kind === 'inspection' ? <ClipboardCheck size={13} /> : <Check size={13} strokeWidth={3} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        {e.unit && <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{TX(e.unit)}</p>}
                        <p className="text-[13.5px] text-ink leading-snug">{TX(e.title)}</p>
                        <p className="text-[11px] text-muted mt-0.5">
                          {[e.kind === 'inspection' ? T('inspections') : T('completed'), e.who, e.when ? day(e.when, lang) : null].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {e.reportUrl && (
                        <button onClick={() => setOpenReport(v => v === e.id ? null : e.id)}
                          className="shrink-0 text-[11.5px] font-semibold text-brand-700 hover:underline">
                          {openReport === e.id ? T('hideReport') : T('report')}
                        </button>
                      )}
                    </div>
                    {e.reportUrl && openReport === e.id && (
                      <div className="border-t border-line p-3">
                        <iframe src={e.reportUrl} title={e.title} className="w-full h-[55vh] rounded-lg border border-line bg-white" />
                        <a href={e.reportUrl} target="_blank" rel="noreferrer" className="inline-block mt-2 text-[12px] font-semibold text-brand-700 hover:underline">{T('openReport')}</a>
                      </div>
                    )}
                  </div>
                ))}
                {entries.length > 6 && (
                  <button onClick={() => setShowDone(v => !v)} className="w-full text-[12px] font-semibold text-muted hover:text-ink py-1">
                    {showDone ? T('collapseAll') : `${T('expandAll')} (${entries.length})`}
                  </button>
                )}
              </div>
            </div>
          )
        })()}


        <div className="pb-8 pt-2 text-center">
          <img src="/stay-logo.png" alt="Stay Hospitality" className="h-5 w-auto mx-auto opacity-30 mb-2" />
          <p className="text-[11px] text-muted">{T('linkPrivate')}</p>
        </div>
      </div>

      {p.staff && tab === 'team' && (
        <TeamPanel p={p} staff={p.staff} busy={busy} T={T} lang={lang} post={post} pass={pass} token={token} />
      )}

      {adding && (
        <AddSheet p={p} busy={busy} T={T} post={post} upload={upload} onClose={() => setAdding(false)} />
      )}

      {openTask && (() => {
        const t = p.steps.find(x => x.id === openTask)
        return t ? <ItemSheet t={t} p={p} who={who} busy={busy} post={post} upload={upload}
          T={T} TX={TX} lang={lang} reload={() => load()} onClose={() => setOpenTask(null)} /> : null
      })()}
    </main>
  )
}


/**
 * ADDING SOMETHING — one button, then a real form (Jon, 2026-10-09).
 *
 * The order is his: TITLE at the top, then WHAT IT IS, then the UNIT, then everything else. A
 * task is one job on this board. A project is a bigger piece of work that gets a board of its
 * own and shows here as a line — because the alternative, a task that grows six checklists and
 * still is not a project, is how a board stops being readable.
 */
/**
 * THE TEAM TAB — what leaves the building, decided here.
 *
 * Jon, 2026-10-09: a signed-in user sees "a tab that shows inspections and all the tasks that
 * were completed that you can push to a completed section for review". Two lists and one switch
 * each, plus the AI pass over the names. Everything on this tab is invisible on the owner's link
 * — not hidden by CSS, absent from the payload: the server only builds it for a signed-in
 * editor, so a curious person reading the page source finds nothing to read.
 */
function TeamPanel({ p, staff, busy, T, lang, post, pass, token }: {
  p: V
  staff: NonNullable<V['staff']>
  busy: string | null
  T: (k: string) => string
  lang: Lang
  post: (body: any, key: string) => Promise<any>
  pass: string
  token: string
}) {
  const [tidy, setTidy] = useState<{ id: string; was: string; now: string }[] | null>(null)
  const [working, setWorking] = useState(false)
  const done = p.steps.filter(x => x.done)
    .sort((a, b) => String(b.done_at || '').localeCompare(String(a.done_at || '')))
  const open = p.steps.filter(x => !x.done)

  /**
   * TIDY THE NAMES. Jobs get typed into a phone between two units — "ac filter chnage 1404",
   * "buy blackout". They read fine to whoever wrote them and badly to an owner. The model
   * rewrites each title through the house rules (/api/ai/polish, which may never add a fact),
   * and NOTHING is saved until somebody picks it line by line.
   */
  const runTidy = async () => {
    setWorking(true)
    const out: { id: string; was: string; now: string }[] = []
    for (const t of open.slice(0, 25)) {
      try {
        const r = await fetch('/api/ai/polish', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: t.title, kind: 'title', context: [p.title, t.section].filter(Boolean).join(' · ') }),
        })
        const j = await r.json()
        const next = j?.changed ? String(j?.polished || '').trim() : ''
        if (next && next !== t.title) out.push({ id: t.id, was: t.title, now: next })
      } catch { /* one title failing is not a reason to lose the rest */ }
    }
    setTidy(out)
    setWorking(false)
  }

  const Card = ({ title, count, children }: { title: string; count?: number; children: any }) => (
    <section className="rounded-2xl border border-line bg-white overflow-hidden shadow-[0_1px_2px_rgba(16,17,20,0.04)]">
      <div className="flex items-baseline gap-2 px-3 py-2.5 border-b border-line">
        <h2 className="text-[12px] font-bold text-ink">{title}</h2>
        {count != null && <span className="text-[11px] text-muted tabular-nums">{count}</span>}
      </div>
      {children}
    </section>
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
      <p className="text-[11.5px] text-muted inline-flex items-center gap-1.5">
        <Lock size={11} /> {T('teamOnly')}
      </p>

      {/* FINISHED WORK → the owner's completed list */}
      <Card title={T('finished')} count={done.length}>
        {!done.length && <p className="px-3 py-3 text-[13px] text-muted">{T('nothingDone')}</p>}
        {!!done.length && (
          <>
            <div className="px-3 py-2 border-b border-line">
              <button
                onClick={() => post({ action: 'releaseDone', taskIds: done.filter(x => !x.doneShared).map(x => x.id), on: true }, 'relall')}
                disabled={busy === 'relall' || done.every(x => x.doneShared)}
                className="text-[12px] font-semibold rounded-lg border border-line px-2.5 py-1 text-ink disabled:opacity-40 hover:bg-app">
                {busy === 'relall' ? <Loader2 size={12} className="animate-spin inline" /> : T('releaseAll')}
              </button>
            </div>
            <div className="divide-y divide-line/70">
              {done.map(x => (
                <div key={x.id} className="px-3 py-2.5">
                  <p className="text-[13.5px] text-ink">{x.title}</p>
                  <p className="text-[11px] text-muted mt-0.5">
                    {[x.section, x.done_by, x.done_at ? day(String(x.done_at).slice(0, 10), lang) : null].filter(Boolean).join(' · ')}
                  </p>
                  <label className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-muted cursor-pointer select-none">
                    <input type="checkbox" checked={!!x.doneShared} disabled={busy === 'rel' + x.id} className="w-3.5 h-3.5"
                      onChange={e => post({ action: 'releaseDone', taskId: x.id, on: e.target.checked }, 'rel' + x.id)} />
                    <span>{x.doneShared ? T('releasedDone') : T('releaseDone')}</span>
                  </label>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* INSPECTIONS → the owner's link */}
      <Card title={T('inspections')} count={staff.inspections.length}>
        {!staff.inspections.length && <p className="px-3 py-3 text-[13px] text-muted">{T('noneYet')}</p>}
        <div className="divide-y divide-line/70">
          {staff.inspections.slice(0, 40).map(i => (
            <div key={i.id} className="px-3 py-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] text-ink font-medium truncate">{i.unit}</p>
                  <p className="text-[11.5px] text-muted truncate">{[i.name, i.inspector].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="shrink-0 text-right">
                  {i.date && <p className="text-[11px] text-muted tabular-nums">{day(i.date, lang)}</p>}
                  {i.reportUrl && <a href={i.reportUrl} target="_blank" rel="noreferrer" className="text-[11.5px] font-semibold text-brand-700 hover:underline">{T('report')} ↗</a>}
                </div>
              </div>
              <label className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-muted cursor-pointer select-none">
                <input type="checkbox" checked={i.shared} disabled={busy === 'ins' + i.id} className="w-3.5 h-3.5"
                  onChange={e => post({ action: 'releaseInspection', bzTaskId: i.id, on: e.target.checked }, 'ins' + i.id)} />
                <span>{i.shared ? T('releasedIns') : T('releaseIns')}</span>
              </label>
            </div>
          ))}
        </div>
      </Card>

      {/* THE COVER (Jon: "I should be able to select the photo") */}
      {!!staff.heroChoices?.length && (
        <Card title={T('coverPhoto')}>
          <div className="p-3">
            <p className="text-[12px] text-muted mb-2">{T('coverHint')}</p>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
              {staff.heroChoices.map(u => (
                <button key={u} onClick={() => post({ action: 'setHero', url: p.hero === u ? '' : u }, 'hero')}
                  disabled={busy === 'hero'}
                  className={'relative block rounded-lg overflow-hidden border-2 transition ' + (p.hero === u ? 'border-ink' : 'border-transparent hover:border-line')}>
                  <img src={u} alt="" className="w-full h-14 object-cover" />
                  {p.hero === u && <span className="absolute inset-0 bg-ink/25 grid place-items-center text-white"><Check size={16} strokeWidth={3} /></span>}
                </button>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* THE NAMES */}
      <Card title={T('tidy')}>
        <div className="p-3 space-y-2">
          <button onClick={runTidy} disabled={working || !open.length}
            className="text-[13px] font-semibold rounded-xl border border-line px-3 py-2 text-ink disabled:opacity-40 hover:bg-app inline-flex items-center gap-2">
            {working ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={14} />}
            {working ? T('tidying') : T('tidy')}
          </button>
          {tidy && !tidy.length && <p className="text-[12.5px] text-muted">{T('tidyNone')}</p>}
          {!!tidy?.length && (
            <div className="space-y-2">
              {tidy.map(row => (
                <div key={row.id} className="rounded-xl border border-line p-2.5">
                  <p className="text-[12px] text-muted line-through">{row.was}</p>
                  <p className="text-[13.5px] text-ink mt-0.5">{row.now}</p>
                  <div className="flex gap-2 mt-2">
                    <button onClick={async () => { await post({ action: 'applyTitle', taskId: row.id, title: row.now }, 'ttl' + row.id); setTidy(v => (v || []).filter(x => x.id !== row.id)) }}
                      disabled={busy === 'ttl' + row.id}
                      className="text-[12px] font-semibold rounded-lg bg-ink text-white px-2.5 py-1 disabled:opacity-40">{T('use')}</button>
                    <button onClick={() => setTidy(v => (v || []).filter(x => x.id !== row.id))}
                      className="text-[12px] text-muted hover:text-ink px-1">{T('keep')}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

/** ONE JOB, as a row inside its unit's block. */
function JobRow({ s, p, busy, T, TX, lang, post, onOpen, open, onToggleSubs, showUnit }: {
  s: Step; p: V; busy: string | null
  T: (k: string) => string
  TX: (v: string | null | undefined) => string
  lang: Lang
  post: (body: any, key: string) => Promise<any>
  onOpen: (id: string) => void
  open: boolean
  onToggleSubs: () => void
  /** The unit as a chip on the row — needed whenever the list is not grouped by unit. */
  showUnit?: boolean
}) {
  const prio = prioOf(s)
  const d = dueChip(s.due_on, lang, T)
  const subs = s.subtasks || []
  return (
    <div>
      <div className={'flex items-start gap-2.5 px-3 py-2.5 text-[13.5px] ' + (s.done ? 'bg-emerald-50/40' : 'hover:bg-app/60')}>
        <span title={T(PRIO_KEY[prio])} className={'shrink-0 mt-2 w-1.5 h-1.5 rounded-full ' + PRIO_DOT[prio]} />
        <button onClick={() => post({ action: 'stepDone', stepId: s.id, done: !s.done }, 'step' + s.id)} disabled={busy === 'step' + s.id}
          aria-label={(s.done ? T('isDone') : T('markDone')) + ': ' + s.title}
          className={'shrink-0 mt-0.5 w-5 h-5 rounded-full border-2 grid place-items-center transition disabled:opacity-50 ' +
            (s.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-line text-transparent hover:border-ink')}>
          {busy === 'step' + s.id ? <Loader2 size={11} className="animate-spin text-muted" /> : <Check size={12} strokeWidth={3} />}
        </button>
        <button onClick={() => onOpen(s.id)} className="min-w-0 flex-1 text-left group">
          {showUnit && s.section && <span className="inline-block text-[10.5px] font-bold uppercase tracking-wide text-muted mr-1.5 align-middle">{unitKey(s.section)}</span>}
          <span className={'leading-snug font-medium ' + (s.done ? 'line-through text-muted font-normal' : 'text-ink group-hover:underline')}>{TX(s.title)}</span>
          {s.note && <span className="block text-[12px] text-muted/80 mt-1 line-clamp-2 leading-relaxed">{TX(s.note)}</span>}
          <span className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {d && <span className={'rounded-full border px-1.5 py-px text-[10.5px] font-semibold ' + d.tone}>{d.label}</span>}
            {prio !== 'normal' && <span className={'rounded-full border px-1.5 py-px text-[10.5px] font-semibold ' + PRIO_CLS[prio]}>{T(PRIO_KEY[prio])}</span>}
            {s.requested && <span className="inline-flex items-center gap-0.5 rounded-full border border-brand-200 bg-brand-50 text-brand-700 px-1.5 py-px text-[10.5px] font-semibold"><Wrench size={9} />{T('pushSentShort')}</span>}
            {s.breezeway && <span className={'inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[10.5px] font-semibold ' + (s.breezeway.tone === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-brand-200 bg-brand-50 text-brand-700')}><Wrench size={9} />{s.breezeway.status}</span>}
            {!!s.photos?.length && <span className="inline-flex items-center gap-0.5 text-[10.5px] text-muted"><Camera size={9} />{s.photos.length}</span>}
            {!!s.comments?.length && <span className="inline-flex items-center gap-0.5 text-[10.5px] text-muted"><MessageSquare size={9} />{s.comments.length}</span>}
            {s.addedByShare && <span className="text-[10px] uppercase tracking-wide text-muted/70">{T('yours')}</span>}
          </span>
        </button>
        <span className="shrink-0 flex items-center gap-1.5 pt-0.5">
          {!!subs.length && (
            <button onClick={onToggleSubs} title={T('stepsLabel')}
              className="inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-[10.5px] font-semibold text-muted hover:text-ink hover:bg-app tabular-nums">
              {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}{subs.filter(x => x.done).length}/{subs.length}
            </button>
          )}
          {(s.assignees || []).length ? (
            <span className="flex -space-x-1.5">
              {(s.assignees || []).slice(0, 2).map(n => (
                <span key={n} title={n} className="w-5 h-5 rounded-full grid place-items-center text-[8.5px] font-bold bg-ink text-white ring-2 ring-white">{initials(n)}</span>
              ))}
              {(s.assignees || []).length > 2 && <span className="w-5 h-5 rounded-full grid place-items-center text-[8.5px] font-bold bg-app text-muted ring-2 ring-white">+{(s.assignees || []).length - 2}</span>}
            </span>
          ) : null}
        </span>
      </div>
      {!!subs.length && open && (
        <div className="pl-9 pr-3 pb-2 space-y-1">
          {subs.map(x => {
            const sd = dueChip(x.due_on, lang, T)
            return (
              <div key={x.id} className="flex items-center gap-2 text-[12.5px]">
                <button onClick={() => post({ action: 'subDone', stepId: x.id, done: !x.done }, 'sub' + x.id)} disabled={busy === 'sub' + x.id}
                  aria-label={x.title}
                  className={'shrink-0 w-4 h-4 rounded-full border-2 grid place-items-center transition ' +
                    (x.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-line text-transparent hover:border-ink')}>
                  <Check size={9} strokeWidth={3} />
                </button>
                <span className={'min-w-0 flex-1 truncate ' + (x.done ? 'line-through text-muted' : 'text-ink/85')}>{TX(x.title)}</span>
                {sd && <span className={'shrink-0 rounded-full border px-1.5 text-[10px] font-semibold ' + sd.tone}>{sd.label}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * CLEAN UP THE WORDING, WHERE THE WORDING IS (Jon: "I don't see the AI ability to enhance or
 * clean up descriptions and titles").
 *
 * A sparkle beside the field, not a feature on another tab. It rewrites what is in the box
 * through the house rules (/api/ai/polish — which may never add a fact or drop one), puts the
 * result straight in, and keeps the original one click away. Nothing is saved by this: the field
 * saves the way it always did, so a rewrite you do not like costs you an Undo, not a correction.
 */
function Polish({ value, kind, context, onText, label }: {
  value: string
  kind: 'title' | 'task' | 'note'
  context?: string
  onText: (v: string) => void
  label: string
}) {
  const [busy, setBusy] = useState(false)
  const [was, setWas] = useState<string | null>(null)
  const run = async () => {
    const text = value.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/ai/polish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, kind, context: context || '' }),
      })
      const j = await r.json()
      if (j?.ok && j.changed && j.polished) { setWas(text); onText(String(j.polished)) }
    } catch { /* leave the words alone */ }
    setBusy(false)
  }
  if (was !== null) {
    return (
      <button type="button" onClick={() => { onText(was); setWas(null) }}
        className="shrink-0 text-[11px] font-semibold text-muted hover:text-ink">{label}</button>
    )
  }
  return (
    <button type="button" onClick={run} disabled={busy || !value.trim()} title={label}
      className="shrink-0 text-muted/60 hover:text-brand-700 disabled:opacity-30 p-0.5">
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
    </button>
  )
}

function AddSheet({ p, busy, T, post, upload, onClose }: {
  p: V; busy: string | null; T: (k: string) => string
  post: (body: any, key: string) => Promise<any>
  upload: (f: File, taskId?: string) => Promise<void>
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [unit, setUnit] = useState('')
  const [desc, setDesc] = useState('')
  const [steps, setSteps] = useState('')
  const [due, setDue] = useState('')
  const [who, setWho] = useState<string[]>([])
  const [photo, setPhoto] = useState<File | null>(null)
  const [prio, setPrio] = useState<Prio>('normal')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev }
  }, [onClose])

  const save = async () => {
    const t = title.trim()
    if (!t || saving) return
    setSaving(true)
    const lines = steps.split('\n').map(x => x.trim()).filter(Boolean)
    const j = await post({ action: 'addTask', title: t, section: unit || null, description: desc, due_on: due || null, assign: who, steps: lines, priority: prio }, 'addTask')
    // The photo needs the job's id, so it goes up after — the one thing that cannot ride along
    // with the write. If it fails the job is still there, which is the right way round.
    if (j?.taskId && photo) await upload(photo, j.taskId)
    setSaving(false)
    if (j) onClose()
  }

  const L = ({ label, hint, children }: { label: string; hint?: string; children: any }) => (
    <label className="block">
      <span className="flex items-baseline gap-2 mb-1">
        <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted">{label}</span>
        {hint && <span className="text-[10.5px] text-muted/70">{hint}</span>}
      </span>
      {children}
    </label>
  )
  const box = 'w-full text-[14px] rounded-xl border border-line px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-ink/40" onClick={() => !saving && onClose()} />
      <div className="relative w-full sm:max-w-md max-h-[92vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl border border-line shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-line px-4 py-3 flex items-center gap-2">
          <Plus size={15} className="text-muted" />
          <span className="text-[14px] font-bold text-ink flex-1">{T('addTask')}</span>
          <button onClick={onClose} disabled={saving} className="text-muted hover:text-ink p-1" aria-label="Close"><X size={17} /></button>
        </div>

        <div className="p-4 space-y-3.5">
          <div className="flex items-start gap-1.5">
            <input ref={ref} value={title} onChange={e => setTitle(e.target.value)} placeholder={T('whatNeedsDoing')}
              className="flex-1 min-w-0 text-[16px] font-semibold text-ink bg-transparent rounded-lg px-1 -mx-1 py-1 focus:outline-none focus:bg-app placeholder:text-muted/60" />
            <span className="pt-1.5"><Polish value={title} kind="title" context={[p.title, unit].filter(Boolean).join(' · ')} onText={setTitle} label={T('undo')} /></span>
          </div>

          <L label={T('unitLabel')}>
            <select value={unit} onChange={e => setUnit(e.target.value)} className={box}>
              <option value="">{T('noUnit')}</option>
              {unitNames(p).map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </L>

          <L label={T('detailsLabel')} hint={undefined}>
            <div className="relative">
              <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder={T('details')}
                className={box + ' text-[13.5px] pr-8'} />
              <span className="absolute top-2 right-2"><Polish value={desc} kind="task" context={[p.title, unit, title].filter(Boolean).join(' · ')} onText={setDesc} label={T('undo')} /></span>
            </div>
          </L>

          {/* THE STEPS, typed as lines (Jon: "add descriptions and tasks to it"). Five steps are
              five lines and four Returns — not five rounds of click, type, click Add. */}
          <L label={T('stepsLabel')} hint={T('stepsHint')}>
            <textarea value={steps} onChange={e => setSteps(e.target.value)} rows={3}
              placeholder={'Buy the glass\nFit the door\nTouch up the paint'}
              className={box + ' text-[13.5px]'} />
          </L>

          <div className="flex flex-wrap gap-3">
            <L label={T('due')}>
              <input type="date" value={due} onChange={e => setDue(e.target.value)} className={box + ' min-w-[150px]'} />
            </L>
            <div className="flex-1 min-w-[150px]">
              <L label={T('photoLabel')}>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
                  onChange={e => setPhoto(e.target.files?.[0] || null)} />
                <button type="button" onClick={() => fileRef.current?.click()}
                  className={box + ' text-left text-[13px] inline-flex items-center gap-2 ' + (photo ? 'text-ink' : 'text-muted')}>
                  <Camera size={15} className="shrink-0" />
                  <span className="truncate">{photo ? photo.name : T('choosePhoto')}</span>
                </button>
              </L>
            </div>
          </div>

          <L label={T('importance')}>
            <div className="flex flex-wrap gap-1.5">
              {PRIOS.map(k => (
                <button key={k} type="button" onClick={() => setPrio(k)}
                  className={'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-semibold ' +
                    (prio === k ? 'border-ink bg-ink text-white' : PRIO_CLS[k] + ' hover:border-ink/40')}>
                  <span className={'w-1.5 h-1.5 rounded-full ' + (prio === k ? 'bg-white' : PRIO_DOT[k])} />
                  {T(PRIO_KEY[k])}
                </button>
              ))}
            </div>
          </L>

          {!!(p.team || []).length && (
            <L label={T('assignedTo')}>
              <div className="flex flex-wrap gap-1.5">
                {(p.team || []).map(n => {
                  const on = who.includes(n)
                  return (
                    <button key={n} type="button" onClick={() => setWho(v => on ? v.filter(x => x !== n) : [...v, n])}
                      className={'inline-flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 py-0.5 text-[12.5px] ' +
                        (on ? 'border-ink bg-ink text-white font-semibold' : 'border-line text-muted hover:text-ink')}>
                      <span className={'w-5 h-5 rounded-full grid place-items-center text-[9px] font-bold ' + (on ? 'bg-white/20' : 'bg-app text-muted')}>{initials(n)}</span>
                      {n}
                    </button>
                  )
                })}
              </div>
            </L>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <button onClick={onClose} disabled={saving} className="text-[13.5px] text-muted hover:text-ink px-2">{T('cancel')}</button>
            <button onClick={save} disabled={!title.trim() || saving}
              className="text-[14px] font-semibold px-4 py-2.5 rounded-xl bg-ink text-white disabled:opacity-40 inline-flex items-center gap-1.5">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} />} {saving ? T('saving') : T('add')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * ONE ITEM, OPENED (Jon, 2026-10-09). Everything about one job on one screen: what it is, the
 * action steps under it, what the field says through Breezeway — its status and the report with
 * the technician's own photos — the paperwork, the photos, and a conversation with the team that
 * both sides can see. Nothing here is a second copy of the data: it is the same task row the
 * board runs on, read through the share's whitelist.
 */
function ItemSheet({ t, p, who, busy, post, upload, T, TX, lang, reload, onClose }: {
  t: Step; p: V; who: string; busy: string | null
  post: (body: any, key: string) => Promise<any>
  upload: (f: File, taskId?: string) => Promise<void>
  T: (k: string) => string
  TX: (v: string | null | undefined) => string
  lang: Lang
  reload: () => Promise<void>
  onClose: () => void
}) {
  const [body, setBody] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [sub, setSub] = useState('')
  const [ask, setAsk] = useState('')
  const [subDue, setSubDue] = useState('')
  const [busyBz, setBusyBz] = useState(false)
  const [bzErr, setBzErr] = useState<string | null>(null)

  /** The unit this job belongs to, as Guesty knows it — matched from the job's own section. */
  const listingFor = (x: Step) => {
    const k = unitKey(x.section)
    if (!k) return ''
    const hit = p.units.find(u => unitKey(u.label) === k)
    return hit ? hit.ref_id : ''
  }
  const pushBz = async (x: Step) => {
    const listingId = listingFor(x)
    if (!listingId) { setBzErr(T('needUnit')); return }
    setBusyBz(true); setBzErr(null)
    try {
      const r = await fetch('/api/projects/' + p.id, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'taskToBreezeway', taskId: x.id, listingId, department: 'maintenance', date: x.due_on || undefined }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Breezeway said no.')
      // Re-read through the share so the sheet shows the field task, its status and its report.
      await reload()
    } catch (e: any) { setBzErr(String(e.message || e)) } finally { setBusyBz(false) }
  }
  const [report, setReport] = useState(false)
  // EVERYTHING EDITABLE (Jon, 2026-10-09). The title, the detail, the date and the unit are typed
  // straight into the sheet and saved on blur — no edit mode, no pencil to find. Edits always act
  // on the ORIGINAL text, never on a translation being displayed, so switching language and
  // fixing a typo cannot quietly overwrite the job with its own Spanish.
  const [edit, setEdit] = useState<{ title: string; note: string; due: string; section: string } | null>(null)
  const draft = edit || { title: t.title, note: t.note || '', due: t.due_on || '', section: t.section || '' }
  const setDraft = (patch: Partial<typeof draft>) => setEdit({ ...draft, ...patch })
  const saveEdit = () => {
    if (!edit) return
    const changed = edit.title.trim() !== t.title || edit.note !== (t.note || '') || edit.due !== (t.due_on || '') || edit.section !== (t.section || '')
    setEdit(null)
    if (!changed || !edit.title.trim()) return
    post({ action: 'taskEdit', taskId: t.id, title: edit.title, description: edit.note, due_on: edit.due, section: edit.section }, 'edit' + t.id)
  }
  const fileRef = useRef<HTMLInputElement>(null)
  const team = p.team || []
  const subs = t.subtasks || []

  // Esc closes, and the body does not scroll behind the sheet — on a phone that is the difference
  // between a panel and a trapdoor.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev }
  }, [onClose])

  const send = () => {
    const text = body.trim()
    if (!text) return
    // The tags ride in the text as well as in the field: that is what the notifier reads, and it
    // is what the comment should say when somebody reads it back a month from now.
    const prefix = tags.map(x => '@' + x).join(' ')
    post({ action: 'taskNote', taskId: t.id, body: prefix ? prefix + ' ' + text : text, mentions: tags }, 'note' + t.id)
    setBody(''); setTags([])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl border border-line">
        <div className="sticky top-0 bg-white border-b border-line px-4 py-3 flex items-start gap-3">
          {/* DONE, WHERE THE EYE ALREADY IS (Jon, 2026-10-09: "mark done should be in a better
              spot"). It was a full-width box three sections down, below the detail — which put
              the commonest action on the sheet behind a scroll. It belongs beside the title, the
              way it sits beside the title in the list. */}
          <button onClick={() => post({ action: 'stepDone', stepId: t.id, done: !t.done }, 'step' + t.id)} disabled={busy === 'step' + t.id}
            title={t.done ? T('isDone') : T('markDone')} aria-label={t.done ? T('isDone') : T('markDone')}
            className={'shrink-0 mt-0.5 w-6 h-6 rounded-full border-2 grid place-items-center transition disabled:opacity-50 ' +
              (t.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-line text-transparent hover:border-ink')}>
            {busy === 'step' + t.id ? <Loader2 size={12} className="animate-spin text-muted" /> : <Check size={14} strokeWidth={3} />}
          </button>
          <div className="min-w-0 flex-1">
            {t.section && <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{TX(t.section)}</p>}
            {p.canEdit ? (
              <span className="flex items-start gap-1">
                <input value={draft.title} onChange={e => setDraft({ title: e.target.value })} onBlur={saveEdit}
                  className="flex-1 min-w-0 text-[15px] font-bold text-ink leading-snug bg-transparent rounded-md -ml-1 px-1 py-0.5 hover:bg-app focus:bg-app focus:outline-none focus:ring-2 focus:ring-brand-200" />
                <Polish value={draft.title} kind="title" context={[p.title, t.section].filter(Boolean).join(' · ')}
                  onText={v => { setDraft({ title: v }); post({ action: 'taskEdit', taskId: t.id, title: v }, 'edit' + t.id) }} label={T('undo')} />
              </span>
            ) : (
              <h2 className="text-[15px] font-bold text-ink leading-snug">{TX(t.title)}</h2>
            )}
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              {(() => { const d = dueChip(t.due_on, lang, T); return d
                ? <span className={'rounded-full border px-2 py-0.5 text-[11px] font-semibold ' + d.tone}>{d.label}</span>
                : <span className="text-[11px] text-muted">{T('noDate')}</span> })()}
              {(t.assignees || []).map(n => (
                <span key={n} className="inline-flex items-center gap-1 rounded-full bg-app px-2 py-0.5 text-[11px] text-ink">{n}</span>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 text-muted hover:text-ink p-1" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-5">
          {p.canEdit ? (
            <div className="relative">
              <textarea value={draft.note} onChange={e => setDraft({ note: e.target.value })} onBlur={saveEdit} rows={draft.note ? 3 : 2}
                placeholder={T('details')}
                className="w-full text-[13.5px] text-ink/90 leading-relaxed rounded-xl border border-line px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              <span className="absolute top-2 right-2">
                <Polish value={draft.note} kind="task" context={[p.title, t.section, t.title].filter(Boolean).join(' · ')}
                  onText={v => { setDraft({ note: v }); post({ action: 'taskEdit', taskId: t.id, description: v }, 'edit' + t.id) }} label={T('undo')} />
              </span>
            </div>
          ) : (
            t.note ? <p className="text-[13.5px] text-ink/90 whitespace-pre-wrap leading-relaxed">{TX(t.note)}</p> : null
          )}

          {p.canEdit && (
            <div className="rounded-xl border border-line divide-y divide-line">
              {/* WHO HAS IT (Jon: "easier to assign"). Names from this project's own people —
                  tapping one puts the job on the real person, who gets told the same way they
                  would from inside the app. Tap again to take it off. */}
              <div className="px-3 py-2.5">
                <span className="block text-[10.5px] font-bold uppercase tracking-wide text-muted mb-1.5">{T('assignedTo')}</span>
                {team.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {team.map(n => {
                      const on = (t.assignees || []).includes(n)
                      return (
                        <button key={n} disabled={busy === 'assign' + t.id}
                          onClick={() => {
                            const next = on ? (t.assignees || []).filter(x => x !== n) : [...(t.assignees || []), n]
                            post({ action: 'taskAssign', taskId: t.id, names: next }, 'assign' + t.id)
                          }}
                          className={'inline-flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 py-0.5 text-[12.5px] transition disabled:opacity-50 ' +
                            (on ? 'border-ink bg-ink text-white font-semibold' : 'border-line text-muted hover:text-ink')}>
                          <span className={'w-5 h-5 rounded-full grid place-items-center text-[9px] font-bold ' + (on ? 'bg-white/20' : 'bg-app text-muted')}>{initials(n)}</span>
                          {n}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-[12.5px] text-muted">{T('nobody')}</p>
                )}
              </div>
              <div className="flex flex-wrap">
                <label className="flex-1 min-w-[150px] px-3 py-2.5">
                  <span className="block text-[10.5px] font-bold uppercase tracking-wide text-muted mb-1">{T('due')}</span>
                  <input type="date" value={draft.due} onChange={e => setDraft({ due: e.target.value })} onBlur={saveEdit}
                    className="w-full text-[13.5px] rounded-lg border border-line px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                </label>
                <div className="w-full px-3 py-2.5 border-t border-line">
                  <span className="block text-[10.5px] font-bold uppercase tracking-wide text-muted mb-1.5">{T('importance')}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {PRIOS.map(k => (
                      <button key={k} onClick={() => post({ action: 'taskEdit', taskId: t.id, priority: k }, 'prio' + t.id)}
                        disabled={busy === 'prio' + t.id}
                        className={'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-semibold disabled:opacity-50 ' +
                          (prioOf(t) === k ? 'border-ink bg-ink text-white' : PRIO_CLS[k] + ' hover:border-ink/40')}>
                        <span className={'w-1.5 h-1.5 rounded-full ' + (prioOf(t) === k ? 'bg-white' : PRIO_DOT[k])} />
                        {T(PRIO_KEY[k])}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex-1 min-w-[150px] px-3 py-2.5">
                  <span className="block text-[10.5px] font-bold uppercase tracking-wide text-muted mb-1">{T('unitLabel')}</span>
                  <select value={draft.section} onChange={e => { setDraft({ section: e.target.value }); setTimeout(saveEdit, 0) }}
                    className="w-full text-[13.5px] rounded-lg border border-line px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200">
                    <option value="">{T('noUnit')}</option>
                    {unitNames(p).map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </label>
              </div>
            </div>
          )}

          {/* ACTION STEPS */}
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5">{T('actionSteps')}</h3>
            {!subs.length && <p className="text-[12.5px] text-muted">{T('noneYet')}</p>}
            <div className="space-y-1">
              {subs.map(x => (
                <div key={x.id} className="flex items-start gap-2 text-[13.5px] group/sub">
                  <input type="checkbox" checked={x.done} disabled={busy === 'sub' + x.id} className="w-3.5 h-3.5 mt-1.5 cursor-pointer"
                    onChange={e => post({ action: 'subDone', stepId: x.id, done: e.target.checked }, 'sub' + x.id)} />
                  {p.canEdit ? (
                    <input defaultValue={x.title} key={x.id + x.title}
                      onBlur={e => { const v = e.target.value.trim(); if (v && v !== x.title) post({ action: 'subEdit', stepId: x.id, title: v }, 'sub' + x.id) }}
                      className={'flex-1 min-w-0 bg-transparent rounded-md px-1 py-0.5 hover:bg-app focus:bg-app focus:outline-none focus:ring-2 focus:ring-brand-200 ' + (x.done ? 'line-through text-muted' : 'text-ink')} />
                  ) : (
                    <span className={'py-0.5 ' + (x.done ? 'line-through text-muted' : 'text-ink')}>{TX(x.title)}</span>
                  )}
                  {x.due_on && (() => { const d = dueChip(x.due_on, lang, T); return d
                    ? <span className={'shrink-0 mt-1 rounded-full border px-1.5 text-[10.5px] font-semibold ' + d.tone}>{d.label}</span> : null })()}
                  {p.canEdit && (
                    <button onClick={() => post({ action: 'subDelete', stepId: x.id }, 'sub' + x.id)} disabled={busy === 'sub' + x.id}
                      className="shrink-0 mt-1 text-muted/40 hover:text-rose-600 opacity-0 group-hover/sub:opacity-100 focus:opacity-100" aria-label="Remove">
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {p.canEdit && (
              <form className="flex gap-2 mt-2" onSubmit={e => { e.preventDefault(); if (sub.trim()) { post({ action: 'subAdd', parentId: t.id, title: sub, due_on: subDue || null }, 'sub' + t.id); setSub(''); setSubDue('') } }}>
                <input value={sub} onChange={e => setSub(e.target.value)} placeholder={T('addStep')}
                  className="flex-1 min-w-0 text-[13.5px] rounded-lg border border-line px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                <input type="date" value={subDue} onChange={e => setSubDue(e.target.value)} title={T('due')}
                  className="shrink-0 w-[130px] text-[12.5px] rounded-lg border border-line px-2 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                <button disabled={!sub.trim() || busy === 'sub' + t.id} className="text-[13px] font-semibold px-2.5 rounded-lg border border-line text-ink disabled:opacity-40">{T('add')}</button>
              </form>
            )}
          </div>

          {/* BREEZEWAY — the field's own word on the work. */}
          {t.breezeway && (
            <div className="rounded-xl border border-line overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-app">
                <Wrench size={13} className="text-muted shrink-0" />
                <span className="text-[12px] font-bold text-ink">{T('inTheField')}</span>
                <span className={'ml-auto text-[10.5px] font-bold uppercase px-1.5 py-0.5 rounded border ' + (t.breezeway.tone === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : t.breezeway.tone === 'bad' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-brand-200 bg-brand-50 text-brand-700')}>
                  {t.breezeway.status || 'open'}
                </span>
              </div>
              <div className="px-3 py-2 text-[12.5px] text-muted">
                {[t.breezeway.assignee, t.breezeway.date ? day(t.breezeway.date, lang) : null].filter(Boolean).join(' · ') || T('scheduled')}
              </div>
              {t.breezeway.reportUrl && (
                <div className="border-t border-line">
                  <button onClick={() => setReport(v => !v)} className="w-full text-left px-3 py-2 text-[12.5px] font-semibold text-brand-700 hover:bg-app">
                    {report ? T('hideReport') : T('showReport')}
                  </button>
                  {report && (
                    <div className="px-3 pb-3">
                      <iframe src={t.breezeway.reportUrl} title="Breezeway report" className="w-full h-[55vh] rounded-lg border border-line bg-white" />
                      <a href={t.breezeway.reportUrl} target="_blank" rel="noreferrer" className="inline-block mt-2 text-[12px] font-semibold text-brand-700 hover:underline">{T('openReport')}</a>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ASKING FOR A TECHNICIAN. Only offered when no field task exists yet — once one does,
              the block above is the answer and a second request would be noise. What comes back
              says "asked for", full stop: whether it is approved, by whom, or declined is ours. */}
          {/* A SIGNED-IN USER PUSHES, RIGHT HERE (Jon: "if you are a signed-in user using the
              shareable link, you can just assign and push the Breezeway task automatically").
              There is no one to ask — they ARE the approval. It goes through the same endpoint
              the board uses, so the never-assign guard, the template and the assignee matching
              all behave identically; the unit comes from the job's own unit, and whoever is on
              the task is matched into Breezeway by name. An owner still only gets to ask. */}
          {!t.breezeway && p.staff ? (
            <div>
              <button onClick={() => pushBz(t)} disabled={busyBz}
                className="w-full rounded-xl bg-ink text-white text-[13.5px] font-semibold py-2.5 inline-flex items-center justify-center gap-2 disabled:opacity-50">
                {busyBz ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={15} />}
                {busyBz ? T('pushing') : T('pushNow')}
              </button>
              {bzErr && <p className="text-[12px] text-rose-700 mt-1.5">{bzErr}</p>}
            </div>
          ) : !t.breezeway && (
            t.requested ? (
              <p className="rounded-xl border border-line bg-app px-3 py-2.5 text-[12.5px] text-muted">
                <Wrench size={12} className="inline mr-1.5 -mt-0.5" />{T('pushSent')}
              </p>
            ) : (
              <div>
                <input value={ask} onChange={e => setAsk(e.target.value)} placeholder={T('techNote')}
                  className="w-full text-[13px] rounded-xl border border-line px-3 py-2.5 mb-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                <button onClick={() => { post({ action: 'requestBreezeway', taskId: t.id, note: ask }, 'ask' + t.id); setAsk('') }}
                  disabled={busy === 'ask' + t.id}
                  className="w-full rounded-xl border border-line text-[13.5px] font-semibold py-2.5 inline-flex items-center justify-center gap-2 text-ink disabled:opacity-50">
                  {busy === 'ask' + t.id ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={15} />} {T('pushBz')}
                </button>
              </div>
            )
          )}

          {/* PAPERWORK */}
          {!!t.invoices?.length && (
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5">{T('paperwork')}</h3>
              <div className="space-y-1.5">
                {t.invoices.map(inv => (
                  <a key={inv.id} href={inv.file?.url || '#'} target="_blank" rel="noreferrer"
                    className={'flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[13px] ' + (inv.file ? 'hover:bg-app' : 'opacity-60 pointer-events-none')}>
                    <Paperclip size={13} className="text-muted shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-ink">{[inv.vendor, inv.number ? '#' + inv.number : null].filter(Boolean).join(' · ') || inv.file?.name || 'Invoice'}</span>
                    {inv.issued_on && <span className="text-[11px] text-muted shrink-0">{day(inv.issued_on, lang)}</span>}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* PHOTOS ON THIS JOB */}
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5">{T('photos')}</h3>
            {!!t.photos?.length && (
              <div className="grid grid-cols-3 gap-2 mb-2">
                {t.photos.map(ph => (
                  <a key={ph.id} href={ph.url} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden border border-line">
                    <img src={ph.url} alt={ph.caption || ''} className="w-full h-20 object-cover" />
                  </a>
                ))}
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) upload(f, t.id); e.target.value = '' }} />
            <button onClick={() => fileRef.current?.click()} disabled={busy === 'photo' + t.id}
              className="w-full rounded-xl border border-line text-[13.5px] font-semibold py-2.5 inline-flex items-center justify-center gap-2 text-ink disabled:opacity-50">
              {busy === 'photo' + t.id ? <Loader2 size={14} className="animate-spin" /> : <Camera size={15} />} {T('addPhotoJob')}
            </button>
          </div>

          {/* THE CONVERSATION */}
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5">{T('comments')}</h3>
            <div className="space-y-1.5 mb-2">
              {(t.comments || []).map((c, i) => (
                <div key={i} className={'rounded-lg px-2.5 py-1.5 text-[13px] ' + (c.mine ? 'bg-brand-50' : 'bg-app')}>
                  <p className="text-ink whitespace-pre-wrap">{TX(c.body)}</p>
                  <p className="text-[10px] text-muted mt-0.5">{c.author || 'someone'} · {new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                </div>
              ))}
              {!(t.comments || []).length && <p className="text-[12.5px] text-muted">{T('nothingSaid')}</p>}
            </div>
            {/* Tagging by name: the people actually on this project, nobody else. */}
            {!!team.length && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {team.map(n => (
                  <button key={n} onClick={() => setTags(v => v.includes(n) ? v.filter(x => x !== n) : [...v, n])}
                    className={'text-[11.5px] px-2 py-1 rounded-full border ' + (tags.includes(n) ? 'border-brand-300 bg-brand-50 text-brand-700 font-semibold' : 'border-line text-muted hover:text-ink')}>
                    @{n}
                  </button>
                ))}
              </div>
            )}
            <form className="flex gap-2" onSubmit={e => { e.preventDefault(); send() }}>
              <input value={body} onChange={e => setBody(e.target.value)} placeholder={who ? T('addComment') : T('nameFirst')}
                className="flex-1 text-[13.5px] rounded-xl border border-line px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              <button disabled={!body.trim() || busy === 'note' + t.id} className="text-[13.5px] font-semibold px-3.5 rounded-xl bg-brand-600 text-white disabled:opacity-50">
                {busy === 'note' + t.id ? <Loader2 size={14} className="animate-spin" /> : T('send')}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
