import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { Capacitor } from '@capacitor/core'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlamaPluginDefinitions {
  loadModel(options: {
    modelDir: string
    nCtx?: number
    nGpuLayers?: number
  }): Promise<void>
  startChat(options: {
    messages: ChatMessage[]
    maxTokens?: number
    temperature?: number
    topP?: number
  }): Promise<void>
  abortChat(): Promise<void>
  unloadModel(): Promise<void>
  getModelStatus(): Promise<{ loaded: boolean; modelId: string }>
}

export const LlamaPlugin = registerPlugin<LlamaPluginDefinitions>('LlamaPlugin')

let tokenListener: PluginListenerHandle | null = null
let doneListener: PluginListenerHandle | null = null
let errorListener: PluginListenerHandle | null = null

export function isNativeInferenceAvailable(): boolean {
  return Capacitor.isNativePlatform()
}

export async function nativeLoadModel(modelDir: string): Promise<void> {
  await LlamaPlugin.loadModel({ modelDir, nCtx: 2048, nGpuLayers: 99 })
}

export async function nativeChat(
  messages: ChatMessage[],
  onData?: (token: string) => void,
  options?: {
    maxTokens?: number
    temperature?: number
    abortSignal?: AbortSignal
  },
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      tokenListener = await (LlamaPlugin as any).addListener('chatToken', (data: { token: string }) => {
        onData?.(data.token)
      })

      doneListener = await (LlamaPlugin as any).addListener('chatDone', (data: { content: string }) => {
        cleanup()
        resolve(data.content)
      })

      errorListener = await (LlamaPlugin as any).addListener('chatError', (data: { message: string }) => {
        cleanup()
        reject(new Error(data.message))
      })

      if (options?.abortSignal) {
        options.abortSignal.addEventListener('abort', () => {
          LlamaPlugin.abortChat().catch(() => {})
          cleanup()
          reject(new Error('推理已取消'))
        }, { once: true })
      }

      await LlamaPlugin.startChat({
        messages,
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
      })
    } catch (err) {
      cleanup()
      reject(err)
    }
  })
}

export async function nativeUnloadModel(): Promise<void> {
  cleanup()
  await LlamaPlugin.unloadModel()
}

function cleanup(): void {
  tokenListener?.remove()
  tokenListener = null
  doneListener?.remove()
  doneListener = null
  errorListener?.remove()
  errorListener = null
}