// WHICH TOOL DRAWER A QUESTION ALREADY NAMES (2026-10-01 cost pass).
//
// Eve's tools are disclosed progressively (lib/eve/registry): a core set is always present and the
// rest arrive by domain through open_domain, which costs a whole model turn — a full prefix at list
// price — on the first deep question of every thread, and again on every Slack follow-up because a
// new message is a new run. Most questions have already said which drawer they need: "clean",
// "inspection" and "task" are ops; "payout", "ADR" and "statement" are money; "review" is quality.
// This is a plain keyword vote, no model, run once before the first call; it opens at most two
// domains, strongest first, and only when a domain scores clearly. The model can still open_domain
// anything it finds missing. No imports, so lib/eve/__tests__/domain-guess.test.mjs runs it bare.
//
// Spanish counts: the field team asks in Spanish and the drawer is the same.
export type DomainKey = 'ops' | 'money' | 'quality' | 'labor' | 'guests' | 'slack' | 'property' | 'system'

const VOTES: { key: DomainKey; re: RegExp; w: number }[] = [
  { key: 'ops', w: 2, re: /\b(clean|cleans|cleaning|cleaner|limpieza|limpiezas|limpiar|turnover|departure|checkout|check-?out|salida|inspection|inspections|inspecci[oó]n|task|tasks|tarea|tareas|breezeway|glitch|glitches|claim|claims|schedule|scheduled|scheduler|horario|assign|assigned|asignad[oa]|same-?day|mismo d[ií]a|maintenance|mantenimiento|repair|work order|late|behind|not started|in progress|who usually|how long does|minutes a clean|roster)\b/i },
  { key: 'money', w: 2, re: /\b(revenue|revpar|adr|occupancy|ocupaci[oó]n|payout|payouts|owner statement|statement|statements|invoice|invoices|billable|billing|margin|pacing|direct booking|direct bookings|\$\s?\d|dollars|pricing|rate|rates|nightly rate|how much did|how much is|ingresos|pago|pagos|factura)\b/i },
  { key: 'quality', w: 2, re: /\b(review|reviews|rese[nñ]a|rese[nñ]as|rating|ratings|stars?|estrellas|health score|audit|audits|walk|walkthrough|sentiment|ff&e|ffe|project|projects|proyecto|complaint|complaints|queja|quejas)\b/i },
  { key: 'labor', w: 2, re: /\b(clocked|clock in|clock out|homebase|hours|horas|overtime|payroll|n[oó]mina|labor|labour|agency|crew scorecard|scorecard|cost per clean|per clean|productivity|who is working|who's working|qui[eé]n trabaja|on shift|shift|shifts|turno|turnos)\b/i },
  { key: 'guests', w: 2, re: /\b(guest|guests|hu[eé]sped|hu[eé]spedes|message|messages|mensaje|mensajes|thread|threads|inbox|reply|replied|unread|welcome call|welcome calls|llamada|llamadas|reservation|reservations|reserva|reservas|booking|bookings|arrival|arrivals|llegada|llegadas|check-?in|checkin|stay|stays|refund|reembolso|airbnb|vrbo|expedia|booking\.com|guesty|comment|comments|history with us)\b/i },
  { key: 'slack', w: 2, re: /\b(slack|channel|channels|canal|#vr-[a-z0-9-]+|what did .* say|who said|dijo|thread in|posted in|conversation in)\b/i },
  { key: 'property', w: 2, re: /\b(house rules|arrival instructions|instrucciones|guidebook|guide book|gu[ií]a|faq|wifi|wi-fi|parking|estacionamiento|door code|c[oó]digo|lock|cerradura|amenit(y|ies)|what does .* have|what is in|inventory|inventario|building|buildings|edificio|address|direcci[oó]n|elevator|pool|gym|unit details|bedrooms|how many beds)\b/i },
  { key: 'system', w: 2, re: /\b(automation|automations|cron|job|jobs|sync|synced|last run|is .* on|turned on|turned off|email went out|who got the email|share link|share links|approval|approvals|pending approval|health page|setting|settings|configuration|alert routing|routing)\b/i },
]

/** The domains a question already names, strongest first — at most two, and none when nothing scores. */
export function guessDomains(text: string, max = 2): DomainKey[] {
  const t = String(text || '').slice(0, 1200)
  if (!t.trim()) return []
  const score: Partial<Record<DomainKey, number>> = {}
  for (const v of VOTES) {
    const m = t.match(new RegExp(v.re.source, 'gi'))
    if (m && m.length) score[v.key] = (score[v.key] || 0) + v.w * Math.min(m.length, 4)
  }
  const ranked = (Object.entries(score) as [DomainKey, number][]).sort((a, b) => b[1] - a[1])
  if (!ranked.length) return []
  const top = ranked[0][1]
  // The second domain rides along when it has at least one clear word of its own and is not dwarfed.
  return ranked.filter(([, n], i) => i === 0 || (i < max && n >= 2 && n >= top / 3)).slice(0, max).map(([k]) => k)
}
