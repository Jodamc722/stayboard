'use client'
// ONE PERSON'S PAGE (Jon, 2026-11-25): "where they can see their stats, hours worked, tasks assigned,
// training and profile. And schedule when pushed." · "once approved they can also see their
// inspections."
//
// The SAME view in two places: /learn/<code> on the person's phone (mode 'self' — they tick their
// apps, watch, take quizzes, sign the handbook) and the manager's sheet on Training → People (mode
// 'manager' — read the same page, plus the issues and the activity log). Tabs are buttons, never
// a drop-down. English / Spanish throughout.
import { useState, type ReactNode } from 'react'
import { Check, Play, BookOpen, FileText, ChevronDown, Loader2, Circle, CalendarDays, ClipboardCheck, GraduationCap, ExternalLink, AlertTriangle, RotateCcw } from 'lucide-react'

export type Lang = 'en' | 'es'
type Q = { q: { en: string; es: string | null }; options: { en: string[]; es: string[] | null } }
export type TrainingRow = {
  id: string; kind: 'video' | 'faq' | 'doc'; title: { en: string; es: string | null }; summary: { en: string | null; es: string | null }; body: { en: string | null; es: string | null }
  durationSec: number | null; url: { en: string | null; es: string | null }; onTrack: boolean
  assignment: { dueOn: string | null; completedAt: string | null; reason: string | null; round: number } | null
  quiz: { questions: Q[]; passedAt: string | null; lastScore: string | null; attempts: number } | null
}
type Task = { id: string; date: string; unit: string; name: string; status: 'done' | 'in progress' | 'scheduled'; clean: boolean }
export type Profile = {
  ok: true; migrated: boolean; today: string
  person: { key: string; name: string; email: string | null; phone: string | null; lang: Lang; dept: string | null; market: string | null; code: string }
  onboarding: {
    track: string | null; trackLabel: string | null; startDate: string | null; apps: Record<string, string | null>
    ack: { name: string; at: string; version: string } | null; invitedAt: string | null; inviteError: string | null; onboardedAt: string | null
    steps: { key: string; done: boolean; label: { en: string; es: string } }[]; percent: number; handbookVersion: string
  }
  training: TrainingRow[]
  modules?: { id: string; title: { en: string; es: string | null }; summary: { en: string | null; es: string | null }; itemIds: string[]; done: number; total: number }[]
  schedule: { weekStart: string; market: string; pushedAt: string; days: { date: string; status: string; shift: string | null }[] }[]
  tasks: { today: Task[]; upcoming: Task[]; recent: Task[] }
  hours: { ok: boolean; error?: string; days: { date: string; hours: number; clockIn: string | null; clockOut: string | null; open: boolean }[]; thisWeek: number; lastWeek: number; last14: number }
  inspections: { reports: { code: string; createdAt: string; sentAt: string | null; avgScore: number | null; avgPassRate: number | null; count: number }[]; rows: { taskId: string; date: string | null; unit: string | null; score: number | null; passRate: number | null; misses: number; reportCode: string | null }[] }
  stats: { cleans30: number; tasks30: number; hours14: number; hoursPerClean: number | null; avgScore: number | null; avgPassRate: number | null; inspections: number; trainingDone: number; trainingTotal: number; quizzesPassed: number; openIssues: number }
  issues: { id: string; kind: string; note: string | null; ref: string | null; itemIds: string[]; status: string; createdBy: string | null; createdAt: string; closedAt: string | null }[]
  activity: { kind: string; detail: any; by: string | null; at: string }[]
}
export type Act = (body: Record<string, any>) => Promise<any>
type TabKey = 'home' | 'training' | 'schedule' | 'work' | 'inspections' | 'profile' | 'record'

const APPS: { key: string; label: string; how: { en: string; es: string } }[] = [
  { key: 'homebase', label: 'Homebase', how: { en: 'Your schedule and hours. Clock in when you start, clock out when you finish.', es: 'Tu horario y horas. Marca entrada al empezar y salida al terminar.' } },
  { key: 'breezeway', label: 'Breezeway', how: { en: 'Your tasks: every clean, inspection and job.', es: 'Tus tareas: cada limpieza, inspección y trabajo.' } },
  { key: 'slack', label: 'Slack', how: { en: 'How the team talks. Add your photo, role, email and phone.', es: 'Cómo habla el equipo. Agrega tu foto, puesto, correo y teléfono.' } },
  { key: 'lighthouse', label: 'Lighthouse', how: { en: 'This page. Save it to your home screen.', es: 'Esta página. Guárdala en tu pantalla de inicio.' } },
]
const T = {
  en: {
    hi: 'Hi', tabs: { home: 'Home', training: 'Training', schedule: 'Schedule', work: 'Hours + tasks', inspections: 'Inspections', profile: 'Profile', record: 'Record' },
    onboarding: 'Your onboarding', onboarded: 'Onboarded', apps: 'Set up your apps', imIn: "I'm set up", setUp: 'Done', training: 'Training', todo: 'To do', done: 'Done',
    watch: 'Watch', markDone: 'Mark as done', takeQuiz: 'Take the quiz', quiz: 'Quiz', submit: 'Check my answers', passed: 'Passed', tryAgain: 'Not quite — the ones in red are wrong. Try again.', allRight: 'All correct. Done!',
    handbook: 'Handbook', signIntro: 'I have read the Stay Hospitality employee handbook and I agree to follow it.', typeName: 'Type your full name', sign: 'Sign', signed: 'Signed',
    due: 'Due', late: 'Late', redo: 'Redo', min: 'min', noVideo: 'The video is not ready in this language yet.', open: 'Open',
    schedule: 'Your schedule', noSchedule: 'No schedule posted yet. It shows here as soon as your manager posts the week.', off: 'Off',
    hours: 'Hours', thisWeek: 'This week', lastWeek: 'Last week', hoursErr: 'Hours are not available right now.', noHours: 'No hours yet.',
    tasks: 'Tasks', today: 'Today', upcoming: 'Coming up', recent: 'Recent', noTasks: 'Nothing assigned.',
    inspections: 'Your inspections', noInsp: 'No inspection reports shared with you yet.', report: 'Open the report', score: 'Score', pass: 'Pass',
    stats: { cleans: 'Cleans · 30 days', hours: 'Hours · this week', score: 'Inspection score', training: 'Training done' },
    profile: { name: 'Name', email: 'Email', phone: 'Phone', track: 'Role', market: 'Market', start: 'Start date', lang: 'Language' },
    stepsLabel: 'steps', module: 'Module', more: 'More training', next: 'Up next', cont: 'Continue', allDone: 'Course complete', lessons: 'lessons',
  },
  es: {
    hi: 'Hola', tabs: { home: 'Inicio', training: 'Capacitación', schedule: 'Horario', work: 'Horas + tareas', inspections: 'Inspecciones', profile: 'Perfil', record: 'Historial' },
    onboarding: 'Tu incorporación', onboarded: 'Incorporado', apps: 'Configura tus apps', imIn: 'Ya estoy', setUp: 'Hecho', training: 'Capacitación', todo: 'Por hacer', done: 'Hecho',
    watch: 'Ver', markDone: 'Marcar como hecho', takeQuiz: 'Hacer la prueba', quiz: 'Prueba', submit: 'Revisar mis respuestas', passed: 'Aprobada', tryAgain: 'Casi — las rojas están mal. Inténtalo otra vez.', allRight: '¡Todo correcto!',
    handbook: 'Manual', signIntro: 'He leído el manual del empleado de Stay Hospitality y acepto seguirlo.', typeName: 'Escribe tu nombre completo', sign: 'Firmar', signed: 'Firmado',
    due: 'Para', late: 'Vencido', redo: 'Repetir', min: 'min', noVideo: 'El video aún no está listo en este idioma.', open: 'Abrir',
    schedule: 'Tu horario', noSchedule: 'Aún no hay horario publicado. Aparece aquí cuando tu gerente publique la semana.', off: 'Libre',
    hours: 'Horas', thisWeek: 'Esta semana', lastWeek: 'Semana pasada', hoursErr: 'Las horas no están disponibles ahora.', noHours: 'Aún no hay horas.',
    tasks: 'Tareas', today: 'Hoy', upcoming: 'Próximas', recent: 'Recientes', noTasks: 'Nada asignado.',
    inspections: 'Tus inspecciones', noInsp: 'Aún no te han compartido reportes de inspección.', report: 'Abrir el reporte', score: 'Puntaje', pass: 'Aprobado',
    stats: { cleans: 'Limpiezas · 30 días', hours: 'Horas · esta semana', score: 'Puntaje de inspección', training: 'Capacitación hecha' },
    profile: { name: 'Nombre', email: 'Correo', phone: 'Teléfono', track: 'Puesto', market: 'Mercado', start: 'Inicio', lang: 'Idioma' },
    stepsLabel: 'pasos', module: 'Módulo', more: 'Más capacitación', next: 'Lo siguiente', cont: 'Continuar', allDone: 'Curso completo', lessons: 'lecciones',
  },
}
const serif: React.CSSProperties = { fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,'New York',Georgia,ui-serif,serif", letterSpacing: '-0.01em' }
const day = (ymd: string | null, lang: Lang, wd = false) => ymd ? new Date(ymd.slice(0, 10) + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', wd ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' }) : ''
const time = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : ''
const pct = (n: number | null) => n == null ? '—' : `${Math.round(n * 100)}%`
const tx = (o: { en: string | null; es: string | null }, lang: Lang) => (lang === 'es' && o.es ? o.es : o.en) || ''
const H = ({ children, n }: { children: ReactNode; n?: number }) => <h2 className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2 mt-5 px-1">{children}{n != null ? ` · ${n}` : ''}</h2>
const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => <div className={`rounded-2xl bg-white border border-neutral-200 ${className}`}>{children}</div>

export function MemberProfile({ data, lang, mode, act, onChanged, managerSlot }: { data: Profile; lang: Lang; mode: 'self' | 'manager'; act: Act; onChanged: () => void; managerSlot?: ReactNode }) {
  const t = T[lang]
  const [tab, setTab] = useState<TabKey>(mode === 'self' && !data.onboarding.onboardedAt ? 'training' : 'home')
  const tabs: TabKey[] = mode === 'manager' ? ['home', 'training', 'schedule', 'work', 'inspections', 'profile', 'record'] : ['home', 'training', 'schedule', 'work', 'inspections', 'profile']
  const s = data.stats
  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {tabs.map(k => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${tab === k ? 'bg-neutral-900 text-white' : 'bg-white border border-neutral-200 text-neutral-600'}`}>
            {t.tabs[k]}{k === 'record' && s.openIssues ? ` · ${s.openIssues}` : ''}
          </button>
        ))}
      </div>

      {tab === 'home' ? <>
        <NextUp data={data} lang={lang} onGo={() => setTab('training')} />
        {!data.onboarding.onboardedAt ? <Onboarding data={data} lang={lang} onGo={() => setTab('training')} /> : null}
        <div className="grid grid-cols-2 gap-2 mt-4">
          <Stat label={t.stats.cleans} value={String(s.cleans30)} />
          <Stat label={t.stats.hours} value={data.hours.ok ? String(data.hours.thisWeek) : '—'} />
          <Stat label={t.stats.score} value={s.avgScore != null ? `${s.avgScore} / 5` : '—'} sub={s.avgPassRate != null ? `${pct(s.avgPassRate)} ${t.pass.toLowerCase()}` : undefined} />
          <Stat label={t.stats.training} value={`${s.trainingDone} / ${s.trainingTotal}`} />
        </div>
        <ScheduleList data={data} lang={lang} compact />
        <TaskList title={t.today} rows={data.tasks.today} lang={lang} />
      </> : null}

      {tab === 'training' ? <TrainingTab data={data} lang={lang} mode={mode} act={act} onChanged={onChanged} /> : null}
      {tab === 'schedule' ? <ScheduleList data={data} lang={lang} /> : null}
      {tab === 'work' ? <>
        <H>{t.hours}</H>
        {!data.hours.ok ? <p className="text-[13px] text-neutral-500 px-1">{t.hoursErr}</p> : <>
          <div className="grid grid-cols-2 gap-2"><Stat label={t.thisWeek} value={`${data.hours.thisWeek} h`} /><Stat label={t.lastWeek} value={`${data.hours.lastWeek} h`} /></div>
          {data.hours.days.length ? <Card className="mt-2 divide-y divide-neutral-100">{data.hours.days.map(d => (
            <div key={d.date + (d.clockIn || '')} className="flex items-center gap-3 px-4 py-2 text-[13.5px]"><span className="w-28 text-neutral-700">{day(d.date, lang, true)}</span><span className="flex-1 text-neutral-500">{time(d.clockIn)}{d.clockOut ? ` – ${time(d.clockOut)}` : d.open ? ' – …' : ''}</span><span className="font-semibold tabular-nums">{d.hours} h</span></div>
          ))}</Card> : <p className="text-[13px] text-neutral-500 px-1 mt-2">{t.noHours}</p>}
        </>}
        <TaskList title={t.today} rows={data.tasks.today} lang={lang} />
        <TaskList title={t.upcoming} rows={data.tasks.upcoming} lang={lang} />
        <TaskList title={t.recent} rows={data.tasks.recent} lang={lang} />
      </> : null}
      {tab === 'inspections' ? <Inspections data={data} lang={lang} mode={mode} /> : null}
      {tab === 'profile' ? <Card className="mt-4 divide-y divide-neutral-100">
        {([[t.profile.name, data.person.name], [t.profile.email, data.person.email], [t.profile.phone, data.person.phone], [t.profile.track, data.onboarding.trackLabel], [t.profile.market, data.person.market], [t.profile.start, day(data.onboarding.startDate, lang)], [t.profile.lang, data.person.lang === 'es' ? 'Español' : 'English']] as [string, string | null][]).map(([k, v]) => (
          <div key={k} className="flex items-center gap-3 px-4 py-2.5 text-[13.5px]"><span className="w-28 text-neutral-500">{k}</span><span className="flex-1 text-neutral-900 break-all">{v || '—'}</span></div>
        ))}
      </Card> : null}
      {tab === 'record' && mode === 'manager' ? <>{managerSlot}<Record data={data} /></> : null}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <Card className="px-4 py-3"><div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">{label}</div><div className="text-[22px] font-bold tabular-nums mt-0.5" style={serif}>{value}</div>{sub ? <div className="text-[11.5px] text-neutral-500">{sub}</div> : null}</Card>
}

/** The one next thing to do, in course order: an app not set up, then the first unfinished lesson, then the handbook. */
function NextUp({ data, lang, onGo }: { data: Profile; lang: Lang; onGo: () => void }) {
  const t = T[lang]
  const finished = (i: TrainingRow) => !!i.assignment?.completedAt && (!i.quiz || !!i.quiz.passedAt)
  const order = (data.modules || []).flatMap(m => m.itemIds)
  const rows = data.training.slice().sort((a, b) => { const x = order.indexOf(a.id), y = order.indexOf(b.id); return (x < 0 ? 999 : x) - (y < 0 ? 999 : y) })
  const lesson = rows.find(i => !finished(i))
  const app = APPS.find(a => !data.onboarding.apps[a.key])
  const modOf = lesson ? (data.modules || []).findIndex(m => m.itemIds.indexOf(lesson.id) >= 0) : -1
  let title = '', sub = ''
  if (app && data.migrated) { title = `${t.apps}: ${app.label}`; sub = app.how[lang] }
  else if (lesson) { title = tx(lesson.title, lang); sub = [modOf >= 0 ? `${t.module} ${modOf + 1} · ${tx(data.modules![modOf].title, lang)}` : null, lesson.quiz && !lesson.quiz.passedAt ? t.quiz : null].filter(Boolean).join(' · ') }
  else if (!data.onboarding.ack && data.migrated) { title = t.handbook; sub = t.signIntro }
  if (!title) {
    if (!data.training.length) return null
    return <div className="mt-4 rounded-2xl bg-emerald-600 text-white px-4 py-4 flex items-center gap-3"><Check size={22} /><span className="text-[17px] font-bold" style={serif}>{t.allDone}</span></div>
  }
  return (
    <button type="button" onClick={onGo} className="mt-4 w-full text-left rounded-2xl bg-neutral-900 text-white px-4 py-4 shadow-sm">
      <span className="block text-[11px] font-bold uppercase tracking-wider text-white/60">{t.next}</span>
      <span className="block text-[19px] font-bold leading-snug mt-0.5" style={serif}>{title}</span>
      {sub ? <span className="block text-[12.5px] text-white/70 mt-1 leading-snug">{sub}</span> : null}
      <span className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-white text-neutral-900 px-3.5 py-2 text-[13.5px] font-bold">{t.cont} →</span>
    </button>
  )
}

function Onboarding({ data, lang, onGo }: { data: Profile; lang: Lang; onGo: () => void }) {
  const t = T[lang]
  return (
    <Card className="mt-4 px-4 py-3">
      <div className="flex items-center gap-2"><GraduationCap size={16} className="text-neutral-700" /><span className="font-semibold text-[14px]">{t.onboarding}</span><span className="ml-auto text-[12px] text-neutral-500">{data.onboarding.percent}%</span></div>
      <div className="h-1.5 rounded-full bg-neutral-100 mt-2 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${data.onboarding.percent}%` }} /></div>
      <ol className="mt-3 space-y-1.5">{data.onboarding.steps.map((st, i) => (
        <li key={st.key} className="flex items-center gap-2 text-[13.5px]">{st.done ? <Check size={15} className="text-emerald-600" /> : <Circle size={15} className="text-neutral-300" />}<span className={st.done ? 'text-neutral-500' : 'text-neutral-900 font-medium'}>{i + 1}. {st.label[lang]}</span></li>
      ))}</ol>
    </Card>
  )
}

function TrainingTab({ data, lang, mode, act, onChanged }: { data: Profile; lang: Lang; mode: 'self' | 'manager'; act: Act; onChanged: () => void }) {
  const t = T[lang]
  const [busy, setBusy] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const run = async (k: string, body: Record<string, any>) => {
    setBusy(k); setErr('')
    try { await act(body); onChanged() } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(null) }
  }
  const mods = data.modules || []
  const [openMods, setOpenMods] = useState<string[]>([])
  const inMods: string[] = mods.flatMap(m => m.itemIds)
  const byId: Record<string, TrainingRow> = {}
  for (const r of data.training) byId[r.id] = r
  const finishedRow = (i: TrainingRow) => !!i.assignment?.completedAt && (!i.quiz || !!i.quiz.passedAt)
  const rest = data.training.filter(i => inMods.indexOf(i.id) < 0)
  const loose = rest.filter(i => !finishedRow(i))
  const done = rest.filter(finishedRow)
  return (
    <div>
      <H>{t.apps}</H>
      <Card className="divide-y divide-neutral-100">
        {APPS.map(a => {
          const on = !!data.onboarding.apps[a.key]
          return (
            <div key={a.key} className="flex items-center gap-3 px-4 py-3">
              <span className={`shrink-0 w-8 h-8 rounded-lg inline-flex items-center justify-center ${on ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-500'}`}>{on ? <Check size={16} /> : <Circle size={14} />}</span>
              <span className="flex-1 min-w-0"><span className="block font-semibold text-[14px]">{a.label}</span><span className="block text-[12.5px] text-neutral-500 leading-snug">{a.how[lang]}</span></span>
              {data.migrated ? <button type="button" disabled={!!busy} onClick={() => run('app:' + a.key, { action: 'app', app: a.key, on: !on })} className={`shrink-0 rounded-xl px-3 py-1.5 text-[12.5px] font-semibold ${on ? 'border border-neutral-200 text-neutral-500' : 'bg-neutral-900 text-white'}`}>
                {busy === 'app:' + a.key ? <Loader2 size={14} className="animate-spin" /> : on ? t.setUp : t.imIn}
              </button> : null}
            </div>
          )
        })}
      </Card>
      {err ? <p className="text-[13px] text-rose-600 mt-2 px-1">{err}</p> : null}
      {mods.length ? mods.map((m, mi) => {
        const rows = m.itemIds.map(id => byId[id]).filter(Boolean) as TrainingRow[]
        const complete = m.total > 0 && m.done === m.total
        const shut = complete && openMods.indexOf(m.id) < 0
        return (
          <section key={m.id} className="mt-5">
            <button type="button" onClick={() => complete && setOpenMods(o => o.indexOf(m.id) >= 0 ? o.filter(x => x !== m.id) : o.concat([m.id]))} className="w-full text-left flex items-center gap-3 px-1 mb-2">
              <span className={`shrink-0 w-9 h-9 rounded-xl inline-flex items-center justify-center text-[15px] font-bold ${complete ? 'bg-emerald-600 text-white' : 'bg-neutral-900 text-white'}`} style={serif}>{complete ? <Check size={17} /> : mi + 1}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-neutral-500">{t.module} {mi + 1} · {m.done}/{m.total}</span>
                <span className={`block text-[17px] font-bold leading-tight ${complete ? 'text-neutral-500' : 'text-neutral-900'}`} style={serif}>{tx(m.title, lang)}</span>
              </span>
              {complete ? <ChevronDown size={18} className={`text-neutral-400 transition ${shut ? '' : 'rotate-180'}`} /> : null}
            </button>
            {!complete ? <div className="h-1 rounded-full bg-neutral-200 mx-1 mb-2 overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${m.total ? (m.done / m.total) * 100 : 0}%` }} /></div> : null}
            {!shut ? <ul className="space-y-2">{rows.map(i => <Item key={i.id} item={i} data={data} lang={lang} mode={mode} act={act} onChanged={onChanged} />)}</ul> : null}
          </section>
        )
      }) : null}
      {loose.length ? <><H n={loose.length}>{mods.length ? t.more : t.todo}</H><ul className="space-y-2">{loose.map(i => <Item key={i.id} item={i} data={data} lang={lang} mode={mode} act={act} onChanged={onChanged} />)}</ul></> : null}

      <H>{t.handbook}</H>
      <Card className="px-4 py-3">
        {data.onboarding.ack ? (
          <p className="text-[13.5px] text-neutral-700 flex items-center gap-2"><Check size={15} className="text-emerald-600" />{t.signed}: <b>{data.onboarding.ack.name}</b> · {day(data.onboarding.ack.at, lang)}</p>
        ) : mode === 'self' && data.migrated ? (
          <div className="space-y-2">
            <p className="text-[13.5px] text-neutral-700">{t.signIntro}</p>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={t.typeName} autoComplete="name" className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-base" />
            <button type="button" disabled={!!busy || name.trim().split(/\s+/).length < 2} onClick={() => run('sign', { action: 'sign', name })} className="w-full rounded-xl bg-neutral-900 text-white py-2.5 text-[14px] font-semibold disabled:opacity-40">{busy === 'sign' ? <Loader2 size={15} className="animate-spin inline" /> : t.sign}</button>
          </div>
        ) : <p className="text-[13px] text-neutral-500">—</p>}
      </Card>

      {done.length ? <><H n={done.length}>{t.done}</H><ul className="space-y-2">{done.map(i => <Item key={i.id} item={i} data={data} lang={lang} mode={mode} act={act} onChanged={onChanged} />)}</ul></> : null}
    </div>
  )
}

function Item({ item, data, lang, mode, act, onChanged }: { item: TrainingRow; data: Profile; lang: Lang; mode: 'self' | 'manager'; act: Act; onChanged: () => void }) {
  const t = T[lang]
  const [open, setOpen] = useState(false)
  const [quizOpen, setQuizOpen] = useState(false)
  const [answers, setAnswers] = useState<number[]>([])
  const [wrong, setWrong] = useState<number[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const finished = !!item.assignment?.completedAt && (!item.quiz || !!item.quiz.passedAt)
  const url = item.url[lang] || item.url.en || item.url.es
  const external = !!url && !/supabase\.co\/storage/.test(url) && !/\.(mp4|m4v|mov|webm)(\?|$)/i.test(url)
  const late = !!item.assignment?.dueOn && !finished && item.assignment.dueOn < data.today
  const self = mode === 'self'
  const view = () => { if (self) act({ action: 'view', itemId: item.id, lang }).catch(() => {}) }
  const done = async () => { setBusy(true); setMsg(''); try { await act({ action: 'complete', itemId: item.id, lang }); onChanged() } catch (e: any) { setMsg(e?.message || String(e)) } finally { setBusy(false) } }
  const submit = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await act({ action: 'quiz', itemId: item.id, answers, lang })
      if (r.passed) { setWrong([]); setMsg(t.allRight); onChanged() } else { setWrong(r.wrong || []); setMsg(t.tryAgain) }
    } catch (e: any) { setMsg(e?.message || String(e)) } finally { setBusy(false) }
  }
  return (
    <li><Card className="overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left px-4 py-3 flex items-center gap-3">
        <span className={`shrink-0 w-10 h-10 rounded-xl inline-flex items-center justify-center ${finished ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-900 text-white'}`}>{finished ? <Check size={18} /> : item.kind === 'video' ? <Play size={17} /> : item.kind === 'faq' ? <BookOpen size={17} /> : <FileText size={17} />}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-semibold text-neutral-900 leading-snug">{tx(item.title, lang)}</span>
          <span className="block text-[12.5px] text-neutral-500 mt-0.5">
            {item.assignment?.reason === 'retraining' && !finished ? <span className="text-amber-700 font-semibold">{t.redo} · </span> : null}
            {item.kind === 'video' && item.durationSec ? `${Math.max(1, Math.round(item.durationSec / 60))} ${t.min} · ` : ''}
            {item.quiz ? `${t.quiz}${item.quiz.passedAt ? ' ✓' : item.quiz.lastScore ? ` ${item.quiz.lastScore}` : ''} · ` : ''}
            {finished ? `${t.done} ${day(item.assignment?.completedAt || item.quiz?.passedAt || null, lang)}` : late ? <span className="text-rose-600 font-semibold">{t.late} · {day(item.assignment!.dueOn, lang)}</span> : item.assignment?.dueOn ? `${t.due} ${day(item.assignment.dueOn, lang)}` : ''}
          </span>
        </span>
        <ChevronDown size={18} className={`text-neutral-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="px-3 pb-3 space-y-3">
          {item.kind === 'video' ? (
            <div className="rounded-xl overflow-hidden bg-black">
              {url ? (external
                ? <a href={url} target="_blank" rel="noopener noreferrer" onClick={view} className="block p-6 text-center text-white text-[14px] underline">{t.open} ↗</a>
                : <video key={url} controls playsInline preload="metadata" onPlay={view} className="w-full bg-black" src={url} />)
                : <div className="p-5 text-center text-white/80 text-[13px]">{t.noVideo}</div>}
            </div>
          ) : null}
          {tx(item.body, lang) ? <Body text={tx(item.body, lang)} /> : null}
          {item.quiz && !item.quiz.passedAt && self ? (
            quizOpen ? (
              <div className="rounded-xl border border-neutral-200 px-3 py-3 space-y-4">
                {item.quiz.questions.map((q, qi) => {
                  const opts = (lang === 'es' && q.options.es) || q.options.en
                  const isWrong = wrong && wrong.indexOf(qi) >= 0
                  return (
                    <div key={qi}>
                      <p className={`text-[14px] font-semibold mb-1.5 ${isWrong ? 'text-rose-600' : 'text-neutral-900'}`}>{qi + 1}. {tx(q.q, lang)}</p>
                      <div className="space-y-1.5">{opts.map((o, oi) => (
                        <button key={oi} type="button" onClick={() => { const a = answers.slice(); a[qi] = oi; setAnswers(a); setWrong(w => w ? w.filter(x => x !== qi) : w) }} className={`w-full text-left rounded-xl px-3 py-2.5 text-[14px] border ${answers[qi] === oi ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-800'}`}>{o}</button>
                      ))}</div>
                    </div>
                  )
                })}
                <button type="button" disabled={busy || item.quiz.questions.some((_, i) => answers[i] == null)} onClick={submit} className="w-full rounded-2xl bg-emerald-600 text-white py-3 text-[15px] font-bold disabled:opacity-40">{busy ? <Loader2 size={16} className="animate-spin inline" /> : t.submit}</button>
              </div>
            ) : <button type="button" onClick={() => { setQuizOpen(true); setAnswers([]); setWrong(null); setMsg('') }} className="w-full rounded-2xl bg-neutral-900 text-white py-3 text-[15px] font-bold">{t.takeQuiz}</button>
          ) : null}
          {!item.quiz && !finished && self ? (
            <button type="button" disabled={busy} onClick={done} className="w-full rounded-2xl bg-emerald-600 text-white py-3 text-[15px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t.markDone}</button>
          ) : null}
          {msg ? <p className={`text-[13px] px-1 ${wrong && wrong.length ? 'text-rose-600' : 'text-emerald-700'}`}>{msg}</p> : null}
        </div>
      ) : null}
    </Card></li>
  )
}

/** A lesson's text: lines in CAPITALS become headings, "•" and "1." lines become list rows, the rest paragraphs. */
function Body({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/)
  return (
    <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-4 py-3 text-[14.5px] text-neutral-800 leading-relaxed space-y-3">
      {blocks.map((b, bi) => (
        <div key={bi} className="space-y-1">
          {b.split('\n').map((line, li) => {
            const l = line.trim()
            if (!l) return null
            const letters = l.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '')
            if (letters.length >= 3 && letters === letters.toUpperCase() && l.length < 70) return <p key={li} className="text-[11.5px] font-bold uppercase tracking-wider text-neutral-500 pt-1">{l.replace(/^\d+\.\s*/, m => m)}</p>
            if (/^[•\-]\s/.test(l)) return <p key={li} className="flex gap-2"><span className="text-neutral-400">•</span><span>{l.replace(/^[•\-]\s*/, '')}</span></p>
            return <p key={li}>{l}</p>
          })}
        </div>
      ))}
    </div>
  )
}

function ScheduleList({ data, lang, compact }: { data: Profile; lang: Lang; compact?: boolean }) {
  const t = T[lang]
  const weeks = compact ? data.schedule.filter(w => w.days.some(d => d.date >= data.today)).slice(0, 1) : data.schedule
  return (
    <>
      <H>{t.schedule}</H>
      {!weeks.length ? <p className="text-[13px] text-neutral-500 px-1">{t.noSchedule}</p> : weeks.map(w => (
        <Card key={w.weekStart + w.market} className="mb-2 divide-y divide-neutral-100">
          {w.days.map(d => {
            const off = d.status === 'OFF' || d.status === 'REQ OFF'
            return <div key={d.date} className={`flex items-center gap-3 px-4 py-2 text-[13.5px] ${d.date === data.today ? 'bg-amber-50' : ''}`}><CalendarDays size={14} className="text-neutral-400" /><span className="w-28 text-neutral-700">{day(d.date, lang, true)}</span><span className={`flex-1 ${off ? 'text-neutral-400' : 'font-semibold text-neutral-900'}`}>{off ? t.off : (d.shift || d.status)}</span></div>
          })}
        </Card>
      ))}
    </>
  )
}

function TaskList({ title, rows, lang }: { title: string; rows: Task[]; lang: Lang }) {
  const t = T[lang]
  return (
    <>
      <H n={rows.length}>{title}</H>
      {!rows.length ? <p className="text-[13px] text-neutral-500 px-1">{t.noTasks}</p> : (
        <Card className="divide-y divide-neutral-100">{rows.map(r => (
          <div key={r.id} className="flex items-center gap-3 px-4 py-2 text-[13.5px]">
            <span className="w-16 text-neutral-500 shrink-0">{day(r.date, lang)}</span>
            <span className="flex-1 min-w-0"><span className="block font-semibold truncate">{r.unit || '—'}</span><span className="block text-[12px] text-neutral-500 truncate">{r.name}</span></span>
            <span className={`shrink-0 text-[11px] font-semibold rounded-full px-2 py-0.5 ${r.status === 'done' ? 'bg-emerald-100 text-emerald-700' : r.status === 'in progress' ? 'bg-sky-100 text-sky-700' : 'bg-neutral-100 text-neutral-600'}`}>{r.status}</span>
          </div>
        ))}</Card>
      )}
    </>
  )
}

function Inspections({ data, lang, mode }: { data: Profile; lang: Lang; mode: 'self' | 'manager' }) {
  const t = T[lang]
  const { reports, rows } = data.inspections
  return (
    <>
      <H n={reports.length}>{t.inspections}</H>
      {!reports.length ? <p className="text-[13px] text-neutral-500 px-1">{t.noInsp}</p> : (
        <Card className="divide-y divide-neutral-100">{reports.map(r => (
          <a key={r.code} href={'/ir/' + r.code} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-2.5 text-[13.5px]">
            <ClipboardCheck size={15} className="text-neutral-500" />
            <span className="flex-1"><span className="block font-semibold">{day(r.createdAt, lang)} · {r.count}</span><span className="block text-[12px] text-neutral-500">{t.score} {r.avgScore ?? '—'} · {t.pass} {pct(r.avgPassRate)}{mode === 'manager' && !r.sentAt ? ' · not sent yet' : ''}</span></span>
            <ExternalLink size={14} className="text-neutral-400" />
          </a>
        ))}</Card>
      )}
      {rows.length ? <Card className="mt-2 divide-y divide-neutral-100">{rows.map(r => (
        <div key={r.taskId} className="flex items-center gap-3 px-4 py-2 text-[13px]"><span className="w-16 text-neutral-500">{day(r.date, lang)}</span><span className="flex-1 truncate">{r.unit || '—'}</span><span className="tabular-nums">{r.score ?? '—'}/5</span><span className={`tabular-nums w-12 text-right ${r.passRate != null && r.passRate < 0.8 ? 'text-rose-600' : 'text-neutral-600'}`}>{pct(r.passRate)}</span></div>
      ))}</Card> : null}
    </>
  )
}

const KIND: Record<string, string> = { red_button: 'Red-button', inspection: 'Inspection', guest: 'Guest issue', other: 'Other' }
const ACT: Record<string, string> = { opened: 'Opened their page', watched: 'Watched', completed: 'Finished an item', quiz: 'Took a quiz', signed: 'Signed the handbook', step: 'App set up', invited: 'Invite emailed', onboard: 'Onboarding started', onboarded: 'Onboarded', issue: 'Issue logged', retrained: 'Retraining finished', schedule: 'Schedule emailed' }
function Record({ data }: { data: Profile }) {
  const titleOf = (id: string) => { const i = data.training.find(x => x.id === id); return i ? i.title.en : 'an item' }
  return (
    <>
      <H n={data.issues.length}>Issues + retraining</H>
      {!data.issues.length ? <p className="text-[13px] text-neutral-500 px-1">None logged.</p> : (
        <Card className="divide-y divide-neutral-100">{data.issues.map(i => (
          <div key={i.id} className="px-4 py-2.5 text-[13px]">
            <div className="flex items-center gap-2"><AlertTriangle size={14} className={i.kind === 'red_button' ? 'text-rose-600' : 'text-amber-600'} /><b>{KIND[i.kind] || i.kind}</b><span className="text-neutral-500">· {day(i.createdAt, 'en')} · {i.createdBy || ''}</span>
              <span className={`ml-auto text-[11px] font-semibold rounded-full px-2 py-0.5 ${i.status === 'retraining' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>{i.status === 'retraining' ? 'Retraining' : i.status === 'retrained' ? 'Retrained' : 'Logged'}</span></div>
            {i.note ? <p className="text-neutral-700 mt-1">{i.note}</p> : null}
            {i.itemIds.length ? <p className="text-neutral-500 mt-1 text-[12px]"><RotateCcw size={11} className="inline mr-1" />{i.itemIds.map(titleOf).join(' · ')}</p> : null}
          </div>
        ))}</Card>
      )}
      <H n={data.activity.length}>Everything they did</H>
      {!data.activity.length ? <p className="text-[13px] text-neutral-500 px-1">Nothing yet.</p> : (
        <Card className="divide-y divide-neutral-100">{data.activity.map((a, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-1.5 text-[12.5px]">
            <span className="w-24 text-neutral-500 shrink-0">{day(a.at, 'en')} {time(a.at)}</span>
            <span className="flex-1 min-w-0 truncate">{ACT[a.kind] || a.kind}{a.kind === 'quiz' ? ` · ${a.detail?.score}/${a.detail?.total}${a.detail?.passed ? ' passed' : ''}` : ''}{a.kind === 'step' ? ` · ${a.detail?.app}` : ''}{a.detail?.itemId ? ` · ${titleOf(a.detail.itemId)}` : ''}</span>
            <span className="text-neutral-400 shrink-0">{a.by || 'them'}</span>
          </div>
        ))}</Card>
      )}
    </>
  )
}

