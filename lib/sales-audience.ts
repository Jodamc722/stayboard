// WHO A SALES DECK IS FOR (Jon, 2026-11-11: "we should be able to decide if we are creating a single
// owner deck, or one we are sending to buyers so they can review this and share with their clients").
// The audience is chosen when the deck is made (content.audience) and can be changed in the magazine.
// It sets which building pages print and how the cover and close speak; every page can still be
// switched on or off by hand afterwards.
export type Audience = 'owner' | 'agents' | 'building'
export const AUDIENCES: Record<Audience, {
  label: string; hint: string
  /** The masthead line on the cover. */
  mast: string
  /** "Prepared for …" reads as this when no name is given. */
  forDefault: string
  sections: { partner: boolean; second: boolean; market: boolean; glance: boolean; plans: boolean }
  /** The order of the three parts after the cover (Jon, 2026-11-11: "understand the difference between
   *  building facing, owner (individual facing) and realtor"). An owner sees their numbers first; an
   *  agent sees what is in it for them and their client first; a building team sees the operator first. */
  order: ('who' | 'work' | 'num')[]
  /** What the owner keeps after fees, shown by default (an owner asks; a building team does not). */
  net: boolean
  /** The titles and the close, each in that reader's terms (all still editable on the page). */
  secondKicker: string; secondTitle: string; workTitle: string; backTitle: string; backDek: string
}> = {
  // ONE OWNER: personal. Their residence's numbers first, then who would run it, then the terms. No
  // agent program; what they would keep after fees is shown.
  owner: { label: 'One owner', hint: 'A proposal for one owner and their residence: their numbers first, what they keep, the terms', mast: 'A Proposal for Your Residence', forDefault: '', sections: { partner: false, second: true, market: true, glance: true, plans: true },
    order: ['num', 'who', 'work'], net: true,
    secondKicker: 'What it costs, and how it works', secondTitle: 'Simple terms, *in writing*', workTitle: 'How we would work together',
    backTitle: 'Let’s talk about *your residence.*', backDek: 'A short call{with} to walk through your numbers, the terms, and how we would look after your home{at}.' },
  // REALTORS: what is in it for the agent and their client. The partner program first, then the
  // numbers they can hand a buyer, then the operator behind them. The close asks for a unit.
  agents: { label: 'Realtors and their buyers', hint: 'For agents to review and share with clients: the partner program, every floor plan’s numbers', mast: 'The Agent & Buyer Package', forDefault: 'Agents and their clients', sections: { partner: true, second: true, market: true, glance: true, plans: true },
    order: ['work', 'num', 'who'], net: false,
    secondKicker: 'When your buyer asks for options', secondTitle: 'Stay as a second option{at}', workTitle: 'For agents, and the buyers they bring',
    backTitle: 'Send us a unit. *We’ll send the numbers.*', backDek: 'Any unit you are showing or listing{at}: a projection for your buyer within 48 hours, and a call{with} whenever it helps.' },
  // THE BUILDING: the developer's or the building's sales team, a leave-behind for every owner. The
  // operator first, then how we work with the sales team, then every floor plan.
  building: { label: 'Building or developer', hint: 'For a building or developer sales team: a leave-behind on site, or sent to every owner', mast: 'The Building Package', forDefault: 'The sales team and every owner', sections: { partner: true, second: true, market: true, glance: true, plans: true },
    order: ['who', 'work', 'num'], net: false,
    secondKicker: 'For buyers who ask for options', secondTitle: 'Stay as a second option{at}', workTitle: 'For the sales team, and the buyers they bring',
    backTitle: 'Book a call *to learn more.*', backDek: 'A short call{with} to walk through these projections, the terms, and how we would run a home{at}.' },
}
export const audienceOf = (v: any): Audience => (v === 'agents' || v === 'building' || v === 'owner') ? v : 'building'
