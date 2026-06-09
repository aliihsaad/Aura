import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const sourcePath = path.join(process.cwd(), 'src/main/services/markdown-plaintext.ts')
const source = readFileSync(sourcePath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText

const sandbox = { exports: {}, module: { exports: {} } }
vm.runInNewContext(compiled, sandbox, { filename: sourcePath })
const { markdownToPlaintext } = {
  ...sandbox.exports,
  ...sandbox.module.exports,
}

assert.equal(
  markdownToPlaintext('## Heading\n\n- **bold** item with a [link](https://x.com) and `code`'),
  'Heading bold item with a link and code'
)
assert.equal(markdownToPlaintext('```\ncode block\n```\nafter'), 'after')
assert.equal(markdownToPlaintext('![alt text](https://x.com/a.png)'), 'alt text')

console.log('check-rich-content: markdownToPlaintext OK')
