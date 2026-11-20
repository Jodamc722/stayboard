// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// THE BRIEFS THE MODELS RECEIVE. Three calls make a piece, and each gets every one of Jon's ad rules in words:
//   conceptPrompt   three different ideas for the confirmed brief (cheap tier, shown as low-fidelity previews)
//   copyPrompt      three ways to say it: a spoken line and an on-screen headline per scene, and a caption
//   composerSystem  + composerUser: the art director writes the composition for THIS event, audience and photographs
//   repairPrompt    the audit's findings handed back once, for the scenes that failed
// The composer is told the format from the same constants the validator enforces, so the two cannot drift.
// Pure string builders; client and server safe.
import type { Brief, Composition, PhotoAsset } from './composition'
import { CHANNELS, EASES, TRANSITIONS, DIRS, TREATMENTS, MASKS, SHAPES, MOTIFS, MOTIF_VARIANTS, DRESSES, PRESETS, FROMS, LOOK_KEYS, FONT_FAMILIES, GUEST_CTA, OWNER_CTA, CHANNEL_NAMES, DEAD_BAND_MAX, MIN_LABEL_PX, MIN_HEADLINE_PX, MAX_PHOTO_UPSCALE } from './composition'
import { IDENTITIES, LOOKS, SALES_FACTS, type Identity } from './identities'

const or = (list: readonly string[]) => list.map(x => `"${x}"`).join(' | ')

/** Jon's rules, stated once and used in every prompt. */
export function houseRules(audience: 'guests' | 'owners'): string {
  const guests = audience !== 'owners'
  return `BRAND
- The Stay logo is black. Use the black mark on light grounds and the white mark (which may be tinted to a palette colour) on dark grounds. Black is the house default; gold appears only where the event's palette has it.
- ${guests ? `This is a GUEST piece: no prices, no discounts, no "deals", no phone number, never "call us". The only ask is "${GUEST_CTA}", on a button in the last scene.` : `This is an OWNER piece for people not yet with us: it ends on Nick's line, "${OWNER_CTA}". Build it for an owner: how the date is priced, where the listing sells, who looks after the unit. Never generic.`}
FACTS YOU MAY STATE
${SALES_FACTS}
WORDS
- Spoken lines never contain "Salato" or "Pompano Beach" (the voice mispronounces them). They may appear on screen.
- No hype words: "luxury", "paradise", "unforgettable", "nestled", "experience". No exclamation marks.
PHOTOGRAPHS
- One photograph on screen at a time. Never a grid, a collage, a split screen or a strip of photos.
- A photograph is used once in a piece.
- The words of a scene describe what its photograph shows. If no photograph shows it, change the words.
- Only our units in the area of the brief. Scenes that describe one stay (the kitchen, the table, the pool) come from the same building, and carry a small label naming it.
- A photograph is never drawn larger than ${Math.round(MAX_PHOTO_UPSCALE * 100)}% of its real pixels. Most listing photos are 1200 x 800 landscape: on a tall canvas they go in windows, never full bleed. Only a photograph at least 2400 px on its long side may fill a tall frame.
- Photographs are untreated ("treatment": "none"). Never darken a photograph to make words readable: put the words on a ground.`
}

/** The composition format, written from the validator's own lists. */
export function formatSpec(): string {
  return `You write ONE JSON object. Coordinates are canvas pixels from the top-left. Colours are a key of tokens.color or "#RRGGBB".
{
  "concept": { "name": "...", "idea": "one sentence", "look": ${or(LOOK_KEYS)}, "identity": "<event key>" },
  "tokens": {
    "color": { "<key>": "#RRGGBB", ... },                    // the palette of this piece (up to 12)
    "type": { "display": TYPE, "displayAccent": TYPE, "label": TYPE, "button": TYPE },
    "motion": { "language": "one word", "ease": EASE, "easeMove": EASE }
  },
  "scenes": [ { "id": "s1", "name": "...", "dur": seconds, "transitionIn": TRANSITION, "layers": [ LAYER, ... ] }, ... ],
  "script": { "lines": [ { "scene": "s1", "vo": "the spoken line" }, ... ], "alternates": { "s1": ["...", "..."] } },
  "social": { "caption": "...", "captionAlternates": ["...", "..."], "hashtags": ["#..."] }
}
TYPE = { "family": ${or(FONT_FAMILIES)}, "weight": 400-800, "style": "normal" | "italic" (italic exists for Fraunces only), "lineHeight": 0.9-1.6, "tracking": -0.05 to 0.4 (em), "upper": true|false }
EASE = ${or(EASES)}
TRANSITION = { "type": ${or(TRANSITIONS)}, "dir": ${or(DIRS)} (push, slide, wipe), "dur": 0.2-1.0, "ease": EASE }   // the first scene is "none"
BOX = { "x": n, "y": n, "w": n, "h": n }
ENTRANCE ("in") = { "preset": ${or(PRESETS)}, "at": seconds from the scene's start, "dur": seconds, "ease": EASE,
                    "stagger": seconds (rise-lines), "from": ${or(FROMS)} (wipe, draw), "fromY": pixels and "spin": degrees (settle) }
   rise-lines: each line of words rises out of its own mask. wipe: a photograph or block is revealed from one side. draw: a rule draws itself.
   settle: a motif drifts in once and comes to rest. light-up: bulbs come on in sequence. track-in: letter-spacing closes. pop: a button lands.
LAYER (drawn in order, first at the back; every layer has a unique "id", optional "opacity" 0-1, "rotate" degrees, "in"):
  { "type": "fill", "color": C }                                                  // the scene's ground; put one first
  { "type": "photo", "photo": "<id from the photograph list>", "box": BOX, "focal": { "x": 0-1, "y": 0-1 }, "treatment": ${or(TREATMENTS)},
    "mask": { "shape": ${or(MASKS)}, "radius": n }, "camera": { "from": { "scale": 1-1.6, "x": -0.2..0.2, "y": -0.2..0.2 }, "to": {...}, "ease": EASE } }
  { "type": "text", "style": "<type key>", "color": C, "box": BOX, "align": "left" | "center" | "right",
    "fit": { "max": px, "min": px, "lines": n }   (headlines)   or   "size": px   (labels),
    "runs": [ { "t": "words " }, { "t": "accent.", "style": "displayAccent", "color": C }, { "br": true }, ... ] }
  { "type": "shape", "shape": ${or(SHAPES)}, "color": C, "box": BOX, "radius": n, "stroke": px (outline instead of fill) }
  { "type": "vector", "box": BOX, "viewBox": [w, h], "paths": [ { "d": "<SVG path data only>", "fill": C, "stroke": C, "strokeWidth": n } ] }   // a shape you draw for this piece
  { "type": "motif", "motif": ${or(MOTIFS)}, "variant": "...", "color": C, "box": BOX, "target": "<layer id>" (bulbs-around), "count": n }
      variants: ${Object.entries(MOTIF_VARIANTS).map(([k, v]) => `${k}: ${v.join('/')}`).join(' · ')}
      string-lights: box x..x+w is the span, h is how far the wire sags. ornament: the top of its box is where the thread hangs from (the lights, the foot of a photograph); the bauble (as wide as the box) sits at the bottom.
      rays: a fan of wedges from the bottom centre of its box. firework: opens once at its entrance time and is gone. snow, sparkle: soft, behind the content.
  { "type": "logo", "variant": "black" | "white", "tint": C (white mark only), "dress": ${or(DRESSES)}, "box": { "x": n, "y": n, "w": n } }      // height follows (ratio 2.09:1)
  { "type": "button", "style": "button", "fill": C, "color": C, "size": px, "box": BOX, "radius": n, "label": "..." }
Nothing else exists: no HTML, no CSS, no images by URL, no other layer types, no other keys. Unknown things are deleted before drawing.`
}

function looksText(keys: string[]): string {
  const order = keys.concat(LOOKS.map(l => l.key).filter(k => keys.indexOf(k) < 0))
  return order.map(k => LOOKS.find(l => l.key === k)).filter(Boolean).map(l => `${l!.key}\n   ${l!.brief}`).join('\n')
}
function identityText(id: Identity): string {
  return `What people expect to see   ${id.expect}
What is ours to add         ${id.ours}
Palette (start here)        ${Object.entries(id.palette).map(([k, v]) => `${k} ${v}`).join(' · ')}
Type                        ${id.type}
Motifs                      ${id.motifs}
Motion language             ${id.motion}
Never                       ${id.never}${id.naming ? `\nNaming the event            ${id.naming}` : ''}`
}
export function briefText(b: Brief): string {
  const ch = CHANNELS[b.channel]
  return `Event       ${b.momentName}${b.dates ? ' · ' + b.dates : ''}
Goal        ${b.goal}
Audience    ${b.audience === 'owners' ? 'Owners' : 'Guests'}. ${b.who}
Area        ${b.areaLabel || 'South Florida'} only
Vibe        ${b.vibe}
Channel     ${ch.label} (${ch.hint}), ${ch.w} x ${ch.h}, about ${b.seconds} seconds at 30 fps
Safe area   words, the logo and the button stay inside: top ${ch.safe.top}, bottom ${ch.safe.bottom}, left ${ch.safe.left}, right ${ch.safe.right} px from the edges${b.note ? `\nMust say    ${b.note}` : ''}`
}
export function photoList(photos: Record<string, PhotoAsset>): string {
  return Object.entries(photos).map(([k, p]) => `${k}  ${p.w} x ${p.h}  ${p.source}  ${p.building}${p.unit && p.unit !== p.building ? ' (' + p.unit + ')' : ''}  —  ${p.shows || 'no description'}`).join('\n')
}
export const sceneCount = (seconds: number) => Math.max(3, Math.min(6, Math.round(seconds / 3)))

// ── 1. concepts ─────────────────────────────────────────────────────────────────────────────────────────────────
export function conceptPrompt(b: Brief, photos: Record<string, PhotoAsset>): string {
  const id = IDENTITIES[b.moment]
  return `You are the creative director for Stay Hospitality, a short-term rental manager in South Florida. Propose THREE different ideas for one seasonal piece. They must differ in what the piece is about, which picture leads, and how it feels — not three wordings of one idea.

THE BRIEF (confirmed by the person making it)
${briefText(b)}

THE EVENT
${identityText(id)}
Territories to start from (go beyond them): ${id.territories.join(' | ')}

LOOKS YOU MAY CHOOSE FROM (best fits first)
${looksText(id.looks)}

OUR PHOTOGRAPHS FOR THIS AREA (ids are fixed; an idea must be buildable from these)
${photoList(photos) || '(none found — say so in "why")'}

${houseRules(b.audience)}

Reply with ONLY this JSON:
{"concepts":[{"name":"2 to 5 words","idea":"one sentence: what the piece shows and why it lands with this audience","look":"<look key>","ground":["<palette key>","<palette key>","<palette key>"],"hook":"the opening on-screen headline, 2 to 5 words, the accent word in *stars*","lead":"<photograph id that opens it>","beats":["scene 1: what we see · what it says", "..."],"why":"one short line"}]}
Exactly three concepts; ${sceneCount(b.seconds)} beats each; "ground" lists three palette keys in the order the grounds appear.`
}

// ── 2. script and copy ──────────────────────────────────────────────────────────────────────────────────────────
export function copyPrompt(b: Brief, concept: { name: string; idea: string; hook: string; beats: string[] }, photos: Record<string, PhotoAsset>): string {
  const n = sceneCount(b.seconds)
  return `You write the words for one short seasonal piece for Stay Hospitality (South Florida short-term rentals). The script is the spine of the piece: write it so it could be read aloud in ${b.seconds} seconds (about 2.5 words a second), one line per scene.

THE BRIEF
${briefText(b)}

THE IDEA THAT WAS CHOSEN
${concept.name}: ${concept.idea}
Opening headline: ${concept.hook}
Beats: ${concept.beats.join(' | ')}

THE PHOTOGRAPHS (each line must be true of a photograph here; name its id)
${photoList(photos)}

${houseRules(b.audience)}

Write THREE options that differ in voice (for example: plain and warm, playful, spare and elegant). Each has exactly ${n} scenes. For every scene: "vo" (the spoken line, 4 to 9 words), "head" (the on-screen headline: the same thought in 2 to 6 words, the one accent word or phrase in *stars*, a line break as \\n where it reads best) and "photo" (the id whose picture the line describes; "" for the last scene if it needs none; never the same id twice). The last scene is the call to action: ${b.audience === 'owners' ? `it carries "${OWNER_CTA}"` : `its spoken line ends with "${GUEST_CTA.replace('Book at ', 'Book at ')}"`}.
Also a "caption" for Instagram and Facebook (2 or 3 sentences, ending with the call to action) and three "hashtags".

Reply with ONLY this JSON:
{"options":[{"voice":"2 or 3 words","lines":[{"vo":"...","head":"...","photo":"<id>"}],"caption":"...","hashtags":["#...","#...","#..."]}]}`
}

// ── 3. the composer ─────────────────────────────────────────────────────────────────────────────────────────────
/** Which finished piece is shown as the worked example: always a DIFFERENT event and look, so structure is copied and design is not. */
export const EXAMPLE_FOR: Record<string, string> = { thanksgiving: 'basel', christmas: 'thanksgiving', nye: 'christmas', basel: 'nye' }

/** Sections that are the same for every piece of an event: sent as the cached system prompt. */
export function composerSystem(audience: 'guests' | 'owners', example: Composition | null): string {
  const ex = example ? JSON.stringify({ concept: example.concept, tokens: example.tokens, scenes: example.scenes.map(s => ({ id: s.id, name: s.name, dur: s.dur, transitionIn: s.transitionIn, layers: s.layers })), script: example.script, social: example.social }) : ''
  return `You are the art director and motion designer for Stay Hospitality, a short-term rental manager in South Florida. You design ONE piece, for one moment, one audience and one goal, from the photographs you are shown. You are not filling in a template. Decide what this piece should look like, then write it as a composition document. A player draws exactly what you write; nothing is added for you, and nothing you write is executed.

HOW TO WORK (show none of it; reply with the document only)
a. Look at the photographs. Which is the strongest picture? What do they have in common (light, colour, material)? What is lost if each is cropped tall?
b. Say the one idea of the piece in a sentence. If you cannot, you do not have one yet.
c. Decide where the colour comes from. The event's palette must be unmistakable in the first frame.
d. Lay out each scene on the canvas for THESE words and THIS photograph. Scenes must differ in composition: never the same arrangement twice in a row.
e. Give every element one entrance and let it rest. Check each scene at its resting moment: is anything touching, crowded, outside the safe area, or is part of the frame empty?

${houseRules(audience)}
TYPE AND LAYOUT
- Words, the logo and the button stay inside the safe area. Photographs, colour and decoration may leave it.
- DESIGN THE WHOLE FRAME. The bands under the platform's own buttons (the top and especially the bottom of a tall frame) are still seen: carry a photograph, a block of colour or decoration into them. No horizontal band taller than ${Math.round(DEAD_BAND_MAX * 100)}% of the frame may be plain ground with nothing in it. A photograph running off the bottom edge, a coloured band with a motif resting on it, or an end card centred in the frame all work; a headline with empty ground beneath it does not.
- Give every headline a "fit" range with "min" no lower than ${MIN_HEADLINE_PX}. Labels are at least ${MIN_LABEL_PX} px. Leave room: a headline's box must hold its lines at "max".
- Contrast is measured. Type under 52 px needs 4.5:1 against what is behind it; larger type needs 3:1. A mid-tone ground (pumpkin, mid blue, red) cannot carry a small label: put small labels on the lightest or darkest ground. The logo needs 3:1.
- Two type styles and one accent per piece. The accent word is the one that carries the idea.
- Decoration frames the content. It never rests on words and never crosses the frame while someone is reading.
MOTION
- Transitions: at most two kinds in a piece (from cut, dissolve, dip, push, slide, wipe), each used for a reason: a push when the next scene continues the thought, a dissolve when the mood changes. Clean, never showy.
- Entrances take 0.4 to 1.2 s and finish at least 1 s before the scene ends. Things arrive once and rest; only lights glow and sparkle twinkles.
- The first frame must already be a picture: the opening photograph has no entrance.
- The last scene holds at least 3.2 s.
SCRIPT
- The script is the spine. One spoken line per scene, about 2.5 words a second. The on-screen headline says the same thing in fewer words. Give two alternates for the opening line and for the last line.

THE FORMAT
${formatSpec()}

THE LOOKS (art-direction systems; you compose inside one, you do not fill it in)
${looksText([])}
${ex ? `\nA FINISHED PIECE FOR A DIFFERENT EVENT, in the format (its frame was ${example!.canvas.w} x ${example!.canvas.h}; copy the structure and the level of craft, never its design, palette or words):\n${ex}` : ''}`
}

/** This piece: the brief Jon confirmed, the event's identity, the idea and the words he picked, the photographs. */
export function composerUser(b: Brief, concept: { name: string; idea: string; look: string }, lines: { vo: string; head: string; photo: string }[], caption: string, photos: Record<string, PhotoAsset>): string {
  const id = IDENTITIES[b.moment], ch = CHANNELS[b.channel]
  return `THIS PIECE (confirmed by ${b.confirmedBy || 'the team'} before this call was made)
${briefText(b)}
Concept     "${concept.name}": ${concept.idea}
Look        ${concept.look}

THE EVENT'S IDENTITY: ${id.name.toUpperCase()}
${identityText(id)}

THE SCRIPT (chosen; one scene per line, in this order — "head" is the on-screen headline with its accent in *stars*, "photo" the picture it was written for)
${lines.map((l, i) => `s${i + 1}  vo: ${l.vo}\n    head: ${l.head.replace(/\n/g, ' / ')}${l.photo ? '\n    photo: ' + l.photo : ''}`).join('\n')}
Caption     ${caption}

THE PHOTOGRAPHS YOU MAY USE (attached as images in this order; ids are fixed; use each at most once)
${photoList(photos)}

REPLY
One JSON object in the format: concept, tokens, scenes (${lines.length} of them, ids s1 to s${lines.length}, durations adding up to about ${b.seconds} s), script, social. The canvas is ${ch.w} x ${ch.h}. Give each photo layer a "focal" point for what must stay in the crop. Nothing before or after the JSON.`
}

// ── 4. one repair pass ──────────────────────────────────────────────────────────────────────────────────────────
export function repairPrompt(findings: string, sceneIds: string[]): string {
  return `The audit measured your document and found these problems:
${findings}

Fix them without changing the idea or the words more than a fix needs. Reply with ONLY this JSON, containing the complete corrected scene object for each scene you change (same ids: ${sceneIds.join(', ')}), in the same format as before:
{"scenes":[{"id":"...","name":"...","dur":0,"transitionIn":{},"layers":[]}]}`
}

// ── 5. the creative director's review: the designer LOOKS at its own rendered frames and revises ─────────────────
// Jon, 2026-11-20: "this looks worse than the ones you rendered" → "Do it, but need this to be best" → "Back it with a
// true Claude creative build as if creating here." Here the work is: design, render, look, criticise, redo. The blind
// composer never saw its piece; this pass is given every scene as a picture (rendered by the same player that
// exports), the measured audit's findings, and is told to be hard on it. It answers with whole replacement scenes
// (data, through the validator like everything else) or says the piece is ready.
export function reviewPrompt(doc: Composition, findings: string, photos: Record<string, PhotoAsset>, round: number, rounds: number): string {
  const b = doc.brief, id = IDENTITIES[b.moment]
  return `YOU ARE NOW LOOKING AT YOUR OWN PIECE, RENDERED. The pictures above are each scene at its resting moment, exactly as people will see it. This is review ${round} of at most ${rounds}.

${briefText(b)}
Concept     "${doc.concept.name}": ${doc.concept.idea}
${id ? 'Identity    ' + id.name + ' — ' + id.expect + ' Ours: ' + id.ours + ' Never: ' + id.never : ''}

Judge it the way a creative director judges work before it leaves a top studio. Be hard on it; "fine" is not good enough. Look, in this order:
1. FIRST FRAME. Would it stop a thumb in one second? Is there one clear thing to look at, and is it beautiful?
2. HIERARCHY. One dominant element in each scene. Is the headline large and confident, and close to what it is about? Are labels clearly smaller?
3. COMPOSITION. Empty bands with nothing designed in them. Things almost but not quite aligned. Awkward gaps. Elements cramped against an edge or each other. A photograph in a timid little window when it could carry the frame. A crop that cuts off what the picture is about.
4. THE EVENT. Does it look made for this moment (its colours and decoration used with intent, framing the content), or like generic blocks that could be for anything?
5. RHYTHM. Do the scenes read as one piece with real variation (the ground changes, the layout turns), or the same slide repeated, or unrelated slides?
6. FINISH. Decoration that clutters instead of frames. An end card where the mark, the date line and the button are not each clear and well spaced.

THE MEASURED CHECK FOUND
${findings || 'nothing failing'}
Every item it lists must be fixed.

If, and only if, the piece is already at that standard, reply with ONLY: {"verdict":"ship","notes":["one line on why it works"]}

Otherwise redesign the weak scenes. Be bold: move, resize, re-crop (focal), change grounds, enlarge the photograph, add or remove shapes and decoration. Do not just nudge. Keep the idea, the meaning of the words (you may tighten a headline), every rule in your instructions, and the truth of the photographs: each used at most once, never drawn above 100% of its own pixels (sizes are listed below), never tinted.
Reply with ONLY this JSON (no prose before or after):
{"verdict":"revise","notes":["what was wrong and what you changed, one line each, at most 6"],"scenes":[the COMPLETE scene object for each scene you change, same ids as now]}

YOUR DOCUMENT
${JSON.stringify({ concept: doc.concept, tokens: doc.tokens, canvas: { w: doc.canvas.w, h: doc.canvas.h, safe: doc.canvas.safe }, scenes: doc.scenes.map(s => ({ id: s.id, name: s.name, dur: s.dur, transitionIn: s.transitionIn, layers: s.layers })) })}

THE PHOTOGRAPHS (ids are fixed; you may swap in one that is not used yet)
${photoList(photos)}`
}

/** The channels by name, for an owner piece that says "40+". */
export const CHANNEL_LINE = CHANNEL_NAMES.join(' · ')
