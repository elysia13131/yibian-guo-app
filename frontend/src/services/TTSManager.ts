import type { TTSEngine, TTSConfig } from '../types'
import { TTSManager as NativeTTS } from './Live2DManager'
import { ttsApi } from '../api'
import { TtsPreprocessor } from '../utils/ttsPreprocessor'

interface TTSOptions { text: string; engine: TTSEngine; speakerId?: string; speedRatio?: number }

export class TTSEngineManager {
  private config: TTSConfig = { preferredEngine: 'online', autoPlay: true }
  private preprocessor = new TtsPreprocessor()
  private _isSpeaking = false
  private currentAudio: HTMLAudioElement | null = null

  constructor() { this.initEngine() }

  get isSpeaking(): boolean { return this._isSpeaking }

  private async initEngine() {
    try { await NativeTTS.init() } catch { console.warn('离线TTS不可用，回退在线') }
  }

  setConfig(config: Partial<TTSConfig>) { this.config = { ...this.config, ...config } }

  async speak(options: TTSOptions) {
    this.preprocessor.reset()
    const processed = this.preprocessor.process(options.text)
    const cleaned = processed.trim()
    if (!cleaned) return

    if (options.engine === 'offline') {
      this._isSpeaking = true
      try {
        await NativeTTS.speak(cleaned)
      } finally {
        this._isSpeaking = false
      }
    } else {
      const speakerId = options.speakerId || localStorage.getItem('tts_speaker_id') || 'default'
      try {
        const blob = await ttsApi.synthesize(cleaned, speakerId)
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        this.currentAudio = audio
        this._isSpeaking = true
        audio.onended = () => { this._isSpeaking = false; this.currentAudio = null }
        audio.onerror = () => { this._isSpeaking = false; this.currentAudio = null }
        audio.play()
        return audio
      } catch {
        console.warn('[TTS] 在线合成失败，跳过')
        this._isSpeaking = false
      }
    }
  }

  async stop() {
    this.preprocessor.reset()
    this._isSpeaking = false
    if (this.currentAudio) {
      this.currentAudio.pause()
      this.currentAudio.src = ''
      this.currentAudio = null
    }
    try { await NativeTTS.stop() } catch {}
  }
}
