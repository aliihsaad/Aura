import { appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
const version = packageJson.version
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

if (!semverPattern.test(version)) {
  console.error(`check-release-version: package.json version must be semver, got "${version}"`)
  process.exit(1)
}

const githubRef = process.env.GITHUB_REF || ''
const githubRefName = process.env.GITHUB_REF_NAME || ''
const githubRefType = process.env.GITHUB_REF_TYPE || ''
const tagName = githubRefType === 'tag'
  ? githubRefName
  : githubRef.startsWith('refs/tags/')
    ? githubRef.slice('refs/tags/'.length)
    : ''

if (tagName) {
  const expectedTag = `v${version}`
  if (tagName !== expectedTag) {
    console.error(`check-release-version: tag "${tagName}" must match package.json version "${expectedTag}"`)
    process.exit(1)
  }

  console.log(`check-release-version: tag ${tagName} matches package version ${version}`)
} else {
  console.log(`check-release-version: package version ${version}`)
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `package_version=${version}\n`)
}
