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
  { key: 'ops', w: 2, re: /\b(clean|cleans|cleaning|cleaner|limpieza|limpiezas|limpiar|turnover|departure|checkout|check-?out|salida|inspection|inspections|inspecci[oó]n|task|tasks|tarea|tareas|breezeway|glitch|glitches|claim|claims|schedule|scheduled|scheduler|horario|assign|assigned|asignad[oa]|same-?day|mismo d[ií]a|maintenance|mantenimiento|repair|work order|late|behind|not started|in progress|who usually|how long does|minutes a clean|roster|upkeep|preventive|preventative|\bpm\b|pms|filter|filters|filtro|filtros|deep clean|coil|coils|mini-?split|batter(?:y|ies)|overdue|vencid[oa]s?|atrasad[oa]s?|blocked|block|blocks|bloquead[oa]s?|out of service|offline|vendor|vendors|proveedor|proveedores|contractor|contractors|checklist|checklists|post-?clean|failed items?|pass rate)\b/i },
  { key: 'money', w: 2, re: /\b(revenue|revpar|adr|occupancy|ocupaci[oó]n|payout|payouts|owner statement|statement|statements|invoice|invoices|billable|billing|margin|pacing|direct booking|direct bookings|\$\s?\d|dollars|pricing|rate|rates|nightly rate|how much did|how much is|ingresos|pago|pagos|factura|owner|owners|due[nñ]o|due[nñ]os|propietari[oa]s?|commission|net revenue|billed|bill to)\b/i },
  { key: 'quality', w: 2, re: /\b(review|reviews|rese[nñ]a|rese[nñ]as|rating|ratings|stars?|estrellas|health score|audit|audits|walk|walkthrough|sentiment|ff&e|ffe|project|projects|proyecto|complaint|complaints|queja|quejas)\b/i },
  { key: 'labor', w: 2, re: /\b(clocked|clock in|clock out|homebase|hours|horas|overtime|payroll|n[oó]mina|labor|labour|agency|crew scorecard|scorecard|cost per clean|per clean|productivity|who is working|who's working|qui[eé]n trabaja|on shift|shift|shifts|turno|turnos)\b/i },
  { key: 'guests', w: 2, re: /\b(guest|guests|hu[eé]sped|hu[eé]spedes|message|messages|mensaje|mensajes|thread|threads|inbox|reply|replied|unread|welcome call|welcome calls|post-?checkout call|calls?|phone|missed call|voicemail|talkroute|llamada|llamadas|reservation|reservations|reserva|reservas|booking|bookings|arrival|arrivals|llegada|llegadas|check-?in|checkin|stay|stays|refund|reembolso|airbnb|vrbo|expedia|booking\.com|guesty|comment|comments|history with us)\b/i },
  { key: 'slack', w: 2, re: /\b(slack|channel|channels|canal|#vr-[a-z0-9-]+|what did .* say|who said|dijo|thread in|posted in|conversation in)\b/i },
  { key: 'property', w: 2, re: /\b(house rules|arrival instructions|instrucciones|guidebook|guide book|gu[ií]a|faq|wifi|wi-fi|parking|estacionamiento|door code|c[oó]digo|lock|cerradura|amenit(y|ies)|what does .* have|what is in|inventory|inventario|building|buildings|edificio|address|direcci[oó]n|elevator|pool|gym|unit details|bedrooms|how many beds)\b/i },
  // The business brain (2026-11-10): upkeep decisions open ops (unit_health, repeat_failures,
  // upkeep_rank, upkeep_advise); owners and the brain's measures open money (measure, query, owner_360).
  { key: 'ops', w: 2, re: /\b(unit health|apartment health|health ranking|repeat (?:failures?|issues?|problems?|repairs?|breakdowns?)|failed again|keeps? (?:breaking|failing|leaking)|broke again|replace|replacing|replacement|reemplaz\w*|repair or replace|worth (?:fixing|repairing)|escalate to (?:the )?owner|hvac|a\/c|water heater|compressor|upkeep cost|costs? (?:the )?most to (?:maintain|keep up)|cost to (?:maintain|keep up)|most expensive to maintain|upkeep rank)\b/i },
  { key: 'money', w: 2, re: /\b(business brain|measure|owner 360|owner's units|by owner|per owner|available nights|owner nights|occupied nights|net accommodation|gross accommodation|cleaning revenue|yoy|year over year|vs last year|prior period)\b/i },
  { key: 'system', w: 2, re: /\b(automation|automations|cron|job|jobs|sync|synced|last run|is .* on|turned on|turned off|email went out|who got the email|share link|share links|approval|approvals|pending approval|health page|setting|settings|configuration|alert routing|routing|ai spend|ai cost|ai budget|ai bill|tokens|what did you cost|how much do you cost)\b/i },
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

// WHICH ALWAYS-ON TOOL A QUESTION SHOULD START WITH (owner, 2026-11-10: "Our guest access codes are
// frequently asked questions. Things in the area need to be a resource … needs to understand our
// handbook"). The place, access, area and handbook tools are core, so no drawer has to open for them;
// what goes wrong instead is the FIRST call — door_code_check for "how do guests get in", general
// knowledge for "what's our policy". This is a plain keyword match, run once before the first call,
// that adds at most two one-line hints to the turn. The model still chooses; door_code_check stays the
// only path to an actual code.
const HINTS: { key: string; re: RegExp; line: string }[] = [
  { key: 'access', re: /\b(door ?codes?|access codes?|entry codes?|gate codes?|lock ?box(?:es)?|key ?pads?|smart ?locks?|fobs?|key ?cards?|locked out|get (?:in|into|inside)|let (?:them|him|her|the guests?) in|how (?:do|does|can|will|would) (?:i|we|they|he|she|the guests?|guests?) (?:get|go) in(?:to|side)?|c[oó]digos?(?: de (?:la )?puerta)?|c[oó]mo (?:entran|entro|entrar))\b/i,
    line: 'ROUTE: an access question — call access_info first (arrival, entry steps, parking, lock type and where, who to call). A code itself comes only from door_code_check under its rules, and only if they actually need the code and you have that tool here.' },
  { key: 'policy', re: /\b(handbook|employee manual|polic(?:y|ies)|our rules?|sop|procedures?|dress code|uniforms?|time off|pto|vacation days?|sick days?|call(?:ing)? out|how do we (?:handle|deal with|do|process|treat|charge|bill|respond|manage)|what do we do (?:when|if)|are we allowed|is it allowed|what'?s the rule)\b/i,
    line: 'ROUTE: a handbook / policy question — doc_search first. If the documents do not answer it, say "that isn\'t in the handbook yet" (doc_search logs it; log_gap=true when passages came back but none answers) and do not fill it from general knowledge.' },
  { key: 'area', re: /\b(near(?:by)?|close to|around (?:the )?(?:unit|building|there|here)|in the area|walking distance|restaurants?|places to eat|where to eat|beach(?:es)?|grocer(?:y|ies)|supermarket|pharmac(?:y|ies)|hospitals?|urgent care|things to do|attractions?|nightlife|bars? near|transit|train station|brightline|tri-?rail|cerca|restaurantes?|playa)\b/i,
    line: 'ROUTE: a things-in-the-area question — area_guide first (the building guidebooks and measured area facts). If nothing is stored, say so and offer web_search; never name a place from memory.' },
  { key: 'card', re: /\b(how many (?:bedrooms|bathrooms|beds|guests)|sleeps|max(?:imum)? (?:guests|occupancy)|bedrooms?|bathrooms?|address of|what(?:'s| is) the address|check-?in time|check-?out time|what time is check|wi-?fi|parking|who owns|owner of|who cleans|cleaning vendor|guidebook link|in breezeway)\b/i,
    line: 'ROUTE: a unit or building fact — property_card first (one call, each fact with its source).' },
  { key: 'owner', re: /\b(owner'?s?|owners|due[nñ]os?|propietari[oa]s?)\b[^.?!]{0,60}\b(make|made|earn(?:ed|s)?|revenue|net|payout|gross|do(?:ing)?|perform\w*)\b|\bwhich owners?\b|\b\w+'s (?:units|properties|apartments|condos|portfolio)\b[^.?!]{0,40}\b(?:make|made|earn\w*|revenue|gross|net|do(?:ing)?)\b/i,
    line: 'ROUTE: an owner / revenue question — owner_360 for one owner, measure (by owner) to compare; open the money drawer. Dollar amounts follow money access.' },
]

/** One-line routing hints for the first call, at most two, strongest (listed first) first. */
export function firstToolHints(text: string, max = 2): string[] {
  const t = String(text || '').slice(0, 1200)
  if (!t.trim()) return []
  return HINTS.filter(h => h.re.test(t)).slice(0, max).map(h => h.line)
}
