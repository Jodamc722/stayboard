// A GUEST'S NAME, AS A PERSON WOULD WRITE IT (inbox audit, 2026-11-09: the list read "MAR??A GABRIELA").
//
// WHERE THE "??" COMES FROM. Our own path is clean: lib/guesty reads Guesty's JSON as UTF-8 and
// stores `guest.fullName` untouched, Postgres is UTF-8, and nothing in the inbox re-encodes. The
// question marks are already in the payload — Expedia (and some Booking.com / Vrbo feeds) hand the
// name to Guesty in upper case with every accented letter replaced by one "?" per UTF-8 byte, so
// "MARÍA" arrives as "MAR??A". The letter is gone before we ever see it, so this cannot be a
// decoding fix; it is a repair, done at display time and never written back:
//
//   1. Real mojibake ("MarÃ­a" — UTF-8 read as Latin-1 somewhere upstream) is decoded properly.
//   2. A word with "?" holes is matched against the same guest's name from another source (the
//      reservation, the guest record, the name on their own messages) — the hole stands for one
//      accented letter, everything else must agree.
//   3. Failing that, against the accented given names and surnames we actually host (Spanish,
//      Portuguese, French). "MAR??A" can only be MARÍA.
//   4. A hole nothing explains is left exactly as it came. We do not guess a letter.
//
// And a name shouted in capitals ("MARÍA GABRIELA PEÑA") is set in normal case, because the reply
// box greets the guest with it.
//
// No 'server-only': the list, the thread and the composer all call this.

const HOLE = /\?\?|\?|�/g
const HAS_HOLE = /\?|�/

// Accented names seen in South Florida bookings. Matching is by shape, so only names that CONTAIN
// an accented letter belong here.
const ACCENTED = [
  'María', 'José', 'Jesús', 'Andrés', 'Ramón', 'Ángel', 'Ángela', 'Ángeles', 'Angélica', 'Mónica', 'Sofía', 'Lucía', 'Rocío', 'Inés', 'Nicolás',
  'Sebastián', 'Julián', 'Adrián', 'Hernán', 'Martín', 'Joaquín', 'Agustín', 'Víctor', 'Héctor', 'César', 'Raúl', 'Saúl', 'Belén', 'Verónica',
  'Bárbara', 'Débora', 'Fátima', 'Úrsula', 'Óscar', 'Álvaro', 'Félix', 'Tomás', 'Matías', 'Elías', 'Isaías', 'Jeremías', 'Simón', 'Germán', 'Fabián',
  'Cristián', 'Damián', 'Efraín', 'Valentín', 'Benjamín', 'Rubén', 'Moisés', 'Noé', 'André', 'Renée', 'René', 'Hélène', 'Eloísa',
  'Estefanía', 'Rosalía', 'Eugénia', 'Cecília', 'Patrícia', 'Letícia', 'Júlia', 'Júlio', 'Cláudia', 'Cláudio', 'Flávia', 'Flávio', 'Sílvia',
  'Lívia', 'Vitória', 'João', 'Conceição', 'Gonçalo', 'Gonçalves', 'Luís', 'Luísa', 'Mário', 'Sérgio', 'Érica', 'Érika',
  'Íris', 'Ítalo', 'Márcia', 'Márcio', 'Fábio', 'Fabrício', 'Maurício', 'Vinícius', 'Thaís', 'Taís', 'Anaís', 'Raíssa', 'Françoise', 'François',
  'Jérôme', 'Jérémie', 'Frédéric', 'Stéphane', 'Stéphanie', 'Amélie', 'Aurélie', 'Céline', 'Cécile', 'Léa', 'Léo', 'Théo', 'Noël', 
  'Björn', 'Jürgen', 'Günther', 'Günter', 'Søren', 'Jörg', 'Müller', 'Schröder', 'Köhler',
  'Peña', 'Muñoz', 'Núñez', 'Ibáñez', 'Yáñez', 'Castañeda', 'Zúñiga', 'Briceño', 'Cedeño', 'Treviño', 'Patiño', 'Londoño', 'Nariño', 'Quiñones',
  'Ordóñez', 'Avendaño', 'Bolaños', 'Montaño', 'Carreño', 'Acuña', 'Saldaña', 'Cañas', 'Niño', 'Toño', 'Begoña', 'Iñaki', 'Íñigo',
  'García', 'Martínez', 'Rodríguez', 'González', 'Hernández', 'López', 'Pérez', 'Sánchez', 'Ramírez', 'Gómez', 'Díaz', 'Álvarez', 'Jiménez',
  'Gutiérrez', 'Vázquez', 'Vásquez', 'Suárez', 'Domínguez', 'Fernández', 'Méndez', 'Guzmán', 'Velásquez', 'Velázquez', 'Chávez', 'Cháves', 'Córdoba',
  'Cortés', 'Garcés', 'Galván', 'Durán', 'Beltrán', 'Marín', 'Morán', 'León', 'Colón', 'Rincón', 'Pabón', 'Calderón', 'Barón', 'Cerón', 'Girón',
  'Mejía', 'Mejías', 'Macías', 'Farías', 'Frías', 'Rondón', 'Bolívar', 'Dávila', 'Ávila', 'Dávalos', 'Báez', 'Páez', 'Sáez',
  'Peláez', 'Narváez', 'Bermúdez', 'Benítez', 'Estévez', 'Márquez', 'Enríquez', 'Henríquez', 'Rodrígues', 'Simões', 'Guimarães', 'Magalhães',
  'Araújo', 'Assunção', 'Brandão', 'Leitão', 'Falcão', 'Galvão', 'Romão', 'Simão', 'Sebastião', 'Cristóbal', 'Mónaco', 'Solís', 'París', 'Valdés',
  'Avilés', 'Andújar', 'Aguiló', 'Miró', 'Maté', 'Bazán', 'Terán', 'Roldán', 'Millán', 'Pavón', 'Obregón', 'Alarcón', 'Chacón', 'Garzón', 'Tobón',
]

/** "MARÍA" → "MAR??A" and "MAR?A": the shapes a lossy feed leaves behind. */
const BY_SHAPE: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const n of ACCENTED) {
    const up = n.toLocaleUpperCase('es')
    const two = up.replace(/[^\x00-\x7F]/g, '??')
    const one = up.replace(/[^\x00-\x7F]/g, '?')
    // First writer wins: the list is ordered most-common first within a shape ("JOS??" is José).
    if (two !== up && !m[two]) m[two] = n
    if (one !== up && !m[one]) m[one] = n
  }
  return m
})()

/** UTF-8 that was read as Latin-1 / Windows-1252 ("MarÃ­a") back to what it was. Anything else is returned as given. */
function unMojibake(s: string): string {
  if (!/[Â-ô][\u0080-¿‘-›ŒœŠšŸŽžƒˆ˜€™]/.test(s)) return s
  // Windows-1252 puts printable characters where Latin-1 has C1 controls; map them back to bytes.
  const CP1252: Record<string, number> = {
    '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
    'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
    '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F,
  }
  const bytes: number[] = []
  for (const ch of Array.from(s)) {
    const cp = ch.codePointAt(0) as number
    if (cp <= 0xFF) bytes.push(cp)
    else if (CP1252[ch] != null) bytes.push(CP1252[ch])
    else return s   // a character Latin-1 could never have produced: this is not mojibake
  }
  try {
    const out = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
    return out && out !== s ? out : s
  } catch { return s }   // not valid UTF-8 underneath: leave it alone
}

const escapeRe = (s: string) => s.replace(/[.*+^${}()|[\]\\]/g, '\\$&')

/** One word with holes, repaired from the other spellings of this guest's name, then from the list. */
function fillWord(word: string, pool: string[]): string {
  if (!HAS_HOLE.test(word)) return word
  // Every hole is exactly one non-ASCII letter; the rest of the word must match.
  const re = new RegExp('^' + word.split(HOLE).map(escapeRe).join('[^\\x00-\\x7F?]') + '$', 'i')
  const hit = pool.find(w => !HAS_HOLE.test(w) && re.test(w))
  if (hit) return hit
  const known = BY_SHAPE[word.toLocaleUpperCase('es').replace(/�/g, '?')]
  return known || word
}

// Built with the constructor: the project compiles to ES5, where a /u literal is a type error.
const CAP_AT = new RegExp("(^|[-'’])(\\p{L})", 'gu')
const NOT_LETTER = new RegExp('[^\\p{L}]', 'gu')
const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'da', 'das', 'do', 'dos', 'di', 'van', 'von', 'der', 'den', 'y', 'e'])
function titleWord(w: string, first: boolean): string {
  const low = w.toLocaleLowerCase('es')
  if (!first && SMALL.has(low)) return low
  // Capital after the start, a hyphen or an apostrophe: "O'BRIEN" → "O'Brien", "ANA-MARÍA" → "Ana-María".
  return low.replace(CAP_AT, (_m: string, a: string, b: string) => a + b.toLocaleUpperCase('es'))
}

/**
 * The guest's name for display and for greeting them. `others` are the same person's name from
 * other sources (reservation, guest record, their own messages) — used only to fill "?" holes.
 * Returns '' for an empty name, so callers keep their own "Guest" fallback.
 */
export function cleanGuestName(name: string | null | undefined, ...others: (string | null | undefined)[]): string {
  let s = unMojibake(String(name ?? '')).normalize('NFC').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  // ALL CAPITALS → normal case. Decided before the holes are filled (a repaired word comes back in
  // normal case); a name with any lower-case letter was typed by a person and keeps its own case.
  const letters = s.replace(NOT_LETTER, '')
  const shout = letters.length >= 2 && s === s.toLocaleUpperCase('es') && s !== s.toLocaleLowerCase('es')
  if (HAS_HOLE.test(s)) {
    const pool = others.map(o => unMojibake(String(o ?? '')).normalize('NFC')).join(' ').split(/[\s,-]+/).filter(Boolean)
    // Words, with the spaces, commas and hyphens between them kept in place.
    s = s.split(/([\s,-]+)/).map(w => fillWord(w, pool)).join('')
  }
  if (shout) {
    let first = true
    s = s.split(/(\s+)/).map(w => {
      if (!w.trim()) return w
      const out = HAS_HOLE.test(w) ? w : titleWord(w, first)
      first = false
      return out
    }).join('')
  }
  return s
}

/** True when a name still carries a letter the channel destroyed — worth a hover saying so. */
export function nameIsDamaged(name: string | null | undefined): boolean {
  return HAS_HOLE.test(String(name ?? ''))
}
