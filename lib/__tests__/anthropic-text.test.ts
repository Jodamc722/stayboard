// textOf — the text out of a Messages reply, wherever it sits.
import { textOf } from '../anthropic-text'
let failed = 0
const eq = (why: string, got: any, want: any) => { if (got !== want) { console.log(`FAIL ${why}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); failed++ } }

eq('plain text block',      textOf({ content: [{ type: 'text', text: 'hello' }] }), 'hello')
// THE BUG THIS EXISTS FOR: a thinking block in front of the answer.
eq('thinking first',        textOf({ content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: '{"a":1}' }] }), '{"a":1}')
eq('two text blocks join',  textOf({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), 'ab')
eq('trims',                 textOf({ content: [{ type: 'text', text: '  x  ' }] }), 'x')
eq('tool_use only',         textOf({ content: [{ type: 'tool_use', name: 'x' }] }), '')
eq('no content',            textOf({}), '')
eq('null',                  textOf(null), '')
eq('content not an array',  textOf({ content: 'nope' }), '')
eq('block missing text',    textOf({ content: [{ type: 'text' }] }), '')
eq('text not a string',     textOf({ content: [{ type: 'text', text: 42 }] }), '')

console.log(failed ? `\n${failed} textOf check(s) failed.` : '\nAll textOf checks passed.')
process.exit(failed ? 1 : 0)
