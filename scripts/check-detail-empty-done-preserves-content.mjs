import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function assertIncludes(path, needle, message) {
  const text = read(path)
  if (!text.includes(needle)) {
    throw new Error(`${message}\nMissing in ${path}: ${needle}`)
  }
}

function assertNotIncludes(path, needle, message) {
  const text = read(path)
  if (text.includes(needle)) {
    throw new Error(`${message}\nUnexpected in ${path}: ${needle}`)
  }
}

assertIncludes(
  'src/renderer/overlay/App.tsx',
  'const hasDisplayableAnswer = answer.trim().length > 0',
  'Detail must distinguish an empty done event from a real displayable answer.'
)

assertIncludes(
  'src/renderer/overlay/App.tsx',
  'setCurrentAnswer((prev) => (answer.trim().length > 0 ? answer : prev))',
  'Empty answer-done events must not erase already-streamed Detail content (image-only answers keep prior text).'
)

assertNotIncludes(
  'src/renderer/overlay/App.tsx',
  'setCurrentAnswer(answer)\n      setCurrentAttachments(attachments)\n      setIsAnswering(false)',
  'Detail answer-done must not unconditionally overwrite the visible answer.'
)

assertIncludes(
  'package.json',
  'check:detail-empty-done',
  'package.json must expose the Detail empty-done regression guard.'
)

console.log('check-detail-empty-done-preserves-content: ok')
