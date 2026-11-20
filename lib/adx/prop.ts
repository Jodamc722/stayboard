// AD STUDIO — 3D OBJECTS (Jon, 2026-11-20: "Also add some 3d generation to the mix to fit the look").
// The words sent to the image model for a 3D object: what the person asked for, in one fixed style, with the rules
// (one object, clear background, no text, logos, brands or people). Pure, so the tests can read it.
import { scrubNames } from '@/lib/ad-image-prompt'
import { cleanText } from './composition'

export function propPrompt(what: string, colors: string[]): string {
  const thing = scrubNames(cleanText(what, 120)) || 'a gift box with a ribbon'
  const pal = colors.filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 4)
  return `A single object: ${thing}. Stylised 3D render, like a premium product illustration: smooth, slightly glossy material with soft studio lighting, gentle highlights and soft shading on the object itself, rounded and well-made forms, seen from a three-quarter angle, the whole object in frame with a little space around it.${pal.length ? ` Use this colour palette for the object: ${pal.join(', ')}.` : ''} Fully transparent background: nothing behind or under the object, no floor, no cast shadow on the ground, no scenery. No text, no letters, no numbers, no logos, no brand marks, no people, no hands.`
}

