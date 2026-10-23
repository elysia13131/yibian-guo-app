import { registerPlugin } from '@capacitor/core'

export interface IntentHandlerPluginDefinitions {
  getPendingSharedFile(): Promise<{
    hasFile: boolean
    path?: string
    name?: string
    mimeType?: string
  }>
  readSharedFile(): Promise<{
    data: string
    name: string
    mimeType: string
    size: number
  }>
  clearPendingSharedFile(): Promise<void>
  openFileExternally(options: { path: string; mimeType?: string }): Promise<void>
}

export const IntentHandler = registerPlugin<IntentHandlerPluginDefinitions>('IntentHandler')
