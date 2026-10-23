const AGNES_API_KEY = import.meta.env.VITE_AGNES_API_KEY || ''
const AGNES_BASE_URL = 'https://apihub.agnes-ai.com/v1'
const AGNES_MODEL = 'agnes-2.0-flash'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'

function dataUrlToBlob(dataUrl: string, mime: string): Blob {
  const base64 = dataUrl.substring(dataUrl.indexOf(',') + 1)
  const binaryStr = atob(base64)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime })
}

export class AgnesApi {
  /**
   * 流式聊天（普通模式）
   */
  async chatStream(
    text: string,
    callbacks?: {
      onToken?: (token: string) => void
      onReasoning?: (token: string) => void
    },
    options?: {
      systemPrompt?: string
      temperature?: number
      abortSignal?: AbortSignal
      historyMessages?: { role: 'user' | 'assistant'; content: string }[]
      imagesData?: { base64: string; mime: string }[]
      enableTools?: boolean
      deepThink?: boolean
    }
  ): Promise<{ reasoning: string; content: string }> {
    const messages: any[] = []
    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt })
    }
    if (options?.historyMessages) {
      for (const m of options.historyMessages) {
        messages.push({ role: m.role, content: m.content })
      }
    }

    const hasImages = options?.imagesData && options.imagesData.length > 0
    if (hasImages) {
      const content: any[] = []
      for (const img of options!.imagesData!) {
        const dataUrl = `data:${img.mime};base64,${img.base64}`
        const publicUrl = await this.ensurePublicUrl(dataUrl, img.mime)
        content.push({
          type: 'image_url',
          image_url: { url: publicUrl },
        })
      }
      content.push({ type: 'text', text })
      messages.push({ role: 'user', content })
    } else {
      messages.push({ role: 'user', content: text })
    }

    const body: any = {
      model: AGNES_MODEL,
      messages,
      stream: true,
    }
    if (options?.temperature !== undefined) body.temperature = options.temperature
    if (options?.enableTools) {
      body.tools = TOOL_DEFINITIONS
      body.tool_choice = 'auto'
    }
    if (options?.deepThink) {
      body.chat_template_kwargs = { enable_thinking: true }
    }

    const response = await fetch(`${AGNES_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AGNES_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: options?.abortSignal,
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      const msg = this.parseError(response.status, errText)
      throw new Error(msg)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let reasoning = ''
    let content = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') continue
        try {
          const chunk = JSON.parse(payload)
          const delta = chunk.choices?.[0]?.delta || {}
          if (delta.reasoning_content || delta.reasoning) {
            const r = delta.reasoning_content || delta.reasoning
            reasoning += r
            callbacks?.onReasoning?.(r)
          }
          if (delta.content) {
            content += delta.content
            callbacks?.onToken?.(delta.content)
          }
        } catch { /* skip malformed chunks */ }
      }
    }

    return { reasoning, content }
  }

  /**
   * 非流式聊天（带工具调用）
   */
  async chatWithTools(
    text: string,
    callbacks?: {
      onToken?: (token: string) => void
      onReasoning?: (token: string) => void
      onToolCall?: (name: string, input: any, result: string) => void
    },
    options?: {
      systemPrompt?: string
      temperature?: number
      abortSignal?: AbortSignal
      historyMessages?: { role: 'user' | 'assistant'; content: string }[]
      imagesData?: ArrayBuffer[]
      deepThink?: boolean
    }
  ): Promise<{ reasoning: string; content: string }> {
    const messages: any[] = []
    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt })
    }
    if (options?.historyMessages) {
      for (const m of options.historyMessages) {
        messages.push({ role: m.role, content: m.content })
      }
    }

    const hasImages = options?.imagesData && options.imagesData.length > 0
    if (hasImages) {
      const content: any[] = []
      for (const buf of options!.imagesData!) {
        const mime = this.detectMime(buf)
        const b64 = this.arrayBufferToBase64(buf)
        const dataUrl = `data:${mime};base64,${b64}`
        const publicUrl = await this.ensurePublicUrl(dataUrl, mime)
        content.push({
          type: 'image_url',
          image_url: { url: publicUrl },
        })
      }
      content.push({ type: 'text', text })
      messages.push({ role: 'user', content })
    } else {
      messages.push({ role: 'user', content: text })
    }

    const body: any = {
      model: AGNES_MODEL,
      messages,
      stream: false,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
    }
    if (options?.temperature !== undefined) body.temperature = options.temperature
    if (options?.deepThink) {
      body.chat_template_kwargs = { enable_thinking: true }
    }

    const response = await fetch(`${AGNES_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AGNES_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: options?.abortSignal,
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(this.parseError(response.status, errText))
    }

    const result = await response.json()
    const msg = result.choices?.[0]?.message || {}
    const reasoning = msg.reasoning_content || msg.reasoning || ''
    const content = msg.content || ''

    if (callbacks?.onToken) callbacks.onToken(content)
    return { reasoning, content }
  }

  /**
   * 图片理解（协作模式图片解析）
   */
  async understandImage(
    imageSource: string | File | Blob,
    userPrompt?: string
  ): Promise<{ description: string; source: string }> {
    let b64: string
    let mime = 'image/png'

    if (imageSource instanceof File || imageSource instanceof Blob) {
      mime = imageSource.type || 'image/png'
      const buf = await imageSource.arrayBuffer()
      b64 = this.arrayBufferToBase64(buf)
    } else if (imageSource.startsWith('data:')) {
      const match = imageSource.match(/^data:(image\/\w+);base64,(.+)$/)
      if (match) {
        mime = match[1]
        b64 = match[2]
      } else {
        b64 = imageSource
      }
    } else {
      b64 = imageSource
    }

    const prompt = userPrompt || '请详细描述这张图片的内容。如果是文档截图，请提取其中的文字信息。'
    const dataUrl = `data:${mime};base64,${b64}`
    const publicUrl = await this.ensurePublicUrl(dataUrl, mime)
    const messages: any[] = [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: publicUrl } },
        { type: 'text', text: prompt },
      ],
    }]

    const response = await fetch(`${AGNES_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AGNES_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: AGNES_MODEL, messages, stream: false }),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(this.parseError(response.status, errText))
    }

    const result = await response.json()
    const description = result.choices?.[0]?.message?.content || ''
    return { description, source: 'agnes' }
  }

  /** 解析错误信息，特别处理并发限制 */
  private parseError(status: number, body: string): string {
    if (status === 429) {
      return 'AI 服务器繁忙，请稍后再试'
    }
    if (status === 503 || status === 502) {
      return 'AI 服务暂时不可用，请稍后再试'
    }
    try {
      const j = JSON.parse(body)
      const msg = j.error?.message || j.message || ''
      if (msg.includes('rate') || msg.includes('limit') || msg.includes('concurrency') || msg.includes('busy')) {
        return 'AI 服务器繁忙，请稍后再试'
      }
      return msg || `请求失败 (${status})`
    } catch {
      return body ? body.slice(0, 100) : `请求失败 (${status})`
    }
  }

  private detectMime(buf: ArrayBuffer): string {
    const arr = new Uint8Array(buf)
    if (arr[0] === 0xFF && arr[1] === 0xD8) return 'image/jpeg'
    if (arr[0] === 0x89 && arr[1] === 0x50) return 'image/png'
    if (arr[0] === 0x47 && arr[1] === 0x49) return 'image/gif'
    if (arr[0] === 0x52 && arr[1] === 0x49) return 'image/webp'
    return 'image/png'
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  /**
   * 确保图片有公网 URL：data URL → 上传到 OSS → 返回公网 URL
   */
  async ensurePublicUrl(imageBase64: string, mime: string): Promise<string> {
    // 如果已经是 http URL，直接返回
    if (imageBase64.startsWith('http://') || imageBase64.startsWith('https://')) {
      return imageBase64
    }
    // data URL → 上传
    const formData = new FormData()
    const blob = dataUrlToBlob(imageBase64, mime)
    formData.append('file', blob, `img.${mime.split('/')[1] || 'png'}`)
    const res = await fetch(`${API_BASE_URL}/api/v1/image/upload`, {
      method: 'POST',
      body: formData,
    })
    if (!res.ok) throw new Error('图片上传失败')
    const data = await res.json()
    const relativeUrl = data.url || data.path || ''
    // 拼接完整公网 URL
    return relativeUrl.startsWith('http') ? relativeUrl : `${API_BASE_URL}${relativeUrl}`
  }
}

const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description: '搜索互联网获取实时信息。当用户询问新闻、最新事件、实时数据、或需要外部知识补充时使用。',
      parameters: {
        type: 'object' as const,
        properties: {
          query: { type: 'string' as const, description: '搜索关键词，尽量简洁精确' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_knowledge',
      description: '在用户的学习知识库中搜索。当用户询问课本内容、学习资料、专业知识时使用。',
      parameters: {
        type: 'object' as const,
        properties: {
          query: { type: 'string' as const, description: '搜索关键词，尽量简洁精确' },
        },
        required: ['query'],
      },
    },
  },
]

export const agnesApi = new AgnesApi()
