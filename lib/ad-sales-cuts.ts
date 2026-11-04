// The two sales videos (Why owners choose Stay — full cut 1:13, Book a call — short cut 0:31) as Ad Studio
// projects, so they can be edited scene by scene (Jon, 2026-11-04: "two videos that I want to be able to edit …
// I love the way those look"). Same words, numbers, photos, voice take and timing as the rendered MP4s in the
// Videos library; the designs are the twelve PRO_KINDS in lib/ad-engine.ts.
import { type AdProject, type AdScene, voiceSig, VOICE_DEFAULTS } from './ad-engine'

const P = (n: string) => '/ads/sales/' + n + '.jpg'
let sid = 0
const S = (x: Partial<AdScene> & Pick<AdScene, 'kind'>): AdScene => ({ id: 'p' + (++sid), vo: '', head: '', sub: '', items: [], photos: [], tr: 'fade', ...x })

const NICK = { name: 'Nick Carline', role: 'Business Development · Stay Hospitality', phone: '651.200.8283', email: 'nicholas@stay-hospitality.com', photo: P('nick') }
const BUILDINGS: [string, string][] = [['elser-pool', 'Elser'], ['arya-pool', 'Arya'], ['amrit-ocean', 'Amrit'], ['salato-dusk', 'Salato'], ['nomad-roof', 'NoMad'], ['botanica-pool', 'The Botanica'], ['eden-coast', 'Eden'], ['capri-pool', 'Capri'], ['17west-bed', '17WEST']]
const LH_TILES = ['Listing optimization', 'Guest guidebooks', 'Recurring-issue detection', 'Automated tasks', 'Review + message monitoring', 'Guest ID + deposit checks', 'Spanish ⇄ English for the team', 'Smart turnover scheduling']
const lhgrid = (vo: string) => S({ kind: 'tilegrid', vo, head: 'Light**house**', eyebrow: 'Our own AI · built in-house', items: LH_TILES, photos: [P('nomad-lobby')], dim: 2 })
const switchScene = (vo: string) => S({ kind: 'curve', vo, head: 'Owners who switch\n**earn more.**', sub: 'Switch to Stay', items: ['Higher nightly rates', 'More booked nights', '40+ channels'], photos: [P('arya-pool')], dim: 2 })
const close = (vo: string) => S({ kind: 'contact', vo, head: 'Book a **call.**', photos: [P('amrit-ocean')] })

function full(): AdScene[] {
  sid = 0
  return [
    S({ kind: 'beats', vo: 'More revenue. A lower fee. One complete team. This is Stay Hospitality.', head: 'More **revenue.**\nLower **fee.**\nOne complete **team.**', photos: [P('salato-dusk')], dim: 1, tr: 'cut' }),
    S({ kind: 'tiles', vo: 'Four hundred and fifty listings across South Florida, and over a million guests hosted.', items: ['450+|listings', '140+|properties', '4|markets', '10|years in business', '1M+|guests hosted', '4.6/5|guest rating'], sub: 'Miami · Fort Lauderdale · Pompano Beach · Palm Beach', photos: [P('elser-marina')], dim: 0 }),
    S({ kind: 'grid', vo: '', photos: BUILDINGS.map(b => P(b[0])), items: BUILDINGS.map(b => b[1]) }),
    S({ kind: 'calendar', vo: 'It starts with revenue. Dedicated revenue managers price your home every day.', eyebrow: 'Nightly rate · next 5 weeks', sub: 'Comp set watched daily', items: ['Illustration of daily pricing. Real rates set by our revenue managers.', '189,179,185,199,259,289,229'], photos: [P('amrit-aerial')], dim: 2 }),
    S({ kind: 'dates', vo: "And the dates that matter most, like Art Basel and New Year's Eve, are priced months ahead.", eyebrow: 'High-demand dates · priced months ahead', items: ['Oct|Fort Lauderdale Boat Show|$289|$649', 'Dec|Art Basel Miami Beach|$309|$899', "Dec 31|New Year's Eve|$329|$999", 'Feb|Miami International Boat Show|$279|$619', 'May|Formula 1 Miami|$269|$759'], sub: 'Illustrative rates. Every event is priced to the demand it brings.', photos: [P('elser-aerial')], dim: 2 }),
    S({ kind: 'hub', vo: 'Then your home goes everywhere guests book, on more than forty channels.', eyebrow: 'Your home', sub: '**40+** channels · one calendar', items: ['Airbnb', 'Vrbo', 'Booking.com', 'Expedia', 'Marriott', 'Blueground', 'stay-hospitality.com'], photos: [P('eden-coast')], dim: 0 }),
    S({ kind: 'beforeafter', vo: 'Every listing is built to convert, and refreshed every three months.', sub: 'Condo w/ Pool', head: 'Salato Residences · Luxury Suite · Resort Pool · Pompano Beach', items: ['Hero photo: dusk exterior', 'Pool + suite up front', 'Title + copy rewritten', 'Refreshed every 3 months'], photos: [P('nomad-roof'), P('salato-shelf'), P('salato-lounge'), P('salato-suite'), P('salato-dusk'), P('salato-pool'), P('salato-suite')], dim: 2 }),
    lhgrid('Behind it all is Lighthouse, the AI platform we built in-house.'),
    S({ kind: 'livefeed', vo: 'It optimizes listings, builds guest guidebooks, and spots recurring issues before guests ever do.', eyebrow: 'Lighthouse', head: 'Our own AI.\n**Every stay.**', sub: 'Spots issues · automates the work', items: ['Same AC issue, 3rd time in 60 days|Recurring issue flagged · technician scheduled|#E07B5F', 'New listing live|Guest guidebook built|#D2B077', 'Listing slipping vs comp set|Photos reordered · copy refreshed|#4CC488', 'Review mentions the shower|Maintenance task created|#E0B44C', 'Guest message translated|ES → EN · sent to Customer Care|#6E9BE0'], photos: [P('elser-pool')], dim: 0 }),
    S({ kind: 'roles', vo: 'And one complete team does the work, from housekeeping to guest care.', head: 'One complete **team.**', items: ['Housekeeping', 'Maintenance', 'Inspections', 'Customer Care Team'], sub: 'Our people · photo-checked tasks · on the record', photos: [P('salato-pool')], dim: 0 }),
    switchScene("That's why owners who switch to Stay earn more, on a lower management fee."),
    close('Book a call with Nick, and see what your property can earn. 651-200-8283.'),
  ]
}
function short(): AdScene[] {
  sid = 0
  return [
    S({ kind: 'grid', vo: "Own a rental in South Florida? Here's how to earn more from it.", head: 'Own a rental in\n**South Florida?**', photos: ['elser-pool', 'arya-pool', 'amrit-ocean', 'salato-dusk', 'nomad-roof', 'botanica-pool', 'eden-coast', 'capri-pool', 'amrit-rooftop'].map(P), dim: 0, tr: 'cut' }),
    S({ kind: 'triad', vo: 'We price it every day, put it on more than forty channels, and run it with one complete team.', items: ['Priced daily|Dedicated revenue managers', '40+ channels|Everywhere guests book', 'One complete team|Housekeeping to guest care'], photos: [P('capri-loft'), P('amrit-rooftop'), P('eden-coast'), P('salato-pool')], dim: 2 }),
    lhgrid('All powered by Lighthouse, our own AI.'),
    switchScene('Owners who switch to Stay earn more, on a lower fee.'),
    close('Book a call with Nick today. 651-200-8283.'),
  ]
}
// The voice take each MP4 used (Victoria, one continuous take) and where every scene's line sits in it,
// from the ElevenLabs character alignment (sales-video/*_align.json).
const TAKES = {
  full: { path: 'public:/ads/sales/vo-full.mp3', dur: 68.023, starts: [0.0, 6.954, null, 14.954, 20.283, 26.75, 31.719, 36.816, 42.005, 49.413, 54.951, 60.268], ends: [6.177, 11.726, null, 19.459, 25.821, 30.86, 35.852, 41.019, 48.519, 53.987, 59.432, 67.989] },
  short: { path: 'public:/ads/sales/vo-short.mp3', dur: 25.208, starts: [0.0, 4.992, 11.598, 15.36, 20.387], ends: [4.075, 10.716, 14.489, 19.435, 25.17] },
}
export const SALES_CUTS = {
  full: { name: 'Why owners choose Stay — full cut', scenes: full },
  short: { name: 'Book a call — short cut', scenes: short },
}
export type SalesCut = keyof typeof SALES_CUTS

/** A fresh, editable copy of one of the two sales videos. */
export function salesProject(cut: SalesCut, id: string, by: string): AdProject {
  const now = new Date().toISOString()
  const voiceId = 'qSeXEcewz7tA0Q0qk9fH'
  const p: AdProject = {
    id, name: SALES_CUTS[cut].name + ' (editable)', prompt: 'Imported from the Videos library — the sales video, scene by scene.',
    format: '16:9', voiceId, voiceName: 'Victoria', voiceSettings: { ...VOICE_DEFAULTS, stability: 0.5, style: 0.2, speed: 1 },
    music: 'werq', musicVol: 0.28, captions: true, audience: 'owners', look: 'stay', goal: '', platform: '', kind: 'video', status: 'draft', notes: '',
    style: { font: 'auto', caps: 'auto', grade: 'auto', pace: 'normal', finish: 'clean', frame: 'none', logo: 'gold', wash: 'auto' },
    scenes: SALES_CUTS[cut].scenes(), contact: { ...NICK }, voice: null, createdAt: now, updatedAt: now, updatedBy: by,
  }
  const T = TAKES[cut]
  p.voice = { path: T.path, sig: voiceSig(p), voiceId, starts: T.starts, ends: T.ends, dur: T.dur } as any
  return p
}
