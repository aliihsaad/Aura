import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'

const nodeRequire = createRequire(import.meta.url)
const moduleCache = new Map()

function loadTs(relativePath) {
  const sourcePath = path.resolve(process.cwd(), relativePath)
  if (moduleCache.has(sourcePath)) return moduleCache.get(sourcePath).exports

  const source = readFileSync(sourcePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText

  const module = { exports: {} }
  moduleCache.set(sourcePath, module)
  const dirname = path.dirname(sourcePath)
  const localRequire = (specifier) => {
    if (specifier.startsWith('@shared/')) {
      return loadTs(`src/shared/${specifier.slice('@shared/'.length)}.ts`)
    }
    if (specifier.startsWith('.')) {
      const resolved = path.resolve(dirname, specifier)
      return loadTs(`${resolved}.ts`)
    }
    return nodeRequire(specifier)
  }

  vm.runInNewContext(compiled, {
    exports: module.exports,
    module,
    require: localRequire,
    __dirname: dirname,
    __filename: sourcePath,
  }, { filename: sourcePath })
  return module.exports
}

const { DEFAULT_LOCAL_AI_CONFIG } = loadTs('src/shared/local-ai-types.ts')
const { resolveDeepgramSpeechInputKey } = loadTs('src/main/services/local-ai/local-ai-stt-policy.ts')

assert.equal(
  resolveDeepgramSpeechInputKey({ ...DEFAULT_LOCAL_AI_CONFIG, mode: 'auto', sttProvider: 'deepgram' }, () => 'dg-key'),
  'dg-key'
)
assert.throws(
  () => resolveDeepgramSpeechInputKey({ ...DEFAULT_LOCAL_AI_CONFIG, mode: 'local-only', sttProvider: 'deepgram' }, () => 'dg-key'),
  /Deepgram speech input is unavailable/
)
assert.throws(
  () => resolveDeepgramSpeechInputKey({ ...DEFAULT_LOCAL_AI_CONFIG, mode: 'auto', sttProvider: 'whisper-local' }, () => 'dg-key'),
  /Whisper local speech input is selected/
)

console.log('check-local-ai-routing: speech input policy decisions OK')
