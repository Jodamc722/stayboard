// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// ART DIRECTION, NOT TEMPLATES. Two things the composer works inside:
//   · LOOKS — art-direction systems. Each fixes only four things (where colour comes from, how photographs are held,
//     the type pairing, the motion language) and leaves the layout of every scene to the composer.
//   · IDENTITIES — what an event looks like: the colours and visuals people associate with it (Jon, 2026-11-04:
//     "fall colours for Thanksgiving, Christmas colours with lights or trees"), what is ours to add, the motifs, the
//     motion, and a never-list. An identity is a palette and a vocabulary; it is never a layout.
// Also the choices the guided brief offers as buttons. Client-safe, no imports.

export type LookDef = { key: string; label: string; oneLine: string; brief: string }
export const LOOKS: LookDef[] = [
  { key: 'stay-black', label: 'Stay black', oneLine: 'The house look: black ground, white type, photographs untouched',
    brief: 'The house look and the default. Black ground, white type, the white mark. Photographs untreated, in hard-edged windows (or full bleed only when they are large enough). Grotesque display type (Bricolage Grotesque 700–800) with Instrument Sans labels. Motion: cuts and pushes, mask reveals, nothing soft. One accent colour at most.' },
  { key: 'gallery-white', label: 'Gallery white', oneLine: 'White page, black type and logo, photographs hung like prints',
    brief: 'A white or ivory page, black type, the black mark. A photograph sits like a print on a wall: generous margin, a thin frame or a caption line under it, and flat blocks of strong colour beside it. Motion: slow slides, hairlines that draw, things stop like pictures being hung. For design-led moments.' },
  { key: 'true-colour', label: 'True colour', oneLine: 'The photograph is the piece: full bleed, no filter',
    brief: 'The photograph fills the frame, untreated. Use ONLY with photographs at least 2400 px on the long side. Words go on a solid label or a ground panel, never on a darkened photo. Motion: one slow camera move per scene, dissolves.' },
  { key: 'colour-field', label: 'Colour field', oneLine: 'The event’s palette is the page; photographs are windows cut into it',
    brief: 'The event’s palette is the page. Photographs are windows cut into flat colour (rectangles, arches, circles) and are never tinted. The ground changes from scene to scene within the palette. Serif display with an italic accent word. Motion: pushes between grounds, wipes that open the windows. The look for seasons and holidays that have colours but need no props.' },
  { key: 'festive-lights', label: 'Festive lights', oneLine: 'A string of bulbs, the Book button in lights, the logo dressed for the season',
    brief: 'The holiday look Jon likes. A string of bulbs across the top of the frame ("string-lights"), bulbs round the Book button ("bulbs-around" with target), the mark dressed for the season (logo "dress"). A deep seasonal ground, cream type, photographs in framed windows hung under the lights, ornaments or a tree in the bands the platform covers. Motion: bulbs come on in sequence once ("light-up") and then glow; ornaments swing in and settle.' },
]

export type Identity = {
  key: string
  name: string
  /** What people expect to see for this event. */
  expect: string
  /** What is ours to add: South Florida, our places. */
  ours: string
  palette: Record<string, string>
  type: string
  motifs: string
  motion: string
  never: string
  /** Looks that suit it, best first. */
  looks: string[]
  logoDress: string
  music: string
  /** Subjects worth looking for in the photo library, best first. */
  subjects: string[]
  /** Starting points for three different ideas — territories, not headlines. */
  territories: string[]
  /** Naming rule for a real event we are not part of. */
  naming?: string
}
export const IDENTITIES: Record<string, Identity> = {
  thanksgiving: {
    key: 'thanksgiving', name: 'Thanksgiving',
    expect: 'The colours of the table and of fall: pumpkin, cranberry, ochre, cream linen, dark wood. Leaves. Candlelight warmth.',
    ours: 'It is 80 degrees here. Palms, a pool, the ocean, a full kitchen and a table that fits everyone. The piece is the meeting of the two: fall colours around Florida pictures.',
    palette: { cream: '#F5EBDC', bark: '#2A1A12', pumpkin: '#C4541C', cranberry: '#7C1F2A', ochre: '#D9A441', sage: '#8A9A7B' },
    type: 'display: Fraunces 600 · displayAccent: Fraunces 500 italic for the one accent word · label: Instrument Sans 600, tracked capitals',
    motifs: '"leaf" (maple, oval) in palette colours — three to five in a scene at most, arriving once ("settle") and resting at the edge of a photograph or in a corner. The mark may wear "leaves" on the end card.',
    motion: 'Settle. Things arrive once and come to rest, like a table being laid. Pushes and dissolves.',
    never: 'Turkeys, pilgrim hats, cornucopia clip-art, an orange wash over a photograph, leaves falling across the words, "gobble", prices, "deals".',
    looks: ['colour-field', 'gallery-white'], logoDress: 'leaves', music: 'carefree',
    subjects: ['dining table', 'kitchen', 'living room', 'pool', 'ocean view', 'balcony view', 'exterior'],
    territories: ['Somewhere warm: skip the cold, same dinner in the sun', 'Room for everyone: one table, the whole family under one roof', 'The long weekend: Thursday dinner, Friday beach, leftovers by the pool'],
  },
  christmas: {
    key: 'christmas', name: 'Christmas',
    expect: 'Evergreen, cranberry red, warm gold and cream. A string of coloured lights, ornaments, a tree, a star.',
    ours: 'Christmas in the sun: pool mornings, palms, warm nights, a real apartment for the whole family. The lights are strung over Florida, not snow.',
    palette: { evergreen: '#0F3D2B', pine: '#17543B', cranberry: '#B3122A', cream: '#F7EEDD', gold: '#E3BC62', night: '#07251A', snow: '#FFFFFF' },
    type: 'display: Fraunces 600 · displayAccent: Fraunces 500 italic · label: Instrument Sans 600, tracked capitals',
    motifs: '"string-lights" across the top of the frame (variant multi; entrance light-up), "bulbs-around" the Book button, "ornament" hanging from the top, a "tree" in a lower corner, a "star", the "palm" leaf. The mark wears "lights".',
    motion: 'Glow. The bulbs come on left to right once and then glow; ornaments swing in and settle; photographs open with a wipe. Dissolves and pushes.',
    never: 'Santa or reindeer clip-art, snow piled over a pool photograph, a red or green wash over a photograph, "deals", "sale", prices, anything flashing.',
    looks: ['festive-lights', 'colour-field'], logoDress: 'lights', music: 'jingle',
    subjects: ['pool', 'living room', 'ocean view', 'kitchen', 'dining table', 'balcony view', 'bedroom'],
    territories: ['Christmas in the sun: the pool on Christmas morning', 'Everyone under one roof: a real apartment, a full kitchen, room for the whole family', 'Trade the snow for the sand: a warm, playful swap'],
  },
  nye: {
    key: 'nye', name: 'New Year’s Eve',
    expect: 'Midnight black and champagne gold, sparkle, fireworks, the countdown, a toast.',
    ours: 'Fireworks over the bay, the skyline at night, rooftops and balconies, then a slow first morning of the year in the sun.',
    palette: { night: '#0B0B0D', coal: '#17171C', champagne: '#EBD6A6', gold: '#C9A45C', white: '#FFFFFF', blush: '#F0C7B4' },
    type: 'display: Bricolage Grotesque 800, tight · displayAccent: Fraunces 500 italic in champagne · label: Instrument Sans 600, tracked capitals',
    motifs: '"rays" (a deco fan opening behind a photograph or the mark), "firework" bursts that open once over a dark ground, "sparkle", a "star". The mark wears "sparkle". Gold is welcome here: it is the season for it.',
    motion: 'Countdown. Crisp pushes, a fan that opens, one or two fireworks that burst once and are gone. Fast in, then hold.',
    never: 'Champagne-bottle clip-art, party hats, "party" in the copy, a gold wash over a photograph, prices, anything strobing.',
    looks: ['stay-black', 'festive-lights'], logoDress: 'sparkle', music: 'glitter',
    subjects: ['skyline night', 'city view', 'rooftop', 'balcony view', 'pool', 'ocean view', 'living room'],
    territories: ['Midnight over the bay: the fireworks from your own balcony', 'The first morning: ring it in loud, wake up slow in the sun', 'The countdown: three, two, one, from the rooftop'],
  },
  basel: {
    key: 'basel', name: 'Art Basel',
    expect: 'A white gallery wall, bold contemporary colour, clean confident type, the feeling of a private view.',
    ours: 'Stays in Miami Beach and downtown, steps from the fairs: the city at night, the beach between shows, an apartment to come back to.',
    palette: { paper: '#FAF8F3', ink: '#0B0B0B', cobalt: '#1F3FD6', vermilion: '#F0442B', sun: '#F5C400', pink: '#F7B7C9' },
    type: 'display: Bricolage Grotesque 800, tight · displayAccent: Fraunces 500 italic · label: Instrument Sans 600, tracked capitals',
    motifs: 'No seasonal props. Flat blocks of strong colour ("shape" rect and ellipse), a thin frame round a photograph ("shape" with stroke), and one or two shapes you draw yourself ("vector": an arc, a squiggle, a cut-out) — original shapes only.',
    motion: 'Hang. Frames slide in and stop like pictures being hung; blocks of colour wipe on; cuts and slides.',
    never: 'Any real artwork or anything that looks like one, the fair’s logo, lettering or slogan, the words "official", "partner", "presented by" or "sponsor", a collage of pictures.',
    looks: ['gallery-white', 'colour-field'], logoDress: 'none', music: 'ultralounge',
    subjects: ['city view', 'living room', 'balcony view', 'ocean view', 'bedroom', 'rooftop', 'pool'],
    territories: ['Steps from it all: the fairs by day, your own place by night', 'A private view: the apartment as the exhibit', 'Art week, slowly: the beach between shows'],
    naming: 'The event may be named as a plain fact with its dates ("Art Basel · Dec 4–6"). Never "official", "partner", "presented by" or "sponsor", never its slogan, logo or lettering, nothing implying we are connected to it.',
  },
}

// FROM SCRATCH (Jon, 2026-11-20): pieces for no calendar event. They are identities like the events — a palette and
// a vocabulary, never a layout — so the same designer, review and editor make them.
Object.assign(IDENTITIES, {
  stays: {
    key: 'stays', name: 'Our stays',
    expect: 'A confident travel brand: the place itself is the hero. Clean, modern, unhurried.',
    ours: 'Real apartments and homes in South Florida with the space of a home and the polish of a hotel: full kitchens, pools, balconies over the water, a local team and 24/7 guest support.',
    palette: { black: '#000000', coal: '#161616', white: '#FFFFFF', sand: '#EDE6DA', gold: '#D2B077', sea: '#1F6F8B' },
    type: 'display: Bricolage Grotesque 800, tight · displayAccent: Fraunces 500 italic · label: Instrument Sans 600, tracked capitals',
    motifs: 'No seasonal props. Hard-edged photograph windows, thin frames ("shape" with stroke), one line that draws, a block of sand or sea colour. At most one accent colour in a scene.',
    motion: 'Cuts and pushes, mask reveals, one slow camera move on the strongest photograph. Fast in, then hold.',
    never: 'Stock-brochure clichés ("your home away from home", "paradise awaits"), prices, "deals", anything flashing, a tint over a photograph.',
    looks: ['stay-black', 'gallery-white', 'true-colour'], logoDress: 'none', music: 'rooftops',
    subjects: ['ocean view', 'pool', 'living room', 'balcony view', 'kitchen', 'bedroom', 'city view', 'exterior'],
    territories: ['The space of a home, the polish of a hotel', 'Wake up to this: the view from your own balcony', 'Room for everyone: a real kitchen, a real table, a pool downstairs'],
  },
  ownerstory: {
    key: 'ownerstory', name: 'For owners',
    expect: 'A serious, premium management company: calm, exact, black and white with one warm accent.',
    ours: 'Stay manages 500+ units for a 15% fee, lists them on 40+ platforms (Airbnb, Vrbo, Booking.com, Expedia, Marriott, Blueground, stay-hospitality.com), with a local team and 24/7 guest support. March is the peak month. Owners talk to Nick Carline, 651.200.8283.',
    palette: { black: '#000000', coal: '#161616', white: '#FFFFFF', paper: '#F4F1EA', gold: '#D2B077', slate: '#5B6470' },
    type: 'display: Bricolage Grotesque 800, tight · displayAccent: Fraunces 500 italic in gold · label: Instrument Sans 600, tracked capitals',
    motifs: 'No props. Large numerals as design ("15%", "500+"), hairlines that draw, a thin frame round a photograph, the channel names set as a clean list.',
    motion: 'Measured. Lines draw, numbers arrive once and hold, pushes between grounds. Nothing bounces.',
    never: 'Any number that is not in the facts above, guarantees of income, "passive income", "in seconds", "CCS", clip-art charts, a tint over a photograph.',
    looks: ['stay-black', 'gallery-white'], logoDress: 'none', music: 'backbay',
    subjects: ['exterior', 'living room', 'ocean view', 'kitchen', 'pool', 'bedroom', 'city view'],
    territories: ['The numbers, plainly: 15%, 500+ units, 40+ platforms', 'Your place, looked after: a local team and 24/7 guest support', 'Priced for the dates that matter: March, the holidays, the big events'],
  },
  team: {
    key: 'team', name: 'Team (internal)',
    expect: 'A company talking to its own people: warm, proud, a little playful. Big friendly type, strong colour, clear news.',
    ours: 'The Stay team in South Florida: housekeeping, maintenance, guest care, the office. Wins, welcomes, events, announcements, thank-yous.',
    palette: { black: '#000000', white: '#FFFFFF', gold: '#D2B077', cream: '#F6EFE2', coral: '#F0603F', sky: '#3E8FD0', leaf: '#2F7D5B' },
    type: 'display: Bricolage Grotesque 800, tight · displayAccent: Fraunces 500 italic · label: Instrument Sans 600, tracked capitals',
    motifs: 'Flat blocks and circles of strong colour, "sparkle" or a "star" for a win, "rays" behind a headline, one shape you draw yourself ("vector"). With no photographs, colour and type ARE the piece: fill every frame.',
    motion: 'Upbeat. Blocks wipe on, headlines rise line by line, a star or sparkle arrives once. Pushes between grounds.',
    never: 'Corporate filler ("synergy", "rockstars", "family"), anything sarcastic, a booking button, guest-facing sales lines, names or facts that are not in the brief.',
    looks: ['colour-field', 'stay-black'], logoDress: 'none', music: 'hopeonrepeat',
    subjects: ['exterior', 'pool', 'living room'],
    territories: ['The news, big and clear: what, when, where', 'A proper thank-you: name the win, name the people', 'Come along: the event as an invitation'],
  },
} as Record<string, Identity>)
/** The from-scratch kinds, as the brief offers them. `audience` is fixed by the kind. */
export const ANYTIME: { key: string; label: string; emoji: string; hint: string; audience: 'guests' | 'owners' | 'team' }[] = [
  { key: 'stays', label: 'Our stays', emoji: '🌴', hint: 'For guests, any time of year', audience: 'guests' },
  { key: 'ownerstory', label: 'For owners', emoji: '🔑', hint: 'Why owners choose Stay', audience: 'owners' },
  { key: 'team', label: 'Team (internal)', emoji: '🎉', hint: 'Promo, culture event, announcement', audience: 'team' },
]

// ── the guided brief: every choice is a button ──────────────────────────────────────────────────────────────────
export type Choice = { key: string; label: string; hint?: string; brief: string }
export const AUDIENCES: Choice[] = [
  { key: 'guests', label: 'Guests', hint: 'People choosing where to stay', brief: 'Travellers choosing where to stay in South Florida' },
  { key: 'owners', label: 'Owners', hint: 'People who own a rental here', brief: 'Owners of a South Florida rental who are not yet with Stay' },
]
/** The team is never offered beside guests and owners: it comes with the internal kind. */
export const TEAM_AUDIENCE: Choice = { key: 'team', label: 'The team', hint: 'Internal', brief: 'Stay Hospitality’s own team: housekeeping, maintenance, guest care and the office' }
export const GOALS: Record<'guests' | 'owners' | 'team', Choice[]> = {
  guests: [
    { key: 'book-dates', label: 'Fill these dates', hint: 'Bookings for the event itself', brief: 'Bookings for the event dates' },
    { key: 'reach', label: 'Reach new guests', hint: 'People who have never stayed with us', brief: 'Make people who have never stayed with us want to' },
    { key: 'return', label: 'Bring guests back', hint: 'Past guests, a reason to return', brief: 'Give past guests a reason to come back for this' },
  ],
  owners: [
    { key: 'win-owners', label: 'Win new owners', hint: 'A call with Nick', brief: 'Get owners who are not with us to book a call with Nick' },
    { key: 'big-dates', label: 'Show how we price the big dates', hint: 'Why this event earns more with us', brief: 'Show owners how Stay prices and fills the high-demand dates' },
  ],
  team: [
    { key: 'announce', label: 'Announcement', hint: 'News the team needs to know', brief: 'Tell the team one piece of news clearly: what, when, where' },
    { key: 'event', label: 'Culture event', hint: 'A party, lunch, outing', brief: 'Invite the team to an event and make them want to come' },
    { key: 'shoutout', label: 'Shout-out', hint: 'Thank or celebrate people', brief: 'Celebrate a win and thank the people behind it, by name where the brief names them' },
    { key: 'welcome', label: 'Welcome', hint: 'New team member or property', brief: 'Welcome someone or something new to the team' },
    { key: 'promo', label: 'Team promo', hint: 'Who we are, why it is good here', brief: 'Show who the Stay team is and make people proud to be part of it' },
  ],
}
export const VIBES: Choice[] = [
  { key: 'warm', label: 'Warm and relaxed', brief: 'warm, unhurried, a little playful' },
  { key: 'elegant', label: 'Elegant', brief: 'elegant, calm, confident' },
  { key: 'playful', label: 'Playful', brief: 'playful, bright, a smile in the copy' },
  { key: 'energy', label: 'High energy', brief: 'energetic, quick, a sense of occasion' },
  { key: 'festive', label: 'Festive', brief: 'festive and cheerful, clearly dressed for the season' },
]
export const LENGTHS = [10, 15, 20]

/** The facts a piece may state (Jon's standing sales facts and wording). */
export const SALES_FACTS = `- 15% management fee (owner pieces only, and only when the brief asks for the fee).
- 500+ units managed. Listed on 40+ platforms; when "40+" is used, name them: Airbnb, Vrbo, Booking.com, Expedia, Marriott, Blueground, stay-hospitality.com.
- "A local team and 24/7 guest support" (say it this way; never "CCS", never "Customer Care Team", never that anyone picks up at 2 a.m.; issues are resolved quickly, never "in seconds").
- March is the peak month. Winter is strong, but the peak is March.
- Guests book at stay-hospitality.com. Owners talk to Nick Carline, 651.200.8283.
Invent no number, rating, price, percentage or guarantee.`
