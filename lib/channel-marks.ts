// ── CHANNEL MARKS ───────────────────────────────────────────────────────────
// Jon, 2026-09-16: "grab a few of the logos… don't need all of them… more big picture."
//
// These are single-path monochrome glyphs from Simple Icons (the icon set is CC0; the marks
// themselves remain each brand's trademark). Showing a channel's mark to say "your calendar is
// live here" is ordinary nominative use — Stay genuinely distributes on all of them.
//
// They ship as path data compiled into the bundle rather than as URLs pointing at somebody
// else's server, because a hotlinked logo is a broken image on an owner's screen the first time
// that host changes a filename. Monochrome is also the design answer: six brand palettes at full
// saturation is a sticker sheet, and one ink colour reads as a partner wall.
//
// Vrbo, Hopper, Blueground, Whimstay and Google Vacation Rentals have no glyph in the set, so
// they carry as type in the tail line under the wall — which is the honest way round, since the
// reach is the argument, not the logos.
//
// TRIP.COM WAS REMOVED (Jon, 2026-09-18). Every other mark here is a channel we actually hold
// a connection to, or a storefront one of them feeds -- Hotels.com sells through Expedia, so
// its mark is earned. Trip.com was neither: no integration on any of the 290 listings. A logo
// wall an owner could disprove by clicking one of them is worse than a shorter wall.
export type ChannelMark = { name: string; d: string }

export const CHANNEL_MARKS: ChannelMark[] = [
  { name: "Airbnb", d: "M12.001 18.275c-1.353-1.697-2.148-3.184-2.413-4.457-.263-1.027-.16-1.848.291-2.465.477-.71 1.188-1.056 2.121-1.056s1.643.345 2.12 1.063c.446.61.558 1.432.286 2.465-.291 1.298-1.085 2.785-2.412 4.458zm9.601 1.14c-.185 1.246-1.034 2.28-2.2 2.783-2.253.98-4.483-.583-6.392-2.704 3.157-3.951 3.74-7.028 2.385-9.018-.795-1.14-1.933-1.695-3.394-1.695-2.944 0-4.563 2.49-3.927 5.382.37 1.565 1.352 3.343 2.917 5.332-.98 1.085-1.91 1.856-2.732 2.333-.636.344-1.245.558-1.828.609-2.679.399-4.778-2.2-3.825-4.88.132-.345.395-.98.845-1.961l.025-.053c1.464-3.178 3.242-6.79 5.285-10.795l.053-.132.58-1.116c.45-.822.635-1.19 1.351-1.643.346-.21.77-.315 1.246-.315.954 0 1.698.558 2.016 1.007.158.239.345.557.582.953l.558 1.089.08.159c2.041 4.004 3.821 7.608 5.279 10.794l.026.025.533 1.22.318.764c.243.613.294 1.222.213 1.858zm1.22-2.39c-.186-.583-.505-1.271-.9-2.094v-.03c-1.889-4.006-3.642-7.608-5.307-10.844l-.111-.163C15.317 1.461 14.468 0 12.001 0c-2.44 0-3.476 1.695-4.535 3.898l-.081.16c-1.669 3.236-3.421 6.843-5.303 10.847v.053l-.559 1.22c-.21.504-.317.768-.345.847C-.172 20.74 2.611 24 5.98 24c.027 0 .132 0 .265-.027h.372c1.75-.213 3.554-1.325 5.384-3.317 1.829 1.989 3.635 3.104 5.382 3.317h.372c.133.027.239.027.265.027 3.37.003 6.152-3.261 4.802-6.975z" },
  { name: "Booking.com", d: "M24 0H0v24h24ZM8.575 6.563h2.658c2.108 0 3.473 1.15 3.473 2.898 0 1.15-.575 1.82-.91 2.108l-.287.263.335.192c.815.479 1.318 1.389 1.318 2.395 0 1.988-1.51 3.257-3.857 3.257H7.449V7.713c0-.623.503-1.126 1.126-1.15zm1.7 1.868c-.479.024-.694.264-.694.79v1.893h1.676c.958 0 1.294-.743 1.294-1.365 0-.815-.503-1.318-1.318-1.318zm-.096 4.36c-.407.071-.598.31-.598.79v2.251h1.868c.934 0 1.509-.55 1.509-1.533 0-.934-.599-1.509-1.51-1.509zm7.737 2.394c.743 0 1.341.599 1.341 1.342a1.34 1.34 0 0 1-1.341 1.341 1.355 1.355 0 0 1-1.341-1.341c0-.743.598-1.342 1.34-1.342z" },
  { name: "Expedia", d: "M19.067 0H4.933A4.94 4.94 0 0 0 0 4.933v14.134A4.932 4.932 0 0 0 4.933 24h14.134A4.932 4.932 0 0 0 24 19.067V4.933C24.01 2.213 21.797 0 19.067 0ZM7.336 19.341c0 .19-.148.337-.337.337h-2.33a.333.333 0 0 1-.337-.337v-2.33c0-.189.148-.336.337-.336H7c.19 0 .337.147.337.337zm12.121-1.486-2.308 2.298c-.169.168-.422.053-.422-.2V9.57l-6.44 6.44a.533.533 0 0 1-.421.17H8.169a.32.32 0 0 1-.338-.338v-1.697c0-.2.053-.316.169-.422l6.44-6.44H4.058c-.253 0-.369-.253-.2-.421l2.297-2.309c.137-.137.285-.232.517-.232H18.15c.854 0 1.539.686 1.539 1.54v11.478c-.01.231-.095.368-.232.516z" },
  { name: "Marriott", d: "M8.802 11.083l-1.178 2.41c-.8 1.425-1.931 3.167-3.646 3.603-.668.232-1.255.023-1.9-.023L0 20.476a1.626 1.626 0 0 0 .59.386c3.647 1.39 5.122-.1 8.722-8.238l3.403 7.249h4.53l-2.14-4.893 1.213-2.53 3.345 7.311 4.337.027-7.59-16.677-3.475 1.738 2.738 6.222-1.201 2.445L9.45 2.678l-3.7 1.877Z" },
  { name: "Hotels.com", d: "M19.064 0H4.936a4.937 4.937 0 0 0-4.93 4.93V19.06A4.94 4.94 0 0 0 4.935 24h14.128a4.926 4.926 0 0 0 4.93-4.941V4.93A4.93 4.93 0 0 0 19.065 0zM8.55 10.63v2.329a.32.32 0 0 1-.337.337H5.884a.32.32 0 0 1-.337-.337V10.63c0-.2.137-.337.337-.337h2.34c.2 0 .336.137.336.337h-.01zm5.162 7.491a.32.32 0 0 1-.337.337h-2.328a.32.32 0 0 1-.337-.337v-2.328c0-.2.136-.337.337-.337h2.328c.19 0 .337.136.337.337v2.328zm0-5.162a.32.32 0 0 1-.337.337h-2.328a.32.32 0 0 1-.337-.337V10.63c0-.2.136-.337.337-.337h2.328c.2 0 .337.137.337.337v2.329zm5.974 4.372a.654.654 0 0 1-.22.516l-2.308 2.297c-.18.168-.432.052-.432-.2V7.28H4.062c-.253 0-.369-.264-.2-.432L6.169 4.55c.137-.147.274-.232.506-.232h11.473c.854 0 1.538.685 1.538 1.539V17.33z" },
]

// ── THE REACH, IN ONE PLACE ─────────────────────────────────────────────────
// These two live beside the marks, and in a client-safe module, for the same reason the season
// curve lives beside its headline: the slide prints them next to each other, and a deck
// generated before 2026-09-18 froze the retired pair ("30+" over a wall of 22 names, two of them
// duplicates) into its own content JSON. ReportView substitutes BOTH on a stale deck or neither,
// so the number beside the paragraph can never contradict it.
//
// Sourced, not recalled. Nine connections is ours (guesty_listings.raw.integrations, 290
// listings, 8.0 average). 200+ is Expedia Group's own published figure for the websites it
// operates; Booking.com's parent adds Priceline, Agoda, Kayak and Momondo on top of it.
export const CHANNEL_COUNT = '40+'
// THE PARAGRAPH CANNOT NAME A DIFFERENT NUMBER THAN THE ONE PRINTED BESIDE IT. A draft of this
// said "nine channel connections" under a 40+ headline, which is the season-slide mistake again:
// two numbers arguing with each other in front of an owner. The count carries the breadth; the
// paragraph carries the reason breadth is worth anything, which is that the biggest names on the
// list are networks rather than single websites.
export const CHANNEL_BODY =
  'Your calendar is one calendar. We publish it everywhere that matters and reconcile every booking back to a single place, which is the only reason a unit can be priced for occupancy and still never be double-booked. The biggest names on that list are networks rather than websites: a listing on Expedia is a listing on Hotels.com, Orbitz, Travelocity and Hotwire, and Booking.com carries Priceline, Agoda and Kayak behind it. Most owners arrive on one channel.'
/** Retired defaults. A deck still carrying one of these was never edited on this slide. */
export const CHANNEL_COUNT_RETIRED = ['30+', '200+']
