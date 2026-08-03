// Shared slim-select for guesty_listings when the ONLY reason to read `raw` is the optimize/health
// score (computeScore / computeListingHealth). Those read ~18 specific sub-fields; selecting them by
// JSON-path instead of the full 50-150KB `raw` blob cuts payload ~10x on multi-thousand-row pulls.
// rehydrateRaw() rebuilds the exact `raw` shape those functions expect from the aliased columns.
// Keep this the single source of truth so /health and /ops-plan never drift to different scores.
export const LISTING_SLIM_SELECT =
  'id, title, nickname, building, unit, status, bedrooms, bathrooms, max_occupancy, amenities, pictures, address_city, rawPub:raw->publicDescription, rawPubs:raw->publicDescriptions, rawTerms:raw->terms, rawPrices:raw->prices, rawInts:raw->integrations, rawIb:raw->instantBookable, rawIb2:raw->instantBook, rawCi:raw->>defaultCheckInTime, rawCi2:raw->>checkInTime, rawCo:raw->>defaultCheckOutTime, rawCo2:raw->>checkOutTime, rawPs:raw->_photoScore, rawCp:raw->>cancellationPolicy, rawAirbnb:raw->airbnb, rawBcom:raw->bookingcom, rawTitle:raw->>title, rawMinN:raw->defaultListingMinNights, rawAmen:raw->amenities'

export function rehydrateRaw(l: any): any {
  return {
    ...l,
    raw: {
      publicDescription: l.rawPub, publicDescriptions: l.rawPubs, terms: l.rawTerms, prices: l.rawPrices,
      integrations: l.rawInts, instantBookable: l.rawIb, instantBook: l.rawIb2, defaultCheckInTime: l.rawCi,
      checkInTime: l.rawCi2, defaultCheckOutTime: l.rawCo, checkOutTime: l.rawCo2, _photoScore: l.rawPs,
      cancellationPolicy: l.rawCp, airbnb: l.rawAirbnb, bookingcom: l.rawBcom, title: l.rawTitle,
      defaultListingMinNights: l.rawMinN, amenities: l.rawAmen,
    },
  }
}
