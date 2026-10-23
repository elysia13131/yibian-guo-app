import { Plugins, type PluginListenerHandle } from '@capacitor/core'

export interface NekoRealtimePlugin {
  startRealtime(options: { apiKey: string; baseUrl?: string; model?: string; voice?: string; instructions: string; tools?: string }): Promise<void>
  startMic(): Promise<void>
  stopMic(): Promise<void>
  muteMic(): Promise<void>
  unmuteMic(): Promise<void>
  stopRealtime(): Promise<void>
  sendText(options: { text: string }): Promise<void>
  sendImage(options: { image: string }): Promise<void>
  sendToolResult(options: { callId: string; output: string }): Promise<void>
  sendOutputEvents(options: { events: string[] }): Promise<void>
  sendImageFrame(options: { image: string }): Promise<void>
  addListener(eventName: string, listenerFunc: (...args: any[]) => void): PluginListenerHandle
}

declare module '@capacitor/core' {
  interface PluginRegistry {
    NekoRealtime: NekoRealtimePlugin
  }
}

let nativeRealtime: NekoRealtimePlugin | null = null
try {
  if (Plugins.NekoRealtime) {
    nativeRealtime = Plugins.NekoRealtime as NekoRealtimePlugin
  }
} catch {
  nativeRealtime = null
}

const mockRealtime: NekoRealtimePlugin = {
  startRealtime: async () => { console.log('[Realtime Mock] startRealtime') },
  startMic: async () => { console.log('[Realtime Mock] startMic') },
  stopMic: async () => { console.log('[Realtime Mock] stopMic') },
  muteMic: async () => { console.log('[Realtime Mock] muteMic') },
  unmuteMic: async () => { console.log('[Realtime Mock] unmuteMic') },
  stopRealtime: async () => { console.log('[Realtime Mock] stopRealtime') },
  sendText: async () => { console.log('[Realtime Mock] sendText') },
  sendImage: async () => { console.log('[Realtime Mock] sendImage') },
  sendToolResult: async () => { console.log('[Realtime Mock] sendToolResult') },
  sendOutputEvents: async () => { console.log('[Realtime Mock] sendOutputEvents') },
  sendImageFrame: async () => { console.log('[Realtime Mock] sendImageFrame') },
  addListener: (eventName, listenerFunc) => {
    console.log('[Realtime Mock] addListener', eventName)
    return { remove: async () => { console.log('[Realtime Mock] removeListener', eventName) } }
  },
}

const rtImpl = nativeRealtime ?? mockRealtime

export type RealtimeState = 'connecting' | 'connected' | 'ready' | 'idle' | 'disconnected' | 'error'
export type VideoState = 'inactive' | 'activating' | 'active'

type StateHandler = (state: RealtimeState) => void
type TranscriptHandler = (text: string) => void
type TextDeltaHandler = (delta: string) => void
type AudioLevelHandler = (level: number) => void
type LifecycleHandler = () => void
type ErrorHandler = (message: string) => void
type InputTranscriptHandler = (text: string) => void
type ToolCallHandler = (callId: string, name: string, argsJson: string) => void
type VideoStateHandler = (state: VideoState) => void

class RealtimeManagerService {
  private stateHandler: StateHandler | null = null
  private transcriptHandler: TranscriptHandler | null = null
  private textDeltaHandler: TextDeltaHandler | null = null
  private audioLevelHandler: AudioLevelHandler | null = null
  private speechStartedHandler: LifecycleHandler | null = null
  private speechStoppedHandler: LifecycleHandler | null = null
  private errorHandler: ErrorHandler | null = null
  private inputTranscriptHandler: InputTranscriptHandler | null = null
  private toolCallHandler: ToolCallHandler | null = null
  private active = false
  private videoStateInternal: VideoState = 'inactive'
  private videoStateHandler: VideoStateHandler | null = null
  private cameraStream: MediaStream | null = null
  private frameTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    rtImpl.addListener('stateChanged', (data: { state: string }) => {
      this.stateHandler?.(data.state as RealtimeState)
      if (data.state === 'idle') {
        setTimeout(() => this.stateHandler?.('idle'), 100)
      }
    })
    rtImpl.addListener('transcript', (data: { text: string }) => {
      this.transcriptHandler?.(data.text)
    })
    rtImpl.addListener('textDelta', (data: { delta: string }) => {
      this.textDeltaHandler?.(data.delta)
    })
    rtImpl.addListener('audioDelta', (data: { level: number }) => {
      this.audioLevelHandler?.(data.level)
    })
    rtImpl.addListener('speechStarted', () => {
      this.speechStartedHandler?.()
    })
    rtImpl.addListener('speechStopped', () => {
      this.speechStoppedHandler?.()
    })
    rtImpl.addListener('error', (data: { message: string }) => {
      this.errorHandler?.(data.message)
    })
    rtImpl.addListener('inputTranscript', (data: { text: string }) => {
      this.inputTranscriptHandler?.(data.text)
    })
    rtImpl.addListener('toolCall', (data: { callId: string; name: string; arguments: string }) => {
      this.toolCallHandler?.(data.callId, data.name, data.arguments)
    })
  }

  get isNative(): boolean { return nativeRealtime !== null }
  get isActive(): boolean { return this.active }

  async start(instructions: string, toolDefs?: string, voice?: string): Promise<void> {
    const apiKey = localStorage.getItem('dashscope_api_key') || localStorage.getItem('deepseek_api_key') || ''
    if (!apiKey) throw new Error('请在设置中配置 DashScope API Key（用于实时语音）')

    const baseUrl = localStorage.getItem('realtime_base_url') || 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime'

    await rtImpl.startRealtime({ apiKey, baseUrl, model: 'qwen3.5-omni-plus-realtime', voice: voice || 'cherry', instructions, tools: toolDefs || '[]' })
    this.active = true
  }

  async startMic(): Promise<void> {
    await rtImpl.startMic()
  }

  async stopMic(): Promise<void> {
    await rtImpl.stopMic()
  }

  async muteMic(): Promise<void> {
    await rtImpl.muteMic()
  }

  async unmuteMic(): Promise<void> {
    await rtImpl.unmuteMic()
  }

  async stop(): Promise<void> {
    await rtImpl.stopRealtime()
    this.active = false
  }

  async sendText(text: string): Promise<void> {
    await rtImpl.sendText({ text })
  }

  async sendImage(base64Jpeg: string): Promise<void> {
    await rtImpl.sendImage({ image: base64Jpeg })
  }

  async sendToolResult(callId: string, output: string): Promise<void> {
    await rtImpl.sendToolResult({ callId, output })
  }

  async sendOutputEvents(events: string[]): Promise<void> {
    await rtImpl.sendOutputEvents({ events })
  }

  async sendImageFrame(image: string): Promise<void> {
    await rtImpl.sendImageFrame({ image })
  }

  onStateChanged(handler: StateHandler) { this.stateHandler = handler }
  onTranscript(handler: TranscriptHandler) { this.transcriptHandler = handler }
  onTextDelta(handler: TextDeltaHandler) { this.textDeltaHandler = handler }
  onAudioLevel(handler: AudioLevelHandler) { this.audioLevelHandler = handler }
  onSpeechStarted(handler: LifecycleHandler) { this.speechStartedHandler = handler }
  onSpeechStopped(handler: LifecycleHandler) { this.speechStoppedHandler = handler }
  onError(handler: ErrorHandler) { this.errorHandler = handler }
  onInputTranscript(handler: InputTranscriptHandler) { this.inputTranscriptHandler = handler }
  onToolCall(handler: ToolCallHandler) { this.toolCallHandler = handler }
  onVideoStateChanged(handler: VideoStateHandler) { this.videoStateHandler = handler }

  get videoState(): VideoState { return this.videoStateInternal }

  async startCamera(): Promise<void> {
    if (this.videoStateInternal !== 'inactive') return
    this.setVideoState('activating')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 15 },
          facingMode: 'user',
        },
      })
      this.cameraStream = stream
      this.setVideoState('active')
      this.startFrameCapture()
    } catch (e: any) {
      console.warn('[Realtime] camera access denied:', e.message)
      this.setVideoState('inactive')
    }
  }

  async stopCamera(): Promise<void> {
    this.stopFrameCapture()
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(t => t.stop())
      this.cameraStream = null
    }
    this.setVideoState('inactive')
  }

  private setVideoState(state: VideoState) {
    this.videoStateInternal = state
    this.videoStateHandler?.(state)
  }

  private startFrameCapture() {
    this.stopFrameCapture()
    const video = document.createElement('video')
    video.srcObject = this.cameraStream!
    video.playsInline = true
    video.muted = true
    video.play().catch(() => {})

    const canvas = document.createElement('canvas')
    canvas.width = 480
    canvas.height = 360
    const ctx = canvas.getContext('2d')!

    this.frameTimer = setInterval(() => {
      if (!this.cameraStream || this.videoStateInternal !== 'active' || !this.active) return
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const jpeg = canvas.toDataURL('image/jpeg', 0.75)
        const base64 = jpeg.slice(jpeg.indexOf(',') + 1)
        if (base64.length <= 256 * 1024) {
          rtImpl.sendImage({ image: base64 }).catch(() => {})
        }
      } catch {}
    }, 1000)
  }

  private stopFrameCapture() {
    if (this.frameTimer !== null) {
      clearInterval(this.frameTimer)
      this.frameTimer = null
    }
  }
}

export const RealtimeManager = new RealtimeManagerService()
