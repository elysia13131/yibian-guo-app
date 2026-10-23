import { registerPlugin } from '@capacitor/core'

export interface AppUpdatePluginDefinitions {
  getCurrentVersion(): Promise<{ version: string; versionCode: number }>
  setCurrentVersion(options: { version: string; versionCode?: number }): Promise<void>
  writeFile(options: { path: string; content: string }): Promise<void>
  deleteFile(options: { path: string }): Promise<void>
  getFileHash(options: { path: string }): Promise<{ exists: boolean; sha256?: string }>
  clearCacheAndReload(): Promise<void>
  installApk(options: { path: string }): Promise<void>
}

export const AppUpdate = registerPlugin<AppUpdatePluginDefinitions>('AppUpdate')
