import { Plugins } from '@capacitor/core'

export interface NekoAgentPlugin {
  checkAccessibilityPermission(): Promise<{ enabled: boolean }>
  requestAccessibilityPermission(): Promise<void>
  getUIHierarchy(): Promise<{ hierarchy: string }>
  click(options: { x: number; y: number }): Promise<{ success: boolean }>
  longClick(options: { x: number; y: number }): Promise<{ success: boolean }>
  scroll(options: { startX: number; startY: number; endX: number; endY: number }): Promise<{ success: boolean }>
  inputText(options: { text: string }): Promise<{ success: boolean }>
  goBack(): Promise<{ success: boolean }>
  goHome(): Promise<{ success: boolean }>
  openApp(options: { packageName: string }): Promise<{ success: boolean }>
  waitForUI(): Promise<{ success: boolean }>
  requestScreenCapture(): Promise<void>
  captureScreen(): Promise<{ screenshot: string }>
}

declare module '@capacitor/core' {
  interface PluginRegistry {
    NekoAgent: NekoAgentPlugin
  }
}

declare global {
  interface Window {
    __NEKO_AGENT__: NekoAgentPlugin
  }
}

let pluginInstance: NekoAgentPlugin | null = null

try {
  if (Plugins.NekoAgent) {
    pluginInstance = Plugins.NekoAgent as NekoAgentPlugin
  }
} catch {
  pluginInstance = null
}

const mockPlugin: NekoAgentPlugin = {
  checkAccessibilityPermission: async () => { console.log('[NekoAgent Mock] check'); return { enabled: false } },
  requestAccessibilityPermission: async () => { console.log('[NekoAgent Mock] request permission') },
  getUIHierarchy: async () => { console.log('[NekoAgent Mock] getUIHierarchy'); return { hierarchy: '[]' } },
  click: async (o) => { console.log('[NekoAgent Mock] click', o); return { success: true } },
  longClick: async (o) => { console.log('[NekoAgent Mock] longClick', o); return { success: true } },
  scroll: async (o) => { console.log('[NekoAgent Mock] scroll', o); return { success: true } },
  inputText: async (o) => { console.log('[NekoAgent Mock] inputText', o); return { success: true } },
  goBack: async () => { console.log('[NekoAgent Mock] goBack'); return { success: true } },
  goHome: async () => { console.log('[NekoAgent Mock] goHome'); return { success: true } },
  openApp: async (o) => { console.log('[NekoAgent Mock] openApp', o); return { success: true } },
  waitForUI: async () => { console.log('[NekoAgent Mock] waitForUI'); return { success: true } },
  requestScreenCapture: async () => { console.log('[NekoAgent Mock] requestScreenCapture') },
  captureScreen: async () => { console.log('[NekoAgent Mock] captureScreen'); return { screenshot: '' } },
}

const instance = pluginInstance ?? mockPlugin
window.__NEKO_AGENT__ = instance

export function getAgentPlugin(): NekoAgentPlugin {
  return instance
}
