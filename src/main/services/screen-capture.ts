import { desktopCapturer, screen } from 'electron'

export class ScreenCaptureService {
  async captureScreen(): Promise<string> {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.size

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
    })

    if (sources.length === 0) {
      throw new Error('No screen sources available')
    }

    // Get the primary screen
    const primarySource = sources[0]
    const thumbnail = primarySource.thumbnail

    // Convert to base64 PNG
    const base64 = thumbnail.toPNG().toString('base64')
    return base64
  }

  async captureToBase64Jpeg(quality = 70): Promise<string> {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.size

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
    })

    if (sources.length === 0) {
      throw new Error('No screen sources available')
    }

    return sources[0].thumbnail.toJPEG(quality).toString('base64')
  }

  async captureWindow(windowTitle?: string): Promise<string> {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1920, height: 1080 },
    })

    let source = sources[0]

    if (windowTitle) {
      const match = sources.find((s) =>
        s.name.toLowerCase().includes(windowTitle.toLowerCase())
      )
      if (match) source = match
    }

    if (!source) {
      throw new Error('No matching window found')
    }

    return source.thumbnail.toPNG().toString('base64')
  }
}
