// DESIGNED PRESETS FOR THE CALENDAR'S MOMENTS.
//
// Jon, 2026-11-10: "if it's to owners it needs to be built for owners, not arbitrary — the preset designs need to be
// full thought-out designs, not just random" · "you're regurgitating all the same designs, all the same info. Get
// much more creative with your ads, your verbiage, and your language. Need a wide range of talking points for each ad
// type … Art Basel, Christmas, and New Year's. Give us more options, built into those pre-templated designs" · "the
// 40 channels should show the different channels".
//
// So a moment is no longer one template. It is a set of ANGLES — each a different idea with its own words, its own
// scene designs, its own photos and its own poster style — and the studio offers them side by side before building.
//
//  · OWNER angles argue the way an owner thinks: how the money is made (priced every day, the big dates captured months
//    ahead), where the listing sells (the channels shown by name, never just "40+"), who looks after the unit — and end
//    on Nick's card. No fee or revenue figures (HOUSE_FACTS).
//  · GUEST angles sell the stay for the moment: no prices, no "party", end on a Book card dressed for the season.
//
// Graphics: the moment's full set (trees, string lights) goes on the opening poster only; the scenes after it keep just
// the atmosphere (snow, leaves, sparkle), so nothing piles up on the Book button.
//
// Client-safe. Each scene names the photo it wants (q); the studio fills it from our library — our buildings in the
// moment's area first, never the same photo twice.
import type { AdKind } from './ad-engine'
import type { Moment } from './marketing-calendar'

export type PresetScene = { kind: AdKind; head: string; sub: string; items: string[]; q: string; n?: number; dur: number; fx?: string[]; eyebrow?: string; tr?: 'fade' | 'crosszoom' | 'push' | 'leak' | 'dip' | 'slide' | 'whip' | 'iris' }
export type Angle = { key: string; name: string; pitch: string; post: PresetScene[]; flyer: PresetScene
  /** An owner angle inside a moment that is mostly for guests (boat shows, F1…) — the piece is built for owners. */
  audience?: 'owners' | 'guests' }

const NICK = 'Talk to Nick · 651-200-8283'
const BOOK = 'Book at stay-hospitality.com'
/** The channels, by name (HOUSE_FACTS) — the hub draws stay-hospitality.com last, in the accent. */
const CHANNELS = ['Airbnb', 'Vrbo', 'Booking.com', 'Expedia', 'Marriott', 'Blueground', 'stay-hospitality.com']
const AMBIENT = ['snow', 'leaves', 'sparkle', 'bokeh', 'hearts', 'confetti', 'rays', 'waves', 'scan', 'grid', 'frame', 'corners']
/** The moment's graphics a later scene keeps: atmosphere only, never a tree or a string of lights. */
const amb = (fx?: string[]) => (fx || []).filter(k => AMBIENT.indexOf(k) >= 0)

// ── scene makers, so each angle reads as a design rather than a list of fields ──
const poster = (head: string, sub: string, row1: string, button: string, style: string, q: string, fx?: string[]): PresetScene => ({ kind: 'poster', head, sub, items: [row1, button, style], q, dur: 3.8, fx })
const hub = (head: string, sub = 'One calendar, every channel, no double bookings'): PresetScene => ({ kind: 'hub', head, sub, eyebrow: 'Your listing', items: CHANNELS, q: 'living room', dur: 4.2, tr: 'crosszoom' })
const nick = (q = 'building exterior'): PresetScene => ({ kind: 'contact', head: 'Talk to **Nick.**', sub: '', items: [], q, dur: 3.8, tr: 'fade' })
const book = (head: string, sub: string, q: string, fx?: string[], button = BOOK): PresetScene => ({ kind: 'cta', head, sub, items: [button], q, dur: 3.8, fx, tr: 'fade' })

// ── ANGLE BUILDERS (Jon, 2026-11-10: "need this for all events, not just Christmas"). Each is a different shape of ad —
// the classic three reasons, a kinetic hook, a polaroid and three beats, a cinematic montage, a day-by-day plan, a
// one-word mask — so two angles for the same event never look or read alike. The words are always the event's own.
type G = { m: Moment; when: string; F: string[]; Am: string[] }
const aClassic = (g: G, key: string, name: string, pitch: string, head: string, sub: string, rowsHead: string, rows: string[], cta: string, q: [string, string, string], style = ''): Angle => ({ key, name, pitch, post: [
  poster(head, sub, g.when, '', style, q[0], g.F),
  { kind: 'callouts', head: rowsHead, sub: '', items: rows, q: q[1], dur: 3.8, fx: g.Am, tr: 'crosszoom' },
  book(cta, g.when, q[2], g.Am)],
  flyer: poster(head, sub, g.when, BOOK, style, q[0], g.F) })
const aKinetic = (g: G, key: string, name: string, pitch: string, hook: string, beats: string, cta: string, flyerHead: string, flyerSub: string, q: [string, string, string]): Angle => ({ key, name, pitch, post: [
  { kind: 'kinetic', head: hook, sub: '', items: [], q: q[0], dur: 3, fx: g.Am },
  { kind: 'beats', head: beats, sub: '', items: [], q: q[1], dur: 4.2, fx: g.Am, tr: 'whip' },
  book(cta, g.when, q[2], g.Am)],
  flyer: poster(flyerHead, flyerSub, g.when, BOOK, 'band', q[1], g.F) })
const aBeats = (g: G, key: string, name: string, pitch: string, head: string, polaroidSub: string, cards: string[], cta: string, flyerHead: string, flyerSub: string, q: [string, string, string]): Angle => ({ key, name, pitch, post: [
  { kind: 'polaroid', head, sub: polaroidSub, items: [], q: q[0], dur: 3.6, fx: g.F },
  { kind: 'cards', head: '', sub: '', items: cards, q: q[1], n: 3, dur: 5, fx: g.Am, tr: 'push' },
  book(cta, g.when, q[2], g.Am)],
  flyer: poster(flyerHead, flyerSub, g.when, BOOK, 'gallery', q[0], g.F) })
const aCinema = (g: G, key: string, name: string, pitch: string, head: string, place: string, wallHead: string, cta: string, flyerSub: string, q: [string, string, string]): Angle => ({ key, name, pitch, post: [
  { kind: 'cinema', head, sub: place, items: [], q: q[0], dur: 4, fx: g.F },
  { kind: 'wall', head: wallHead, sub: '', items: [], q: q[1], n: 3, dur: 4, fx: g.Am, tr: 'leak' },
  book(cta, g.when, q[2], g.Am)],
  flyer: poster(head, flyerSub, g.when, BOOK, 'dark', q[0], g.F) })
const aPlan = (g: G, key: string, name: string, pitch: string, eventHead: string, date: string, planHead: string, rows: string[], cta: string, flyerHead: string, flyerSub: string, q: [string, string, string]): Angle => ({ key, name, pitch, post: [
  { kind: 'event', head: eventHead, sub: '', items: [date], q: q[0], dur: 3.4, fx: g.F },
  { kind: 'timeline', head: planHead, sub: '', items: rows, q: q[1], dur: 4.6, fx: g.Am, tr: 'crosszoom' },
  book(cta, g.when, q[2], g.Am)],
  flyer: poster(flyerHead, flyerSub, g.when, BOOK, 'band', q[0], g.F) })
const aMask = (g: G, key: string, name: string, pitch: string, word: string, head: string, sub: string, cta: string, flyerHead: string, q: [string, string, string]): Angle => ({ key, name, pitch, post: [
  { kind: 'mask', head: word, sub: '', items: [], q: q[0], dur: 3, fx: g.Am },
  { kind: 'title', head, sub, items: [], q: q[1], dur: 3.6, fx: g.Am, tr: 'iris' },
  book(cta, g.when, q[2], g.Am)],
  flyer: poster(flyerHead, sub, g.when, BOOK, 'dark', q[1], g.F) })
/** The owner side of a big guest event: the date is priced early, the listing is on every channel, Nick. */
const aOwner = (g: G, event: string, date: string, hook: string): Angle => ({ key: 'owners', audience: 'owners', name: 'For owners: ' + event, pitch: 'Owner piece — what the event means for their unit', post: [
  { kind: 'event', head: hook, sub: '', items: [date], q: 'building exterior', dur: 3.4, fx: g.F },
  { kind: 'checks', head: 'Ready **before the rush**', sub: 'What we have done by now', items: [event + ' priced months ahead', 'Minimum stays tuned for the week', 'Live on every channel', 'Cleaned and inspected before arrival'], q: 'living room', dur: 4, tr: 'crosszoom' },
  hub('Seen by **everyone coming.**'),
  nick()],
  flyer: poster(hook, 'We price the big dates months ahead — and review them every day', 'Priced daily · 40+ channels · in-house team', NICK, 'band', 'building exterior', g.F) })

/** Angles for every other event on the calendar. */
function eventAngles(m: Moment, when: string): Angle[] | null {
  const g: G = { m, when, F: m.fx || [], Am: amb(m.fx) }
  switch (m.key) {
    case 'thanksgiving': return [
      aClassic(g, 'water', 'Thanksgiving by the water', 'The table, the family, the beach after', 'Thanksgiving, **by the water.**', m.sub, 'This year, **host it here.**', ['A full kitchen for the big dinner', 'Room for everyone', 'The beach after'], 'Book **Thanksgiving.**', ['dining table', 'kitchen', 'beach'], 'dark'),
      aBeats(g, 'table', 'A table for everyone', 'For the family that never fits in one house', 'A table for **everyone.**', 'Room for all of you', ['Thursday|Dinner at your own table', 'Friday|The beach, all day', 'Saturday|Leftovers by the pool'], 'Book **the long weekend.**', 'This year, **everyone fits.**', 'Full apartments with kitchens and room for the whole family', ['dining table', 'living room', 'pool']),
      aKinetic(g, 'cold', 'Skip the cold', 'For families stuck with grey skies up north', 'Skip **the cold.**', 'Turkey at noon.\nPool by **three.**\nSunset by six.', 'Thanksgiving, **somewhere warm.**', 'Thanksgiving, **without the coat.**', 'Warm days and a full kitchen in South Florida', ['pool', 'balcony view', 'ocean view']),
      aMask(g, 'grateful', 'Grateful for the view', 'Warm, simple, very shareable', 'THANKS.', 'Grateful **for the view.**', 'A long weekend by the water', 'Book **Thanksgiving.**', 'Grateful **for the view.**', ['ocean view', 'balcony view', 'kitchen']),
    ]
    case 'winter-sun': return [
      aClassic(g, 'escape', 'Escape winter', 'The temperature does the selling', 'Escape **winter.**', m.sub, 'Winter, **cancelled.**', ['78° in January', 'The pool every morning', 'Weeks, not nights'], 'Escape **winter.**', ['pool', 'balcony view', 'ocean view'], 'dark'),
      aKinetic(g, 'shovel', 'Put down the shovel', 'Straight at the snowbirds', 'Put down **the shovel.**', 'Pack light.\nStay long.\nIt’s **78° here.**', 'Winter, **somewhere warm.**', 'Put down the shovel. **Pick up the sunscreen.**', 'December to March in South Florida', ['beach', 'pool', 'ocean view']),
      aBeats(g, 'month', 'A month in the sun', 'Long stays — work from the balcony', 'A month **in the sun.**', 'Stay as long as you like', ['Mornings|Coffee on the balcony', 'Afternoons|Work from the pool deck', 'Evenings|Sunset over the water'], 'Book **a longer stay.**', 'Stay a week. **Or the whole winter.**', 'Full apartments with kitchens and fast Wi-Fi', ['balcony view', 'living room', 'pool']),
      aCinema(g, 'light', 'The winter light', 'Cinematic — golden afternoons in January', 'The best light **is in January.**', 'South Florida', 'Warm days. **Long evenings.**', 'Book **winter sun.**', 'Stays from Miami to Palm Beach', ['ocean view', 'pool', 'balcony view']),
    ]
    case 'mlk': return [
      aClassic(g, 'sun', 'Three days in the sun', 'The long weekend, simple and warm', 'Three days **in the sun.**', m.sub, 'One long **weekend.**', ['Three days in the sun', 'The pool on Monday', 'Easy for the whole family'], 'Book **the weekend.**', ['pool', 'living room', 'balcony view'], 'dark'),
      aKinetic(g, 'monday', 'Monday off, by the pool', 'Built on the extra day', 'Monday **off.**', 'Friday flight.\nSaturday beach.\nMonday **pool.**', 'Make it **a long one.**', 'Three days. **One extra.**', 'Long-weekend stays across South Florida', ['pool', 'beach', 'ocean view']),
      aBeats(g, 'family', 'The family long weekend', 'Room for everyone, three easy days', 'The family **long weekend.**', 'Room for everyone', ['Saturday|The beach', 'Sunday|The pool', 'Monday|Brunch at home'], 'Book **the weekend.**', 'Room for the whole family **this long weekend.**', 'Full apartments with kitchens', ['living room', 'pool', 'kitchen']),
    ]
    case 'marathon': return [
      aClassic(g, 'recover', 'Run Miami. Recover here.', 'Close to the start, built for recovery', 'Run Miami. **Recover here.**', m.sub, 'Race weekend, **sorted.**', ['Close to the start line', 'A real bed the night before', 'A kitchen to refuel'], 'Book **race weekend.**', ['city view', 'bedroom', 'kitchen'], 'dark'),
      aKinetic(g, 'miles', '26.2 miles. Then the pool.', 'Energy for runners', '26.2 **miles.**', 'Carb up.\nRun it.\nThen **the pool.**', 'Book **race weekend.**', '26.2 miles. **Then the pool.**', 'Downtown stays near the start', ['city view', 'pool', 'bedroom']),
      aPlan(g, 'plan', 'Race weekend, planned', 'Day by day for the runner and their crew', 'Miami **Marathon**', 'FEB', 'Your race weekend', ['Friday|Pick up your bib', 'Saturday|Pasta at home', 'Sunday|Run Miami', 'After|The pool, legs up'], 'Book **race weekend.**', 'Race weekend, **planned.**', 'Stays close to the start line', ['city view', 'kitchen', 'pool']),
    ]
    case 'boat-show-miami': return [
      aClassic(g, 'water', 'Boat show week, on the water', 'Close to the docks, water views', 'Boat show week, **on the water.**', m.sub, 'Show week, **sorted.**', ['Close to the docks', 'Water views', 'Room for the crew'], 'Book **boat show week.**', ['water view', 'balcony view', 'living room'], 'band'),
      aBeats(g, 'crew', 'Room for the whole crew', 'For buyers, brokers and crews travelling together', 'Room for **the whole crew.**', 'Close to the docks', ['Morning|Coffee with a water view', 'Show days|Minutes to the docks', 'Night|Dinner at your own table'], 'Book **for the crew.**', 'Bring the crew. **Skip the hotel.**', 'Full apartments close to the show', ['living room', 'water view', 'kitchen']),
      aCinema(g, 'dock', 'From the dock to the balcony', 'Cinematic — boats by day, the bay by night', 'From the docks **to your balcony.**', 'Miami', 'Boats by day. **The bay by night.**', 'Book **boat show week.**', 'Water-view stays for boat show week', ['water view', 'balcony view', 'city view night']),
      aOwner(g, 'the boat show', 'FEB 10–14', 'Boat show week is **already priced.**'),
    ]
    case 'valentines': return [
      aClassic(g, 'two', 'A weekend for two', 'Sunsets, rooftops, the beach', 'A weekend **for two.**', m.sub, 'Just the **two of you.**', ['Sunsets from the balcony', 'A rooftop for two', 'No one else’s schedule'], 'Book **for two.**', ['balcony sunset', 'bedroom', 'rooftop'], 'dark'),
      aMask(g, 'love', 'Love, with a view', 'A single word, then the feeling', 'LOVE.', 'Love, **with a view.**', 'Valentine’s weekend in South Florida', 'Book **for two.**', 'Love, **with a view.**', ['balcony sunset', 'ocean view', 'bedroom']),
      aCinema(g, 'sunset', 'Sunset, just us', 'Cinematic and romantic', 'Sunset. **Just us.**', 'South Florida', 'Slow mornings. **Long sunsets.**', 'Book **Valentine’s.**', 'A weekend away for two', ['balcony sunset', 'bedroom', 'rooftop']),
      aBeats(g, 'plan', 'The weekend, planned for two', 'Three moments they will picture', 'Plans **for two.**', 'Feb 12–14', ['Friday|Sunset on the roof', 'Saturday|The beach, then dinner', 'Sunday|Breakfast in bed'], 'Book **the weekend.**', 'Three days. **Two of you.**', 'Stays with views worth sharing', ['balcony sunset', 'beach', 'bedroom']),
    ]
    case 'sobewff': return [
      aClassic(g, 'eat', 'Eat your way through Miami', 'Steps from the tents', 'Eat your way **through Miami.**', m.sub, 'Festival weekend, **your way.**', ['Steps from the tents', 'A kitchen of your own', 'The beach in between'], 'Book **festival weekend.**', ['beach', 'kitchen', 'ocean view'], 'gallery'),
      aKinetic(g, 'taste', 'Taste it all, walk home', 'Location — no driving after the tastings', 'Taste **it all.**', 'Taste it all.\nWalk **home.**\nRepeat tomorrow.', 'Book **festival weekend.**', 'Taste it all. **Walk home.**', 'Stays steps from the festival', ['beach', 'living room', 'ocean view']),
      aBeats(g, 'menu', 'A weekend on the menu', 'Food-first, three moments', 'A weekend **on the menu.**', 'South Beach', ['Friday|The tents open', 'Saturday|Brunch on the balcony', 'Sunday|One more tasting'], 'Book **the weekend.**', 'The weekend **is on the menu.**', 'South Beach stays for the festival', ['kitchen', 'balcony view', 'beach']),
    ]
    case 'spring-break': return [
      aClassic(g, 'right', 'Spring break, done right', 'The pool, the beach, the city', 'Spring break, **done right.**', m.sub, 'All of it, **your way.**', ['The pool all day', 'Room for your group', 'The beach close by'], 'Book **spring break.**', ['pool', 'living room', 'beach'], 'neon'),
      aKinetic(g, 'out', 'Out of office', 'Pure energy, made for Reels', 'Out of **office.**', 'Pool by ten.\nBeach by two.\nCity **by night.**', 'Book **spring break.**', 'Out of office. **Into the sun.**', 'March in South Florida', ['pool', 'beach', 'city view night']),
      aBeats(g, 'group', 'Room for the group', 'Friends travelling together', 'Room for **the group.**', 'Everyone in one place', ['Bedrooms|For everyone', 'The kitchen|For mornings after', 'The pool|All day'], 'Book **for the group.**', 'One place. **Everyone in.**', 'Full apartments for groups', ['living room', 'kitchen', 'pool']),
    ]
    case 'miami-open': return [
      aClassic(g, 'match', 'Match point in Miami', 'Easy to the stadium, a pool between matches', 'Match point **in Miami.**', m.sub, 'Tournament week, **sorted.**', ['Easy to the stadium', 'A pool between matches', 'Room to spread out'], 'Book **match week.**', ['pool', 'living room', 'balcony view'], 'dark'),
      aKinetic(g, 'game', 'Game, set, pool', 'Playful — tennis words, holiday feeling', 'Game. **Set.**', 'Game.\nSet.\n**Pool.**', 'Book **match week.**', 'Game. Set. **Pool.**', 'Stays for the Miami Open', ['pool', 'pool', 'balcony view']),
      aPlan(g, 'plan', 'Tournament week, planned', 'Days at the matches, evenings at home', 'Miami **Open**', 'MAR 14–28', 'Your week, planned', ['Day|Courtside', 'Afternoon|The pool', 'Evening|Dinner at home', 'Finals|The big match'], 'Book **match week.**', 'Two weeks of tennis. **One place to stay.**', 'Stays for the Miami Open', ['city view', 'pool', 'living room']),
    ]
    case 'ultra': return [
      aClassic(g, 'downtown', 'Stay downtown, walk to the gates', 'Location first', 'Ultra weekend. **Stay downtown.**', m.sub, 'Ultra, **sorted.**', ['Walk to the gates', 'A rooftop before the gates open', 'Room for the whole crew'], 'Book **Ultra weekend.**', ['city view night', 'rooftop', 'living room'], 'neon'),
      aKinetic(g, 'walk', 'No cab, no queue', 'High energy — the walk to the gates', 'Walk **to the gates.**', 'No cab.\nNo queue.\n**Just walk.**', 'Book **Ultra weekend.**', 'No cab. No queue. **Just walk.**', 'Downtown stays for Ultra', ['city view night', 'city view', 'rooftop']),
      aBeats(g, 'crew', 'Room for the whole crew', 'Groups travelling together', 'Bring **the crew.**', 'Room for everyone', ['Before|The rooftop', 'Ultra|Walk to the gates', 'After|A real bed'], 'Book **for the crew.**', 'Three days of Ultra. **One place for the crew.**', 'Full apartments downtown', ['living room', 'rooftop', 'bedroom']),
    ]
    case 'easter': return [
      aClassic(g, 'sea', 'Easter by the sea', 'Family stays, a long weekend', 'Easter **by the sea.**', m.sub, 'A long weekend, **together.**', ['Room for the whole family', 'A kitchen for Easter brunch', 'The sea close by'], 'Book **Easter.**', ['ocean view', 'kitchen', 'beach'], 'gallery'),
      aBeats(g, 'brunch', 'Easter brunch at home', 'The meal as the memory', 'Brunch **at home.**', 'A kitchen for everyone', ['Friday|Fly in', 'Sunday|Easter brunch at your own table', 'Monday|One more beach day'], 'Book **Easter.**', 'Easter brunch, **with a view.**', 'Family stays with full kitchens', ['kitchen', 'dining table', 'beach']),
      aCinema(g, 'spring', 'Spring, by the water', 'Cinematic and calm', 'Spring, **by the water.**', 'South Florida', 'Long days. **Warm sea.**', 'Book **Easter.**', 'Easter weekend stays', ['ocean view', 'beach', 'pool']),
    ]
    case 'f1': return [
      aClassic(g, 'race', 'Race week, Miami', 'The city at full speed', 'Race week, **Miami.**', m.sub, 'Race week, **sorted.**', ['Race week in Miami', 'A rooftop to watch the city', 'Room for the crew'], 'Book **race week.**', ['city view', 'rooftop', 'living room'], 'neon'),
      aKinetic(g, 'lights', 'Lights out', 'Race-start energy', 'Lights **out.**', 'Lights out.\n**Race week.**\nStay close.', 'Book **race week.**', 'Lights out. **Stay close.**', 'Race-week stays in Miami', ['city view night', 'city view', 'rooftop']),
      aPlan(g, 'plan', 'Race weekend, planned', 'Practice, qualifying, race day', 'Miami **Grand Prix**', 'MAY', 'Your race weekend', ['Friday|Practice', 'Saturday|Qualifying', 'Sunday|Race day', 'Every night|The rooftop'], 'Book **race weekend.**', 'Three days. **Full throttle.**', 'Stays for race week', ['city view', 'rooftop', 'living room']),
      aOwner(g, 'race week', 'MAY', 'Race week is **already priced.**'),
    ]
    case 'memorial': return [
      aClassic(g, 'summer', 'Summer starts here', 'The first long weekend of summer', 'Summer **starts here.**', m.sub, 'The first **long weekend.**', ['Summer starts here', 'The pool all weekend', 'Room for everyone'], 'Book **the long weekend.**', ['pool', 'living room', 'balcony'], 'dark'),
      aKinetic(g, 'first', 'First pool day of summer', 'Short and loud', 'Summer’s **here.**', 'Pool.\nBeach.\n**Repeat.**', 'Book **the long weekend.**', 'Pool. Beach. **Repeat.**', 'Memorial Day weekend stays', ['pool', 'beach', 'ocean view']),
      aBeats(g, 'family', 'Three days, everyone together', 'Families and friends', 'Everyone, **one place.**', 'Room for all of you', ['Saturday|The beach', 'Sunday|A long lunch at home', 'Monday|One last swim'], 'Book **the weekend.**', 'Three days. **Everyone together.**', 'Full apartments for the long weekend', ['living room', 'kitchen', 'pool']),
    ]
    case 'july4': return [
      aClassic(g, 'bay', 'Fireworks over the bay', 'Waterfront stays for the Fourth', 'Fireworks **over the bay.**', m.sub, 'The Fourth, **on the water.**', ['Fireworks over the bay', 'Waterfront stays', 'Room for the whole family'], 'Book **the Fourth.**', ['water view night', 'balcony view', 'living room'], 'band'),
      aMask(g, 'boom', 'The best seat for the fireworks', 'One word, then the view', 'BOOM.', 'The best seat **for the fireworks.**', 'Waterfront stays for July 4', 'Book **the Fourth.**', 'The best seat **for the fireworks.**', ['city view night', 'balcony view', 'pool']),
      aBeats(g, 'day', 'The whole Fourth, planned', 'Beach, grill, fireworks', 'The Fourth, **all day.**', 'Room for everyone', ['Morning|The beach', 'Afternoon|Lunch at home', 'Night|Fireworks from the balcony'], 'Book **the Fourth.**', 'Beach by day. **Fireworks by night.**', 'Waterfront stays for the Fourth', ['beach', 'kitchen', 'balcony view']),
    ]
    case 'labor': return [
      aClassic(g, 'one-more', 'One more summer weekend', 'The last long weekend of summer', 'One more **summer weekend.**', m.sub, 'Before the **school run.**', ['One more pool day', 'Room to spread out', 'The beach close by'], 'Book **the weekend.**', ['pool', 'living room', 'beach'], 'dark'),
      aKinetic(g, 'last', 'Last call for summer', 'Urgency, warmly', 'Last call **for summer.**', 'One more swim.\nOne more sunset.\n**One more weekend.**', 'Book **the weekend.**', 'Last call **for summer.**', 'Labor Day weekend stays', ['pool', 'balcony sunset', 'ocean view']),
      aCinema(g, 'golden', 'Summer’s golden ending', 'Cinematic sunsets', 'Summer’s **golden ending.**', 'South Florida', 'Long swims. **Late sunsets.**', 'Book **Labor Day.**', 'The last long weekend of summer', ['balcony sunset', 'pool', 'beach']),
    ]
    case 'flibs': return [
      aClassic(g, 'marina', 'Boat show week, Fort Lauderdale', 'Stays by the marina', 'Boat show week, **Fort Lauderdale.**', m.sub, 'Show week, **sorted.**', ['Close to the marinas', 'Water views', 'Room for the crew'], 'Book **boat show week.**', ['water view', 'balcony view', 'living room'], 'band'),
      aBeats(g, 'crew', 'Room for the whole crew', 'Brokers, buyers and crews', 'Room for **the whole crew.**', 'By the marinas', ['Morning|Coffee by the water', 'Show days|Minutes to the docks', 'Night|Dinner at your own table'], 'Book **for the crew.**', 'Bring the crew. **Skip the hotel.**', 'Full apartments by the marinas', ['living room', 'water view', 'kitchen']),
      aCinema(g, 'venice', 'The Venice of America', 'Cinematic Fort Lauderdale', 'Boat show week **in the Venice of America.**', 'Fort Lauderdale', 'Canals by day. **Sunsets by night.**', 'Book **boat show week.**', 'Stays by the water in Fort Lauderdale', ['water view', 'balcony sunset', 'pool']),
      aOwner(g, 'the boat show', 'OCT', 'Boat show week is **already priced.**'),
    ]
    case 'halloween': return [
      aClassic(g, 'city', 'Halloween in the city', 'A weekend of nights out', 'Halloween **in the city.**', m.sub, 'One spooky **weekend.**', ['A night in the city', 'Room to get ready', 'No drive home'], 'Book **the weekend.**', ['city view night', 'living room', 'bedroom'], 'neon'),
      aKinetic(g, 'trick', 'Treat yourself', 'Playful — trick or treat', 'Trick **or stay?**', 'Costumes on.\nCity lights.\n**Treat yourself.**', 'Book **the weekend.**', 'Trick or treat? **Treat yourself.**', 'Halloween weekend stays', ['city view night', 'city view night', 'living room']),
      aMask(g, 'boo', 'Boo', 'One word, made for Stories', 'BOO.', 'Halloween **in Miami.**', 'Oct 29–31', 'Book **the weekend.**', 'Halloween **in Miami.**', ['city view night', 'city view night', 'bedroom']),
    ]
    case 'christmas': case 'basel': return null
  }
  return null
}

/** Hand-written angles, by moment. Every claim is a house fact; every guest line is a feeling, not a promise. */
function angles(m: Moment, when: string): Angle[] | null {
  const F = m.fx || [], Am = amb(m.fx)
  switch (m.key) {
    // ─────────────────────────────── CHRISTMAS (guests) ───────────────────────────────
    case 'christmas': return [
      { key: 'sun', name: 'Christmas in the sun', pitch: 'Warm days, lit-up nights — the classic', post: [
        poster('Christmas in **the sun.**', 'Pool mornings, warm nights, the whole family in one place', when, '', 'dark', 'pool', F),
        { kind: 'callouts', head: 'This year, **it’s warm.**', sub: '', items: ['Pool mornings in December', 'Room for the whole family', 'A full kitchen for Christmas dinner'], q: 'balcony view', dur: 3.8, fx: Am, tr: 'crosszoom' },
        book('Book **Christmas.**', when, 'ocean view', Am)],
        flyer: poster('Christmas in **the sun.**', 'Pool mornings, warm nights, the whole family in one place', when, BOOK, 'dark', 'pool', F) },
      { key: 'snow', name: 'Swap the snow', pitch: 'For everyone shovelling a driveway right now', post: [
        { kind: 'kinetic', head: 'Swap the **snow.**', sub: '', items: [], q: 'pool', dur: 3, fx: Am },
        { kind: 'beats', head: 'Leave the coat.\nPack the **swimsuit.**\nIt’s 78° here.', sub: '', items: [], q: 'beach', dur: 4.2, fx: Am, tr: 'whip' },
        book('Christmas, **78° and sunny.**', when, 'ocean view balcony', Am)],
        flyer: poster('Swap the snow for **the sun.**', 'Christmas in South Florida — pool mornings, beach afternoons', when, BOOK, 'band', 'beach', F) },
      { key: 'family', name: 'Everyone under one roof', pitch: 'For the family that never fits in one hotel room', post: [
        { kind: 'polaroid', head: 'Everyone **under one roof.**', sub: 'Room for everyone', items: [], q: 'living room', dur: 3.8, fx: Am },
        { kind: 'cards', head: '', sub: '', items: ['Christmas Eve|Dinner at your own table', 'Christmas morning|Coffee on the balcony', 'Boxing Day|The beach, all day'], q: 'dining table', n: 3, dur: 5, fx: Am, tr: 'push' },
        book('Book **the family Christmas.**', when, 'pool', Am)],
        flyer: poster('Everyone, **one place.**', 'Bedrooms for all of you and a table big enough for Christmas dinner', when, BOOK, 'gallery', 'dining table', F) },
      { key: 'morning', name: 'Christmas morning, by the pool', pitch: 'Cinematic — the feeling of the day itself', post: [
        { kind: 'cinema', head: 'Christmas morning, **by the pool.**', sub: 'South Florida', items: [], q: 'pool morning', dur: 4, fx: F },
        { kind: 'wall', head: 'Warm days. **Lit-up nights.**', sub: '', items: [], q: 'city view night', n: 3, dur: 4, fx: Am, tr: 'leak' },
        book('Your Christmas, **somewhere warm.**', when, 'balcony view', Am)],
        flyer: poster('Christmas morning, **by the pool.**', 'Stays across Miami and Fort Lauderdale', when, BOOK, 'dark', 'pool morning', F) },
      { key: 'countdown', name: 'The perfect Christmas week', pitch: 'A day-by-day plan they can picture', post: [
        { kind: 'event', head: 'Christmas **in Miami**', sub: '', items: ['DEC 25'], q: 'city view', dur: 3.4, fx: F },
        { kind: 'timeline', head: 'Your week, **planned**', sub: '', items: ['Dec 20|Fly in, drop the bags', 'Dec 24|Dinner with a view', 'Dec 25|Presents by the pool', 'Dec 26|A whole beach day'], q: 'living room', dur: 4.6, fx: Am, tr: 'crosszoom' },
        book('Book **the week.**', when, 'ocean view', Am)],
        flyer: poster('Five days. **Zero snow.**', 'Christmas week in South Florida', when, BOOK, 'band', 'city view', F) },
      { key: 'gift', name: 'Give them the sun', pitch: 'The stay as the present — for gift shoppers', post: [
        { kind: 'mask', head: 'GIFT **SUN.**', sub: '', items: [], q: 'beach', dur: 3, fx: Am },
        { kind: 'title', head: 'Give them **South Florida.**', sub: 'A stay they will talk about all year', items: [], q: 'balcony view', dur: 3.6, fx: Am, tr: 'iris' },
        book('Book **the gift.**', 'Stays from Miami to Palm Beach', 'pool', Am)],
        flyer: poster('The best gift **isn’t under the tree.**', 'Give a South Florida stay this Christmas', '', BOOK, 'gallery', 'beach', F) },
    ]
    // ─────────────────────────────── ART BASEL (guests) ───────────────────────────────
    case 'basel': return [
      { key: 'steps', name: 'Steps from it all', pitch: 'Location first — the fairs, the beach, downtown', post: [
        poster('Art Basel, **steps from it all.**', m.sub, when, '', 'gallery', 'aerial', F),
        { kind: 'callouts', head: 'Basel week, **your way.**', sub: '', items: ['Minutes from the fairs', 'Rooftop views', 'A real apartment, not a room'], q: 'rooftop', dur: 3.8, fx: Am, tr: 'crosszoom' },
        book('Book **Basel week.**', when, 'living room', Am)],
        flyer: poster('Art Basel, **steps from it all.**', m.sub, when, BOOK, 'gallery', 'aerial', F) },
      { key: 'after', name: 'The gallery after the gallery', pitch: 'Come home to a view worth framing', post: [
        { kind: 'cinema', head: 'See the art. **Come home to a view.**', sub: 'Miami Beach · downtown', items: [], q: 'balcony view', dur: 4, fx: F },
        { kind: 'callouts', head: 'After the **crowds**', sub: '', items: ['Your own living room', 'Sunset from the roof', 'Coffee before the fair opens'], q: 'living room', dur: 3.8, fx: Am, tr: 'leak' },
        book('Book **Basel week.**', when, 'rooftop', Am)],
        flyer: poster('The best view of Basel **is from your balcony.**', 'Stays minutes from the fairs', when, BOOK, 'dark', 'balcony view', F) },
      { key: 'hotel', name: 'Skip the hotel', pitch: 'For collectors and crews who need room to host', post: [
        { kind: 'kinetic', head: 'Skip the **hotel.**', sub: '', items: [], q: 'living room', dur: 3, fx: Am },
        { kind: 'cards', head: '', sub: '', items: ['A real apartment|Room to host after the fair', 'A full kitchen|Coffee before the crowds', 'A view|The skyline from your balcony'], q: 'kitchen', n: 3, dur: 5, fx: Am, tr: 'push' },
        book('Basel, **with room to breathe.**', when, 'balcony', Am)],
        flyer: poster('Skip the hotel. **Host the week.**', 'Full apartments minutes from the fairs', when, BOOK, 'band', 'living room', F) },
      { key: 'itinerary', name: 'Three days, planned', pitch: 'The insider’s Basel weekend, day by day', post: [
        { kind: 'event', head: 'Art Basel **Miami Beach**', sub: '', items: ['DEC 4–6'], q: 'aerial', dur: 3.4, fx: F },
        { kind: 'timeline', head: 'Your Basel, **planned**', sub: '', items: ['Day 1|The fair', 'Day 2|Wynwood walls', 'Day 3|Design District', 'Every night|Sunset on the roof'], q: 'rooftop', dur: 4.6, fx: Am, tr: 'crosszoom' },
        book('Book **the weekend.**', when, 'living room', Am)],
        flyer: poster('Three days. **All the art.**', 'Dec 4–6 · stay where it happens', when, BOOK, 'gallery', 'city view', F) },
      { key: 'framed', name: 'Art week, framed', pitch: 'Editorial — feels like the fair itself', post: [
        { kind: 'polaroid', head: 'Art week, **framed.**', sub: 'Miami Beach · downtown', items: [], q: 'living room', dur: 3.6, fx: F },
        { kind: 'quote', head: 'The best seat in Miami is **your own balcony.**', sub: 'Stay Hospitality', items: [], q: 'balcony view', dur: 4, fx: Am, tr: 'fade' },
        book('Book **Basel week.**', when, 'rooftop', Am)],
        flyer: poster('Art week, **framed.**', 'Your stay for Art Basel Miami Beach', when, BOOK, 'gallery', 'living room', F) },
    ]
    // ─────────────────────────────── NEW YEAR'S EVE (guests) ───────────────────────────────
    case 'nye': return [
      { key: 'water', name: 'Ring it in on the water', pitch: 'Fireworks over the bay — the classic', post: [
        poster('Ring it in **on the water.**', m.sub, when, '', 'neon', 'water view night', F),
        { kind: 'callouts', head: 'Midnight, **sorted.**', sub: '', items: ['Fireworks over the bay', 'A rooftop to ring it in', 'No cab home'], q: 'rooftop', dur: 3.8, fx: Am, tr: 'crosszoom' },
        book('Book **New Year’s.**', when, 'balcony night view', Am)],
        flyer: poster('Ring it in **on the water.**', m.sub, when, BOOK, 'neon', 'water view night', F) },
      { key: 'countdown', name: 'The countdown', pitch: 'Big type, pure energy — made for Reels', post: [
        { kind: 'beats', head: 'Ten.\nNine.\nEight.\n**Somewhere warm.**', sub: '', items: [], q: 'city view night', dur: 4, fx: F },
        { kind: 'event', head: 'New Year’s Eve **in Miami**', sub: '', items: ['DEC 31'], q: 'water view night', dur: 3.4, fx: Am, tr: 'whip' },
        book('Count down **here.**', when, 'rooftop', Am)],
        flyer: poster('Count down **somewhere warm.**', 'New Year’s Eve in Miami and Fort Lauderdale', 'DEC 31', BOOK, 'neon', 'city view night', F) },
      { key: 'walk', name: 'Walk home from the fireworks', pitch: 'Location — no traffic, no surge pricing on the ride home', post: [
        { kind: 'mask', head: 'NO **CAB.**', sub: '', items: [], q: 'city view night', dur: 3, fx: Am },
        { kind: 'title', head: 'Walk home from **the fireworks.**', sub: 'Downtown and beach stays', items: [], q: 'balcony night view', dur: 3.6, fx: Am, tr: 'iris' },
        book('Book **New Year’s.**', when, 'living room', Am)],
        flyer: poster('Walk home from **the fireworks.**', 'Downtown and beach stays for New Year’s Eve', when, BOOK, 'dark', 'city view night', F) },
      { key: 'first', name: 'Start 2027 with a view', pitch: 'The night and the morning after', post: [
        { kind: 'cinema', head: 'Start 2027 **with a view.**', sub: 'Miami · Fort Lauderdale', items: [], q: 'balcony view', dur: 4, fx: F },
        { kind: 'cards', head: '', sub: '', items: ['11 pm|Drinks on the roof', 'Midnight|Fireworks over the bay', 'January 1|Pool, then brunch'], q: 'rooftop', n: 3, dur: 5, fx: Am, tr: 'push' },
        book('Book **the first sunrise.**', when, 'ocean view', Am)],
        flyer: poster('The first sunrise of 2027, **from your balcony.**', 'New Year’s stays across South Florida', when, BOOK, 'band', 'ocean view', F) },
      { key: 'crew', name: 'Bring the whole crew', pitch: 'For friends travelling together', post: [
        { kind: 'polaroid', head: 'Bring **the whole crew.**', sub: 'Room for everyone', items: [], q: 'living room', dur: 3.6, fx: F },
        { kind: 'callouts', head: 'One place, **all of you.**', sub: '', items: ['Bedrooms for everyone', 'A kitchen for New Year’s brunch', 'A balcony for midnight'], q: 'kitchen', dur: 3.8, fx: Am, tr: 'crosszoom' },
        book('Book **for the crew.**', when, 'pool', Am)],
        flyer: poster('New Year’s, **all together.**', 'Full apartments with room for everyone', when, BOOK, 'gallery', 'living room', F) },
    ]
    // ─────────────────────────────── OWNERS: THE BIG DATES (Basel, NYE, boat shows, F1) ───────────────────────────────
    case 'basel-owners': return [
      { key: 'priced', name: 'Priced months ahead', pitch: 'How the big dates are captured', post: [
        poster('The big dates are **priced months ahead.**', 'Art Basel · New Year’s Eve · the boat shows · Formula 1', '', '', 'band', 'rooftop pool city view', F),
        { kind: 'checks', head: 'Priced **before the rush**', sub: 'Reviewed every day after that', items: ['Art Basel Miami Beach', 'New Year’s Eve', 'The boat shows', 'Formula 1 Miami'], q: 'living room view', dur: 3.8, tr: 'crosszoom' },
        { kind: 'triad', head: 'How your rate **is set**', sub: '', items: ['Every day|A revenue manager on your calendar', 'The comp set|Your rate against the buildings around you', 'The big dates|Captured months ahead'], q: 'bedroom', n: 4, dur: 4.2, tr: 'push' },
        nick()],
        flyer: poster('The big dates are **priced months ahead.**', 'Art Basel · New Year’s Eve · the boat shows · Formula 1', 'Priced daily · 40+ channels · in-house team', NICK, 'band', 'rooftop pool city view', F) },
      { key: 'ready', name: 'Is your calendar ready?', pitch: 'A direct question to owners who manage it themselves', post: [
        { kind: 'kinetic', head: 'Is your calendar **ready?**', sub: '', items: [], q: 'city view', dur: 3 },
        { kind: 'checks', head: 'Before **Basel week**', sub: 'What we have done by now', items: ['Rates set for the big dates', 'Minimum stays tuned', 'Live on every channel', 'Cleaned and inspected before arrival'], q: 'living room', dur: 4, tr: 'crosszoom' },
        hub('Seen by **every traveller coming.**'),
        nick()],
        flyer: poster('Basel is coming. **Is your calendar ready?**', 'We price the big dates months ahead — and review them every day', 'Priced daily · 40+ channels · in-house team', NICK, 'dark', 'city view', F) },
      { key: 'channels', name: 'Sold everywhere at once', pitch: 'The channels, by name — where the bookings come from', post: [
        { kind: 'beats', head: 'One listing.\n**Every channel.**\nEvery day.', sub: '', items: [], q: 'building exterior', dur: 3.8 },
        hub('40+ channels. **One calendar.**'),
        { kind: 'roles', head: 'Run by **our own team**', sub: 'Revenue, guest care, housekeeping and maintenance', items: ['Revenue', 'Guest care', 'Housekeeping', 'Maintenance'], q: 'kitchen', dur: 3.6, tr: 'push' },
        nick()],
        flyer: poster('Airbnb. Vrbo. Booking.com. **And 40 more.**', 'Your listing on every channel, from one calendar', 'Priced daily · in-house team', NICK, 'band', 'building exterior', F) },
      { key: 'wait', name: 'The week owners wait for', pitch: 'Big-event energy, owner outcome', post: [
        { kind: 'event', head: 'The week **owners wait for.**', sub: '', items: ['DEC 4–6'], q: 'aerial', dur: 3.4, fx: F },
        { kind: 'curve', head: 'Priced to **convert**', sub: 'Basel week', items: ['Priced ahead', 'Ranked higher', 'Booked sooner'], q: 'living room', dur: 4.2, tr: 'crosszoom' },
        { kind: 'tilegrid', head: 'Basel-**ready**', sub: 'What we handle', items: ['Pricing', 'Photos', 'Channels', 'Cleaning', 'Guest care', 'Check-in'], q: 'bedroom', dur: 4, tr: 'push' },
        nick()],
        flyer: poster('Art Basel is **the week owners wait for.**', 'We make sure your unit is priced for it, months ahead', 'Priced daily · 40+ channels · in-house team', NICK, 'gallery', 'aerial', F) },
    ]
    // ─────────────────────────────── OWNERS: YEAR-END THANK-YOU ───────────────────────────────
    // A THANK-YOU IS A YEAR IN REVIEW, NOT A BRAG (Jon, 2026-11-13: "Hey, we built a big business for you. It's stupid …
    // talk about things we're implementing, Lighthouse, a year in review, the market, our expectation, new initiatives,
    // listing optimizations, revamps"). No company-size numbers, no sales card: these owners are already with us.
    case 'owners-thanks': {
      const close = (head: string, sub: string, q: string): PresetScene => ({ kind: 'cta', head, sub, items: [], q, dur: 3.8, tr: 'fade' })
      return [
      { key: 'review', name: 'Your year in review', pitch: 'Thank you, then what we put in place for their listing this year', post: [
        poster('Thank you for **2026.**', 'A look at what we put in place for your listing', 'Year in review', '', 'dark', 'building exterior night'),
        { kind: 'checks', head: 'This year, **for your listing**', sub: '', items: ['Lighthouse|Our own platform, now running every stay', 'Listings rebuilt|Photos, copy and amenities, every three months', 'Every clean checked|Photo-checked before the next arrival', 'Guests verified|ID and deposit checks before arrival'], q: 'living room', dur: 4.6, tr: 'crosszoom' },
        { kind: 'timeline', head: 'The season **ahead**', sub: '', items: ['Dec|The season opens', 'Feb|The boat shows', 'Mar|The peak of the year', 'May|Formula 1 Miami'], q: 'pool', dur: 4.4, tr: 'push' },
        close('Here’s to **2027.**', 'Thank you, from all of us at Stay', 'ocean view balcony')],
        flyer: poster('Thank you for **2026.**', 'Lighthouse live · every listing rebuilt · the season already priced', 'Year in review', '', 'dark', 'building exterior night') },
      { key: 'trust', name: 'Your trust', pitch: 'Personal — one line that means it', post: [
        { kind: 'kinetic', head: 'Thank **you.**', sub: '', items: [], q: 'balcony view', dur: 2.8 },
        { kind: 'quote', head: 'Your trust is the best thing **we manage.**', sub: 'Everyone at Stay Hospitality', items: [], q: 'living room', dur: 4.2, tr: 'leak' },
        close('Happy **holidays.**', 'See you in 2027', 'pool')],
        flyer: poster('Your trust is the best thing **we manage.**', 'Thank you, and happy holidays', 'From all of us at Stay', '', 'gallery', 'living room') },
      { key: 'ahead', name: 'What’s ahead in 2027', pitch: 'Thank them, then show the season we are already pricing', post: [
        { kind: 'cinema', head: 'Thank you **for 2026.**', sub: 'Stay Hospitality', items: [], q: 'building exterior night', dur: 3.6 },
        { kind: 'timeline', head: 'Already pricing **2027**', sub: '', items: ['Jan|Every listing refreshed', 'Feb|The boat shows', 'Mar|The peak of the season', 'May|Formula 1 Miami'], q: 'living room', dur: 4.6, tr: 'crosszoom' },
        { kind: 'checks', head: 'What’s **next**', sub: '', items: ['Lighthouse|More of the day watched, start to finish', 'Listings|The next three-month rebuild', 'Big dates|Priced months ahead, reviewed every day'], q: 'bedroom', dur: 4.2, tr: 'push' },
        close('Here’s to **2027.**', 'Thank you, from all of us at Stay', 'pool')],
        flyer: poster('Thank you for 2026. **2027 is already priced.**', 'The big dates are set months ahead', 'From all of us at Stay', '', 'band', 'building exterior night') },
    ] }
    // ─────────────────────────────── OWNERS: NEW YEAR, NEW LISTING ───────────────────────────────
    case 'new-year-owners': return [
      { key: 'photos', name: 'New year, new photos', pitch: 'The quarterly refresh, shown', post: [
        poster('New year, **new photos.**', 'Every listing refreshed every three months', '', '', 'band', 'living room', F),
        { kind: 'checks', head: 'Every listing, **rebuilt**', sub: 'Every three months, not once', items: ['New photos, best first', 'Copy that sells the stay', 'Amenities audited on every channel', 'Pricing reviewed every day'], q: 'bedroom', dur: 3.8, tr: 'crosszoom' },
        hub('Then live on **every channel.**'),
        nick('pool')],
        flyer: poster('New year, **new photos.**', 'Every listing refreshed every three months', 'Priced daily · 40+ channels · in-house team', NICK, 'band', 'living room', F) },
      { key: 'rebuilt', name: 'Your listing, rebuilt', pitch: 'Before → after, the way a listing actually changes', post: [
        { kind: 'kinetic', head: 'Tired **listing?**', sub: '', items: [], q: 'bedroom', dur: 2.8 },
        { kind: 'beforeafter', head: 'Your listing, **rebuilt.**', sub: 'Same unit, the old photos', items: ['New photos', 'New title', 'Every channel'], q: 'living room', n: 7, dur: 5, tr: 'crosszoom' },
        nick()],
        flyer: poster('Same unit. **A whole new listing.**', 'Photos, copy and amenities rebuilt every three months', 'Priced daily · 40+ channels · in-house team', NICK, 'gallery', 'living room', F) },
      { key: 'switch', name: 'New year, new manager?', pitch: 'A straight question for unhappy owners', post: [
        { kind: 'beats', head: 'New year.\n**New manager?**', sub: '', items: [], q: 'building exterior', dur: 3.4 },
        { kind: 'tiles', head: 'Why owners **switch**', sub: 'Miami · Fort Lauderdale · Pompano · Palm Beach', items: ['450+|listings', '10|years', '4.6|guest rating', '1,000,000+|guests hosted'], q: 'pool', dur: 4, tr: 'push' },
        hub('And sold on **every channel.**'),
        nick()],
        flyer: poster('New year. **New manager?**', 'More bookings, a lower fee, one complete team', 'Priced daily · 40+ channels · in-house team', NICK, 'dark', 'building exterior', F) },
    ]
  }
  return null
}

/** The three reasons and the closing line for guest moments without hand-written angles. */
const GUEST: Record<string, { rows: string[]; cta: string; q2?: string; q3?: string }> = {
  thanksgiving: { rows: ['A full kitchen for the big dinner', 'Room for everyone', 'The beach after'], cta: 'Book **Thanksgiving.**', q2: 'dining table kitchen', q3: 'beach' },
  'winter-sun': { rows: ['78° in January', 'The pool every morning', 'Weeks, not nights'], cta: 'Escape **winter.**', q2: 'pool', q3: 'ocean view' },
  mlk: { rows: ['Three days in the sun', 'The pool on Monday', 'Easy for the whole family'], cta: 'Book **the weekend.**', q2: 'pool', q3: 'living room' },
  marathon: { rows: ['Close to the start line', 'A real bed the night before', 'A kitchen to refuel'], cta: 'Book **race weekend.**', q2: 'bedroom', q3: 'kitchen' },
  'boat-show-miami': { rows: ['Close to the docks', 'Water views', 'Room for the crew'], cta: 'Book **boat show week.**', q2: 'water view', q3: 'living room' },
  valentines: { rows: ['Sunsets from the balcony', 'A rooftop for two', 'No one else’s schedule'], cta: 'Book **for two.**', q2: 'balcony sunset', q3: 'bedroom' },
  sobewff: { rows: ['Steps from the tents', 'A kitchen of your own', 'The beach in between'], cta: 'Book **festival weekend.**', q2: 'kitchen', q3: 'beach' },
  'spring-break': { rows: ['The pool all day', 'Room for your group', 'The beach close by'], cta: 'Book **spring break.**', q2: 'pool', q3: 'living room' },
  'miami-open': { rows: ['Easy to the stadium', 'A pool between matches', 'Room to spread out'], cta: 'Book **match week.**', q2: 'pool', q3: 'living room' },
  ultra: { rows: ['Walk to the gates', 'A rooftop before the gates open', 'Room for the whole crew'], cta: 'Book **Ultra weekend.**', q2: 'rooftop', q3: 'living room' },
  easter: { rows: ['Room for the whole family', 'A kitchen for Easter brunch', 'The sea close by'], cta: 'Book **Easter.**', q2: 'kitchen', q3: 'ocean view' },
  f1: { rows: ['Race week in Miami', 'A rooftop to watch the city', 'Room for the crew'], cta: 'Book **race week.**', q2: 'rooftop', q3: 'living room' },
  memorial: { rows: ['Summer starts here', 'The pool all weekend', 'Room for everyone'], cta: 'Book **the long weekend.**', q2: 'pool', q3: 'balcony' },
  july4: { rows: ['Fireworks over the bay', 'Waterfront stays', 'Room for the whole family'], cta: 'Book **the Fourth.**', q2: 'water view', q3: 'living room' },
  labor: { rows: ['One more pool day', 'Room to spread out', 'The beach close by'], cta: 'Book **the weekend.**', q2: 'pool', q3: 'beach' },
  flibs: { rows: ['Close to the marinas', 'Water views', 'Room for the crew'], cta: 'Book **boat show week.**', q2: 'water view', q3: 'living room' },
  halloween: { rows: ['A night in the city', 'Room to get ready', 'No drive home'], cta: 'Book **the weekend.**', q2: 'city view night', q3: 'living room' },
}

/** A Christmas tree takes a corner of its own, and only the dark poster leaves room for one — everywhere else it would
 *  stand on the words, so it comes off (the scene keeps the rest of its graphics). */
function treeSafe(x: PresetScene): PresetScene {
  if (!(x.fx || []).includes('tree')) return x
  const roomy = x.kind === 'poster' && (x.items[2] || 'dark') === 'dark'
  return roomy ? x : { ...x, fx: (x.fx || []).filter(k => k !== 'tree') }
}
const tidy = (a: Angle): Angle => ({ ...a, post: a.post.map(treeSafe), flyer: treeSafe(a.flyer) })

/** Every angle for a moment — hand-written ones where they exist, else one designed for the audience. */
export function momentAngles(m: Moment, when: string): Angle[] { return momentAnglesRaw(m, when).map(tidy) }
function momentAnglesRaw(m: Moment, when: string): Angle[] {
  const a = angles(m, when) || eventAngles(m, when)
  if (a) return a
  const F = m.fx || [], Am = amb(m.fx)
  if (m.audience === 'owners') {
    const base = m.name.replace(/ \(.*\)$/, '')
    return [{ key: 'owner', name: m.name, pitch: 'Built for owners', post: [
      poster(m.headline, m.sub, '', '', 'band', m.photo || 'building exterior', F),
      { kind: 'triad', head: 'What **' + base + '** means for your unit', sub: '', items: ['Priced ahead|The date captured months early', 'Every channel|In front of everyone coming', 'Ready on the day|Cleaned and inspected by our team'], q: 'living room', n: 4, dur: 4.2, tr: 'crosszoom' },
      hub('Seen on **every channel.**'),
      nick()],
      flyer: poster(m.headline, m.sub, 'Priced daily · 40+ channels · in-house team', NICK, 'band', m.photo || 'building exterior', F) }]
  }
  const g = GUEST[m.key] || { rows: ['Room to spread out', 'A full kitchen', 'Cleaned and inspected by our team'], cta: 'Book **direct.**' }
  const nm = m.name.replace(/ (weekend|week|season)$/i, '').replace(/ \(.*\)$/, '')
  return [{ key: 'guest', name: m.name, pitch: 'The moment, three reasons, Book now', post: [
    poster(m.headline, m.sub, when, '', m.poster || '', m.photo || 'pool', F),
    { kind: 'callouts', head: nm + ', **your way.**', sub: '', items: g.rows, q: g.q2 || 'living room', dur: 3.8, fx: Am, tr: 'crosszoom' },
    book(g.cta, when, g.q3 || 'ocean view', Am)],
    flyer: poster(m.headline, m.sub, when, BOOK, m.poster || '', m.photo || 'pool', F) }]
}

/** The first angle's post / flyer (kept for callers that do not choose). */
export function momentPost(m: Moment, when: string): PresetScene[] { return momentAngles(m, when)[0].post }
export function momentFlyer(m: Moment, when: string): PresetScene { return { ...momentAngles(m, when)[0].flyer, dur: 6 } }
