import { Capacitor } from '@capacitor/core'
import JSZip from 'jszip'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export interface ManifestFile {
  sha256: string
  size: number
}

export interface UpdateManifest {
  version: string
  versionCode: number
  minVersionCode?: number
  files: Record<string, ManifestFile>
  needsReinstall?: boolean
  apkUrl?: string
}

export interface UpdateInfo {
  hasUpdate: boolean
  needsApkUpdate: boolean
  latestVersion: string
  latestVersionCode: number
  currentVersion: string
  currentVersionCode: number
  totalSize: number
  manifest: UpdateManifest | null
}

export type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'completed' | 'error'

export interface DownloadProgress {
  percent: number
  loadedBytes: number
  totalBytes: number
  currentFile: string
}

type StateCallback = (state: UpdateState) => void

class UpdateManager {
  private state: UpdateState = 'idle'
  private stateListeners: StateCallback[] = []
  private currentVersion = '0.0.0'
  private currentVersionCode = 0
  private abortController: AbortController | null = null
  private apkDownloadUrl = ''

  private get isNative(): boolean {
    try {
      return Capacitor.isNativePlatform()
    } catch {
      return false
    }
  }

  onStateChange(cb: StateCallback): () => void {
    this.stateListeners.push(cb)
    return () => {
      this.stateListeners = this.stateListeners.filter(l => l !== cb)
    }
  }

  private setState(state: UpdateState): void {
    this.state = state
    this.stateListeners.forEach(l => l(state))
  }

  getState(): UpdateState {
    return this.state
  }

  async init(): Promise<void> {
    // 始终以构建注入的版本为基准
    this.currentVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null) || '0.0.0'
    this.currentVersionCode = (typeof __APP_VERSION_CODE__ !== 'undefined' ? __APP_VERSION_CODE__ : null) || 0
    console.log('[Update] init build version:', this.currentVersion, 'build versionCode:', this.currentVersionCode, 'isNative:', this.isNative)

    if (!this.isNative) return

    // 尝试读取持久化版本（热更新可能已升级到更高版本）
    try {
      const { AppUpdate } = await import('../plugins/AppUpdate')
      const result = await AppUpdate.getCurrentVersion()
      console.log('[Update] getCurrentVersion result:', JSON.stringify(result))
      if ((result.versionCode || 0) > this.currentVersionCode) {
        this.currentVersion = result.version || this.currentVersion
        this.currentVersionCode = result.versionCode
        console.log('[Update] using plugin version:', this.currentVersion, this.currentVersionCode)
      }
      // 如果持久化的版本比构建版本低，写入新版本覆盖
      if ((result.versionCode || 0) < this.currentVersionCode) {
        await AppUpdate.setCurrentVersion({ version: this.currentVersion, versionCode: this.currentVersionCode })
      }
    } catch (e) {
      console.error('[Update] getCurrentVersion failed:', e)
      // 回退：从 Capacitor 系统 API 获取版本号
      try {
        const { App } = await import('@capacitor/app')
        const info = await App.getInfo()
        console.log('[Update] Capacitor App info:', info.version, info.build)
      } catch { }
    }
  }

  async checkForUpdate(): Promise<UpdateInfo> {
    console.log('[Update] checkForUpdate start, isNative:', this.isNative, 'currentVersionCode:', this.currentVersionCode)
    this.setState('checking')

    try {
      this.apkDownloadUrl = `${API_BASE_URL}/update/www.zip`

      const manifestResp = await fetch(`${API_BASE_URL}/update/manifest.json`)
      if (!manifestResp.ok) {
        this.setState('idle')
        return { hasUpdate: false, needsApkUpdate: false, latestVersion: '', latestVersionCode: 0,
          currentVersion: this.currentVersion, currentVersionCode: this.currentVersionCode,
          totalSize: 0, manifest: null }
      }

      const remoteManifest: UpdateManifest = await manifestResp.json()
      console.log('[Update] remote versionCode:', remoteManifest.versionCode, 'local:', this.currentVersionCode)
      const totalSize = Object.values(remoteManifest.files).reduce((s, f) => s + f.size, 0)

      // 以 versionCode 为唯一更新判断依据
      const hasUpdate = (remoteManifest.versionCode || 0) > this.currentVersionCode

      // versionCode 低于 minVersionCode → 需要下载完整 APK（原生代码有差异）
      const needsApkUpdate = hasUpdate
        && this.currentVersionCode > 0
        && this.currentVersionCode < (remoteManifest.minVersionCode || 0)

      this.setState(hasUpdate ? 'available' : 'idle')

      return {
        hasUpdate,
        needsApkUpdate,
        latestVersion: remoteManifest.version,
        latestVersionCode: remoteManifest.versionCode || 0,
        currentVersion: this.currentVersion,
        currentVersionCode: this.currentVersionCode,
        totalSize,
        manifest: remoteManifest,
      }
    } catch {
      this.setState('idle')
      return { hasUpdate: false, needsApkUpdate: false, latestVersion: '', latestVersionCode: 0,
        currentVersion: this.currentVersion, currentVersionCode: this.currentVersionCode,
        totalSize: 0, manifest: null }
    }
  }

  async downloadUpdate(
    manifest: UpdateManifest,
    onProgress: (progress: DownloadProgress) => void,
  ): Promise<void> {
    console.log('[Update] downloadUpdate called, isNative:', this.isNative)
    if (!this.isNative) {
      console.log('[Update] Not native, skipping download')
      return
    }

    this.setState('downloading')
    this.abortController = new AbortController()

    const { AppUpdate } = await import('../plugins/AppUpdate')

    let loadedBytes = 0
    const totalBytes = Object.values(manifest.files).reduce((s, f) => s + f.size, 0)

    try {
      onProgress({ percent: 0, loadedBytes: 0, totalBytes, currentFile: '正在下载...' })

      // 流式下载 www.zip，实时上报进度
      const response = await fetch(this.apkDownloadUrl, { signal: this.abortController.signal })
      if (!response.ok) throw new Error(`下载失败 (HTTP ${response.status})`)

      const contentLength = Number(response.headers.get('content-length')) || 0
      const reader = response.body!.getReader()
      const chunks: Uint8Array[] = []
      let downloaded = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        downloaded += value.length
        if (contentLength > 0) {
          onProgress({
            percent: Math.round((downloaded / contentLength) * 50),
            loadedBytes: downloaded,
            totalBytes: contentLength,
            currentFile: '正在下载...',
          })
        }
      }

      const zipBlob = new Blob(chunks as BlobPart[])
      const zip = await JSZip.loadAsync(zipBlob)

      for (const [filePath, fileInfo] of Object.entries(manifest.files)) {
        if (this.abortController.signal.aborted) throw new Error('更新已取消')

        // 增量：SHA256 一致的跳过
        try {
          const result = await AppUpdate.getFileHash({ path: filePath })
          if (result.exists && result.sha256 === fileInfo.sha256) {
            loadedBytes += fileInfo.size
            continue
          }
        } catch { /* file doesn't exist, write it */ }

        onProgress({
          percent: 50 + Math.round((loadedBytes / totalBytes) * 50),
          loadedBytes, totalBytes, currentFile: filePath,
        })

        const zipEntry = zip.file(filePath)
        if (!zipEntry) throw new Error(`更新包中缺少文件: ${filePath}`)

        const base64 = await zipEntry.async('base64')
        await AppUpdate.writeFile({ path: filePath, content: base64 })
        loadedBytes += fileInfo.size

        onProgress({
          percent: 50 + Math.round((loadedBytes / totalBytes) * 50),
          loadedBytes, totalBytes, currentFile: filePath,
        })
      }

      // 持久化新版本
      await AppUpdate.setCurrentVersion({ version: manifest.version, versionCode: manifest.versionCode || 0 })
      this.currentVersion = manifest.version
      this.currentVersionCode = manifest.versionCode || 0

      // 清除 WebView 缓存并强制重载
      await AppUpdate.clearCacheAndReload()

      this.setState('completed')
    } catch (err: any) {
      this.setState(err.name === 'AbortError' ? 'idle' : 'error')
      throw err
    }
  }

  async downloadAndInstallApk(
    manifest: UpdateManifest,
    onProgress: (progress: DownloadProgress) => void,
  ): Promise<void> {
    console.log('[Update] downloadAndInstallApk called, isNative:', this.isNative)
    if (!this.isNative) {
      console.log('[Update] Not native, skipping APK download')
      return
    }

    this.setState('downloading')
    this.abortController = new AbortController()

    const { AppUpdate } = await import('../plugins/AppUpdate')
    const apkUrl = `${API_BASE_URL}/${manifest.apkUrl || 'update/app-debug.apk'}`

    try {
      onProgress({ percent: 0, loadedBytes: 0, totalBytes: 0, currentFile: '正在下载安装包...' })

      const response = await fetch(apkUrl, { signal: this.abortController.signal })
      if (!response.ok) throw new Error(`下载失败 (HTTP ${response.status})`)

      const contentLength = Number(response.headers.get('content-length')) || 0
      const reader = response.body!.getReader()
      const chunks: Uint8Array[] = []
      let downloaded = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        downloaded += value.length
        onProgress({
          percent: contentLength > 0 ? Math.round((downloaded / contentLength) * 90) : 0,
          loadedBytes: downloaded,
          totalBytes: contentLength,
          currentFile: contentLength > 0
            ? `正在下载 ${(downloaded / 1024 / 1024).toFixed(1)} / ${(contentLength / 1024 / 1024).toFixed(1)} MB`
            : '正在下载...',
        })
      }

      // 写入 APK 到内部存储
      const apkRelativePath = 'apk/update.apk'
      const apkBase64 = await blobToBase64(new Blob(chunks as BlobPart[]))
      await AppUpdate.writeFile({ path: apkRelativePath, content: apkBase64 })

      onProgress({ percent: 95, loadedBytes: downloaded, totalBytes: contentLength, currentFile: '正在启动安装...' })

      await AppUpdate.installApk({ path: apkRelativePath })

      onProgress({ percent: 100, loadedBytes: downloaded, totalBytes: contentLength, currentFile: '请在安装界面确认' })
      this.setState('completed')
    } catch (err: any) {
      this.setState(err.name === 'AbortError' ? 'idle' : 'error')
      throw err
    }
  }

  cancelDownload(): void {
    this.abortController?.abort()
    this.abortController = null
  }
}

export const updateManager = new UpdateManager()
