// Property GUIDE pages — the shareable, editable "what's happening here" link we send to guests.
//
// One engine, many properties: every page is a row of JSON stored in app_settings under the key
// 'guide:<slug>' (no migration needed - app_settings.value is TEXT, so the content is a JSON string).
// The guest link (/guide/<slug>) is fully public and read-only. The same URL with ?admin=1 asks for
// the StayBoard ADMIN password (share_settings id=2) and turns the whole page into an editor.
//
// This file is PURE (no server imports) so the client component can share the types and defaults.

export type Cta = { label: string; url: string }
export type Kv = { label: string; value: string; note?: string }

export type Guide = {
  slug?: string
  theme?: { ink?: string; deep?: string; leaf?: string; sand?: string; accent?: string }
  hero: { eyebrow: string; title: string; subtitle: string; image: string; chips: string[]; ctas: Cta[] }
  quick: { title: string; items: Kv[] }
  activations: { title: string; note: string; items: { day: string; time: string; name: string; where: string; desc: string }[] }
  venues: { title: string; note: string; items: { name: string; tagline: string; image: string; hours: Kv[]; note: string; phone: string; link: string; linkLabel: string }[] }
  menu: { title: string; note: string; link: string; linkLabel: string; groups: { name: string; note: string; items: { name: string; desc: string; price: string }[] }[] }
  quotes: { title: string; note: string; auto: boolean; keywords: string[]; items: { text: string; who: string; source: string; date: string }[] }
  todo: { title: string; note: string; groups: { name: string; items: { name: string; desc: string; meta: string; url: string }[] }[] }
  gallery: { title: string; note: string; images: { url: string; caption: string }[] }
  place: { title: string; address: string; mapQuery: string; note: string; items: Kv[] }
  contact: { title: string; note: string; items: { name: string; role: string; phone: string; email: string; note: string }[] }
  footer: { note: string; signature: string }
  omit: string[]
  updatedAt?: string
  updatedBy?: string
}

export const GUIDE_SECTIONS = ['quick', 'activations', 'venues', 'menu', 'quotes', 'todo', 'gallery', 'place', 'contact'] as const

export function guideKey(slug: string): string { return 'guide:' + normSlug(slug) }
export function normSlug(slug: string): string { return String(slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) }

// An empty page for a brand-new property. Admin fills it in on the live page.
export function blankGuide(slug: string, name: string): Guide {
  return {
    slug,
    hero: { eyebrow: 'Your stay', title: name, subtitle: 'Everything happening here this week.', image: '', chips: [], ctas: [] },
    quick: { title: 'Good to know', items: [] },
    activations: { title: 'This week', note: 'Updated every week - check back before you plan your day.', items: [] },
    venues: { title: 'Eat and drink', note: '', items: [] },
    menu: { title: 'On the menu', note: '', link: '', linkLabel: 'See the full menu', groups: [] },
    quotes: { title: 'What guests are saying', note: '', auto: true, keywords: ['coffee', 'breakfast', 'food', 'restaurant', 'cafe', 'dinner', 'drinks', 'pool'], items: [] },
    todo: { title: 'Things to do', note: '', groups: [] },
    gallery: { title: 'A look around', note: '', images: [] },
    place: { title: 'Finding your way', address: '', mapQuery: '', note: '', items: [] },
    contact: { title: 'Reach a human', note: '', items: [] },
    footer: { note: 'Hours and events can change - the front desk always has the final word.', signature: 'Managed by Stay Hospitality' },
    omit: [],
  }
}

// ---------------------------------------------------------------------------
// THE GARDEN (Botanica) - seeded from thegardenhotelandresort.com + the dining menu PDF, 2026-07-29.
// Everything here is editable on the live page; this is only the starting point.
// ---------------------------------------------------------------------------
export const GARDEN: Guide = {
  slug: 'garden',
  theme: { ink: '#16204B', deep: '#0E1533', leaf: '#5C8A4A', sand: '#F5F1E8', accent: '#C9A227' },
  hero: {
    eyebrow: 'The Garden Hotel & Resort - Fort Lauderdale',
    title: 'A lush oasis in the heart of Fort Lauderdale',
    subtitle: 'Three pools, a garden-to-table kitchen, and something on the calendar almost every day. Here is everything happening while you are with us.',
    image: 'https://www.thegardenhotelandresort.com/wp-content/uploads/2026/01/Dive-across-pool.png.webp',
    chips: ['3 outdoor pools', 'Complimentary e-bikes', 'EV shuttle to the beach', 'Unlimited Wi-Fi', 'Pet friendly'],
    ctas: [
      { label: 'Reserve a table', url: 'https://www.thegardenhotelandresort.com/dining/#dine_menu' },
      { label: 'Call the front desk', url: 'tel:19545633400' },
    ],
  },
  quick: {
    title: 'Good to know',
    items: [
      { label: 'Front desk', value: '954-563-3400', note: 'Open 24 hours - dial 0 from your room' },
      { label: 'Address', value: '3711 N. Ocean Blvd, Fort Lauderdale, FL 33308', note: 'Beach is a few blocks east' },
      { label: 'Pools', value: 'Three outdoor pools', note: 'Towels and loungers included' },
      { label: 'Wi-Fi', value: 'Unlimited, complimentary', note: 'Ask the front desk for the network password' },
      { label: 'Getting around', value: 'Complimentary e-bikes + EV shuttle', note: 'Shuttle runs to the beach - ask at the desk for times' },
      { label: 'In-room dining', value: 'Daily 7:30 AM - 10 PM', note: 'Dial 0 on your in-room phone' },
    ],
  },
  activations: {
    title: 'This week at The Garden',
    note: 'Our weekly line-up. Times can shift with the weather - the front desk has the final word.',
    items: [
      { day: 'Daily', time: '3 - 6 PM', name: 'Happy Hour', where: 'The Terrace', desc: 'Crafted cocktails, wine and cold beer as the afternoon winds down.' },
      { day: 'Wednesday', time: 'All evening', name: 'Wine Wednesday', where: 'The Greenhouse', desc: 'A midweek pour worth staying in for.' },
      { day: 'Saturday', time: '3 PM', name: 'Pool Golf', where: 'Main Pool', desc: 'Floating putting, questionable technique, prizes.' },
      { day: 'Saturday', time: '6 - 9 PM', name: 'Live Music', where: 'The Terrace', desc: 'Local musicians, poolside, no cover.' },
      { day: 'Sunday', time: '9 - 10 AM', name: 'Yoga', where: 'The Putting Green', desc: 'Open-air flow to start the day. Mats provided.' },
    ],
  },
  venues: {
    title: 'Where to eat and drink',
    note: 'All on property - no car, no traffic, no plan required.',
    items: [
      {
        name: 'The Greenhouse',
        tagline: 'Garden-forward cooking where health-conscious dining meets indulgent classics, sourced locally wherever we can.',
        image: 'https://www.thegardenhotelandresort.com/wp-content/uploads/2026/01/R3_06824-scaled-1.jpg.webp',
        hours: [
          { label: 'Breakfast', value: 'Daily 7 - 11 AM' },
          { label: 'Lunch', value: 'Daily 11 AM - 5 PM' },
          { label: 'Dinner', value: 'Sun - Thu 5 - 10 PM / Fri - Sat 5 - 11 PM' },
          { label: 'Happy hour', value: 'Daily 3 - 6 PM' },
        ],
        note: 'Reservations are not required but encouraged on weekends and in peak season. Please avoid swim attire, gym attire or sleepwear.',
        phone: '954-563-3400',
        link: 'https://www.thegardenhotelandresort.com/dining/#dine_menu',
        linkLabel: 'Menu and reservations',
      },
      {
        name: 'The Greenhouse Cafe',
        tagline: 'Specialty coffee, house lattes, cold-pressed juice and gourmet sandwiches on your way to the beach. Bright indoor seating and free Wi-Fi.',
        image: 'https://www.thegardenhotelandresort.com/wp-content/uploads/2026/01/R3_06841.jpg.webp',
        hours: [{ label: 'Open', value: 'Daily 7 AM - 5 PM' }],
        note: 'Casual dress. Locals welcome.',
        phone: '954-563-3400',
        link: '',
        linkLabel: '',
      },
      {
        name: 'The Terrace at The Greenhouse',
        tagline: 'Drinks and bites by the pool in an open-air setting - the easy handoff from an afternoon swim to a slow evening.',
        image: '',
        hours: [{ label: 'Open', value: 'With restaurant hours' }, { label: 'Happy hour', value: 'Daily 3 - 6 PM' }, { label: 'Live music', value: 'Saturday 6 - 9 PM' }],
        note: '',
        phone: '954-563-3400',
        link: '',
        linkLabel: '',
      },
      {
        name: 'In-room dining',
        tagline: 'The full Greenhouse breakfast, lunch and dinner menu, plus dessert and a bottle of wine, brought to your door.',
        image: 'https://www.thegardenhotelandresort.com/wp-content/uploads/2026/01/In-Room-Dining.jpg.webp',
        hours: [{ label: 'Open', value: 'Daily 7:30 AM - 10 PM' }],
        note: 'To order, dial 0 on your in-room phone.',
        phone: '954-563-3400',
        link: '',
        linkLabel: '',
      },
    ],
  },
  menu: {
    title: 'On the menu',
    note: 'A taste of what is on offer. Seasonal items change - the full menu lives on the hotel site.',
    link: 'https://www.thegardenhotelandresort.com/dining/#dine_menu',
    linkLabel: 'See the full menu',
    groups: [
      {
        name: 'Breakfast - continental and light',
        note: 'Daily 7 - 11 AM',
        items: [
          { name: 'Greenhouse Breakfast', desc: 'Mini croissant, pain au chocolat, baguette with butter and jam, seasonal fruit, two pasture-raised eggs any style', price: '$17' },
          { name: 'Petit-Dejeuner Continental', desc: 'Mini-pastries, toasted baguette, butter and artisanal jam', price: '$12' },
          { name: 'Acai Bowl', desc: 'Acai puree, granola, berries, banana, shaved coconut, honey - gluten free', price: '$16' },
          { name: 'Farmhouse Granola Parfait', desc: 'Greek yogurt, almond butter, granola, seasonal fruit compote - gluten free', price: '$12' },
          { name: 'Overnight Oats', desc: 'Coconut milk, chia, oats, toasted coconut, sliced almonds, mixed berries - vegan', price: '$11' },
          { name: 'Creme Fraiche Pancakes', desc: 'Caramelized bananas, roasted pecans, maple syrup', price: '$15' },
        ],
      },
      {
        name: 'Breakfast - savory',
        note: '',
        items: [
          { name: 'Broken Yolk Sandwich', desc: 'Bacon, cheddar, spinach, roasted cherry tomatoes, sunny-side egg on toasted baguette', price: '$15' },
          { name: 'Smashed Avocado Tartine', desc: 'Toasted sourdough, roasted cherry tomatoes, avocado - vegan. Add egg $2, bacon $5, smoked salmon $6.50', price: '$14' },
          { name: 'Smoked Salmon Bagel', desc: 'Smoked salmon, chive cream cheese, red onion, capers', price: '$17' },
          { name: 'American Breakfast Platter', desc: 'Two pasture-raised eggs, crispy bacon, roasted house potatoes, baguette with butter and jam', price: '$16' },
          { name: 'Energizer Bowl', desc: 'Roasted house potatoes, bacon, avocado, chipotle aioli, sunny-side egg - gluten free', price: '$16' },
          { name: 'Greenhouse Omelet a la Carte', desc: 'Two eggs, choice of four fresh ingredients - gluten free', price: '$15' },
        ],
      },
      {
        name: 'Cafe - coffee',
        note: 'Daily 7 AM - 5 PM at The Greenhouse Cafe',
        items: [
          { name: 'Espresso / Double', desc: '', price: '$4 / $5' },
          { name: 'Americano', desc: '', price: '$4.50' },
          { name: 'Cappuccino', desc: '', price: '$5' },
          { name: 'Cortado', desc: '', price: '$4.50' },
          { name: 'Latte', desc: '', price: '$6' },
          { name: 'Iced Cold Brew', desc: '', price: '$6' },
          { name: 'Matcha Latte', desc: '', price: '$7' },
          { name: 'Affogato', desc: '', price: '$6' },
        ],
      },
      {
        name: 'House lattes',
        note: 'All $8. Syrups +$1, milk alternatives and cold foam +$1',
        items: [
          { name: 'Biscoff Latte', desc: 'Cookie butter, vanilla syrup, double espresso, cold foam, Biscoff crumbles', price: '$8' },
          { name: 'Tiramisu Latte', desc: 'Double espresso, vanilla cold foam, cocoa powder, lady finger', price: '$8' },
          { name: 'Iced Lavender Matcha Latte', desc: 'Ceremonial matcha, oat milk, lavender cold foam', price: '$8' },
          { name: 'Iced Honey Lavender Latte', desc: 'Double espresso, lavender cold foam', price: '$8' },
          { name: 'Iced Strawberry Matcha Latte', desc: 'Strawberry puree, honey, almond milk', price: '$8' },
        ],
      },
      {
        name: 'Fresh and cold-pressed juice',
        note: '',
        items: [
          { name: 'Fresh squeezed orange juice', desc: 'By the glass', price: '$7' },
          { name: 'Cold pressed juice', desc: 'Orange, watermelon, pineapple or apple - by the glass', price: '$11' },
          { name: 'Cold pressed bottles', desc: 'Le Carrot, Le Green, Le Beet, Le Celery - 12oz', price: '$12' },
          { name: 'Wellness shot', desc: 'Ginger turmeric - 2oz', price: '$7' },
        ],
      },
      {
        name: 'Pastry and treats',
        note: '',
        items: [
          { name: 'Croissant / Pain au Chocolat', desc: '', price: '$5' },
          { name: 'Madeleine', desc: '', price: '$3' },
          { name: 'Financier', desc: '', price: '$5' },
          { name: 'Brownie', desc: '', price: '$5' },
        ],
      },
      {
        name: 'Lunch and dinner',
        note: 'Lunch daily 11 AM - 5 PM / Dinner from 5 PM',
        items: [
          { name: 'Lunch', desc: 'Lean and energizing - salads, bowls, sandwiches and shareable plates. Vegan, vegetarian and gluten-free options always available.', price: '' },
          { name: 'Dinner', desc: 'Relaxed cafe dining with thoughtful entrees and small plates, indoors or poolside on The Terrace.', price: '' },
          { name: 'Happy hour', desc: 'Crafted cocktails, wine and cold beer, daily 3 - 6 PM.', price: '' },
        ],
      },
    ],
  },
  quotes: {
    title: 'What guests are saying',
    note: 'Pulled from real reviews of stays here.',
    auto: true,
    keywords: ['coffee', 'breakfast', 'food', 'restaurant', 'cafe', 'greenhouse', 'dinner', 'drinks', 'pool', 'staff'],
    items: [],
  },
  todo: {
    title: 'Things to do',
    note: '',
    groups: [
      {
        name: 'On property',
        items: [
          { name: 'Three outdoor pools', desc: 'Towels and loungers included. The Terrace bar is steps away.', meta: 'Included', url: '' },
          { name: 'Complimentary e-bikes', desc: 'The easiest way to reach the beach and the neighborhood. Ask at the front desk.', meta: 'Included', url: '' },
          { name: 'Garden games and putting green', desc: 'Lawn games, ping pong and a putting green that doubles as our Sunday yoga studio.', meta: 'Included', url: '' },
          { name: 'Coworking and Wi-Fi', desc: 'Bright indoor seating at the Cafe with free Wi-Fi - the best desk on property.', meta: 'Included', url: '' },
        ],
      },
      {
        name: 'Close by',
        items: [
          { name: 'Fort Lauderdale Beach', desc: 'A few blocks east. Take the complimentary EV shuttle or an e-bike.', meta: 'Walk / shuttle', url: '' },
          { name: 'Hugh Taylor Birch State Park', desc: 'Coastal hammock trails, kayaking and a quiet picnic spot right across the road.', meta: 'Minutes away', url: 'https://www.floridastateparks.org/parks-and-trails/hugh-taylor-birch-state-park' },
          { name: 'Las Olas Boulevard', desc: 'Galleries, boutiques and the restaurant strip - the classic Fort Lauderdale evening.', meta: 'Short drive', url: '' },
          { name: 'The Galleria', desc: 'Shopping and dining just south of the property.', meta: 'Short drive', url: '' },
          { name: 'Water Taxi', desc: 'See the city from the Intracoastal - stops along the beach and downtown.', meta: 'Nearby stop', url: 'https://watertaxi.com/' },
        ],
      },
    ],
  },
  gallery: {
    title: 'A look around',
    note: '',
    images: [
      { url: 'https://www.thegardenhotelandresort.com/wp-content/uploads/2026/01/Dive-across-pool.png.webp', caption: 'The main pool' },
      { url: 'https://www.thegardenhotelandresort.com/wp-content/uploads/2026/01/The-Garden-Hotel-6046-scaled-1-750x500.jpg.webp', caption: 'Lawn games in the courtyard' },
      { url: 'https://www.thegardenhotelandresort.com/wp-content/uploads/2026/06/The-Garden-Hotel-5968-750x500.jpg.webp', caption: 'Ping pong' },
      { url: 'https://www.thegardenhotelandresort.com/wp-content/uploads/2026/01/R3_06824-scaled-1.jpg.webp', caption: 'The Greenhouse' },
      { url: 'https://www.thegardenhotelandresort.com/wp-content/uploads/2026/01/R3_06841-750x500.jpg.webp', caption: 'The Greenhouse Cafe' },
      { url: 'https://www.thegardenhotelandresort.com/wp-content/uploads/2025/12/The-Garden-Hotel-5138-scaled-1-750x500.jpg.webp', caption: 'Breakfast' },
      { url: 'https://www.thegardenhotelandresort.com/wp-content/uploads/2026/01/In-Room-Dining-750x750.jpg.webp', caption: 'In-room dining' },
      { url: 'https://www.thegardenhotelandresort.com/wp-content/uploads/2026/06/R3_07304-750x500.jpg.webp', caption: 'Around the property' },
    ],
  },
  place: {
    title: 'Finding your way',
    address: '3711 N. Ocean Boulevard, Fort Lauderdale, FL 33308',
    mapQuery: '3711 N Ocean Blvd, Fort Lauderdale, FL 33308',
    note: 'On-site parking. The beach is a few blocks east - the shuttle and the e-bikes are both complimentary.',
    items: [
      { label: 'From FLL airport', value: 'About 20 - 25 minutes by car' },
      { label: 'To the beach', value: 'A few blocks - complimentary EV shuttle or e-bike' },
      { label: 'Parking', value: 'On-site, for guests and restaurant visitors' },
      { label: 'Las Olas Boulevard', value: 'About 10 minutes south' },
    ],
  },
  contact: {
    title: 'Reach a human',
    note: '',
    items: [
      { name: 'Front desk', role: 'Anything at all, 24 hours', phone: '954-563-3400', email: 'info@thegardenhotelandresort.com', note: 'Dial 0 from your room' },
      { name: 'The Greenhouse', role: 'Reservations and in-room dining', phone: '954-563-3400', email: '', note: 'Dining daily from 7 AM' },
      { name: 'Stay Hospitality', role: 'Your apartment, keys and check-in', phone: '', email: 'hello@stay-hospitality.com', note: 'We manage the residences here' },
    ],
  },
  footer: {
    note: 'Hours and events can change with the season and the weather - the front desk always has the final word.',
    signature: 'The Garden Hotel & Resort - residences managed by Stay Hospitality',
  },
  omit: [],
}

export const SEEDS: Record<string, Guide> = { garden: GARDEN, botanica: GARDEN }

export function seedFor(slug: string): Guide {
  const s = normSlug(slug)
  if (SEEDS[s]) return { ...SEEDS[s], slug: s }
  return blankGuide(s, s.charAt(0).toUpperCase() + s.slice(1))
}
