// THE TEXT OUT OF A MESSAGES REPLY — pure, so a test can import it.
//
// Split from lib/anthropic-call (which is server-only) for the same reason lib/checklist-shared is
// split from lib/daily-checklist: the logic worth testing must not drag a server-only import into
// the test runner.
/**
 * The text out of a Messages response, wherever it sits.
 *
 * WHY THIS EXISTS. Every caller here used to read `content[0].text`. That held while a reply was
 * one text block, and stopped holding the moment a model answered with a thinking block first:
 * content[0] is then `{type:'thinking'}`, `.text` is undefined, and the caller sees an empty
 * string from an HTTP 200. The failure is invisible and intermittent — the same prompt works when
 * the model happens not to think first — which is the worst shape a bug can have.
 *
 * So: take the first block that IS text, and join the rest of them, rather than trusting position.
 */
export function textOf(data: any): string {
  const blocks = data && Array.isArray(data.content) ? data.content : []
  return blocks
    .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('')
    .trim()
}
