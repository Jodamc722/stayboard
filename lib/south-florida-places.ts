// THE PLACES GUESTS BOOK SOUTH FLORIDA FOR (2026-10-05, Jon: "use photo and location address to share
// important local activities and popular areas, maybe having to commute away … setting expectation,
// painting a story and getting people to book").
//
// A curated, coordinates-known list of the beaches, districts, landmarks, airports, stations, ports
// and arenas a guest would actually ask about — the things an honest Neighborhood section names.
// The copywriter was never allowed to name a place on its own (lib/listing-rules HONESTY), and only
// 13 buildings had a hand-written pack, so most listings said "a short walk to the beach" and nothing
// else. With this list and the unit's lat/lng, lib/local-area works out the real walk / drive time to
// each and hands the model a VERIFIED list it may use by name.
//
// Keep it to places with durable, unambiguous identity (a beach, a boulevard, an airport), never a
// single restaurant or bar — those change hands; building packs and the guidebook carry those.
// Coordinates are to ~3 decimals (≈100 m), which is all a walk time needs. Staff can hide any entry
// per building and add their own in the Area tab.
export type PlaceKind = 'beach' | 'district' | 'landmark' | 'park' | 'shopping' | 'airport' | 'station' | 'port' | 'arena' | 'nature'
export type Place = {
  id: string; name: string; kind: PlaceKind; lat: number; lng: number
  /** One short factual clause the copy may use ("pedestrian dining and shopping street"). */
  what: string
  /** Where it reads as a draw from. A beach is local; an airport or stadium is a region-wide fact. */
  reach: 'local' | 'regional'
}

export const SOUTH_FLORIDA_PLACES: Place[] = [
  // ── Miami Beach ──
  { id: 'south-beach', name: 'South Beach', kind: 'beach', lat: 25.782, lng: -80.131, what: 'the Art Deco beachfront, Ocean Drive and the lifeguard towers', reach: 'local' },
  { id: 'ocean-drive', name: 'Ocean Drive', kind: 'district', lat: 25.780, lng: -80.130, what: 'Art Deco hotels, sidewalk cafés and nightlife along the beach', reach: 'local' },
  { id: 'lincoln-road', name: 'Lincoln Road', kind: 'district', lat: 25.790, lng: -80.137, what: 'pedestrian shopping and dining mall', reach: 'local' },
  { id: 'espanola-way', name: 'Española Way', kind: 'district', lat: 25.786, lng: -80.133, what: 'a two-block Mediterranean-style street of restaurants', reach: 'local' },
  { id: 'mid-beach', name: 'Mid-Beach (Faena District)', kind: 'district', lat: 25.813, lng: -80.122, what: 'the quieter oceanfront strip of hotels and the beachwalk', reach: 'local' },
  { id: 'north-beach', name: 'North Beach', kind: 'beach', lat: 25.855, lng: -80.120, what: 'a calmer, more local stretch of Miami Beach with the oceanside park', reach: 'local' },
  { id: 'miami-beach-boardwalk', name: 'Miami Beach Boardwalk', kind: 'nature', lat: 25.800, lng: -80.125, what: 'the oceanfront walking and cycling path', reach: 'local' },
  { id: 'bal-harbour-shops', name: 'Bal Harbour Shops', kind: 'shopping', lat: 25.888, lng: -80.125, what: 'open-air luxury shopping', reach: 'local' },
  { id: 'haulover-beach', name: 'Haulover Beach', kind: 'beach', lat: 25.905, lng: -80.122, what: 'a wide county beach and park north of Bal Harbour', reach: 'local' },
  // ── Miami mainland ──
  { id: 'brickell', name: 'Brickell', kind: 'district', lat: 25.761, lng: -80.192, what: 'the high-rise financial district with Brickell City Centre and rooftop bars', reach: 'local' },
  { id: 'downtown-miami', name: 'Downtown Miami', kind: 'district', lat: 25.774, lng: -80.191, what: 'Bayfront Park, the arena and the Metromover loop', reach: 'local' },
  { id: 'bayside', name: 'Bayside Marketplace', kind: 'shopping', lat: 25.778, lng: -80.186, what: 'waterfront shops, restaurants and boat tours', reach: 'local' },
  { id: 'wynwood', name: 'Wynwood', kind: 'district', lat: 25.801, lng: -80.199, what: 'the street-art district — Wynwood Walls, breweries and galleries', reach: 'local' },
  { id: 'design-district', name: 'Miami Design District', kind: 'district', lat: 25.813, lng: -80.193, what: 'luxury fashion, design showrooms and the ICA museum', reach: 'local' },
  { id: 'little-havana', name: 'Little Havana (Calle Ocho)', kind: 'district', lat: 25.765, lng: -80.219, what: 'Cuban cafés, cigar shops and Domino Park on SW 8th Street', reach: 'local' },
  { id: 'coconut-grove', name: 'Coconut Grove', kind: 'district', lat: 25.728, lng: -80.242, what: 'a leafy bayside village with marinas and CocoWalk', reach: 'local' },
  { id: 'coral-gables', name: 'Coral Gables (Miracle Mile)', kind: 'district', lat: 25.750, lng: -80.259, what: 'Mediterranean-style streets, Miracle Mile dining and the Venetian Pool', reach: 'local' },
  { id: 'key-biscayne', name: 'Key Biscayne (Crandon Park)', kind: 'beach', lat: 25.712, lng: -80.157, what: 'island beaches and Bill Baggs lighthouse park', reach: 'local' },
  { id: 'vizcaya', name: 'Vizcaya Museum & Gardens', kind: 'landmark', lat: 25.744, lng: -80.210, what: 'the bayfront 1916 villa and gardens', reach: 'local' },
  { id: 'perez-art-museum', name: 'Pérez Art Museum Miami', kind: 'landmark', lat: 25.786, lng: -80.186, what: 'the bayfront art museum beside the Frost science museum', reach: 'local' },
  { id: 'kaseya-center', name: 'Kaseya Center', kind: 'arena', lat: 25.781, lng: -80.187, what: 'home of the Miami Heat and big concerts', reach: 'regional' },
  { id: 'loandepot-park', name: 'loanDepot park', kind: 'arena', lat: 25.778, lng: -80.220, what: 'the Marlins’ ballpark in Little Havana', reach: 'regional' },
  { id: 'hard-rock-stadium', name: 'Hard Rock Stadium', kind: 'arena', lat: 25.958, lng: -80.239, what: 'the Dolphins, the Miami Open and the F1 Grand Prix', reach: 'regional' },
  { id: 'aventura-mall', name: 'Aventura Mall', kind: 'shopping', lat: 25.957, lng: -80.143, what: 'one of the largest malls in the US', reach: 'local' },
  { id: 'port-miami', name: 'PortMiami', kind: 'port', lat: 25.777, lng: -80.170, what: 'the cruise port', reach: 'regional' },
  { id: 'mia', name: 'Miami International Airport (MIA)', kind: 'airport', lat: 25.795, lng: -80.287, what: 'the main Miami airport', reach: 'regional' },
  { id: 'brightline-miami', name: 'Brightline MiamiCentral', kind: 'station', lat: 25.779, lng: -80.196, what: 'the downtown rail station to Fort Lauderdale, Boca, West Palm and Orlando', reach: 'regional' },
  { id: 'brightline-aventura', name: 'Brightline Aventura', kind: 'station', lat: 25.957, lng: -80.148, what: 'Brightline station beside Aventura Mall', reach: 'regional' },
  // ── Fort Lauderdale / Broward ──
  { id: 'fll-beach', name: 'Fort Lauderdale Beach', kind: 'beach', lat: 26.122, lng: -80.105, what: 'the wide public beach along A1A with the signature wave wall', reach: 'local' },
  { id: 'las-olas', name: 'Las Olas Boulevard', kind: 'district', lat: 26.119, lng: -80.137, what: 'the main dining, gallery and boutique street', reach: 'local' },
  { id: 'fll-riverwalk', name: 'Riverwalk Fort Lauderdale', kind: 'park', lat: 26.119, lng: -80.148, what: 'the New River promenade through downtown and the arts district', reach: 'local' },
  { id: 'flagler-village', name: 'Flagler Village', kind: 'district', lat: 26.131, lng: -80.141, what: 'the arts-and-breweries district north of downtown with FATVillage', reach: 'local' },
  { id: 'galleria-fll', name: 'The Galleria at Fort Lauderdale', kind: 'shopping', lat: 26.133, lng: -80.115, what: 'the mall on Sunrise Boulevard near the beach', reach: 'local' },
  { id: 'hugh-taylor-birch', name: 'Hugh Taylor Birch State Park', kind: 'park', lat: 26.141, lng: -80.106, what: 'a state park of trails and lagoons across A1A from the beach', reach: 'local' },
  { id: 'bonnet-house', name: 'Bonnet House Museum & Gardens', kind: 'landmark', lat: 26.133, lng: -80.106, what: 'the historic beachside estate and gardens', reach: 'local' },
  { id: 'lauderdale-by-the-sea', name: 'Lauderdale-by-the-Sea', kind: 'beach', lat: 26.191, lng: -80.096, what: 'a low-rise beach town with the Anglin’s fishing pier and shore snorkelling', reach: 'local' },
  { id: 'wilton-manors', name: 'Wilton Drive (Wilton Manors)', kind: 'district', lat: 26.158, lng: -80.137, what: 'a lively strip of restaurants and bars', reach: 'local' },
  { id: 'port-everglades', name: 'Port Everglades', kind: 'port', lat: 26.093, lng: -80.120, what: 'the Fort Lauderdale cruise port', reach: 'regional' },
  { id: 'fll', name: 'Fort Lauderdale–Hollywood International Airport (FLL)', kind: 'airport', lat: 26.072, lng: -80.153, what: 'the Fort Lauderdale airport', reach: 'regional' },
  { id: 'brightline-fll', name: 'Brightline Fort Lauderdale', kind: 'station', lat: 26.121, lng: -80.145, what: 'the downtown rail station to Miami, Boca, West Palm and Orlando', reach: 'regional' },
  { id: 'hollywood-beach', name: 'Hollywood Beach Broadwalk', kind: 'beach', lat: 26.013, lng: -80.117, what: 'the 2.5-mile oceanfront Broadwalk of cafés and bike lanes', reach: 'local' },
  { id: 'hard-rock-hollywood', name: 'Seminole Hard Rock Hollywood', kind: 'landmark', lat: 26.051, lng: -80.211, what: 'the Guitar Hotel casino, concerts and pool complex', reach: 'regional' },
  { id: 'dania-beach', name: 'Dania Beach', kind: 'beach', lat: 26.057, lng: -80.112, what: 'a quieter beach and pier between Hollywood and Fort Lauderdale', reach: 'local' },
  { id: 'pompano-pier', name: 'Pompano Beach Fisher Family Pier', kind: 'beach', lat: 26.231, lng: -80.088, what: 'the rebuilt pier and oceanfront dining village', reach: 'local' },
  { id: 'hillsboro-inlet', name: 'Hillsboro Inlet Lighthouse', kind: 'landmark', lat: 26.259, lng: -80.081, what: 'the working lighthouse at the inlet', reach: 'local' },
  { id: 'deerfield-pier', name: 'Deerfield Beach International Fishing Pier', kind: 'beach', lat: 26.318, lng: -80.074, what: 'the beach and pier at Deerfield', reach: 'local' },
  { id: 'sawgrass-mills', name: 'Sawgrass Mills', kind: 'shopping', lat: 26.150, lng: -80.325, what: 'the outlet mall in Sunrise', reach: 'regional' },
  { id: 'everglades-holiday-park', name: 'Everglades Holiday Park', kind: 'nature', lat: 26.062, lng: -80.443, what: 'airboat rides into the Everglades', reach: 'regional' },
  // ── Palm Beach County ──
  { id: 'boca-mizner', name: 'Mizner Park (Boca Raton)', kind: 'district', lat: 26.355, lng: -80.084, what: 'the open-air shopping, dining and amphitheatre plaza', reach: 'local' },
  { id: 'boca-beach', name: 'Boca Raton beaches (Red Reef & South Beach Park)', kind: 'beach', lat: 26.366, lng: -80.069, what: 'dune-backed public beaches with reef snorkelling at Red Reef', reach: 'local' },
  { id: 'brightline-boca', name: 'Brightline Boca Raton', kind: 'station', lat: 26.351, lng: -80.088, what: 'the Boca rail station', reach: 'regional' },
  { id: 'delray-atlantic', name: 'Atlantic Avenue (Delray Beach)', kind: 'district', lat: 26.461, lng: -80.072, what: 'a walkable mile of restaurants and bars ending at the beach', reach: 'local' },
  { id: 'delray-beach', name: 'Delray Municipal Beach', kind: 'beach', lat: 26.461, lng: -80.059, what: 'the public beach at the foot of Atlantic Avenue', reach: 'local' },
  { id: 'lake-worth-beach', name: 'Lake Worth Beach & Pier', kind: 'beach', lat: 26.613, lng: -80.037, what: 'the public beach, casino building and fishing pier', reach: 'local' },
  { id: 'lake-worth-downtown', name: 'Downtown Lake Worth Beach (Lake & Lucerne Avenues)', kind: 'district', lat: 26.615, lng: -80.056, what: 'the historic downtown of restaurants, bars and the Cultural Plaza', reach: 'local' },
  { id: 'palm-beach-worth-ave', name: 'Worth Avenue (Palm Beach)', kind: 'district', lat: 26.701, lng: -80.036, what: 'the island’s luxury shopping street', reach: 'local' },
  { id: 'west-palm-clematis', name: 'Clematis Street & Rosemary Square (West Palm Beach)', kind: 'district', lat: 26.713, lng: -80.052, what: 'downtown West Palm’s dining, bars and waterfront', reach: 'local' },
  { id: 'brightline-wpb', name: 'Brightline West Palm Beach', kind: 'station', lat: 26.713, lng: -80.056, what: 'the West Palm rail station', reach: 'regional' },
  { id: 'pbi', name: 'Palm Beach International Airport (PBI)', kind: 'airport', lat: 26.683, lng: -80.096, what: 'the West Palm Beach airport', reach: 'regional' },
  { id: 'john-prince-park', name: 'John Prince Park', kind: 'park', lat: 26.592, lng: -80.078, what: 'the large lakeside county park', reach: 'local' },
]

/** Straight-line metres between two points. */
export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000, toR = (d: number) => d * Math.PI / 180
  const dLat = toR(bLat - aLat), dLng = toR(bLng - aLng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}
