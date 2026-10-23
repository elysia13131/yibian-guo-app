/**
 * BGM 缓存服务：双层缓存（内存 + IndexedDB），支持断点续传和下载进度。
 *
 * API:
 *   getStreamUrl(filename)  → 后端直链，用于流式播放（无需等待）
 *   getCachedUrl(filename)  → blob URL（已缓存）或 null
 *   download(filename, onProgress) → 显式下载，带回调和进度，已缓存时立即完成
 *   getCacheStatus(filename) → { cached, totalSize, downloadedSize }
 *   evict(filename) / clearAll()
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://yibianguo.preview.aliyun-zeabur.cn'
const DB_NAME = 'bgm-cache'
const STORE_META = 'file-meta'
const STORE_DATA = 'file-data'
const DB_VERSION = 2

export interface CacheStatus {
  cached: boolean
  totalSize: number
  downloadedSize: number
}

export type DownloadProgress = {
  percent: number
  loadedBytes: number
  totalBytes: number
}

class BgmCacheService {
  private cache = new Map<string, string>()          // filename → blob URL
  private pending = new Map<string, Promise<string>>()
  private dbPromise: Promise<IDBDatabase> | null = null

  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META)
        if (!db.objectStoreNames.contains(STORE_DATA)) db.createObjectStore(STORE_DATA)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return this.dbPromise
  }

  // ── IndexedDB 读写 ──

  private async getMeta(filename: string): Promise<{ totalSize: number; downloadedSize: number } | null> {
    try {
      const db = await this.openDB()
      return new Promise(resolve => {
        const tx = db.transaction(STORE_META, 'readonly')
        const req = tx.objectStore(STORE_META).get(filename)
        req.onsuccess = () => resolve(req.result || null)
        req.onerror = () => resolve(null)
      })
    } catch { return null }
  }

  private async putMeta(filename: string, meta: { totalSize: number; downloadedSize: number }): Promise<void> {
    try {
      const db = await this.openDB()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_META, 'readwrite')
        tx.objectStore(STORE_META).put(meta, filename)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch { /* ignore */ }
  }

  private async getData(filename: string): Promise<ArrayBuffer | null> {
    try {
      const db = await this.openDB()
      return new Promise(resolve => {
        const tx = db.transaction(STORE_DATA, 'readonly')
        const req = tx.objectStore(STORE_DATA).get(filename)
        req.onsuccess = () => resolve(req.result || null)
        req.onerror = () => resolve(null)
      })
    } catch { return null }
  }

  private async putData(filename: string, data: ArrayBuffer): Promise<void> {
    try {
      const db = await this.openDB()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_DATA, 'readwrite')
        tx.objectStore(STORE_DATA).put(data, filename)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch { /* ignore */ }
  }

  // ── 公开 API ──

  /** 返回后端直链 URL，直接用于 <audio src> 流式播放，无需等待下载 */
  getStreamUrl(filename: string): string {
    return `${API_BASE}/api/v1/game/bgm/${filename}`
  }

  /** 返回缓存的 blob URL，未缓存时返回 null */
  async getCachedUrl(filename: string): Promise<string | null> {
    // 1. 内存
    if (this.cache.has(filename)) return this.cache.get(filename)!

    // 2. IndexedDB
    const meta = await this.getMeta(filename)
    if (!meta || meta.downloadedSize < meta.totalSize) return null

    const data = await this.getData(filename)
    if (!data || data.byteLength < meta.totalSize) return null

    const blob = new Blob([data])
    const url = URL.createObjectURL(blob)
    this.cache.set(filename, url)
    return url
  }

  /** 获取缓存状态 */
  async getCacheStatus(filename: string): Promise<CacheStatus> {
    const meta = await this.getMeta(filename)
    if (!meta) return { cached: false, totalSize: 0, downloadedSize: 0 }
    return {
      cached: meta.downloadedSize >= meta.totalSize,
      totalSize: meta.totalSize,
      downloadedSize: meta.downloadedSize,
    }
  }

  /**
   * 显式下载 BGM 到缓存，支持断点续传和进度回调。
   * 如果已缓存则立即完成。
   */
  async download(
    filename: string,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<string> {
    // 已缓存
    const cached = await this.getCachedUrl(filename)
    if (cached) {
      const meta = await this.getMeta(filename)
      if (meta) {
        onProgress?.({ percent: 100, loadedBytes: meta.totalSize, totalBytes: meta.totalSize })
      }
      return cached
    }

    // 去重
    if (this.pending.has(filename)) return this.pending.get(filename)!

    const promise = this._download(filename, onProgress)
    this.pending.set(filename, promise)
    return promise
  }

  private async _download(
    filename: string,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<string> {
    const url = this.getStreamUrl(filename)

    // 获取文件总大小
    let totalSize = 0
    try {
      const headResp = await fetch(url, { method: 'HEAD' })
      if (headResp.ok) {
        const cl = headResp.headers.get('Content-Length') || headResp.headers.get('content-length')
        totalSize = cl ? parseInt(cl, 10) : 0
      }
    } catch { /* 继续用 GET */ }

    if (!totalSize) {
      // 回退：完整下载
      return this._downloadFull(filename, url, onProgress)
    }

    // 检查是否有部分数据（断点续传）
    let existingData: ArrayBuffer | null = null
    let downloadedSize = 0
    const existingMeta = await this.getMeta(filename)
    if (existingMeta && existingMeta.downloadedSize > 0 && existingMeta.downloadedSize < totalSize) {
      const data = await this.getData(filename)
      if (data) {
        existingData = data
        downloadedSize = existingMeta.downloadedSize
      }
    }

    if (downloadedSize >= totalSize) {
      // 数据已完整但元数据不一致
      const finalData = existingData || (await this.getData(filename))
      if (finalData) {
        await this.putMeta(filename, { totalSize, downloadedSize: totalSize })
        const blob = new Blob([finalData])
        const blobUrl = URL.createObjectURL(blob)
        this.cache.set(filename, blobUrl)
        onProgress?.({ percent: 100, loadedBytes: totalSize, totalBytes: totalSize })
        return blobUrl
      }
      downloadedSize = 0
    }

    // 流式下载（Range 请求）
    await this.putMeta(filename, { totalSize, downloadedSize })

    try {
      const resp = await fetch(url, {
        headers: downloadedSize > 0 ? { Range: `bytes=${downloadedSize}-` } : {},
      })
      if (!resp.ok && (downloadedSize > 0 ? resp.status !== 206 : true)) {
        throw new Error(`下载失败 (HTTP ${resp.status})`)
      }

      const reader = resp.body!.getReader()
      const chunks: Uint8Array[] = []
      let loaded = downloadedSize

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        loaded += value.length
        onProgress?.({ percent: Math.round((loaded / totalSize) * 100), loadedBytes: loaded, totalBytes: totalSize })
      }

      // 合并
      const merged = new Uint8Array(loaded)
      let offset = 0
      if (existingData) {
        merged.set(new Uint8Array(existingData), 0)
        offset = existingData.byteLength
      }
      for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.length
      }

      const mergedBuffer = merged.buffer as ArrayBuffer
      await this.putData(filename, mergedBuffer)
      await this.putMeta(filename, { totalSize, downloadedSize: mergedBuffer.byteLength })

      const blob = new Blob([mergedBuffer])
      const blobUrl = URL.createObjectURL(blob)
      this.cache.set(filename, blobUrl)
      onProgress?.({ percent: 100, loadedBytes: mergedBuffer.byteLength, totalBytes: totalSize })
      return blobUrl
    } catch (e) {
      // 保存已下载的部分元数据
      await this.putMeta(filename, { totalSize, downloadedSize })
      throw e
    }
  }

  private async _downloadFull(
    filename: string,
    url: string,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<string> {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`下载失败 (HTTP ${resp.status})`)

    const cl = resp.headers.get('Content-Length') || resp.headers.get('content-length')
    const totalSize = cl ? parseInt(cl, 10) : 0

    const reader = resp.body!.getReader()
    const chunks: Uint8Array[] = []
    let loaded = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.length
      if (totalSize > 0) {
        onProgress?.({ percent: Math.round((loaded / totalSize) * 100), loadedBytes: loaded, totalBytes: totalSize })
      }
    }

    const merged = new Uint8Array(loaded)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }

    const buffer = merged.buffer as ArrayBuffer
    if (totalSize > 0) {
      await this.putMeta(filename, { totalSize, downloadedSize: buffer.byteLength })
    }
    await this.putData(filename, buffer)

    const blob = new Blob([buffer])
    const blobUrl = URL.createObjectURL(blob)
    this.cache.set(filename, blobUrl)
    onProgress?.({ percent: 100, loadedBytes: buffer.byteLength, totalBytes: totalSize })
    return blobUrl
  }

  /** 清除单个文件缓存 */
  async evict(filename: string): Promise<void> {
    const existing = this.cache.get(filename)
    if (existing) URL.revokeObjectURL(existing)
    this.cache.delete(filename)
    this.pending.delete(filename)
    try {
      const db = await this.openDB()
      const tx = db.transaction([STORE_META, STORE_DATA], 'readwrite')
      tx.objectStore(STORE_META).delete(filename)
      tx.objectStore(STORE_DATA).delete(filename)
    } catch { /* ignore */ }
  }

  /** 清除所有缓存 */
  async clearAll(): Promise<void> {
    for (const url of this.cache.values()) URL.revokeObjectURL(url)
    this.cache.clear()
    this.pending.clear()
    try {
      const db = await this.openDB()
      const tx = db.transaction([STORE_META, STORE_DATA], 'readwrite')
      tx.objectStore(STORE_META).clear()
      tx.objectStore(STORE_DATA).clear()
    } catch { /* ignore */ }
  }
}

export const bgmCache = new BgmCacheService()
