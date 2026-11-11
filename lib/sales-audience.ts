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
}> = {
  owner: { label: 'One owner', hint: 'A proposal for one owner or buyer and their unit', mast: 'An Owner Proposal', forDefault: '', sections: { partner: false, second: true, market: true, glance: true, plans: true } },
  agents: { label: 'Buyers and agents', hint: 'A package agents review and share with their clients', mast: 'The Buyer & Agent Package', forDefault: 'Buyers, agents and their clients', sections: { partner: true, second: true, market: true, glance: true, plans: true } },
  building: { label: 'Building or developer', hint: 'For a building or developer sales team to leave on site or send to every owner', mast: 'The Building Package', forDefault: 'The sales team and every owner', sections: { partner: true, second: true, market: true, glance: true, plans: true } },
}
export const audienceOf = (v: any): Audience => (v === 'agents' || v === 'building' || v === 'owner') ? v : 'building'
