// WHO TO CALL, ON THE FREE NEED LIST (Jon, 2026-11-10: "a free thing to share with people online to
// help them determine what they need — SEO, owner acquisition. Have our email, Nick's phone number").
// Shown on /kit/plan, /kit/list and in every Excel the calculator makes. `person` is the named contact
// Nick Carline, business development. Jon, 2026-11-10: "the call is more for book a call (sales, Nick),
// not our CCS team", so the call to action is a sales call with Nick, not the support line. Isomorphic.
export type NeedContact = { company: string; tagline: string; email: string; phone: string; web: string; webUrl: string
  person: { name: string; role: string; phone: string; email: string } | null }

export const STAY_CONTACT: NeedContact = {
  company: 'Stay Hospitality',
  tagline: 'Short-term rental management across Miami-Dade and Broward',
  email: 'support@stay-hospitality.com',
  phone: '(954) 526-8998',
  web: 'stay-hospitality.com',
  webUrl: 'https://stay-hospitality.com',
  person: { name: 'Nick Carline', role: 'Business Development', phone: '(651) 200-8283', email: 'nicholas@stay-hospitality.com' },
}
export const contactLine = (c: NeedContact = STAY_CONTACT) =>
  [c.person ? `Want help managing your rental in South Florida? Call ${c.person.name}` : '', c.person?.phone || c.phone, c.person?.email || c.email, c.web].filter(Boolean).join('  ·  ')
/** The sales call: a tel: link and a mailto: with a subject, for the "Book a call" buttons. */
export const callTel = (c: NeedContact = STAY_CONTACT) => 'tel:+1' + (c.person?.phone || c.phone).replace(/\D/g, '')
export const callMail = (c: NeedContact = STAY_CONTACT) => `mailto:${c.person?.email || c.email}?subject=${encodeURIComponent('Help managing my rental')}`
