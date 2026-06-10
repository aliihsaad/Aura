import assert from 'node:assert/strict'
import fs from 'node:fs'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const build = pkg.build || {}

assert.equal(pkg.name, 'aura-desktop')
assert.equal(build.productName, 'Aura')
assert.equal(build.appId, 'com.aura.desktop')
assert.equal(build.asar, true)
assert.ok(String(pkg.description || '').includes('desktop companion'))
assert.ok(Array.isArray(build.files), 'build.files must be explicit')
assert.ok(Array.isArray(build.extraResources), 'build.extraResources must be explicit')

const forbiddenModelWeightPatterns = [
  '**/*.gguf',
  '**/*.safetensors',
  '**/*.onnx',
  '**/*.bin',
  '**/*.pt',
  '**/*.pth',
]

const files = build.files.map(String)
const forbiddenBroadDirectoryExcludes = ['!**/models/**', '!**/model-packs/**']
for (const pattern of forbiddenBroadDirectoryExcludes) {
  assert.equal(
    files.includes(pattern),
    false,
    `build.files must not use broad directory exclude ${pattern}; dependency packages can ship required JavaScript under models/`
  )
}

const localModelDirectoryExcludes = [
  '!models/**',
  '!model-packs/**',
  '!resources/models/**',
  '!resources/model-packs/**',
]

for (const pattern of localModelDirectoryExcludes) {
  assert.ok(
    files.includes(pattern),
    `build.files must exclude local model directory: ${pattern}`
  )
}

for (const pattern of forbiddenModelWeightPatterns) {
  assert.ok(
    files.includes(`!${pattern}`),
    `build.files must exclude local model weights: !${pattern}`
  )
}

for (const resource of build.extraResources) {
  const from = String(resource.from || '').toLowerCase()
  assert.equal(from.includes('model'), false, `extraResources must not bundle models: ${resource.from}`)
  const filter = Array.isArray(resource.filter) ? resource.filter.map(String) : []
  for (const pattern of forbiddenModelWeightPatterns) {
    assert.ok(
      filter.includes(`!${pattern}`),
      `extraResources filter must exclude model weights: !${pattern}`
    )
  }
}

assert.equal(build.nsis?.oneClick, false)
assert.equal(build.nsis?.allowToChangeInstallationDirectory, true)
assert.equal(build.nsis?.artifactName, '${productName}-Setup-${version}-${arch}.${ext}')
assert.equal(build.portable?.artifactName, '${productName}-Portable-${version}-${arch}.${ext}')
assert.equal(build.nsis?.shortcutName, 'Aura')

console.log('check-package-config: installer identity and model-pack guardrails OK')
