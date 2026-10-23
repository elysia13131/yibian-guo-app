import { getAgentPlugin } from './NekoAgentService'
import type { UIElement, ScreenContent } from '../types'

export class NekoVisionService {
  async captureAndDescribe(): Promise<ScreenContent> {
    const agent = getAgentPlugin()
    const screenshotResult = await agent.captureScreen()
    let rawBase64 = screenshotResult.screenshot

    rawBase64 = await this.compressIfNeeded(rawBase64)

    const hierarchyResult = await agent.getUIHierarchy()
    let uiHierarchy: UIElement[] = []
    try { uiHierarchy = JSON.parse(hierarchyResult.hierarchy) } catch {}

    return { screenshot: rawBase64, uiHierarchy, visionDescription: '' }
  }

  async compressIfNeeded(base64: string): Promise<string> {
    const MAX_BASE64_SIZE = 13 * 1024 * 1024
    const TARGET_HEIGHT = 720
    if (base64.length <= MAX_BASE64_SIZE) return base64
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        let w = img.width, h = img.height
        if (h > TARGET_HEIGHT) {
          const ratio = TARGET_HEIGHT / h
          w = Math.round(w * ratio)
          h = TARGET_HEIGHT
        }
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1])
      }
      img.onerror = () => resolve(base64)
      img.src = `data:image/png;base64,${base64}`
    })
  }

  async findElementByText(text: string): Promise<{ x: number; y: number } | null> {
    const agent = getAgentPlugin()
    const result = await agent.getUIHierarchy()
    let hierarchy: UIElement[] = []
    try { hierarchy = JSON.parse(result.hierarchy) } catch {}
    for (const node of hierarchy) {
      const found = this.searchElement(node, text)
      if (found) return found
    }
    return null
  }

  private searchElement(element: UIElement, text: string): { x: number; y: number } | null {
    if (element.text && element.text.includes(text)) {
      return {
        x: Math.floor((element.bounds.left + element.bounds.right) / 2),
        y: Math.floor((element.bounds.top + element.bounds.bottom) / 2),
      }
    }
    if (element.children) {
      for (const child of element.children) {
        const found = this.searchElement(child, text)
        if (found) return found
      }
    }
    return null
  }
}
