// BRIEF LANGUAGE (Jon, 2026-08-25: "can we add a spanish one for Miami only briefs… or give me
// option to change to spanish in the settings for the briefs").
//
// It is a SETTING, not a guess. Each crew-facing brief carries its own language, chosen at
// /users → App settings → Morning briefs, so Miami housekeeping can read Spanish while Broward
// maintenance reads English — or both switch, whenever Jon decides. Default stays English so
// nothing changes for anyone until somebody chooses.
//
// WHAT TRANSLATES AND WHAT NEVER DOES. The furniture translates: headings, labels, instructions,
// the words on the pills. The DATA never does — unit names, guest names, people's names and the
// task text as it was typed in Breezeway stay exactly as written, because a cleaner searching the
// board for "Field Reported Priority/Replace door lock battery" has to find that string, and a
// machine-translated unit name is a wrong unit name. Dates render through Intl in the brief's
// own locale, which is the one place a translation is safely automatic.
//
// HOW TO ADD A STRING: add the English text as the key and the Spanish as the value. A key with
// no entry falls back to English rather than breaking — a half-translated brief is still a
// readable brief, and the missing phrase is obvious enough to fix.
export type BriefLang = 'en' | 'es'

export const isLang = (v: any): v is BriefLang => v === 'en' || v === 'es'
export const asLang = (v: any): BriefLang => (isLang(v) ? v : 'en')

const ES: Record<string, string> = {
  // ── mastheads and section furniture
  'Day Sheet': 'Hoja del Día',
  'Maintenance': 'Mantenimiento',
  'run in order, same-day first': 'trabaje en orden, primero las salidas con llegada hoy',
  "today by area, empty units, what carried over": 'hoy por área, unidades vacías, lo que quedó pendiente',
  "Today’s thought": 'Pensamiento de hoy',
  'Act now': 'Atender ahora',
  'Today': 'Hoy',
  'Yesterday': 'Ayer',
  'Looking ahead': 'Lo que viene',
  'Today, by area': 'Hoy, por área',
  'Empty units — the PM window': 'Unidades vacías — ventana para mantenimiento preventivo',
  'Behind and repeating': 'Atrasado y repetido',
  'The numbers': 'Los números',
  // ── the access notice (safety copy — translated in full, never dropped)
  'Confirm access before entering any unit.': 'Confirme el acceso antes de entrar a cualquier unidad.',
  ACCESS_BODY: 'Este resumen se genera automáticamente con los datos de anoche — <b>no es autorización para entrar</b>. Los huéspedes extienden estadías, se aprueban salidas tardías y los planes cambian después de enviarse. Confirme siempre que la unidad esté libre antes de entrar.',
  // ── housekeeping card
  "Housekeeping — each person's day, in order": 'Limpieza — el día de cada persona, en orden',
  'NO ONE ASSIGNED': 'SIN ASIGNAR',
  'assign these first': 'asigne estas primero',
  'other housekeeping job': 'otro trabajo de limpieza',
  'other housekeeping jobs': 'otros trabajos de limpieza',
  'clean': 'limpieza',
  'cleans': 'limpiezas',
  'other job': 'otro trabajo',
  'other jobs': 'otros trabajos',
  'same-day': 'salida y llegada hoy',
  'done': 'listo',
  'in progress': 'en proceso',
  'scheduled': 'programado',
  'to do': 'por hacer',
  'open': 'abierto',
  'guest lands': 'el huésped llega',
  'today': 'hoy',
  HK_FOOTNOTE: 'Las filas numeradas son las limpiezas de salida — trabájelas en ese orden. Las filas con viñeta son todo lo demás asignado hoy: destendidos, ropa de cama, reposición, estadías en curso e inspecciones.',
  'Nothing on the housekeeping board today.': 'No hay nada en el tablero de limpieza hoy.',
  // ── arrivals / departures
  'Departures': 'Salidas',
  'Arrivals': 'Llegadas',
  'SAME-DAY TURN': 'SALIDA Y LLEGADA HOY',
  'WALK-IN': 'SIN RESERVA PREVIA',
  'OWNER': 'PROPIETARIO',
  'OWNER?': '¿PROPIETARIO?',
  'VIP': 'VIP',
  'LONG STAY': 'ESTADÍA LARGA',
  'Owner stays in-house': 'Propietarios hospedados',
  'white-glove — no shortcuts': 'trato especial — sin atajos',
  'verify before treating as owner': 'verifique antes de tratarlo como propietario',
  'out': 'sale',
  // ── priorities
  'Top priorities — in order': 'Prioridades — en orden',
  'Top priorities': 'Prioridades',
  'Nothing on fire.': 'Nada urgente.',
  'Work the list below and keep the 4pm deadline in sight.': 'Trabaje la lista de abajo sin perder de vista la hora límite de las 4:00 PM.',
  'clean has <b>no one assigned</b>': 'la limpieza <b>no tiene a nadie asignado</b>',
  // ── vacant / week ahead
  'Vacant units — what to slot in': 'Unidades vacías — qué aprovechar',
  'vacant tonight': 'vacías esta noche',
  'Next 7 days — worth preparing for': 'Próximos 7 días — vale la pena prepararse',
  'Owner stays, long stays and VIP bookings landing soon — these units get the extra pass.':
    'Estadías de propietarios, estadías largas y reservas VIP que llegan pronto — estas unidades llevan una revisión extra.',
  'nights': 'noches',
  'night': 'noche',
  // ── yesterday
  'Yesterday — what the team got done': 'Ayer — lo que el equipo completó',
  'Cleans completed': 'Limpiezas completadas',
  'Inspections completed': 'Inspecciones completadas',
  'Maintenance closed': 'Mantenimiento cerrado',
  'min average': 'min promedio',
  'none logged': 'ninguna registrada',
  // ── maintenance brief
  "Today's jobs — who has what": 'Trabajos de hoy — quién tiene qué',
  "Today's jobs": 'Trabajos de hoy',
  'GUEST IN HOUSE': 'HUÉSPED EN LA UNIDAD',
  'ARRIVES TODAY': 'LLEGA HOY',
  'Call or message the guest before anyone enters.': 'Llame o escriba al huésped antes de que alguien entre.',
  'Nobody assigned': 'Sin asignar',
  'give these a name first': 'asigne estas primero',
  'nobody yet': 'nadie aún',
  'Empty units — walk these while you can': 'Unidades vacías — revíselas mientras pueda',
  'Checking out today — get in after the clean': 'Salen hoy — entre después de la limpieza',
  'Nobody arriving behind them': 'No llega nadie después',
  'after the clean': 'después de la limpieza',
  'pending': 'pendientes',
  'Carried over — oldest first': 'Pendientes de días anteriores — más antiguos primero',
  'Carried over': 'Pendientes de días anteriores',
  'Scheduled in the last 7 days and still open': 'Programados en los últimos 7 días y aún abiertos',
  'Nothing carried over.': 'No quedó nada pendiente.',
  'Every job scheduled this past week is closed.': 'Todo lo programado esta semana está cerrado.',
  'Units that keep coming back': 'Unidades que siguen repitiéndose',
  'Three or more jobs in the last 30 days': 'Tres o más trabajos en los últimos 30 días',
  'Finished and billed': 'Terminados y facturados',
  'Jobs finished': 'Trabajos terminados',
  'closed in Breezeway': 'cerrados en Breezeway',
  'Billed': 'Facturado',
  'charges entered on the task': 'cargos ingresados en la tarea',
  'No charge entered': 'Sin cargo ingresado',
  'these bill $0 until somebody types the cost': 'estos facturan $0 hasta que alguien ingrese el costo',
  'Open the maintenance board →': 'Abrir el tablero de mantenimiento →',
  'Walk it and fix what the guest named': 'Revísela y arregle lo que el huésped mencionó',
  'JOBS OPEN': 'TRABAJOS ABIERTOS',
  'BACKLOG': 'PENDIENTE',
  'PM DUE': 'PREVENTIVO VENCIDO',
  'REVIEW': 'RESEÑA',
  'no PM on record': 'sin preventivo registrado',
  'guest reported': 'reportado por huésped',
  'field reported': 'reportado en campo',
  'clear days': 'días libres',
  'clear day': 'día libre',
  'no future booking': 'sin reserva futura',
  'guest arriving today': 'huésped llega hoy',
  'empty': 'vacías',
  // ── closings
  'Thank you for everything you do.': 'Gracias por todo lo que hacen.',
  'Sent automatically every morning · your supervisor has the live board.':
    'Enviado automáticamente cada mañana · su supervisor tiene el tablero en vivo.',
  'sent automatically every morning · questions: reply to this email.':
    'enviado automáticamente cada mañana · dudas: responda a este correo.',
}

/** The translator for one brief. `t('English text')` → the crew's language, English if untranslated. */
export function translator(lang: BriefLang) {
  const t = (en: string): string => (lang === 'es' ? (ES[en] ?? en) : en)
  return {
    lang,
    t,
    /** Pick between two already-written phrasings without going through the dictionary. */
    pick: (en: string, es: string) => (lang === 'es' ? es : en),
    /** The locale for dates — the one translation that is safely automatic. */
    locale: lang === 'es' ? 'es-US' : 'en-US',
  }
}
export type Tr = ReturnType<typeof translator>
