import { OPENROUTER_BASE_URL } from '@shared/constants'

export type ImageGenerationSize = '1024x1024' | '1536x1024' | '1024x1536' | 'auto'

export interface ImageGenerationRequest {
  prompt: string
  size?: ImageGenerationSize
  quality?: 'auto' | 'low' | 'medium' | 'high'
  background?: 'auto' | 'transparent' | 'opaque'
}

export interface ImageGenerationResult {
  base64: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  revisedPrompt?: string
  size?: string
  quality?: string
  model: string
  aspectRatio?: string
}

interface OpenRouterImageResponse {
  choices?: Array<{
    message?: {
      content?: string
      images?: Array<{
        image_url?: { url?: string }
        imageUrl?: { url?: string }
      }>
    }
  }>
}

export class ImageGenerationService {
  static readonly DEFAULT_MODEL = 'google/gemini-2.5-flash-image'
  private static readonly REQUEST_TIMEOUT_MS = 90_000

  constructor(
    private readonly apiKey: string,
    private readonly model = ImageGenerationService.DEFAULT_MODEL
  ) {}

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const prompt = request.prompt.trim()
    if (!prompt) {
      throw new Error('Image prompt is required.')
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), ImageGenerationService.REQUEST_TIMEOUT_MS)
    const aspectRatio = aspectRatioForSize(request.size)

    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          'HTTP-Referer': 'http://localhost',
          'X-Title': 'Whisphry',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          modalities: ['image', 'text'],
          stream: false,
          ...(aspectRatio ? { image_config: { aspect_ratio: aspectRatio } } : {}),
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(
          `OpenRouter image API returned HTTP ${response.status}${body ? `: ${body}` : ''}`
        )
      }

      const data = (await response.json()) as OpenRouterImageResponse
      const message = data.choices?.[0]?.message
      const imageUrl =
        message?.images?.[0]?.image_url?.url || message?.images?.[0]?.imageUrl?.url || ''
      if (!imageUrl) {
        throw new Error(
          'OpenRouter image response did not include image data. Make sure the selected model supports image output.'
        )
      }

      const image = await readImageData(imageUrl)
      return {
        ...image,
        revisedPrompt: typeof message?.content === 'string' ? message.content : undefined,
        size: request.size,
        quality: request.quality,
        model: this.model,
        aspectRatio,
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Image generation timed out.')
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}

function aspectRatioForSize(size?: ImageGenerationSize): string | undefined {
  switch (size) {
    case '1024x1024':
      return '1:1'
    case '1536x1024':
      return '3:2'
    case '1024x1536':
      return '2:3'
    default:
      return undefined
  }
}

async function readImageData(
  imageUrl: string
): Promise<{ base64: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' }> {
  const dataUrlMatch = imageUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i)
  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1].toLowerCase() as 'image/png' | 'image/jpeg' | 'image/webp',
      base64: dataUrlMatch[2],
    }
  }

  const response = await fetch(imageUrl)
  if (!response.ok) {
    throw new Error(`Failed to download generated image: HTTP ${response.status}`)
  }

  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (mimeType !== 'image/png' && mimeType !== 'image/jpeg' && mimeType !== 'image/webp') {
    throw new Error(`Generated image had unsupported content type: ${mimeType || 'unknown'}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  return {
    mimeType,
    base64: bytes.toString('base64'),
  }
}
