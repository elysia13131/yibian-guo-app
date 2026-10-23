import { Live2DManager, type ExpressionName } from './Live2DManager'

export let COMPANION_ENABLED = false

export type CompanionMode = 'text' | 'live2d' | 'floating'
export type VisionMode = 'on-demand' | 'stream'
export type ModeChangeReason = 'user' | 'llm' | 'proactive' | 'agent'

type ModeListener = (mode: CompanionMode, reason: ModeChangeReason) => void
type VisionModeListener = (mode: VisionMode) => void

class CompanionModeService {
  private mode: CompanionMode = 'text'
  private listeners: Set<ModeListener> = new Set()
  private voiceEnabled = false
  private _visionMode: VisionMode = 'on-demand'
  private visionListeners: Set<VisionModeListener> = new Set()

  getMode(): CompanionMode { return this.mode }
  isLive2D(): boolean { return this.mode === 'live2d' }
  isVoiceEnabled(): boolean { return this.voiceEnabled }
  get visionMode(): VisionMode { return this._visionMode }

  subscribeVision(listener: VisionModeListener): () => void {
    this.visionListeners.add(listener)
    return () => this.visionListeners.delete(listener)
  }

  setVisionMode(mode: VisionMode) {
    if (this._visionMode === mode) return
    this._visionMode = mode
    this.visionListeners.forEach(fn => fn(mode))
  }

  subscribe(listener: ModeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(reason: ModeChangeReason) {
    this.listeners.forEach(fn => fn(this.mode, reason))
  }

  async activateLive2D(reason: ModeChangeReason) {
    if (this.mode === 'live2d') return
    const prev = this.mode
    this.mode = 'live2d'
    this.voiceEnabled = true
    this.notify(reason)
    if (prev !== 'floating') {
      await Live2DManager.loadModel('/companion/model.model3.json')
    }
  }

  async deactivateLive2D(reason: ModeChangeReason) {
    if (this.mode !== 'live2d') return
    this.mode = 'text'
    this.voiceEnabled = false
    this.notify(reason)
    await Live2DManager.unload()
  }

  async enterFloatingMode() {
    if (this.mode === 'floating') return
    this.mode = 'floating'
    this.voiceEnabled = false
    this.notify('agent')
  }

  async exitFloatingMode() {
    if (this.mode !== 'floating') return
    this.mode = 'text'
    this.voiceEnabled = false
    this.notify('agent')
    await Live2DManager.unload()
  }

  async setExpression(name: ExpressionName) {
    if (this.mode === 'text') return
    await Live2DManager.setExpression(name)
  }

  async startMotion(name: string) {
    if (this.mode === 'text') return
    await Live2DManager.startMotion(name)
  }

  async setLipSyncLevel(level: number) {
    await Live2DManager.setLipSyncLevel(level)
  }

  async hideForScreenshot() {
    await Live2DManager.setOpacity(0)
    await new Promise(r => setTimeout(r, 60))
  }

  async restoreAfterScreenshot() {
    await Live2DManager.setOpacity(1)
  }
}

export const companionMode = new CompanionModeService()

export { Live2DManager }
export { TTSManager } from './Live2DManager'
