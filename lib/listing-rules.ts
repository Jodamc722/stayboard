// THE RULES THE OPERATOR CANNOT EDIT — kept here so they can at least be READ.
//
// These three blocks are ~500 words of instruction that go into every listing-content call, and
// until now they lived as string constants inside the route. Two consequences:
//
//   1. The settings panel showed a HAND-WRITTEN PARAPHRASE of the honesty rules instead of the real
//      text, and the two had already drifted — the paraphrase had lost "it is far better to say
//      less, accurately, than to say more and be wrong", lost the landmark examples, and had
//      silently merged in a photo rule that lives somewhere else entirely. Somebody tuning tone was
//      reading a summary of the rules rather than the rules.
//   2. The photo rules were not shown anywhere at all, so the single biggest influence on how "The
//      space" gets written was invisible to the person trying to influence how it gets written.
//
// They stay UNEDITABLE on purpose: a prompt experiment must never be able to put a wrong fact on a
// live listing. But uneditable is not a reason to be unreadable. This file is pure (no server-only
// import) precisely so the admin panel can render the exact strings the model receives.
//
// If you change a rule here, it changes for the model and for the panel in the same commit. That is
// the whole point of the file.

export const HONESTY = `ABSOLUTE HONESTY (THE MOST IMPORTANT RULE)
- Use ONLY facts present in the JSON below (data, location, current content, review signal, booking settings, photo index). If you are NOT certain of something — an exact distance, a specific restaurant/shop/attraction name, a drive time, an amenity, a view, a room count — DO NOT state it. Omit it or stay general. Never guess, never embellish, never invent.
- It is far better to say less, accurately, than to say more and be wrong. This copy goes on a live listing.

LOCATION (use it; never print it verbatim)
- A real address/area is provided. Use it ONLY to identify the actual city/neighborhood so you can name genuinely well-known, real nearby places for THAT exact city (e.g. for Miami Beach: South Beach, Lincoln Road, Ocean Drive; for Fort Lauderdale: Las Olas, Fort Lauderdale Beach). Reference only landmarks you are confident actually exist for that city.
- NEVER print the exact street address, unit number, lock/door codes, phone, email, or URLs anywhere in the copy. Keep proximity general ("a short walk to the beach") unless the data gives an exact distance.
- PARKING: describe only the parking the data confirms. If a VERIFIED BUILDING FACTS block states a garage, it is a garage and you should say so — that is a booking driver. If nothing confirms parking, do not mention it.

THE ONE EXCEPTION TO ALL OF THE ABOVE
- If a block headed VERIFIED BUILDING FACTS appears below, everything in it was written and checked by Stay staff. You MAY state those places, distances and walk times specifically and by name. That block is the ONLY licence to be that specific — it does not extend to anything you know from elsewhere.`

export const PHOTO_RULES_LABELLED = `PHOTOS (you can SEE them, and they are LABELLED)
- Each attached photo is introduced by a line naming the room it shows and what is in it. That labelling was produced by a vision pass over the whole photo set — trust it for WHICH space you are looking at, and use the image itself for how it looks.
- Every photo attached here is a real photo OF THIS home or its building. Generic area/stock imagery has already been filtered out, so you do not need to second-guess it — but still never describe something a photo does not show.
- Ground the copy, especially "The space", in these photos: layout, light, finishes, views, outdoor areas, standout features. Walk the home in the order the rooms are labelled.
- A "coverage" note may tell you which key spaces are well shown and which have no photo at all. Lean on what is shown; do not write vividly about a room nobody photographed.`

export const PHOTO_RULES_RAW = `PHOTOS (you can SEE them — use them)
- The listing's actual photos are attached. STUDY them. Ground the copy (especially "The space") in what the images genuinely show: layout, light, finishes, views, outdoor areas, standout features.
- Use the photos to VERIFY before you write. Only describe what is visible in a photo or stated in the data. If a claimed amenity/view isn't visible or in the data, leave it out. The photos are your fact-check.
- REAL vs STOCK: some photos are NOT of this home - they are generic area/stock shots (city skyline, beach, map, sunset, neighborhood landmarks, building exterior renderings, lifestyle/decor stock). You must tell these apart. ONLY ground home-feature claims (rooms, layout, finishes, views from the unit, the unit's outdoor space) in photos that genuinely show THIS unit or building. Generic area/stock photos may ONLY inform the Neighborhood section - never describe them as part of the home.
- Lead with the most visually compelling TRUE selling points. Make a reader picture themselves there.`
