import { promises as fs } from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'

export async function atomicWriteFile(targetPath: string, content: string | Buffer): Promise<void> {
  const dir = path.dirname(targetPath)
  await fs.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(targetPath)}.${randomBytes(4).toString('hex')}.tmp`)
  await fs.writeFile(tmp, content)
  await fs.rename(tmp, targetPath)
}

export async function readJsonOrNull<T>(targetPath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(targetPath, 'utf8')
    return JSON.parse(raw) as T
  } catch (err: any) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}
