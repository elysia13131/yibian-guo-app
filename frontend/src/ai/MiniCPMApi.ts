const MINICPM_API_KEY = import.meta.env.VITE_MINICPM_API_KEY || ''
const MINICPM_BASE_URL = '/api/modelbest'
const MINICPM_MODEL = 'MiniCPM-V-4.6-Thinking'
const MINICPM_MODEL_INSTRUCT = 'MiniCPM-V-4.6-Instruct'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'

const IMAGE_FORMATS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export class MiniCPMApi {
  async chat(
    text: string,
    onData?: (token: string) => void,
    options?: {
      systemPrompt?: string
      maxTokens?: number
      temperature?: number
      abortSignal?: AbortSignal
      historyMessages?: { role: 'user' | 'assistant'; content: string }[]
      imagesData?: ArrayBuffer[]
      model?: string
      enableTools?: boolean
    }
  ): Promise<string> {
    const messages: any[] = []
    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt })
    }
    if (options?.historyMessages) {
      for (const m of options.historyMessages) {
        messages.push({ role: m.role, content: m.content })
      }
    }

    const userContent: any = options?.imagesData && options.imagesData.length > 0 ? [] : text
    if (Array.isArray(userContent)) {
      for (const buf of options!.imagesData!) {
        const mime = this.detectMime(buf)
        const b64 = this.arrayBufferToBase64(buf)
        userContent.push({
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${b64}` },
        })
      }
      userContent.push({ type: 'text', text })
    }
    messages.push({ role: 'user', content: userContent })

    const body = {
      model: options?.model || MINICPM_MODEL,
      messages,
      stream: true,
    }

    const response = await fetch(`${API_BASE_URL}${MINICPM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MINICPM_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept-Encoding': 'identity',
      },
      body: JSON.stringify(body),
      signal: options?.abortSignal,
    })

    if (!response.ok) {
      throw new Error(`MiniCPM API error: ${response.status}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullContent = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      let hasToken = false

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') continue
          try {
            const chunk = JSON.parse(payload)
            const delta = chunk.choices?.[0]?.delta || {}
            const token = delta.content || delta.reasoning || ''
            if (token) {
              fullContent += token
              onData?.(token)
              hasToken = true
            }
          } catch {
            // skip parse errors
          }
        }
      }

      if (hasToken) {
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    }

    return fullContent
  }

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
      userId?: number
      model?: string
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

    const userContent: any = options?.imagesData && options.imagesData.length > 0 ? [] : text
    if (Array.isArray(userContent)) {
      for (const buf of options!.imagesData!) {
        const mime = this.detectMime(buf)
        const b64 = this.arrayBufferToBase64(buf)
        userContent.push({
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${b64}` },
        })
      }
      userContent.push({ type: 'text', text })
    }
    messages.push({ role: 'user', content: userContent })

    const token = localStorage.getItem('token')
    const response = await fetch(`${API_BASE_URL}/api/v1/ai/tool-chat-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        messages,
        user_id: options?.userId || 0,
        enable_tools: options?.enableTools ?? true,
        temperature: options?.temperature ?? undefined,
        model: options?.model || undefined,
      }),
      signal: options?.abortSignal,
    })

    if (!response.ok) {
      throw new Error(`Tool chat error: ${response.status}`)
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

      let hasToken = false

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') continue
          try {
            const chunk = JSON.parse(payload)
            if (chunk.step === 'tool_call') {
              callbacks?.onToolCall?.(chunk.name, chunk.input, chunk.result || '')
              continue
            }
            if (chunk.step === 'reasoning' && chunk.token) {
              reasoning += chunk.token
              callbacks?.onReasoning?.(chunk.token)
            }
            if (chunk.step === 'thinking_reasoning' && chunk.token) {
              reasoning += chunk.token
              callbacks?.onReasoning?.(chunk.token)
            }
            if (chunk.step === 'content' && chunk.token) {
              content += chunk.token
              callbacks?.onToken?.(chunk.token)
            }
            hasToken = true
          } catch { }
        }
      }

      if (hasToken) {
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    }

    return { reasoning, content }
  }

  async understandImage(
    imageSource: string | File | Blob,
    modelId?: string,
    userPrompt?: string
  ): Promise<{ description: string; source: string }> {
    let b64: string
    let mime = 'image/png'

    if (imageSource instanceof File || imageSource instanceof Blob) {
      mime = imageSource.type || 'image/png'
      const buf = await imageSource.arrayBuffer()
      b64 = this.arrayBufferToBase64(buf)
    } else {
      if (imageSource.includes('base64,')) {
        const parts = imageSource.split('base64,')
        b64 = parts[1] || parts[0]
        const match = imageSource.match(/^data:(image\/\w+);/)
        if (match) mime = match[1]
      } else {
        const resp = await fetch(imageSource)
        const buf = await resp.arrayBuffer()
        b64 = this.arrayBufferToBase64(buf)
        mime = resp.headers.get('content-type') || 'image/png'
      }
    }

    const prompt = userPrompt || '请用中文简洁描述这张图片的内容'

    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
          { type: 'text', text: prompt },
        ],
      },
    ]

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000)

    try {
      const response = await fetch(`${MINICPM_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${MINICPM_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept-Encoding': 'identity',
        },
        body: JSON.stringify({
          model: modelId || MINICPM_MODEL,
          messages,
          stream: false,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errBody = await response.text().catch(() => '')
        throw new Error(`MiniCPM understand error: ${response.status} ${errBody.slice(0, 200)}`)
      }

      const result = await response.json()
      const description = result.choices?.[0]?.message?.content || ''
      return { description, source: 'api' }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private detectMime(buf: ArrayBuffer): string {
    const uint8 = new Uint8Array(buf.slice(0, 4))
    if (uint8[0] === 0x89 && uint8[1] === 0x50) return 'image/png'
    if (uint8[0] === 0xff && uint8[1] === 0xd8) return 'image/jpeg'
    if (uint8[0] === 0x52 && uint8[1] === 0x49) return 'image/webp'
    if (uint8[0] === 0x47 && uint8[1] === 0x49) return 'image/gif'
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
}

export const miniCPMApi = new MiniCPMApi()