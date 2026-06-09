import { app, net } from 'electron'

const GITHUB_RELEASE_URL = 'https://api.github.com/repos/aliihsaad/whisphry/releases/latest'

export interface UpdateInfo {
  updateAvailable: boolean
  latestVersion: string
  releaseUrl: string
}

function compareVersions(current: string, latest: string): boolean {
  const c = current.replace(/^v/, '').split('.').map(Number)
  const l = latest.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] || 0
    const lv = l[i] || 0
    if (lv > cv) return true
    if (lv < cv) return false
  }
  return false
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  try {
    const response = await net.fetch(GITHUB_RELEASE_URL, {
      headers: { 'User-Agent': 'whisphry-update-checker' },
    })

    if (!response.ok) return null

    const data = await response.json()
    const latestVersion = data.tag_name as string
    const releaseUrl = data.html_url as string
    const currentVersion = app.getVersion()

    const updateAvailable = compareVersions(currentVersion, latestVersion)

    if (updateAvailable) {
      console.log(`[Update] New version available: ${latestVersion} (current: v${currentVersion})`)
    }

    return { updateAvailable, latestVersion, releaseUrl }
  } catch (err) {
    console.log('[Update] Check failed:', (err as Error).message)
    return null
  }
}
