// GARDEN HOTEL SETTINGS — the hotel's profile, its voice, and its phone system. Three app_settings
// keys, each with defaults, so every reader gets a whole object even before anyone has saved.
//
// Jon, 2026-09-28: "create better settings"; "create the voice settings based on [Eve's] settings";
// "not sure about their call system yet, but build all the backend connection tools".
//
//   garden_hotel  who the hotel is: name, times, phones, what the desk does and when
//   garden_voice  how the hotel (and Adam) sound to a guest — a carbon of Eve's review voice:
//                 guidelines + examples, plus the sign-off, languages, and welcome-call bones
//   garden_phone  which phone system, how to reach it, and what counts as "reached"
import 'server-only'
import { getSetting, setSetting } from '../app-settings'

export const HOTEL_KEY = 'garden_hotel'
export const VOICE_KEY = 'garden_voice'
export const PHONE_KEY = 'garden_phone'

export type HotelSettings = {
  name: string; shortName: string; city: string; timezone: string
  checkInTime: string; checkOutTime: string
  frontDeskPhone: string; frontDeskEmail: string; managerName: string
  /** Welcome call: how many days before arrival to start, and what hours the desk calls. */
  welcomeCall: { enabled: boolean; daysBefore: number; fromHour: number; toHour: number; mandatoryFor: ('all' | 'direct' | 'ota' | 'long_stay')[]; longStayNights: number }
  verification: { requireId: boolean; requireCard: boolean; requireDeposit: boolean; depositAmount: number | null; sources: string[] }
  postStay: { callEnabled: boolean; reviewAskEnabled: boolean; hoursAfterCheckout: number }
  slackChannel: string | null
}
export const HOTEL_DEFAULTS: HotelSettings = {
  name: 'The Garden Hotel', shortName: 'Garden', city: 'Fort Lauderdale', timezone: 'America/New_York',
  checkInTime: '15:00', checkOutTime: '11:00',
  frontDeskPhone: '', frontDeskEmail: '', managerName: '',
  welcomeCall: { enabled: true, daysBefore: 2, fromHour: 9, toHour: 19, mandatoryFor: ['all'], longStayNights: 7 },
  verification: { requireId: true, requireCard: true, requireDeposit: false, depositAmount: null, sources: [] },
  postStay: { callEnabled: false, reviewAskEnabled: true, hoursAfterCheckout: 6 },
  slackChannel: null,
}

export type VoiceExample = { situation: string; reply: string }
export type VoiceSettings = {
  /** How the hotel writes and speaks to guests — the same shape as Eve's review voice. */
  guidelines: string
  examples: VoiceExample[]
  signOff: string
  languages: ('en' | 'es' | 'pt' | 'fr')[]
  /** Welcome call bones: what every call covers, in order. Adam turns these into a script per guest. */
  welcomeCallPoints: string[]
  reviewReply: { thankFirst: boolean; nameTheFix: boolean; maxSentences: number; neverMention: string[] }
}
export const VOICE_DEFAULTS: VoiceSettings = {
  guidelines: [
    'Warm, unhurried, specific. Sound like a small hotel that knows its guests by name, not a chain.',
    'Say the thing plainly. No corporate filler ("we strive to", "valued guest").',
    'Name the room, the date and the person who will handle it when there is one.',
    'Apologise once, clearly, then say what happens next. Never argue with a review in public.',
    'Short sentences. One idea per sentence. A guest reads this on a phone.',
  ].join('\n'),
  examples: [
    { situation: 'A 5-star review that praises the garden and the breakfast', reply: 'Thank you — the garden is the reason most of us work here, so it means a lot that it was the reason you stayed. Breakfast is Maria\'s; I will tell her. Come back when the mangoes are in.' },
    { situation: 'A 3-star review: room was lovely but the A/C was loud at night', reply: 'Thank you for telling us, and I am sorry the A/C kept you up — that is not the sleep we promise. The unit in that room was serviced this week and the compressor replaced. Next time, ask for me at the desk and I will make sure the room is right before you go up.' },
  ],
  signOff: '— The Garden Hotel front desk',
  languages: ['en', 'es'],
  welcomeCallPoints: [
    'Confirm the dates, the room type and how many are coming',
    'Arrival time and how they are getting here (parking, airport, the entrance to use)',
    'Check-in time and what to have ready (ID, the card on file)',
    'Anything they are celebrating or need (crib, late arrival, allergies)',
    'One thing to look forward to (the garden, breakfast hours, tonight\'s event)',
    'The front desk number, and that we are here around the clock',
  ],
  reviewReply: { thankFirst: true, nameTheFix: true, maxSentences: 5, neverMention: ['compensation amounts', 'other guests', 'staff by full name', 'legal language'] },
}

export type PhoneProvider = 'none' | 'talkroute' | 'twilio' | 'ringcentral' | 'webhook'
export type PhoneSettings = {
  provider: PhoneProvider
  /** The hotel's own numbers in the provider, digits only. Calls to/from these are the hotel's. */
  numbers: string[]
  /** Outbound answered but shorter than this = the guest's voicemail, not a conversation. */
  voicemailMaxSec: number
  /** For 'webhook': a shared token any system must send as ?token= to post a call in. */
  webhookToken: string | null
  /** For twilio/ringcentral: which env vars hold the credentials (never the values). */
  envHint: string
  lastSyncAt: string | null; lastError: string | null; lastCount: number | null
}
export const PHONE_DEFAULTS: PhoneSettings = { provider: 'none', numbers: [], voicemailMaxSec: 20, webhookToken: null, envHint: '', lastSyncAt: null, lastError: null, lastCount: null }

const merge = <T extends object>(d: T, v: any): T => (v && typeof v === 'object' ? { ...d, ...v } : d)
export async function getHotel(): Promise<HotelSettings> { const v = await getSetting<any>(HOTEL_KEY, null).catch(() => null); const m = merge(HOTEL_DEFAULTS, v); return { ...m, welcomeCall: merge(HOTEL_DEFAULTS.welcomeCall, v?.welcomeCall), verification: merge(HOTEL_DEFAULTS.verification, v?.verification), postStay: merge(HOTEL_DEFAULTS.postStay, v?.postStay) } }
export async function getVoice(): Promise<VoiceSettings> { const v = await getSetting<any>(VOICE_KEY, null).catch(() => null); const m = merge(VOICE_DEFAULTS, v); return { ...m, reviewReply: merge(VOICE_DEFAULTS.reviewReply, v?.reviewReply) } }
export async function getPhone(): Promise<PhoneSettings> { return merge(PHONE_DEFAULTS, await getSetting<any>(PHONE_KEY, null).catch(() => null)) }
export async function saveHotel(patch: Partial<HotelSettings>, by: string) { await setSetting(HOTEL_KEY, { ...(await getHotel()), ...patch }, by) }
export async function saveVoice(patch: Partial<VoiceSettings>, by: string) { await setSetting(VOICE_KEY, { ...(await getVoice()), ...patch }, by) }
export async function savePhone(patch: Partial<PhoneSettings>, by: string) { await setSetting(PHONE_KEY, { ...(await getPhone()), ...patch }, by) }

/** The voice as one block of text for a model prompt (Adam, review replies, call scripts). */
export function voiceBlock(v: VoiceSettings): string {
  return [
    'HOW THE HOTEL SOUNDS:', v.guidelines,
    v.examples.length ? 'EXAMPLES:\n' + v.examples.map(e => `- ${e.situation}\n  → ${e.reply}`).join('\n') : '',
    `Sign off: ${v.signOff}`, `Languages: ${v.languages.join(', ')} — answer in the guest's language.`,
  ].filter(Boolean).join('\n\n')
}
