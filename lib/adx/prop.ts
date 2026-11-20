// AD STUDIO — AI GRAPHICS (Jon, 2026-11-20: "add some 3d generation to the mix to fit the look" and "Add graphic design,
// new style and needs the creative power of AI not just templates").
// A graphic made for one piece by an image model: a 3D object, an illustration, or a full backdrop, in one of the
// studio's art styles and in the piece's own colours. The words sent to the model are built here, never taken whole
// from a request: one subject, the style, the palette, and the rules (no text, logos, brands or people; a graphic is
// never a pretend photograph of one of our units). Pure and import-free beyond the piece format, so the tests and the screens can read it; the route scrubs brand and
// event names out of the subject (lib/ad-image-prompt scrubNames) before it gets here.
import { cleanText } from './composition'

export type ArtKind = 'object' | 'illustration' | 'backdrop'
export const ART_KINDS: { key: ArtKind; label: string; hint: string }[] = [
  { key: 'object', label: 'Object', hint: 'One thing on a clear background' },
  { key: 'illustration', label: 'Illustration', hint: 'A drawn scene or motif on a clear background' },
  { key: 'backdrop', label: 'Backdrop', hint: 'Fills the frame behind everything' },
]
export const ART_STYLES: { key: string; label: string; says: string }[] = [
  { key: '3d', label: '3D', says: 'a stylised 3D render like a premium product illustration: smooth, slightly glossy material, soft studio lighting, gentle highlights, rounded well-made forms, three-quarter view' },
  { key: 'chrome', label: 'Liquid chrome', says: 'a glossy liquid-chrome 3D render: mirror-polished metal with soft coloured reflections, inflated rounded forms, a modern fashion-campaign feel' },
  { key: 'flat', label: 'Flat graphic', says: 'bold flat vector graphic design: large simple shapes, crisp edges, no gradients, no outlines, confident negative space, like a modern brand illustration' },
  { key: 'papercut', label: 'Paper cut', says: 'layered cut-paper collage illustration: hand-cut coloured paper shapes stacked with soft real shadows between the layers, slightly imperfect edges' },
  { key: 'riso', label: 'Print', says: 'a two or three colour risograph print: flat inks that overlap and misregister slightly, visible paper grain and halftone texture' },
  { key: 'retro', label: 'Travel poster', says: 'a mid-century travel poster illustration: screen-printed flat colour areas, simplified sunlit forms, long shadows, a little print texture' },
  { key: 'neon', label: 'Neon', says: 'glowing neon tube lighting on a very dark ground: bent glass tubes, soft coloured bloom, a faint reflection' },
  { key: 'watercolour', label: 'Watercolour', says: 'loose hand-painted watercolour: wet washes that bloom into each other, white paper showing through, a few confident darker strokes' },
  { key: 'line', label: 'Line drawing', says: 'an elegant single-weight line drawing: one continuous confident ink line, no fill, generous space' },
  { key: 'gradient', label: 'Soft gradient', says: 'abstract soft mesh gradients: large blurred fields of colour melting into each other with fine film grain, no objects' },
]
export const artStyle = (key: string) => ART_STYLES.find(s => s.key === key) || ART_STYLES[0]

export function propPrompt(what: string, colors: string[], style = '3d', kind: ArtKind = 'object'): string {
  const thing = cleanText(what, 160) || (kind === 'backdrop' ? 'an abstract composition' : 'a gift box with a ribbon')
  const pal = colors.filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 4)
  const st = artStyle(style).says
  const palette = pal.length ? ` Use only this colour palette (and tints of it): ${pal.join(', ')}.` : ''
  const never = ' No text, no letters, no numbers, no logos, no brand marks, no people, no hands, no faces. This is a graphic, not a photograph: do not make it look like a real photo of a room or a building.'
  if (kind === 'backdrop') return `A full-frame background graphic for an advertisement: ${thing}. Style: ${st}.${palette} It fills the whole frame edge to edge, is calm enough for words to sit on top of it, and keeps its busiest detail toward the edges.${never}`
  if (kind === 'illustration') return `An illustration: ${thing}. Style: ${st}.${palette} The whole illustration is in frame with a little space around it, on a fully transparent background: nothing behind it, no floor, no frame, no border.${never}`
  return `A single object: ${thing}. Style: ${st}.${palette} The whole object is in frame with a little space around it, on a fully transparent background: nothing behind or under it, no floor, no cast shadow on the ground, no scenery.${never}`
}

/** The looks a brief can ask for (the "new style" step). Each tells the designer how to work and which art to call for. */
export const STYLES: { key: string; label: string; hint: string; art: string; brief: string }[] = [
  { key: '', label: 'Designer’s choice', hint: 'Whatever suits the idea best', art: '', brief: '' },
  { key: 'poster', label: 'Bold poster', hint: 'Huge type, flat colour, one image', art: 'flat', brief: 'A bold typographic poster in motion: the headline is the hero, set very large and tight, on flat fields of strong colour; one photograph or graphic per scene, hard edges, big confident shapes.' },
  { key: 'three-d', label: '3D playful', hint: 'Rendered 3D objects, bright and fun', art: '3d', brief: 'Playful and dimensional: rendered 3D objects are the stars (one or two per scene, large, floating or turning slowly) beside clean type on a flat colour ground; photographs sit in rounded windows.' },
  { key: 'editorial', label: 'Editorial', hint: 'Magazine layout, calm and expensive', art: 'line', brief: 'A fashion and travel magazine spread in motion: generous margins, a small tracked label over a large serif headline with one italic word, the photograph hung like a print with a caption line, hairlines that draw. Nothing shouts.' },
  { key: 'papercut', label: 'Paper cut', hint: 'Layered cut-paper illustration', art: 'papercut', brief: 'Hand-made and warm: layered cut-paper illustrations frame the content (a paper sun, palms, waves, confetti), soft shadows between layers, photographs in arch or round windows like cut-outs.' },
  { key: 'retro', label: 'Travel poster', hint: 'Mid-century, screen-printed', art: 'retro', brief: 'A mid-century travel poster come to life: an illustrated backdrop or motif in flat screen-print colours, a strong horizon, condensed capitals, the photograph as a postcard inset.' },
  { key: 'neon', label: 'Neon night', hint: 'Dark, glowing, after hours', art: 'neon', brief: 'After dark: near-black grounds, neon-tube graphics that glow, type in white with one glowing accent colour, photographs of the evening in hard windows. For nightlife and big nights.' },
  { key: 'chrome', label: 'Liquid chrome', hint: 'Glossy, modern, fashion', art: 'chrome', brief: 'Modern and glossy: liquid-chrome 3D forms float over a soft gradient backdrop, type is clean and tight, everything has a slow drifting motion.' },
  { key: 'soft', label: 'Soft and airy', hint: 'Gradients, watercolour, light', art: 'watercolour', brief: 'Light and unhurried: soft gradient or watercolour backdrops, lots of air, fine serif type, photographs in rounded windows, gentle fades.' },
]
export const styleOf = (key: string) => STYLES.find(s => s.key === key) || STYLES[0]
