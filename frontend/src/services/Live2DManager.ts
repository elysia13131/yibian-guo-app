import { Plugins, type PluginListenerHandle } from '@capacitor/core'

export type ExpressionName = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprise' | 'tired'

export type MotionName = string

export interface NekoLive2DFloatingPlugin {
  show(options: { modelName: string }): Promise<{ success: boolean }>
  setExpression(options: { expression: string }): Promise<{ success: boolean }>
  startMotion(options: { motionId: number }): Promise<{ success: boolean }>
  setOpacity(options: { opacity: number }): Promise<{ success: boolean }>
  hide(): Promise<{ success: boolean }>
}

export interface NekoLive2DPlugin {
  loadModel(options: { modelName: string }): Promise<{ success: boolean }>
  config(options: Record<string, unknown>): Promise<{ success: boolean }>
  setExpression(options: { expression: ExpressionName }): Promise<{ success: boolean }>
  startMotion(options: { motion: string }): Promise<{ success: boolean }>
  setLipSyncLevel(options: { level: number }): Promise<{ success: boolean }>
  setPosition(options: { x: number; y: number; scale?: number }): Promise<{ success: boolean }>
  unload(): Promise<{ success: boolean }>
}

export interface NekoTTSPlugin {
  initialize(options?: { language?: string }): Promise<{ success: boolean }>
  speak(options: { text: string }): Promise<{ success: boolean }>
  stop(): Promise<{ success: boolean }>
  isSpeaking(): Promise<{ value: boolean }>
  addListener(eventName: string, listenerFunc: (...args: any[]) => void): PluginListenerHandle
}

declare module '@capacitor/core' {
  interface PluginRegistry {
    NekoLive2D: NekoLive2DPlugin
    NekoLive2DFloating: NekoLive2DFloatingPlugin
    NekoTTS: NekoTTSPlugin
  }
}

let nativeLive2D: NekoLive2DPlugin | null = null
let nativeLive2DFloating: NekoLive2DFloatingPlugin | null = null
let nativeTTS: NekoTTSPlugin | null = null

try {
  if (Plugins.NekoLive2D) {
    nativeLive2D = Plugins.NekoLive2D as NekoLive2DPlugin
  }
  if (Plugins.NekoLive2DFloating) {
    nativeLive2DFloating = Plugins.NekoLive2DFloating as NekoLive2DFloatingPlugin
  }
  if (Plugins.NekoTTS) {
    nativeTTS = Plugins.NekoTTS as NekoTTSPlugin
  }
} catch {
  nativeLive2D = null
  nativeLive2DFloating = null
  nativeTTS = null
}

const mockLive2D: NekoLive2DPlugin = {
  loadModel: async (options) => { console.log('[Live2D Mock] loadModel', options); return { success: true } },
  config: async (options) => { console.log('[Live2D Mock] config', options); return { success: true } },
  setExpression: async (options) => { console.log('[Live2D Mock] setExpression', options); return { success: true } },
  startMotion: async (options) => { console.log('[Live2D Mock] startMotion', options); return { success: true } },
  setLipSyncLevel: async (options) => { console.log('[Live2D Mock] setLipSyncLevel', options); return { success: true } },
  setPosition: async (options) => { console.log('[Live2D Mock] setPosition', options); return { success: true } },
  unload: async () => { console.log('[Live2D Mock] unload'); return { success: true } },
}

const mockLive2DFloating: NekoLive2DFloatingPlugin = {
  show: async (options) => { console.log('[Live2D FloatMock] show', options); return { success: true } },
  setExpression: async (options) => { console.log('[Live2D FloatMock] setExpr', options); return { success: true } },
  startMotion: async (options) => { console.log('[Live2D FloatMock] motion', options); return { success: true } },
  setOpacity: async (options) => { console.log('[Live2D FloatMock] opacity', options); return { success: true } },
  hide: async () => { console.log('[Live2D FloatMock] hide'); return { success: true } },
}

const mockTTS: NekoTTSPlugin = {
  initialize: async (options) => { console.log('[TTS Mock] initialize', options); return { success: true } },
  speak: async (options) => { console.log('[TTS Mock] speak', options); return { success: true } },
  stop: async () => { console.log('[TTS Mock] stop'); return { success: true } },
  isSpeaking: async () => { console.log('[TTS Mock] isSpeaking'); return { value: false } },
  addListener: (eventName, listenerFunc) => {
    console.log('[TTS Mock] addListener', eventName)
    return { remove: async () => { console.log('[TTS Mock] removeListener', eventName) } }
  },
}

const live2DImpl = nativeLive2D ?? mockLive2D
const live2DFloatingImpl = nativeLive2DFloating ?? mockLive2DFloating
const ttsImpl = nativeTTS ?? mockTTS

export const Live2DFloating = {
  show: (modelName: string) => live2DFloatingImpl.show({ modelName }),
  setExpression: (expression: string) => live2DFloatingImpl.setExpression({ expression }),
  startMotion: (motionId: number) => live2DFloatingImpl.startMotion({ motionId }),
  setOpacity: (opacity: number) => live2DFloatingImpl.setOpacity({ opacity }),
  hide: () => live2DFloatingImpl.hide(),
}

export const Live2DManager = {
  loadModel: (modelName: string) => live2DImpl.loadModel({ modelName }),
  setExpression: (expression: ExpressionName) => live2DImpl.setExpression({ expression }),
  startMotion: (motion: string) => live2DImpl.startMotion({ motion }),
  setLipSyncLevel: (level: number) => live2DImpl.setLipSyncLevel({ level }),
  setPosition: (x: number, y: number, scale?: number) => live2DImpl.setPosition({ x, y, scale }),
  setOpacity: (opacity: number) => setOpacityHandlers.forEach(h => h(opacity)),
  unload: () => live2DImpl.unload(),
}

let setOpacityHandlers: ((opacity: number) => void)[] = []

export function onSetOpacity(handler: (opacity: number) => void) {
  setOpacityHandlers.push(handler)
  return () => { setOpacityHandlers = setOpacityHandlers.filter(h => h !== handler) }
}

let speechEndHandler: (() => void) | null = null
let speechErrorHandler: ((error: string) => void) | null = null

try {
  ttsImpl.addListener('speechEnd', () => {
    speechEndHandler?.()
  })
  ttsImpl.addListener('speechError', (error: { message: string }) => {
    speechErrorHandler?.(error.message)
  })
} catch {
  void 0
}

export const TTSManager = {
  init: (options?: { language?: string }) => ttsImpl.initialize(options),
  speak: (text: string) => ttsImpl.speak({ text }),
  stop: () => ttsImpl.stop(),
  isSpeaking: () => ttsImpl.isSpeaking(),
  onSpeechEnd: (handler: () => void) => {
    speechEndHandler = handler
  },
  onSpeechError: (handler: (error: string) => void) => {
    speechErrorHandler = handler
  },
}
