import { Live2DManager, type ExpressionName } from './Live2DManager'

type PresenceMode = 'hidden' | 'full' | 'floating'

type PresenceListener = (mode: PresenceMode) => void

class CompanionPresenceService {
  private mode: PresenceMode = 'hidden'
  private listeners: Set<PresenceListener> = new Set()

  getMode(): PresenceMode { return this.mode }

  subscribe(listener: PresenceListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    this.listeners.forEach(fn => fn(this.mode))
  }

  async appear() {
    if (this.mode === 'full') return
    this.mode = 'full'
    this.notify()
    await Live2DManager.loadModel('/companion/model.model3.json')
  }

  async disappear() {
    if (this.mode === 'hidden') return
    this.mode = 'hidden'
    this.notify()
    await Live2DManager.unload()
  }

  async enterFloatingMode() {
    if (this.mode === 'floating') return
    this.mode = 'floating'
    this.notify()
  }

  async exitFloatingMode() {
    if (this.mode !== 'floating') return
    this.mode = 'hidden'
    this.notify()
    await Live2DManager.unload()
  }

  async setExpression(name: ExpressionName) {
    await Live2DManager.setExpression(name)
  }

  async startMotion(name: string) {
    await Live2DManager.startMotion(name)
  }

  async hideForScreenshot() {
    await Live2DManager.setOpacity(0)
    await new Promise(r => setTimeout(r, 60))
  }

  async restoreAfterScreenshot() {
    await Live2DManager.setOpacity(1)
  }
}

export const companionPresence = new CompanionPresenceService()
