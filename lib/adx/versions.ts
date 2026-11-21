// AD STUDIO — VERSIONS (Jon, 2026-11-20: "make this world class designer and have new versions, revamp and add new
// versions 1 a week"). One entry per release, newest first; the studio home shows the latest. Each weekly release adds
// an entry here: what a person can now do that they could not last week, in their words, not ours. Client-safe, no imports.
export type AdxVersion = { v: string; date: string; title: string; items: string[] }
export const ADX_VERSIONS: AdxVersion[] = [
  { v: '1.1', date: '2026-11-21', title: 'A real editor', items: [
    'A timeline under the picture: drag the playhead, drag a clip’s edges to trim it, drag a clip to move it',
    'Cut a scene in two at the playhead (S), duplicate it (⌘D), play with Space, step frame by frame with the arrows',
    'Video clips: add one from the video library or your computer, then trim it, cut it, change its speed, keep or mute its sound',
    'Enhance: after your own edits, the creative director improves the design around them — and one click puts it back',
    'Pieces up to a minute and sixteen scenes',
  ] },
  { v: '1.0', date: '2026-11-20', title: 'The new studio', items: [
    'Every piece is designed for its brief, then looked at and redone by a creative director before you see it',
    'Click anything in the video to change it: words, photos, colours, songs, lengths, transitions',
    'Pieces for guests, owners and the team, as a video, an animated post or a still',
    'Nine styles and AI-made graphics (once the image key is added)',
    'Sixteen new songs',
  ] },
]
export const adxVersion = () => ADX_VERSIONS[0]
