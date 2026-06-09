import fs from 'node:fs'
import path from 'node:path'
import { isLocalAiModelPackId, LocalAiModelPackId } from './model-pack-downloads'

interface ModelPackRecord {
  id: LocalAiModelPackId
  installedAt: number
  bytes?: number
  path?: string
}

interface ModelPackManifest {
  packs: ModelPackRecord[]
}

const EMPTY_MANIFEST: ModelPackManifest = { packs: [] }

export class ModelPackStore {
  constructor(private readonly modelRoot: string) {}

  getRootPath(): string {
    return this.modelRoot
  }

  getManifestPath(): string {
    return path.join(this.modelRoot, 'model-packs.json')
  }

  getPackPath(id: LocalAiModelPackId): string {
    if (!isLocalAiModelPackId(id)) {
      throw new Error(`Unknown local AI model pack: ${String(id)}`)
    }
    return this.resolveInsideRoot(id)
  }

  resolveInsideRoot(...segments: string[]): string {
    const root = path.resolve(this.modelRoot)
    const resolved = path.resolve(root, ...segments)
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error('Refusing to resolve a model-pack path outside the local AI model root')
    }
    return resolved
  }

  readManifest(): ModelPackManifest {
    try {
      const raw = fs.readFileSync(this.getManifestPath(), 'utf8')
      const parsed = JSON.parse(raw) as Partial<ModelPackManifest>
      if (!Array.isArray(parsed.packs)) return EMPTY_MANIFEST
      return {
        packs: parsed.packs.filter((pack): pack is ModelPackRecord =>
          Boolean(pack) &&
          typeof pack === 'object' &&
          isLocalAiModelPackId((pack as Partial<ModelPackRecord>).id)
        ),
      }
    } catch {
      return EMPTY_MANIFEST
    }
  }

  removeLegacyPacks(ids: string[]): Array<{ id: string; removed: boolean; path: string }> {
    const safeIds = ids.filter((id) => /^[a-zA-Z0-9_.-]+$/.test(id))
    if (safeIds.length === 0) return []

    let rawPacks: unknown[] = []
    try {
      const raw = fs.readFileSync(this.getManifestPath(), 'utf8')
      const parsed = JSON.parse(raw) as Partial<ModelPackManifest>
      rawPacks = Array.isArray(parsed.packs) ? parsed.packs : []
    } catch {
      rawPacks = []
    }

    const legacyIdSet = new Set(safeIds)
    this.writeManifest({
      packs: rawPacks.filter((pack): pack is ModelPackRecord =>
        Boolean(pack) &&
        typeof pack === 'object' &&
        !legacyIdSet.has(String((pack as Partial<ModelPackRecord>).id ?? '')) &&
        isLocalAiModelPackId((pack as Partial<ModelPackRecord>).id)
      ),
    })

    return safeIds.map((id) => {
      const packPath = this.resolveInsideRoot(id)
      if (packPath === path.resolve(this.modelRoot)) {
        throw new Error('Refusing to remove the model root')
      }
      const existed = fs.existsSync(packPath)
      if (existed) fs.rmSync(packPath, { recursive: true, force: true })
      return { id, removed: existed, path: packPath }
    })
  }

  isInstalled(id: LocalAiModelPackId): boolean {
    return this.readManifest().packs.some((pack) => pack.id === id)
  }

  installedBytes(id: LocalAiModelPackId): number | undefined {
    const record = this.readManifest().packs.find((pack) => pack.id === id)
    return typeof record?.bytes === 'number' && Number.isFinite(record.bytes)
      ? record.bytes
      : undefined
  }

  registerInstalledPack(id: LocalAiModelPackId, bytes?: number): ModelPackRecord {
    const packPath = this.getPackPath(id)
    fs.mkdirSync(packPath, { recursive: true })
    const manifest = this.readManifest()
    const record: ModelPackRecord = {
      id,
      installedAt: Date.now(),
      bytes,
      path: packPath,
    }
    this.writeManifest({
      packs: [
        ...manifest.packs.filter((pack) => pack.id !== id),
        record,
      ],
    })
    return record
  }

  removePack(id: LocalAiModelPackId): { removed: boolean; path: string } {
    const packPath = this.getPackPath(id)
    if (packPath === path.resolve(this.modelRoot)) {
      throw new Error('Refusing to remove the model root')
    }

    const manifest = this.readManifest()
    this.writeManifest({
      packs: manifest.packs.filter((pack) => pack.id !== id),
    })

    if (!fs.existsSync(packPath)) {
      return { removed: false, path: packPath }
    }

    fs.rmSync(packPath, { recursive: true, force: true })
    return { removed: true, path: packPath }
  }

  private writeManifest(manifest: ModelPackManifest): void {
    fs.mkdirSync(this.modelRoot, { recursive: true })
    const manifestPath = this.getManifestPath()
    const tmpPath = `${manifestPath}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), 'utf8')
    fs.renameSync(tmpPath, manifestPath)
  }
}
