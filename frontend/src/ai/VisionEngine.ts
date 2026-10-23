import { modelManager } from './ModelManager'
import type { ChatCompletionMessage } from '@wllama/wllama'
import type { ChatMessage } from '../plugins/LlamaPlugin'
import { Capacitor } from '@capacitor/core'
import { Directory } from '@capacitor/filesystem'

export interface VisionResult {
  description: string
  labels?: string[]
  confidence?: number
  source: 'model' | 'mock'
}

export type VisionModelId = 'MiniCPM-V-4.6'

const WLLAMA_WASM = 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.2.3/src/wasm/wllama.wasm'

export class VisionEngine {
  private wllama: any = null
  private loadedModelId: VisionModelId | null = null
  private loading = false
  private _loadPromise: Promise<void> | null = null
  private nativeModelDir: string = ''

  private get isNative(): boolean {
    try {
      return Capacitor.isNativePlatform()
    } catch {
      return false
    }
  }

  async isReady(modelId: VisionModelId = 'MiniCPM-V-4.6'): Promise<boolean> {
    if (this.isNative) {
      return this.loadedModelId === modelId && this.nativeModelDir !== ''
    }
    return modelId === this.loadedModelId && this.wllama !== null
  }

  async loadModel(modelId: VisionModelId = 'MiniCPM-V-4.6'): Promise<void> {
    if (this._loadPromise) return this._loadPromise
    if (this.loadedModelId === modelId && (this.wllama || this.nativeModelDir)) return
    if (this.loading) return

    this.loading = true
    this._loadPromise = this._doLoad(modelId)
    try {
      await this._loadPromise
    } finally {
      this.loading = false
      this._loadPromise = null
    }
  }

  private async _doLoad(modelId: VisionModelId): Promise<void> {
    this.wllama = null
    this.loadedModelId = null
    this.nativeModelDir = ''

    const downloaded = await modelManager.isDownloaded(modelId)
    if (!downloaded) {
      throw new Error(`模型 ${modelId} 尚未下载，请前往设置 → AI 模型下载后重试`)
    }

    if (this.isNative) {
      await this._doLoadNative(modelId)
    } else {
      await this._doLoadWeb(modelId)
    }
  }

  private async _doLoadNative(modelId: VisionModelId): Promise<void> {
    const blobs = await modelManager.getModelBlobs(modelId)
    if (blobs.length < 2) {
      throw new Error(`模型文件不完整（需要 2 个文件，实际 ${blobs.length} 个），请重新下载`)
    }

    const { Filesystem } = await import('@capacitor/filesystem')
    const modelDirName = `native-models/${modelId}`
    const markerFile = `${modelDirName}/.ready`

    try {
      await Filesystem.stat({ path: markerFile, directory: Directory.Data })
    } catch {
      await Filesystem.mkdir({ path: modelDirName, directory: Directory.Data, recursive: true })

      const filenames = ['model.gguf', 'mmproj.gguf']
      for (let i = 0; i < filenames.length; i++) {
        const blob = blobs[i]
        if (!blob) continue

        const arrayBuffer = await blob.arrayBuffer()
        const base64 = arrayBufferToBase64(arrayBuffer)

        const chunkSize = 1024 * 1024
        const totalChunks = Math.ceil(base64.length / chunkSize)
        let accumulated = ''

        for (let c = 0; c < totalChunks; c++) {
          const start = c * chunkSize
          const end = Math.min(start + chunkSize, base64.length)
          accumulated += base64.slice(start, end)

          if (accumulated.length >= chunkSize * 3 || c === totalChunks - 1) {
            await Filesystem.appendFile({
              path: `${modelDirName}/${filenames[i]}`,
              data: accumulated,
              directory: Directory.Data,
            })
            accumulated = ''
          }
        }
      }

      await Filesystem.writeFile({
        path: markerFile,
        data: 'ready',
        directory: Directory.Data,
      })
    }

    const result = await Filesystem.stat({ path: modelDirName, directory: Directory.Data })
    const modelPath = result.uri

    const { LlamaPlugin: Plugin } = await import('../plugins/LlamaPlugin')
    await Plugin.loadModel({ modelDir: modelPath, nCtx: 2048, nGpuLayers: 99 })

    this.nativeModelDir = modelPath
    this.loadedModelId = modelId
  }

  private async _doLoadWeb(modelId: VisionModelId): Promise<void> {
    const blobs = await modelManager.getModelBlobs(modelId)
    if (blobs.length < 2) {
      throw new Error(`模型文件不完整（需要 2 个文件，实际 ${blobs.length} 个），请重新下载`)
    }

    const { Wllama } = await import('@wllama/wllama')
    const wllama = new Wllama({ default: WLLAMA_WASM }, {
      suppressNativeLog: true,
    })

    try {
      const loadPromise = wllama.loadModel(blobs, {
        n_ctx: 2048,
        n_gpu_layers: 99,
      })
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('模型加载超时（超过 120 秒）')), 120_000)
      })
      await Promise.race([loadPromise, timeoutPromise])
    } catch (err) {
      await wllama.exit().catch(() => {})
      throw err
    }

    this.wllama = wllama
    this.loadedModelId = modelId
  }

  async unloadModel(): Promise<void> {
    if (this.isNative && this.nativeModelDir) {
      try {
        const { LlamaPlugin } = await import('../plugins/LlamaPlugin')
        await LlamaPlugin.unloadModel()
      } catch {}
      this.nativeModelDir = ''
    }
    if (this.wllama) {
      try { await this.wllama.exit() } catch {}
      this.wllama = null
    }
    this.loadedModelId = null
  }

  async chat(
    text: string,
    onData?: (token: string) => void,
    options?: {
      systemPrompt?: string
      maxTokens?: number
      temperature?: number
      topP?: number
      topK?: number
      minP?: number
      repeatPenalty?: number
      frequencyPenalty?: number
      presencePenalty?: number
      seed?: number
      abortSignal?: AbortSignal
      historyMessages?: { role: 'user' | 'assistant'; content: string }[]
      imagesData?: ArrayBuffer[]
    }
  ): Promise<string> {
    if (this.isNative && this.nativeModelDir) {
      return this._chatNative(text, onData, options)
    }
    if (!this.wllama) {
      throw new Error('模型未加载，请先调用 loadModel()')
    }
    return this._chatWeb(text, onData, options)
  }

  private async _chatNative(
    text: string,
    onData?: (token: string) => void,
    options?: {
      systemPrompt?: string
      maxTokens?: number
      temperature?: number
      abortSignal?: AbortSignal
      historyMessages?: { role: 'user' | 'assistant'; content: string }[]
    }
  ): Promise<string> {
    const prompt = options?.systemPrompt || '你是一个有用的AI助手，请用中文简洁地回答用户的问题。'

    const messages: ChatMessage[] = [
      { role: 'system', content: prompt },
      ...(options?.historyMessages || []).map(m => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content,
      })),
      { role: 'user', content: text },
    ]

    const { nativeChat } = await import('../plugins/LlamaPlugin')
    return nativeChat(messages, onData, {
      maxTokens: options?.maxTokens || 2048,
      temperature: options?.temperature ?? 0.7,
      abortSignal: options?.abortSignal,
    })
  }

  private async _chatWeb(
    text: string,
    onData?: (token: string) => void,
    options?: {
      systemPrompt?: string
      maxTokens?: number
      temperature?: number
      topP?: number
      topK?: number
      minP?: number
      repeatPenalty?: number
      frequencyPenalty?: number
      presencePenalty?: number
      seed?: number
      abortSignal?: AbortSignal
      historyMessages?: { role: 'user' | 'assistant'; content: string }[]
      imagesData?: ArrayBuffer[]
    }
  ): Promise<string> {
    if (!this.wllama) {
      throw new Error('模型未加载')
    }

    const prompt = options?.systemPrompt || '你是一个有用的AI助手，请用中文简洁地回答用户的问题。'

    const userContent: any = (options?.imagesData && options.imagesData.length > 0)
      ? [
          ...options.imagesData.map(data => ({ type: 'image' as const, data })),
          { type: 'text', text },
        ]
      : text

    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: prompt },
      ...(options?.historyMessages || []).map(m => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content,
      }) as ChatCompletionMessage),
      { role: 'user', content: userContent } as ChatCompletionMessage,
    ]

    let fullContent = ''
    let hasToken = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const chatTimeout = new Promise<string>((_, reject) => {
      timer = setTimeout(() => reject(new Error('模型推理超时（超过 30 秒）')), 30_000)
    })

    const doChat = (async () => {
      const stream = await this.wllama.createChatCompletion({
        messages,
        max_tokens: options?.maxTokens || 2048,
        temperature: options?.temperature ?? 0.7,
        top_p: options?.topP,
        top_k: options?.topK,
        min_p: options?.minP,
        penalty_repeat: options?.repeatPenalty,
        penalty_freq: options?.frequencyPenalty,
        penalty_present: options?.presencePenalty,
        seed: options?.seed,
        stream: true,
        abortSignal: options?.abortSignal,
      }) as AsyncIterable<any>

      for await (const chunk of stream) {
        const token = chunk?.choices?.[0]?.delta?.content || ''
        if (token) {
          hasToken = true
          fullContent += token
          onData?.(token)
        }
      }
      return fullContent
    })()

    try {
      return await Promise.race([doChat, chatTimeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async understandImage(
    imageSource: string | File | Blob,
    modelId: VisionModelId = 'MiniCPM-V-4.6',
    userPrompt?: string,
  ): Promise<VisionResult> {
    if (this.loadedModelId === modelId && this.wllama) {
      try {
        const imageData = await this.toArrayBuffer(imageSource)

        const prompt = userPrompt || '请用中文简要描述这张图片的内容。'

        const messages: ChatCompletionMessage[] = [
          {
            role: 'system',
            content: 'You are a helpful assistant. Describe images concisely in Chinese.',
          },
          {
            role: 'user',
            content: [
              { type: 'image', data: imageData },
              { type: 'text', text: prompt },
            ],
          },
        ]

        const response = await this.wllama.createChatCompletion({
          messages,
          max_tokens: 256,
          temperature: 0.1,
          stream: false,
        })

        const text = response?.choices?.[0]?.message?.content || ''

        return {
          description: text,
          source: 'model',
        }
      } catch (err) {
        console.error('模型推理失败，回退到 mock 模式:', err)
      }
    }

    return this.mockUnderstand(imageSource)
  }

  private async toArrayBuffer(source: string | File | Blob): Promise<ArrayBuffer> {
    if (source instanceof File || source instanceof Blob) {
      return await source.arrayBuffer()
    }
    const base64 = source.includes('base64,')
      ? source.split('base64,')[1]
      : source
    const binaryStr = atob(base64)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i)
    }
    return bytes.buffer
  }

  private async mockUnderstand(imageSource: string | File | Blob): Promise<VisionResult> {
    const filename = imageSource instanceof File
      ? imageSource.name
      : typeof imageSource === 'string'
        ? imageSource.split('/').pop() || 'image'
        : 'image'

    return {
      description: `[图片: ${filename}] 这是一张图片，后续下载 MiniCPM-V 4.6 模型后可启用端侧图片理解能力。`,
      source: 'mock',
    }
  }
}

export const visionEngine = new VisionEngine()

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}