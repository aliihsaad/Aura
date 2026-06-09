import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import ts from 'typescript'

const nodeRequire = createRequire(import.meta.url)
const moduleCache = new Map()

function loadTs(relativePath) {
  const sourcePath = path.resolve(process.cwd(), relativePath)
  if (moduleCache.has(sourcePath)) return moduleCache.get(sourcePath).exports

  const source = fs.readFileSync(sourcePath, 'utf8')
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
  const sandbox = {
    Buffer,
    console,
    exports: module.exports,
    module,
    process,
    require: localRequire,
    setTimeout,
    clearTimeout,
    __dirname: dirname,
    __filename: sourcePath,
  }
  vm.runInNewContext(compiled, sandbox, { filename: sourcePath })
  return module.exports
}

function pcmFrame(value, samples = 4096) {
  const buffer = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(value, i * 2)
  return buffer
}

const { writePcm16Wav } = loadTs('src/main/services/local-ai/providers/wav-utils.ts')
const { ModelPackStore } = loadTs('src/main/services/local-ai/model-pack-store.ts')
const { WhisperCppSttService } = loadTs('src/main/services/local-ai/providers/whisper-cpp-stt-service.ts')

const wav = writePcm16Wav(Buffer.from([0, 0, 1, 0]), 16000, 1)
assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
assert.equal(wav.readUInt32LE(24), 16000)

const tmpBase = path.join(process.cwd(), '.tmp-local-ai-checks')
fs.mkdirSync(tmpBase, { recursive: true })
const tmpRoot = fs.mkdtempSync(path.join(tmpBase, 'whisphry-whisper-runtime-'))
try {
  const store = new ModelPackStore(tmpRoot)
  const packPath = store.getPackPath('whisper-tiny-q5_1-cpp')
  fs.mkdirSync(packPath, { recursive: true })
  fs.writeFileSync(path.join(packPath, 'ggml-tiny-q5_1.bin'), 'fake model')
  store.registerInstalledPack('whisper-tiny-q5_1-cpp', 10)

  const fakeWhisper = path.join(tmpRoot, 'fake-whisper.mjs')
  fs.writeFileSync(fakeWhisper, `
import fs from 'node:fs'
const args = process.argv.slice(2)
const outBase = args[args.indexOf('-of') + 1]
fs.writeFileSync(outBase + '.txt', '  hello local whisper  ')
`, 'utf8')

  const service = new WhisperCppSttService(store, 'user', 'en', [], {
    command: process.execPath,
    argsPrefix: [fakeWhisper],
    cwd: tmpRoot,
  })

  await service.connect()
  const transcriptPromise = once(service, 'transcript')
  service.sendAudio(pcmFrame(2600))
  service.sendAudio(pcmFrame(2600))
  service.sendAudio(pcmFrame(0))
  service.sendAudio(pcmFrame(0))
  service.sendAudio(pcmFrame(0))
  service.sendAudio(pcmFrame(0))
  const [entry] = await transcriptPromise
  assert.equal(entry.speaker, 'user')
  assert.equal(entry.audioSource, 'microphone')
  assert.equal(entry.isFinal, true)
  assert.equal(entry.text, 'hello local whisper')
  await service.disconnect()
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
  fs.rmSync(tmpBase, { recursive: true, force: true })
}

console.log('check-whisper-runtime: local Whisper buffering and CLI transcription OK')
