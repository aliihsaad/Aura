import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import fs from 'node:fs'
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
    if (specifier.startsWith('.')) {
      const resolved = path.resolve(dirname, specifier)
      return loadTs(`${resolved}.ts`)
    }
    return nodeRequire(specifier)
  }
  const sandbox = {
    exports: module.exports,
    module,
    require: localRequire,
    __dirname: dirname,
    __filename: sourcePath,
  }
  vm.runInNewContext(compiled, sandbox, { filename: sourcePath })
  return module.exports
}

const { DEFAULT_LOCAL_AI_CONFIG } = loadTs('src/shared/local-ai-types.ts')
const {
  getModelPackDownloadSource,
  isLocalAiModelPackId,
  modelPackForProvider,
} = loadTs('src/main/services/local-ai/model-pack-downloads.ts')
const { ModelPackStore } = loadTs('src/main/services/local-ai/model-pack-store.ts')
const localAiSettingsSource = readFileSync('src/renderer/settings/components/LocalAiSettings.tsx', 'utf8')
const ipcHandlersSource = readFileSync('src/main/ipc-handlers.ts', 'utf8')
const packageSource = readFileSync('package.json', 'utf8')

assert.equal(DEFAULT_LOCAL_AI_CONFIG.mode, 'auto')
assert.equal(DEFAULT_LOCAL_AI_CONFIG.ttsProvider, 'deepgram')
assert.equal(DEFAULT_LOCAL_AI_CONFIG.sttProvider, 'deepgram')
assert.equal(DEFAULT_LOCAL_AI_CONFIG.allowModelDownloads, false)

assert.equal(isLocalAiModelPackId('piper-en-us-small'), false)
assert.equal(isLocalAiModelPackId('minicpm-v-2_6-openvino-int4'), false)
assert.equal(isLocalAiModelPackId('kokoro-82m'), false)
assert.equal(isLocalAiModelPackId('../outside'), false)
assert.equal(modelPackForProvider('piper'), null)
assert.equal(modelPackForProvider('kokoro'), null)
assert.equal(modelPackForProvider('whisper-local').id, 'whisper-tiny-q5_1-cpp')
assert.equal(modelPackForProvider('minicpm-v-2_6-openvino'), null)
assert.equal(modelPackForProvider('../outside'), null)

const whisperSource = getModelPackDownloadSource('whisper-tiny-q5_1-cpp')
assert.equal(whisperSource.license, 'MIT')
assert.equal(whisperSource.files.length, 2)
assert.equal(
  whisperSource.files.find((file) => file.path.endsWith('whisper-bin-x64.zip')).sha256,
  '74f973345cb52ef5ba3ec9e7e7af8e48cc8c71722d1528603b80588a11f82e3e'
)
assert.equal(
  whisperSource.files.find((file) => file.path.endsWith('ggml-tiny-q5_1.bin')).sha1,
  '2827a03e495b1ed3048ef28a6a4620537db4ee51'
)

assert.doesNotMatch(localAiSettingsSource, /Piper|MiniCPM|OpenVINO|Kokoro|Prototype source|Local only|Local-first|Cloud-first|Block cloud screenshots|Cloud escalation|Background warmup|Voice Output|Vision Provider|Test TTS|Test Vision/)
assert.doesNotMatch(ipcHandlersSource, /createMiniCpmVisionProvider|createPiperTtsProvider|createKokoroTtsProvider|completed a local OpenVINO inference test/)
assert.doesNotMatch(packageSource, /openvino-genai-node|kokoro-js/)

const tmpBase = path.join(process.cwd(), '.tmp-local-ai-checks')
fs.mkdirSync(tmpBase, { recursive: true })
const tmpRoot = fs.mkdtempSync(path.join(tmpBase, 'whisphry-local-ai-pack-'))
try {
  const store = new ModelPackStore(tmpRoot)
  const packPath = store.getPackPath('whisper-tiny-q5_1-cpp')
  assert.equal(packPath.startsWith(path.resolve(tmpRoot) + path.sep), true)
  assert.throws(() => store.getPackPath('../outside'), /Unknown local AI model pack/)
  assert.throws(() => store.resolveInsideRoot('..', 'outside'), /outside the local AI model root/)

  store.registerInstalledPack('whisper-tiny-q5_1-cpp', 123)
  assert.equal(store.isInstalled('whisper-tiny-q5_1-cpp'), true)
  assert.equal(fs.existsSync(packPath), true)

  const legacyPiperPath = store.resolveInsideRoot('piper-en-us-small')
  const legacyMiniCpmPath = store.resolveInsideRoot('minicpm-v-2_6-openvino-int4')
  const legacyKokoroPath = store.resolveInsideRoot('kokoro-82m')
  fs.mkdirSync(legacyPiperPath, { recursive: true })
  fs.mkdirSync(legacyMiniCpmPath, { recursive: true })
  fs.mkdirSync(legacyKokoroPath, { recursive: true })
  const legacyRemoved = store.removeLegacyPacks(['piper-en-us-small', 'minicpm-v-2_6-openvino-int4', 'kokoro-82m'])
  assert.equal(legacyRemoved.filter((item) => item.removed).length, 3)
  assert.equal(fs.existsSync(legacyPiperPath), false)
  assert.equal(fs.existsSync(legacyMiniCpmPath), false)
  assert.equal(fs.existsSync(legacyKokoroPath), false)
  assert.equal(store.isInstalled('whisper-tiny-q5_1-cpp'), true)

  const result = store.removePack('whisper-tiny-q5_1-cpp')
  assert.equal(result.removed, true)
  assert.equal(fs.existsSync(packPath), false)
  assert.equal(store.isInstalled('whisper-tiny-q5_1-cpp'), false)
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
  fs.rmSync(tmpBase, { recursive: true, force: true })
}

console.log('check-local-ai-config: defaults and model-pack safety OK')
